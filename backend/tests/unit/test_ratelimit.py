"""In-memory per-client rate limits and the model concurrency gate (research R14)."""

from __future__ import annotations

import asyncio

import pytest
from starlette.requests import Request

from app import ratelimit
from app.errors import ApiError
from app.ratelimit import ENTRY_TTL_S, ModelGate, Settings, TokenBucket, client_key


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def allowed(bucket: TokenBucket, key: str, n: int) -> int:
    return sum(bucket.take(key) == 0 for _ in range(n))


# --- token buckets -------------------------------------------------------------------------


def test_defaults() -> None:
    s = Settings()
    assert (s.runs_per_min, s.runs_burst) == (6, 3)
    assert (s.detail_per_min, s.detail_burst) == (60, 20)
    assert (s.gate_max_waiting, s.gate_queue_wait_s) == (8, 30)


@pytest.mark.parametrize(("per_min", "burst"), [(6, 3), (60, 20)])
def test_burst_then_refill(per_min: int, burst: int) -> None:
    clock = Clock()
    bucket = TokenBucket(per_min, burst, clock)
    assert allowed(bucket, "a", burst + 5) == burst
    retry = bucket.take("a")
    assert retry == pytest.approx(60 / per_min, abs=1)
    assert retry >= 1

    clock.now += 60 / per_min  # exactly one token back
    assert allowed(bucket, "a", 2) == 1

    clock.now += 3600  # refill never exceeds the burst
    assert allowed(bucket, "a", burst + 5) == burst


def test_clients_have_separate_buckets() -> None:
    bucket = TokenBucket(6, 3, Clock())
    assert allowed(bucket, "a", 3) == 3
    assert bucket.take("a") > 0
    assert bucket.take("b") == 0


def test_entries_expire_after_ten_minutes() -> None:
    clock = Clock()
    bucket = TokenBucket(6, 3, clock)
    bucket.take("a")
    assert len(bucket) == 1
    clock.now += ENTRY_TTL_S - 1
    bucket.take("b")
    assert len(bucket) == 2
    clock.now += 2  # "a" idle for more than 10 min, "b" not
    bucket.take("b")
    assert len(bucket) == 1
    assert ENTRY_TTL_S == 600


# --- client key ----------------------------------------------------------------------------


def request(headers: dict[str, str], peer: str | None = "10.0.0.9") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/runs",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
            "client": (peer, 1234) if peer else None,
        }
    )


def test_client_key_is_first_forwarded_hop() -> None:
    req = request({"X-Forwarded-For": " 203.0.113.7 , 10.1.1.1, 10.2.2.2"})
    assert client_key(req) == "203.0.113.7"


def test_client_key_falls_back_to_socket_peer() -> None:
    assert client_key(request({})) == "10.0.0.9"
    assert client_key(request({"X-Forwarded-For": " "})) == "10.0.0.9"
    assert client_key(request({}, peer=None)) == "unknown"


def test_check_rate_raises_rate_limited(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RL_RUNS_PER_MIN", "6")
    monkeypatch.setenv("RL_RUNS_BURST", "1")
    ratelimit.configure()
    try:
        req = request({"X-Forwarded-For": "198.51.100.1"})
        ratelimit.check_rate(req, "runs")
        with pytest.raises(ApiError) as exc:
            ratelimit.check_rate(req, "runs")
        assert exc.value.code == "rate_limited"
        assert exc.value.http_status == 429
        assert exc.value.params["retry_after_s"] >= 1
        ratelimit.check_rate(req, "detail")  # separate bucket
    finally:
        monkeypatch.undo()
        ratelimit.configure()


# --- concurrency gate ----------------------------------------------------------------------


def test_one_model_call_at_a_time() -> None:
    gate = ModelGate(max_waiting=8, queue_wait_s=5)
    active = peak = 0

    async def work() -> None:
        nonlocal active, peak
        async with gate():
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.01)
            active -= 1

    async def main() -> None:
        await asyncio.gather(*(work() for _ in range(5)))

    asyncio.run(main())
    assert peak == 1


def test_queue_overflow_is_busy() -> None:
    gate = ModelGate(max_waiting=8, queue_wait_s=5)
    release = asyncio.Event()

    async def hold() -> None:
        async with gate():
            await release.wait()

    async def main() -> ApiError:
        holder = asyncio.create_task(hold())
        await asyncio.sleep(0)
        waiters = [asyncio.create_task(hold()) for _ in range(8)]
        await asyncio.sleep(0)
        with pytest.raises(ApiError) as exc:
            async with gate():
                pass
        release.set()
        await asyncio.gather(holder, *waiters)  # the 8 queued requests all get their turn
        return exc.value

    err = asyncio.run(main())
    assert err.code == "busy"
    assert err.http_status == 503
    assert err.params["retry_after_s"] >= 1


def test_queue_wait_limit_is_busy() -> None:
    gate = ModelGate(max_waiting=8, queue_wait_s=0.05)

    async def main() -> ApiError:
        release = asyncio.Event()

        async def hold() -> None:
            async with gate():
                await release.wait()

        holder = asyncio.create_task(hold())
        await asyncio.sleep(0)
        loop = asyncio.get_running_loop()
        start = loop.time()
        with pytest.raises(ApiError) as exc:
            async with gate():
                pass
        assert loop.time() - start < 1
        release.set()
        await holder
        async with gate():  # free again once the holder is done
            pass
        return exc.value

    assert asyncio.run(main()).code == "busy"


def test_env_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    env = {
        "RL_RUNS_PER_MIN": "7",
        "RL_RUNS_BURST": "2",
        "RL_DETAIL_PER_MIN": "70",
        "RL_DETAIL_BURST": "9",
        "GATE_MAX_WAITING": "4",
        "GATE_QUEUE_WAIT_S": "12.5",
    }
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    s = Settings.from_env()
    assert (s.runs_per_min, s.runs_burst, s.detail_per_min, s.detail_burst) == (7, 2, 70, 9)
    assert (s.gate_max_waiting, s.gate_queue_wait_s) == (4, 12.5)

    ratelimit.configure()
    try:
        assert ratelimit.current_settings() == s
    finally:
        monkeypatch.undo()
        ratelimit.configure()
    assert ratelimit.current_settings() == Settings()
