"""The four endpoints of `contracts/inference-api.openapi.yaml`.

`/runs` is the only place live text is tokenized (FR-013). Every check that can reject a request
runs before the model, and model work runs in the thread pool behind the concurrency gate.
Detail endpoints take the token IDs a run returned, so they never tokenize or generate.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from app import ratelimit
from app.core import model as gpt2
from app.core.encode import U16_SCALE, encoded_array, pack_causal, quantize_u16
from app.core.run import attention_layer, compute_run, token_embeddings
from app.errors import ApiError
from app.limits import load_limits
from app.schemas import (
    AttentionRequest,
    AttentionResponse,
    EncodedArray,
    Health,
    Limits,
    ModelRef,
    RunRequest,
    RunResponse,
    TokenEmbeddingsResponse,
    TokenIdsRequest,
)

# `info.version` of the contract; tests/contract checks that the two agree.
API_VERSION = "1.0.0"

router = APIRouter(prefix="/api/v1")


def _model_ref() -> ModelRef:
    return ModelRef(id=gpt2.MODEL_ID, revision=gpt2.MODEL_REVISION, versions=gpt2.versions())


def _require_ready(request: Request) -> None:
    if not request.app.state.ready:
        raise ApiError("model_loading")


def _check_ids(token_ids: list[int]) -> None:
    """Longer than a live run can be, longer than the context, or outside the vocabulary."""
    limits = load_limits()
    config = gpt2.load()[1].config
    if len(token_ids) > min(limits.max_input_tokens + limits.max_new_tokens, config.n_positions):
        raise ApiError("invalid_request", {"field": "token_ids"})
    if any(i >= config.vocab_size for i in token_ids):
        raise ApiError("invalid_request", {"field": "token_ids"})


def _json(model: Any) -> dict[str, Any]:
    return model.model_dump(exclude_none=True)


@router.get("/health")
def health(request: Request) -> dict[str, Any]:
    _require_ready(request)
    limits = load_limits()
    return _json(
        Health(
            api_version=API_VERSION,
            model=_model_ref(),
            limits=Limits(
                max_input_tokens=limits.max_input_tokens,
                max_new_tokens=limits.max_new_tokens,
                max_input_chars=limits.max_input_chars,
                wait_limit_s=limits.wait_limit_s,
            ),
        )
    )


@router.post("/runs")
async def create_run(body: RunRequest, request: Request) -> dict[str, Any]:
    ratelimit.check_rate(request, "runs")
    limits = load_limits()
    text = body.text
    if text.strip() == "":
        raise ApiError("empty_input")
    if len(text) > limits.max_input_chars:  # code points
        raise ApiError(
            "input_too_long_chars", {"limit": limits.max_input_chars, "actual": len(text)}
        )
    if body.max_new_tokens > limits.max_new_tokens:
        raise ApiError("invalid_request", {"field": "max_new_tokens"})
    _require_ready(request)
    ids = gpt2.tokenize(text)
    if len(ids) > limits.max_input_tokens:
        raise ApiError(
            "input_too_long_tokens", {"limit": limits.max_input_tokens, "actual": len(ids)}
        )
    n_positions = gpt2.load()[1].config.n_positions
    steps = min(body.max_new_tokens, n_positions - len(ids))

    def work() -> dict[str, Any]:
        return compute_run(ids, steps).to_core()

    async with ratelimit.model_gate():
        core = await run_in_threadpool(work)
    return RunResponse(model=_model_ref(), run=core).model_dump()


@router.post("/attention")
async def get_attention(body: AttentionRequest, request: Request) -> dict[str, Any]:
    ratelimit.check_rate(request, "detail")
    _require_ready(request)
    _check_ids(body.token_ids)
    if body.layer > gpt2.load()[1].config.n_layer:
        raise ApiError("invalid_request", {"field": "layer"})

    def work() -> np.ndarray:
        weights, _ = quantize_u16(attention_layer(body.token_ids, body.layer))
        return pack_causal(weights)

    async with ratelimit.model_gate():
        packed = await run_in_threadpool(work)
    return _json(
        AttentionResponse(
            layer=body.layer,
            n_tokens=len(body.token_ids),
            weights=EncodedArray(**encoded_array(packed, "uint16", U16_SCALE)),
        )
    )


@router.post("/token-embeddings")
async def get_token_embeddings(body: TokenIdsRequest, request: Request) -> dict[str, Any]:
    ratelimit.check_rate(request, "detail")
    _require_ready(request)
    _check_ids(body.token_ids)

    async with ratelimit.model_gate():
        unique_ids, rows = await run_in_threadpool(token_embeddings, body.token_ids)
    return _json(
        TokenEmbeddingsResponse(
            unique_ids=unique_ids, embeddings=EncodedArray(**encoded_array(rows, "float32"))
        )
    )
