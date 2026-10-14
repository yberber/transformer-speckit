"""The one computation core shared by the live service and the example generator (research R4).

A Run is one token sequence; generation step k is the prefix of length n_input + k (R5):

1. Greedy generation with the KV cache. Each step's top-10 candidates come from the same logits
   that chose the appended token, so the marked greedy choice always equals the next token.
2. One forward pass over the final sequence with hooks collects attention and per-block change
   percentages for every position. GPT-2 is causal, so row i depends only on tokens 0..i and the
   full pass gives exactly the data of every step.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
import torch

from app.core import model as gpt2
from app.core.encode import sig7

TOP_K = 10

StopReason = Literal["step_limit", "eos", "context_limit"]


@dataclass(frozen=True)
class Run:
    token_ids: list[int]
    n_input: int
    steps: int
    stop_reason: StopReason
    # predictions[k] = top-10 (id, prob) at step k, sorted by prob desc, ties by id asc.
    predictions: list[list[tuple[int, float]]]
    # [n_layer, T] change percentages, T = n_input + steps.
    attn_change_pct: np.ndarray
    mlp_change_pct: np.ndarray
    # [n_layer, n_head, T, T] float32, future entries 0.
    attention: np.ndarray

    def to_core(self) -> dict[str, Any]:
        """The contract's `RunCore` (example-data.schema.json)."""
        token_bytes = {i: list(gpt2.token_bytes(i)) for i in set(self.token_ids)}
        for pred in self.predictions:
            for i, _ in pred:
                if i not in token_bytes:
                    token_bytes[i] = list(gpt2.token_bytes(i))
        return {
            "n_input": self.n_input,
            "steps": self.steps,
            "stop_reason": self.stop_reason,
            "tokens": [{"id": i, "bytes": token_bytes[i]} for i in self.token_ids],
            "predictions": [
                {
                    "candidates": [
                        {"id": i, "bytes": token_bytes[i], "prob": sig7(p)} for i, p in pred
                    ]
                }
                for pred in self.predictions
            ],
            "layers": [
                {
                    "attn_change_pct": [sig7(v) for v in attn],
                    "mlp_change_pct": [sig7(v) for v in mlp],
                }
                for attn, mlp in zip(self.attn_change_pct, self.mlp_change_pct, strict=True)
            ],
        }


def top_candidates(logits: torch.Tensor, k: int = TOP_K) -> list[tuple[int, float]]:
    """Softmax of float32 logits (no temperature); top-k sorted by prob desc, ties by id asc.

    A stable sort on (-prob, id) over the whole vocabulary, not bare `topk`, whose tie order is
    unspecified.
    """
    probs = torch.softmax(logits.to(torch.float32), dim=-1).numpy()
    order = np.lexsort((np.arange(probs.shape[0]), -probs))[:k]
    return [(int(i), float(probs[i])) for i in order]


def _check_ids(token_ids: list[int]) -> None:
    _, m = gpt2.load()
    if not token_ids:
        raise ValueError("token_ids must not be empty")
    if len(token_ids) > m.config.n_positions:
        raise ValueError("token_ids longer than the model context")
    if any(not 0 <= i < m.config.vocab_size for i in token_ids):
        raise ValueError("token id out of vocabulary range")


@torch.inference_mode()
def compute_run(token_ids: list[int], max_new_tokens: int) -> Run:
    _check_ids(token_ids)
    if max_new_tokens < 0:
        raise ValueError("max_new_tokens must be ≥ 0")
    _, m = gpt2.load()
    eos = gpt2.eos_token_id()
    n_positions = m.config.n_positions

    ids = list(token_ids)
    n_input = len(ids)
    predictions: list[list[tuple[int, float]]] = []
    out = m(input_ids=torch.tensor([ids]), use_cache=True)
    while True:
        candidates = top_candidates(out.logits[0, -1])
        predictions.append(candidates)
        steps = len(ids) - n_input
        stop: StopReason | None = None
        if candidates[0][0] == eos:
            stop = "eos"  # never appended
        elif steps == max_new_tokens:
            stop = "step_limit"
        elif len(ids) >= n_positions:
            stop = "context_limit"
        if stop is not None:
            break
        ids.append(candidates[0][0])
        out = m(
            input_ids=torch.tensor([[ids[-1]]]),
            past_key_values=out.past_key_values,
            use_cache=True,
        )

    attn_pct, mlp_pct, attention = _full_pass(ids)
    return Run(
        token_ids=ids,
        n_input=n_input,
        steps=len(ids) - n_input,
        stop_reason=stop,
        predictions=predictions,
        attn_change_pct=attn_pct,
        mlp_change_pct=mlp_pct,
        attention=attention,
    )


def _full_pass(ids: list[int]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """One pass over the whole sequence. Per block: x = block input, a = attention output (after
    c_proj, before the residual add), m = MLP output. attn % = ‖a‖/‖x‖·100 and
    mlp % = ‖m‖/‖x + a‖·100 per position. Hooks, not `output_hidden_states`, because the last
    hidden state has ln_f applied."""
    _, m = gpt2.load()
    captured: dict[str, list[torch.Tensor]] = {"x": [], "a": [], "m": []}
    handles = []
    for block in m.transformer.h:
        handles += [
            block.register_forward_pre_hook(lambda _mod, args: captured["x"].append(args[0])),
            block.attn.register_forward_hook(
                lambda _mod, _args, output: captured["a"].append(output[0])
            ),
            block.mlp.register_forward_hook(
                lambda _mod, _args, output: captured["m"].append(output)
            ),
        ]
    try:
        out = m(input_ids=torch.tensor([ids]), output_attentions=True, use_cache=False)
    finally:
        for h in handles:
            h.remove()

    x = torch.stack([t[0] for t in captured["x"]]).double()  # [L, T, d]
    a = torch.stack([t[0] for t in captured["a"]]).double()
    mlp = torch.stack([t[0] for t in captured["m"]]).double()
    attn_pct = (a.norm(dim=-1) / x.norm(dim=-1) * 100).numpy()
    mlp_pct = (mlp.norm(dim=-1) / (x + a).norm(dim=-1) * 100).numpy()
    attention = torch.stack([t[0] for t in out.attentions]).to(torch.float32).numpy()
    return attn_pct, mlp_pct, attention


@torch.inference_mode()
def attention_layer(token_ids: list[int], layer_1based: int) -> np.ndarray:
    """Attention weights [n_head, T, T] of one block (1-based) for a token sequence."""
    _check_ids(token_ids)
    _, m = gpt2.load()
    if not 1 <= layer_1based <= m.config.n_layer:
        raise ValueError("layer out of range")
    out = m(input_ids=torch.tensor([token_ids]), output_attentions=True, use_cache=False)
    return out.attentions[layer_1based - 1][0].to(torch.float32).numpy()


@torch.inference_mode()
def token_embeddings(token_ids: list[int]) -> tuple[list[int], np.ndarray]:
    """Unique IDs in order of first appearance, and their wte rows [U, n_embd] float32."""
    _check_ids(token_ids)
    _, m = gpt2.load()
    unique_ids = list(dict.fromkeys(token_ids))
    rows = m.transformer.wte.weight[torch.tensor(unique_ids)].to(torch.float32).numpy()
    return unique_ids, rows
