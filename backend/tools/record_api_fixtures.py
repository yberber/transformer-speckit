"""Record the shared API fixtures in `contracts/fixtures/api/` from the real service.

    uv run python -m tools.record_api_fixtures

Each fixture is `{request?, status, headers?, body}`: a real response of the app (through
TestClient), with `headers` holding only `retry-after` where the contract defines it. Error
states that need a particular server condition (rate limit reached, model busy, model not yet
loaded, an unexpected failure) are produced by putting the real app in that condition.
Both test suites validate these files against the contract (backend tests/contract, frontend
tests/contract), and the frontend's API client tests and e2e mocks are fed from them.
"""

from __future__ import annotations

import json
import os
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from unittest import mock

import httpx
from fastapi.testclient import TestClient

from app import api, ratelimit
from app.limits import load_limits
from app.main import create_app

OUT = Path(__file__).resolve().parents[2] / "contracts" / "fixtures" / "api"

TEXT = "The quick brown fox"
STEPS = 3
GENEROUS = {"RL_RUNS_BURST": "1000", "RL_DETAIL_BURST": "1000"}


@contextmanager
def env(**values: str) -> Iterator[None]:
    """Set limiter environment variables and rebuild the limiter; restore both afterwards."""
    saved = {k: os.environ.get(k) for k in values}
    os.environ.update(values)
    ratelimit.configure()
    try:
        yield
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        ratelimit.configure()


@contextmanager
def ready_client() -> Iterator[TestClient]:
    with TestClient(create_app()) as client:
        deadline = time.monotonic() + 300
        while client.get("/api/v1/health").status_code != 200:
            if time.monotonic() > deadline:
                raise TimeoutError("the model did not load in time")
            time.sleep(0.05)
        yield client


def fixture(res: httpx.Response, request: dict[str, Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if request is not None:
        out["request"] = request
    out["status"] = res.status_code
    if "retry-after" in res.headers:
        out["headers"] = {"retry-after": res.headers["retry-after"]}
    out["body"] = res.json()
    return out


def post(client: TestClient, path: str, body: dict[str, Any]) -> dict[str, Any]:
    return fixture(client.post(path, json=body), body)


def run_body(text: str, max_new_tokens: int = STEPS) -> dict[str, Any]:
    return {"text": text, "max_new_tokens": max_new_tokens}


def busy(client: TestClient) -> dict[str, Any]:
    """A second run while the first holds the model, with no room to wait."""
    entered, release = threading.Event(), threading.Event()
    real = api.compute_run

    def slow(ids: list[int], steps: int):
        entered.set()
        release.wait(60)
        return real(ids, steps)

    body = run_body(TEXT)
    with env(GATE_MAX_WAITING="0", **GENEROUS), mock.patch.object(api, "compute_run", slow):
        first = threading.Thread(target=lambda: client.post("/api/v1/runs", json=body))
        first.start()
        try:
            if not entered.wait(60):
                raise TimeoutError("the first run did not start")
            return post(client, "/api/v1/runs", body)
        finally:
            release.set()
            first.join(120)


def record() -> dict[str, dict[str, Any]]:
    limits = load_limits()
    fixtures: dict[str, dict[str, Any]] = {}

    with env(**GENEROUS), ready_client() as client:
        fixtures["health"] = fixture(client.get("/api/v1/health"))
        fixtures["run"] = post(client, "/api/v1/runs", run_body(TEXT))
        ids = [t["id"] for t in fixtures["run"]["body"]["run"]["tokens"]]
        fixtures["attention"] = post(client, "/api/v1/attention", {"token_ids": ids, "layer": 1})
        fixtures["token-embeddings"] = post(client, "/api/v1/token-embeddings", {"token_ids": ids})

        fixtures["error-empty_input"] = post(client, "/api/v1/runs", run_body(" \n "))
        fixtures["error-input_too_long_chars"] = post(
            client, "/api/v1/runs", run_body("x" * (limits.max_input_chars + 1))
        )
        fixtures["error-input_too_long_tokens"] = post(
            client, "/api/v1/runs", run_body("a" + " a" * limits.max_input_tokens)
        )
        fixtures["error-invalid_request"] = post(
            client, "/api/v1/runs", run_body(TEXT, limits.max_new_tokens + 1)
        )

        def broken(ids: list[int], steps: int):
            raise RuntimeError("fixture: simulated failure")

        with mock.patch.object(api, "compute_run", broken):
            fixtures["error-internal"] = post(client, "/api/v1/runs", run_body(TEXT))

        fixtures["error-busy"] = busy(client)

    with env(RL_RUNS_PER_MIN="1", RL_RUNS_BURST="1"), ready_client() as client:
        client.post("/api/v1/runs", json=run_body(TEXT))
        fixtures["error-rate_limited"] = post(client, "/api/v1/runs", run_body(TEXT))

    with env(**GENEROUS):
        client = TestClient(create_app())  # start-up not run: the model is not loaded
        fixtures["error-model_loading"] = fixture(client.get("/api/v1/health"))

    return fixtures


def main() -> None:
    fixtures = record()
    expected = {"error-internal": 500, "error-busy": 503, "error-rate_limited": 429}
    for name, f in fixtures.items():
        want = expected.get(name, 200 if not name.startswith("error-") else None)
        if want is not None and f["status"] != want:
            raise SystemExit(f"{name}: expected status {want}, got {f['status']}")
        if name.startswith("error-") and f["body"]["error"]["code"] != name[len("error-") :]:
            raise SystemExit(f"{name}: got error code {f['body']['error']['code']}")
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    for name, f in sorted(fixtures.items()):
        path = OUT / f"{name}.json"
        path.write_text(json.dumps(f, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote {path.relative_to(OUT.parents[2])} ({f['status']})")


if __name__ == "__main__":
    main()
