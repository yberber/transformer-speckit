"""Shared fixtures for the service tests.

`client` is a TestClient on a fresh app with the model loaded and rate limits high enough that
no test is throttled by accident; tests that check throttling configure their own limits.
"""

from __future__ import annotations

import time
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app import ratelimit
from app.main import create_app

GENEROUS_LIMITS = {
    "RL_RUNS_PER_MIN": "100000",
    "RL_RUNS_BURST": "100000",
    "RL_DETAIL_PER_MIN": "100000",
    "RL_DETAIL_BURST": "100000",
}


def wait_ready(client: TestClient, timeout_s: float = 300) -> None:
    """The model loads in the background after start-up; wait until /health says ok."""
    deadline = time.monotonic() + timeout_s
    while client.get("/api/v1/health").status_code != 200:
        if time.monotonic() > deadline:
            raise TimeoutError("the model did not load in time")
        time.sleep(0.05)


@pytest.fixture
def generous_limits(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for name, value in GENEROUS_LIMITS.items():
        monkeypatch.setenv(name, value)
    ratelimit.configure()
    yield
    monkeypatch.undo()
    ratelimit.configure()


@pytest.fixture
def client(generous_limits: None) -> Iterator[TestClient]:
    with TestClient(create_app()) as c:
        wait_ready(c)
        yield c
