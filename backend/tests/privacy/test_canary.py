"""Text sent to the service is never logged or echoed (Principle IV, FR-012, Q9).

A unique canary goes through every request path, success and each input error, and must not
appear in any log record, in anything written to stdout/stderr, or in any response body or
header.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app import api
from app.limits import load_limits

pytestmark = pytest.mark.model

LOGGERS = ["", "uvicorn", "uvicorn.access", "uvicorn.error", "fastapi", "app"]

# Distinct Unicode spaces: str.strip() removes them all, so a text made only of them is empty.
SPACES = [chr(c) for c in range(0x2000, 0x200B)]


def whitespace_canary() -> str:
    """A unique run of whitespace: the canary for the `empty_input` path."""
    return "".join(SPACES[int(c, 16) % len(SPACES)] for c in uuid4().hex)


@pytest.fixture
def capture(caplog: pytest.LogCaptureFixture) -> Iterator[pytest.LogCaptureFixture]:
    for name in LOGGERS:
        caplog.set_level(logging.DEBUG, logger=name)
    yield caplog


def assert_absent(
    canary: str,
    responses: list[httpx.Response],
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    for record in caplog.records:
        assert canary not in record.getMessage(), record.name
        assert canary not in str(record.args), record.name
        assert canary not in (record.exc_text or ""), record.name
    assert canary not in caplog.text
    out, err = capfd.readouterr()
    assert canary not in out
    assert canary not in err
    for res in responses:
        assert canary not in res.text, res.request.url
        for name, value in res.headers.items():
            assert canary not in name and canary not in value


def post_runs(client: TestClient, text: str, **extra) -> httpx.Response:
    return client.post("/api/v1/runs", json={"text": text, "max_new_tokens": 2, **extra})


def test_canary_never_logged_or_echoed(
    client: TestClient,
    capture: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    canary = f"canary-{uuid4()}"
    limits = load_limits()
    responses: list[httpx.Response] = []

    # Success; the detail endpoints then get the canary's token IDs.
    res = post_runs(client, f"My note says {canary}")
    assert res.status_code == 200
    responses.append(res)
    ids = [t["id"] for t in res.json()["run"]["tokens"]]
    responses.append(client.post("/api/v1/attention", json={"token_ids": ids, "layer": 1}))
    responses.append(client.post("/api/v1/token-embeddings", json={"token_ids": ids}))
    assert [r.status_code for r in responses[1:]] == [200, 200]

    # input_too_long_chars
    res = post_runs(client, canary + "x" * limits.max_input_chars)
    assert res.json()["error"]["code"] == "input_too_long_chars"
    responses.append(res)

    # input_too_long_tokens: the canary repeated, under the character limit.
    text = " ".join([canary] * (limits.max_input_chars // (len(canary) + 1)))
    res = post_runs(client, text)
    assert res.json()["error"]["code"] == "input_too_long_tokens"
    responses.append(res)

    # invalid_request: malformed JSON, then an unknown field and a bad value next to the text.
    res = client.post(
        "/api/v1/runs",
        content=f'{{"text": "{canary}", "max_new_tokens": '.encode(),
        headers={"content-type": "application/json"},
    )
    assert res.json()["error"]["code"] == "invalid_request"
    responses.append(res)
    for res in (
        post_runs(client, canary, note=canary),
        post_runs(client, canary, **{canary: 1}),
        post_runs(client, canary, max_new_tokens=canary),
        client.post("/api/v1/attention", json={"token_ids": [canary], "layer": canary}),
    ):
        assert res.json()["error"]["code"] == "invalid_request"
        responses.append(res)

    # internal: an exception whose message carries the canary.
    def broken(ids: list[int], steps: int):
        raise RuntimeError(f"failed on {canary}")

    monkeypatch.setattr(api, "compute_run", broken)
    res = post_runs(client, canary)
    assert res.status_code == 500
    assert res.json() == {"error": {"code": "internal"}}
    responses.append(res)
    assert any("RuntimeError" in r.getMessage() for r in capture.records), "error not logged"

    assert_absent(canary, responses, capture, capfd)


def test_whitespace_canary_never_logged_or_echoed(
    client: TestClient, capture: pytest.LogCaptureFixture, capfd: pytest.CaptureFixture[str]
) -> None:
    canary = whitespace_canary()
    res = post_runs(client, f" {canary}\n")
    assert res.status_code == 422
    assert res.json() == {"error": {"code": "empty_input"}}
    assert_absent(canary, [res], capture, capfd)


def test_request_log_has_route_template_only(
    client: TestClient, capture: pytest.LogCaptureFixture
) -> None:
    """One line per request: method, route template, status, duration. No query, IP or body."""
    canary = f"canary-{uuid4()}"
    client.get(f"/api/v1/health?q={canary}", headers={"X-Forwarded-For": "203.0.113.99"})
    client.get(f"/{canary}")
    lines = [r.getMessage() for r in capture.records if r.name == "app.requests"]
    assert any(line.startswith("GET /api/v1/health 200 ") for line in lines), lines
    assert any(line.startswith("GET unmatched 404 ") for line in lines), lines
    assert not any(canary in line or "203.0.113.99" in line for line in lines)
