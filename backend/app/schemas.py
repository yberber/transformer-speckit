"""Pydantic models mirroring `contracts/inference-api.openapi.yaml` (the contract is authoritative;
tests/contract validates real responses against it).

Request models forbid unknown fields. The `maxLength` of `text` is only a transport guard: the
character limit (code points) and the token limit are checked by the endpoint, so that they
answer with their own error codes.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.limits import load_limits

_limits = load_limits()
# Longest sequence a detail endpoint accepts: an input plus everything generated from it.
MAX_SEQUENCE = _limits.max_input_tokens + _limits.max_new_tokens


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


TokenIds = Annotated[
    list[Annotated[int, Field(ge=0)]], Field(min_length=1, max_length=MAX_SEQUENCE)
]


class RunRequest(_Strict):
    text: Annotated[str, Field(max_length=4000)]
    max_new_tokens: Annotated[int, Field(ge=0)]


class TokenIdsRequest(_Strict):
    token_ids: TokenIds


class AttentionRequest(_Strict):
    token_ids: TokenIds
    layer: Annotated[int, Field(ge=1)]


class EncodedArray(_Strict):
    dtype: Literal["float32", "uint16"]
    shape: list[int]
    scale: float | None = None
    data: str


class ModelRef(_Strict):
    id: str
    revision: str
    versions: dict[str, str]


class Limits(_Strict):
    max_input_tokens: int
    max_new_tokens: int
    max_input_chars: int
    wait_limit_s: int


class Health(_Strict):
    status: Literal["ok"] = "ok"
    api_version: str
    model: ModelRef
    limits: Limits


class RunResponse(_Strict):
    model: ModelRef
    # The contract's RunCore (example-data.schema.json), as produced by `Run.to_core()`.
    run: dict[str, Any]


class AttentionResponse(_Strict):
    layer: int
    n_tokens: int
    weights: EncodedArray


class TokenEmbeddingsResponse(_Strict):
    unique_ids: list[int]
    embeddings: EncodedArray


ErrorCode = Literal[
    "empty_input",
    "input_too_long_chars",
    "input_too_long_tokens",
    "invalid_request",
    "rate_limited",
    "busy",
    "model_loading",
    "internal",
]


class ErrorDetail(_Strict):
    code: ErrorCode
    # Numbers or field names only, never user input.
    params: dict[str, int | str] | None = None


class ErrorBody(_Strict):
    error: ErrorDetail
