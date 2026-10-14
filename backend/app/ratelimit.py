"""Per-client rate limits and the model concurrency gate, in memory (research R14).

Clients are keyed by the first `X-Forwarded-For` hop (set by the Hugging Face proxy), else the
socket peer. Keys live only in this process's memory, expire after 10 idle minutes and are never
logged. The model runs one request at a time; at most `GATE_MAX_WAITING` requests wait, each for
at most `GATE_QUEUE_WAIT_S` seconds, and the rest are told the service is busy.
"""

from __future__ import annotations

import asyncio
import math
import os
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, fields
from typing import Literal

from starlette.requests import Request

from app.errors import ApiError

ENTRY_TTL_S = 600
# Suggested wait after a busy refusal: about the time a few queued runs take.
BUSY_RETRY_AFTER_S = 10

_ENV = {
    "runs_per_min": "RL_RUNS_PER_MIN",
    "runs_burst": "RL_RUNS_BURST",
    "detail_per_min": "RL_DETAIL_PER_MIN",
    "detail_burst": "RL_DETAIL_BURST",
    "gate_max_waiting": "GATE_MAX_WAITING",
    "gate_queue_wait_s": "GATE_QUEUE_WAIT_S",
}


@dataclass(frozen=True)
class Settings:
    runs_per_min: float = 6
    runs_burst: int = 3
    detail_per_min: float = 60
    detail_burst: int = 20
    gate_max_waiting: int = 8
    gate_queue_wait_s: float = 30

    @classmethod
    def from_env(cls) -> Settings:
        values = {}
        for f in fields(cls):
            raw = os.environ.get(_ENV[f.name])
            if raw is not None:
                values[f.name] = (int if f.type in ("int", int) else float)(raw)
        return cls(**values)


class TokenBucket:
    """`burst` requests at once, refilled at `per_min` per minute, per client key."""

    def __init__(self, per_min: float, burst: int, clock: Callable[[], float] = time.monotonic):
        self.rate = per_min / 60
        self.burst = burst
        self.clock = clock
        self._entries: dict[str, tuple[float, float]] = {}  # key → (tokens, last seen)

    def __len__(self) -> int:
        return len(self._entries)

    def take(self, key: str) -> int:
        """0 if the request may go ahead, else the whole seconds until it may."""
        now = self.clock()
        for k, (_, seen) in list(self._entries.items()):
            if now - seen > ENTRY_TTL_S:
                del self._entries[k]
        tokens, seen = self._entries.get(key, (self.burst, now))
        tokens = min(self.burst, tokens + (now - seen) * self.rate)
        if tokens >= 1:
            self._entries[key] = (tokens - 1, now)
            return 0
        self._entries[key] = (tokens, now)
        return max(1, math.ceil((1 - tokens) / self.rate))


def _busy() -> ApiError:
    return ApiError("busy", {"retry_after_s": BUSY_RETRY_AFTER_S})


class ModelGate:
    def __init__(self, max_waiting: int, queue_wait_s: float) -> None:
        self.max_waiting = max_waiting
        self.queue_wait_s = queue_wait_s
        self.waiting = 0
        self._lock = asyncio.Lock()

    @asynccontextmanager
    async def __call__(self) -> AsyncIterator[None]:
        if self._lock.locked() and self.waiting >= self.max_waiting:
            raise _busy()
        self.waiting += 1
        try:
            await asyncio.wait_for(self._lock.acquire(), self.queue_wait_s)
        except TimeoutError:
            raise _busy() from None
        finally:
            self.waiting -= 1
        try:
            yield
        finally:
            self._lock.release()


Bucket = Literal["runs", "detail"]

_settings = Settings()
_buckets: dict[Bucket, TokenBucket] = {}
_gate = ModelGate(_settings.gate_max_waiting, _settings.gate_queue_wait_s)


def configure() -> None:
    """(Re)build the limiter from the environment, forgetting every client."""
    global _settings, _gate
    _settings = Settings.from_env()
    _buckets["runs"] = TokenBucket(_settings.runs_per_min, _settings.runs_burst)
    _buckets["detail"] = TokenBucket(_settings.detail_per_min, _settings.detail_burst)
    _gate = ModelGate(_settings.gate_max_waiting, _settings.gate_queue_wait_s)


def current_settings() -> Settings:
    return _settings


def client_key(request: Request) -> str:
    first_hop = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if first_hop:
        return first_hop
    return request.client.host if request.client else "unknown"


def check_rate(request: Request, bucket: Bucket) -> None:
    wait = _buckets[bucket].take(client_key(request))
    if wait:
        raise ApiError("rate_limited", {"retry_after_s": wait})


def model_gate():
    """`async with model_gate():` around every model call."""
    return _gate()


configure()
