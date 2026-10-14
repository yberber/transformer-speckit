"""Live mode gives the same result as example mode for the same text (FR-010, SC-002, Q6).

Each shipped example's text goes through `POST /api/v1/runs`: the tokens must be identical and
every candidate probability within 1e-4. Layer 1 attention from `/attention` must match the
shipped `attention-L01.u16` within 1e-3 after dequantization.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.model

EXAMPLES = Path(__file__).resolve().parents[3] / "frontend" / "public" / "data" / "examples"
INDEX = json.loads((EXAMPLES / "index.json").read_text(encoding="utf-8"))
CORES = {
    e["id"]: json.loads((EXAMPLES / e["core"]).read_text(encoding="utf-8"))
    for e in INDEX["examples"]
}

PROB_TOL = 1e-4
ATTENTION_TOL = 1e-3


def dequantize(raw: bytes, shape: list[int], scale: float) -> np.ndarray:
    return np.frombuffer(raw, dtype="<u2").reshape(shape).astype(np.float64) * scale


@pytest.mark.parametrize("example_id", list(CORES))
def test_live_run_matches_example(client: TestClient, example_id: str) -> None:
    core = CORES[example_id]
    expected = core["run"]
    res = client.post(
        "/api/v1/runs",
        json={"text": core["example"]["text"], "max_new_tokens": expected["steps"]},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    live = body["run"]

    assert body["model"]["revision"] == core["model"]["revision"]
    assert live["n_input"] == expected["n_input"]
    assert live["steps"] == expected["steps"]
    assert live["stop_reason"] == expected["stop_reason"]
    assert live["tokens"] == expected["tokens"]
    assert len(live["predictions"]) == len(expected["predictions"])
    for k, (got, want) in enumerate(zip(live["predictions"], expected["predictions"], strict=True)):
        assert [c["id"] for c in got["candidates"]] == [c["id"] for c in want["candidates"]], k
        for g, w in zip(got["candidates"], want["candidates"], strict=True):
            assert abs(g["prob"] - w["prob"]) <= PROB_TOL, (k, g["id"])

    ids = [t["id"] for t in expected["tokens"]]
    res = client.post("/api/v1/attention", json={"token_ids": ids, "layer": 1})
    assert res.status_code == 200, res.text
    weights = res.json()["weights"]
    got = dequantize(base64.b64decode(weights["data"]), weights["shape"], weights["scale"])
    shipped = core["files"]["attention"][0]
    want = dequantize(
        (EXAMPLES / example_id / shipped["path"]).read_bytes(), shipped["shape"], shipped["scale"]
    )
    assert got.shape == want.shape
    assert np.max(np.abs(got - want)) <= ATTENTION_TOL
