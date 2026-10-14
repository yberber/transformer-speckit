"""The service enforces exactly the limits in `contracts/limits.json` (FR-013, research R12).

Input over a limit is rejected before the model runs: a spy on `compute_run` proves it.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import api
from app.core import model as gpt2
from app.limits import load_limits

pytestmark = pytest.mark.model

LIMITS_FILE = Path(__file__).resolve().parents[3] / "contracts" / "limits.json"
LIMITS = load_limits()


def text_of_tokens(n: int) -> str:
    """'a a a …': one token per word."""
    text = "a" + " a" * (n - 1)
    assert len(gpt2.tokenize(text)) == n
    return text


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> list[tuple[list[int], int]]:
    """Records every compute_run call; still runs the real model."""
    seen: list[tuple[list[int], int]] = []
    real = api.compute_run

    def spy(ids: list[int], steps: int):
        seen.append((list(ids), steps))
        return real(ids, steps)

    monkeypatch.setattr(api, "compute_run", spy)
    return seen


def run(client: TestClient, text: str, max_new_tokens: int = 1):
    return client.post("/api/v1/runs", json={"text": text, "max_new_tokens": max_new_tokens})


def test_limits_come_from_the_contract_file(client: TestClient) -> None:
    raw = json.loads(LIMITS_FILE.read_text(encoding="utf-8"))
    for name in ("max_input_tokens", "max_new_tokens", "max_input_chars", "wait_limit_s"):
        assert getattr(LIMITS, name) == raw[name]
    health = client.get("/api/v1/health").json()
    assert health["limits"] == {
        name: raw[name]
        for name in ("max_input_tokens", "max_new_tokens", "max_input_chars", "wait_limit_s")
    }


def test_input_token_limit(client: TestClient, calls: list) -> None:
    limit = LIMITS.max_input_tokens
    assert run(client, text_of_tokens(limit)).status_code == 200
    assert len(calls) == 1

    res = run(client, text_of_tokens(limit + 1))
    assert res.status_code == 422
    assert res.json() == {
        "error": {"code": "input_too_long_tokens", "params": {"limit": limit, "actual": limit + 1}}
    }
    assert len(calls) == 1, "the model must not run for a rejected input"


def test_character_limit_counts_code_points(client: TestClient, calls: list) -> None:
    limit = LIMITS.max_input_chars
    # Astral emoji are one code point each but two UTF-16 units: the limit counts code points.
    at_limit = "😀" * 10 + "x" * (limit - 10)
    res = run(client, at_limit)
    assert res.json()["error"]["code"] != "input_too_long_chars"

    res = run(client, at_limit + "😀")
    assert res.status_code == 422
    assert res.json() == {
        "error": {"code": "input_too_long_chars", "params": {"limit": limit, "actual": limit + 1}}
    }
    assert calls == []


@pytest.mark.parametrize("text", ["", " ", " \n\t ", "　"])
def test_whitespace_only_is_empty(client: TestClient, calls: list, text: str) -> None:
    res = run(client, text)
    assert res.status_code == 422
    assert res.json() == {"error": {"code": "empty_input"}}
    assert calls == []


def test_max_new_tokens_limit(client: TestClient, calls: list) -> None:
    res = run(client, "Hello", LIMITS.max_new_tokens + 1)
    assert res.status_code == 400
    assert res.json() == {"error": {"code": "invalid_request", "params": {"field": "max_new_tokens"}}}
    assert calls == []


def detail_requests(token_ids: list[int], layer: int = 1):
    return [
        ("/api/v1/attention", {"token_ids": token_ids, "layer": layer}),
        ("/api/v1/token-embeddings", {"token_ids": token_ids}),
    ]


def test_detail_endpoints_reject_too_many_ids(client: TestClient) -> None:
    too_many = [1] * (LIMITS.max_input_tokens + LIMITS.max_new_tokens + 1)
    for path, payload in detail_requests(too_many):
        res = client.post(path, json=payload)
        assert res.status_code == 400, path
        assert res.json()["error"] == {"code": "invalid_request", "params": {"field": "token_ids"}}


def test_detail_endpoints_reject_ids_outside_the_vocabulary(client: TestClient) -> None:
    vocab_size = gpt2.load()[1].config.vocab_size
    for path, payload in detail_requests([1, vocab_size]):
        res = client.post(path, json=payload)
        assert res.status_code == 400, path
        assert res.json()["error"] == {"code": "invalid_request", "params": {"field": "token_ids"}}


@pytest.mark.parametrize("layer", ["zero", "past_last"])
def test_attention_rejects_layers_outside_the_model(client: TestClient, layer: str) -> None:
    n_layer = gpt2.load()[1].config.n_layer
    value = 0 if layer == "zero" else n_layer + 1
    res = client.post("/api/v1/attention", json={"token_ids": [1, 2], "layer": value})
    assert res.status_code == 400
    assert res.json()["error"] == {"code": "invalid_request", "params": {"field": "layer"}}


def test_step_cap_is_the_step_limit(client: TestClient, calls: list) -> None:
    text = text_of_tokens(5)
    assert run(client, text, LIMITS.max_new_tokens).status_code == 200
    assert calls[-1][1] == LIMITS.max_new_tokens


def test_step_cap_respects_the_model_context(
    client: TestClient, calls: list, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Near the end of the context, the cap is n_positions − n_input."""
    n_input = 5
    n_positions = n_input + LIMITS.max_new_tokens - 3
    monkeypatch.setattr(gpt2.load()[1].config, "n_positions", n_positions)
    res = run(client, text_of_tokens(n_input), LIMITS.max_new_tokens)
    assert res.status_code == 200
    assert calls[-1][1] == n_positions - n_input
    assert res.json()["run"]["steps"] <= n_positions - n_input
