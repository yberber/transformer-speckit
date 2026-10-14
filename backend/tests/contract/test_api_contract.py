"""Real service responses against the authoritative contract (Principle IX, research R11).

Every success and error response of the four endpoints is validated with Draft 2020-12 against
`contracts/inference-api.openapi.yaml`, whose `./example-data.schema.json#/$defs/...` refs
resolve through a `referencing` registry. The shared fixtures in `contracts/fixtures/api/` are
validated the same way, so the frontend never tests against an invalid response.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

import httpx
import pytest
import yaml
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from app import api, ratelimit
from app.core import model as gpt2
from app.limits import load_limits
from app.main import create_app

pytestmark = pytest.mark.model

CONTRACTS = Path(__file__).resolve().parents[3] / "contracts"
FIXTURES = CONTRACTS / "fixtures" / "api"
BASE = "https://inside-the-transformer/contracts/"
OPENAPI_URI = BASE + "inference-api.openapi.yaml"

OPENAPI = yaml.safe_load((CONTRACTS / "inference-api.openapi.yaml").read_text(encoding="utf-8"))
DATA_SCHEMA = json.loads((CONTRACTS / "example-data.schema.json").read_text(encoding="utf-8"))
REGISTRY = Registry().with_resources(
    [
        (OPENAPI_URI, Resource(contents=OPENAPI, specification=DRAFT202012)),
        (DATA_SCHEMA["$id"], Resource.from_contents(DATA_SCHEMA)),
    ]
)

ERROR_CODES = OPENAPI["components"]["schemas"]["ErrorCode"]["enum"]
TEXT = "The quick brown fox"


def validate(body: Any, schema_name: str) -> None:
    schema = {"$ref": f"{OPENAPI_URI}#/components/schemas/{schema_name}"}
    Draft202012Validator(schema, registry=REGISTRY).validate(body)


def assert_error(res: httpx.Response, code: str, status: int) -> dict[str, Any]:
    assert res.status_code == status, res.text
    body = res.json()
    validate(body, "Error")
    assert body["error"]["code"] == code
    if status in (429, 503):
        assert int(res.headers["retry-after"]) >= 1
        if code in ("rate_limited", "busy"):
            assert int(res.headers["retry-after"]) == body["error"]["params"]["retry_after_s"]
    return body["error"]


def test_api_version_matches_contract() -> None:
    assert api.API_VERSION == OPENAPI["info"]["version"]


# --- success responses ---------------------------------------------------------------------


def test_health(client: TestClient) -> None:
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    body = res.json()
    validate(body, "Health")
    assert body["model"]["id"] == gpt2.MODEL_ID
    assert body["model"]["revision"] == gpt2.MODEL_REVISION


def test_run(client: TestClient) -> None:
    res = client.post("/api/v1/runs", json={"text": TEXT, "max_new_tokens": 3})
    assert res.status_code == 200, res.text
    body = res.json()
    validate(body, "RunResponse")
    assert body["model"]["revision"] == gpt2.MODEL_REVISION
    assert body["run"]["steps"] == 3


def test_attention(client: TestClient) -> None:
    ids = gpt2.tokenize(TEXT)
    res = client.post("/api/v1/attention", json={"token_ids": ids, "layer": 1})
    assert res.status_code == 200, res.text
    body = res.json()
    validate(body, "AttentionResponse")
    n_head = gpt2.load()[1].config.n_head
    assert body["weights"]["shape"] == [n_head, len(ids) * (len(ids) + 1) // 2]


def test_token_embeddings(client: TestClient) -> None:
    ids = gpt2.tokenize("the cat and the dog")
    res = client.post("/api/v1/token-embeddings", json={"token_ids": ids})
    assert res.status_code == 200, res.text
    body = res.json()
    validate(body, "TokenEmbeddingsResponse")
    assert body["unique_ids"] == list(dict.fromkeys(ids))


# --- error responses -----------------------------------------------------------------------


def test_empty_input(client: TestClient) -> None:
    res = client.post("/api/v1/runs", json={"text": " \n\t ", "max_new_tokens": 1})
    assert_error(res, "empty_input", 422)


def test_input_too_long_chars(client: TestClient) -> None:
    limit = load_limits().max_input_chars
    res = client.post("/api/v1/runs", json={"text": "x" * (limit + 1), "max_new_tokens": 1})
    err = assert_error(res, "input_too_long_chars", 422)
    assert err["params"] == {"limit": limit, "actual": limit + 1}


def test_input_too_long_tokens(client: TestClient) -> None:
    limit = load_limits().max_input_tokens
    res = client.post("/api/v1/runs", json={"text": "a" + " a" * limit, "max_new_tokens": 1})
    err = assert_error(res, "input_too_long_tokens", 422)
    assert err["params"] == {"limit": limit, "actual": limit + 1}


@pytest.mark.parametrize(
    ("path", "payload", "field"),
    [
        ("/api/v1/runs", {"text": "hi", "max_new_tokens": -1}, "max_new_tokens"),
        ("/api/v1/runs", {"text": "hi", "max_new_tokens": 1, "extra": 1}, "extra"),
        ("/api/v1/attention", {"token_ids": [1, 2], "layer": 0}, "layer"),
        ("/api/v1/token-embeddings", {"token_ids": []}, "token_ids"),
    ],
)
def test_invalid_request(client: TestClient, path: str, payload: dict, field: str) -> None:
    err = assert_error(client.post(path, json=payload), "invalid_request", 400)
    assert err["params"] == {"field": field}


def test_malformed_json(client: TestClient) -> None:
    res = client.post(
        "/api/v1/runs", content=b'{"text": "abc', headers={"content-type": "application/json"}
    )
    assert_error(res, "invalid_request", 400)


def test_rate_limited(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RL_RUNS_PER_MIN", "1")
    monkeypatch.setenv("RL_RUNS_BURST", "1")
    ratelimit.configure()
    try:
        with TestClient(create_app()) as c:
            first = c.post("/api/v1/runs", json={"text": " ", "max_new_tokens": 1})
            assert first.status_code == 422  # the request counted, the input was empty
            res = c.post("/api/v1/runs", json={"text": " ", "max_new_tokens": 1})
            err = assert_error(res, "rate_limited", 429)
            assert err["params"]["retry_after_s"] >= 1
    finally:
        monkeypatch.undo()
        ratelimit.configure()


def test_busy(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """With no waiting room, a second request while the model is in use is turned away."""
    monkeypatch.setenv("GATE_MAX_WAITING", "0")
    ratelimit.configure()
    entered, release = threading.Event(), threading.Event()
    real = api.compute_run

    def slow(ids: list[int], steps: int):
        entered.set()
        release.wait(30)
        return real(ids, steps)

    monkeypatch.setattr(api, "compute_run", slow)
    first: list[httpx.Response] = []
    worker = threading.Thread(
        target=lambda: first.append(
            client.post("/api/v1/runs", json={"text": TEXT, "max_new_tokens": 1})
        )
    )
    worker.start()
    try:
        assert entered.wait(30)
        res = client.post("/api/v1/runs", json={"text": TEXT, "max_new_tokens": 1})
        err = assert_error(res, "busy", 503)
        assert err["params"]["retry_after_s"] >= 1
    finally:
        release.set()
        worker.join(60)
    assert first[0].status_code == 200


def test_model_loading(generous_limits: None) -> None:
    """Before the lifespan has loaded the model, the service says so instead of failing."""
    c = TestClient(create_app())  # no `with`: start-up has not run
    assert_error(c.get("/api/v1/health"), "model_loading", 503)
    res = c.post("/api/v1/runs", json={"text": TEXT, "max_new_tokens": 1})
    assert_error(res, "model_loading", 503)


def test_internal(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(ids: list[int], steps: int):
        raise RuntimeError("boom")

    monkeypatch.setattr(api, "compute_run", broken)
    res = client.post("/api/v1/runs", json={"text": TEXT, "max_new_tokens": 1})
    err = assert_error(res, "internal", 500)
    assert "params" not in err


# --- shared fixtures -----------------------------------------------------------------------

FIXTURE_SCHEMAS = {
    "health.json": (None, "Health"),
    "run.json": ("RunRequest", "RunResponse"),
    "attention.json": ("AttentionRequest", "AttentionResponse"),
    "token-embeddings.json": ("TokenIdsRequest", "TokenEmbeddingsResponse"),
}


def test_every_fixture_present() -> None:
    names = {p.name for p in FIXTURES.glob("*.json")}
    expected = set(FIXTURE_SCHEMAS) | {f"error-{code}.json" for code in ERROR_CODES}
    assert names == expected


@pytest.mark.parametrize("path", sorted(FIXTURES.glob("*.json")), ids=lambda p: p.name)
def test_fixture_valid(path: Path) -> None:
    fixture = json.loads(path.read_text(encoding="utf-8"))
    assert set(fixture) <= {"request", "status", "headers", "body"}
    if path.name.startswith("error-"):
        code = path.name.removeprefix("error-").removesuffix(".json")
        validate(fixture["body"], "Error")
        assert fixture["body"]["error"]["code"] == code
        assert fixture["status"] >= 400
        if fixture["status"] in (429, 503):
            assert int(fixture["headers"]["retry-after"]) >= 1
        return
    request_schema, body_schema = FIXTURE_SCHEMAS[path.name]
    assert fixture["status"] == 200
    validate(fixture["body"], body_schema)
    if request_schema:
        validate(fixture["request"], request_schema)
