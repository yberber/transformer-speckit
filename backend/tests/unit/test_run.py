import math

import numpy as np
import pytest

from app.core import model as gpt2
from app.core.run import Run, compute_run

pytestmark = pytest.mark.model

TEXT = "The best way to make a cup of coffee is to"
STEPS = 8


@pytest.fixture(scope="module")
def run() -> Run:
    return compute_run(gpt2.tokenize(TEXT), STEPS)


def test_lengths(run: Run) -> None:
    assert run.n_input == len(gpt2.tokenize(TEXT))
    assert len(run.token_ids) == run.n_input + run.steps
    assert len(run.predictions) == run.steps + 1
    assert run.steps == STEPS or run.stop_reason == "eos"
    if run.steps == STEPS:
        assert run.stop_reason == "step_limit"


def test_greedy_choice_is_the_appended_token(run: Run) -> None:
    for k in range(1, run.steps + 1):
        assert run.predictions[k - 1][0][0] == run.token_ids[run.n_input + k - 1]


def test_candidates_sorted_and_valid(run: Run) -> None:
    for pred in run.predictions:
        assert len(pred) == 10
        assert pred == sorted(pred, key=lambda c: (-c[1], c[0]))
        assert all(0 < p <= 1 for _, p in pred)


def test_change_percentages(run: Run) -> None:
    _, m = gpt2.load()
    t = len(run.token_ids)
    for arr in (run.attn_change_pct, run.mlp_change_pct):
        assert arr.shape == (m.config.n_layer, t)
        assert np.all(np.isfinite(arr))
        assert np.all(arr >= 0)


def test_attention(run: Run) -> None:
    _, m = gpt2.load()
    t = len(run.token_ids)
    att = run.attention
    assert att.shape == (m.config.n_layer, m.config.n_head, t, t)
    assert att.min() >= 0 and att.max() <= 1
    np.testing.assert_allclose(att.sum(axis=-1), 1.0, atol=1e-5)
    future = np.triu(np.ones((t, t), dtype=bool), k=1)
    assert np.all(att[..., future] == 0)


def test_to_core_shape(run: Run) -> None:
    core = run.to_core()
    assert core["n_input"] == run.n_input and core["steps"] == run.steps
    assert [tok["id"] for tok in core["tokens"]] == run.token_ids
    assert all(len(tok["bytes"]) >= 1 for tok in core["tokens"])
    for layer in core["layers"]:
        assert all(math.isfinite(v) and v >= 0 for v in layer["attn_change_pct"])


def test_zero_new_tokens() -> None:
    r = compute_run(gpt2.tokenize(TEXT), 0)
    assert r.steps == 0
    assert len(r.predictions) == 1
    assert r.stop_reason in ("step_limit", "eos")


def test_special_token_text_is_ordinary_text() -> None:
    # Research R8: literal "<|endoftext|>" typed by a user is not the EOS token.
    assert gpt2.eos_token_id() not in gpt2.tokenize("<|endoftext|>")


def test_runs_are_bit_identical(run: Run) -> None:
    # FR-006: greedy decoding is deterministic.
    again = compute_run(gpt2.tokenize(TEXT), STEPS)
    assert again.token_ids == run.token_ids
    assert again.predictions == run.predictions
    np.testing.assert_array_equal(again.attn_change_pct, run.attn_change_pct)
    np.testing.assert_array_equal(again.mlp_change_pct, run.mlp_change_pct)
    np.testing.assert_array_equal(again.attention, run.attention)
