from __future__ import annotations

import asyncio
import datetime as dt
import time
from dataclasses import dataclass


@dataclass
class _TokenBucket:
    rate_per_sec: float
    burst: int
    tokens: float
    last_refill: float


@dataclass
class _CircuitState:
    failure_streak: int = 0
    open_until: float = 0.0


class ProviderBudgetExceededError(RuntimeError):
    pass


class ProviderUnavailableError(RuntimeError):
    pass


class ProviderBudgetController:  # pragma: no cover
    def __init__(self) -> None:
        now = time.monotonic()
        self._buckets: dict[str, _TokenBucket] = {
            "openlibrary": _TokenBucket(
                rate_per_sec=0.33,
                burst=10,
                tokens=10.0,
                last_refill=now,
            ),
            "googlebooks": _TokenBucket(
                rate_per_sec=0.01,
                burst=5,
                tokens=5.0,
                last_refill=now,
            ),
        }
        self._daily_limits: dict[str, int] = {
            "openlibrary": 20000,
            "googlebooks": 1000,
        }
        self._daily_counts: dict[str, tuple[dt.date, int]] = {}
        self._circuits: dict[str, _CircuitState] = {
            "openlibrary": _CircuitState(),
            "googlebooks": _CircuitState(),
        }
        self._lock = asyncio.Lock()

    async def acquire(self, provider: str, *, timeout: float = 30.0) -> None:
        deadline = time.monotonic() + timeout
        while True:
            async with self._lock:
                now = time.monotonic()
                circuit = self._circuits.setdefault(provider, _CircuitState())
                if circuit.open_until > now:
                    wait = circuit.open_until - now
                    if now + wait > deadline:
                        raise ProviderUnavailableError(
                            f"{provider} circuit breaker is open"
                        )
                    # Release lock, wait for circuit to close, then retry
                else:
                    self._consume_daily(provider)
                    bucket = self._buckets.get(provider)
                    if bucket is None:
                        return

                    elapsed = max(0.0, now - bucket.last_refill)
                    bucket.tokens = min(
                        float(bucket.burst),
                        bucket.tokens + (elapsed * bucket.rate_per_sec),
                    )
                    bucket.last_refill = now
                    if bucket.tokens >= 1.0:
                        bucket.tokens -= 1.0
                        return
                    # Not enough tokens — calculate wait time for 1 token
                    wait = (1.0 - bucket.tokens) / bucket.rate_per_sec
                    if now + wait > deadline:
                        raise ProviderBudgetExceededError(
                            f"{provider} rate budget exhausted; try again later"
                        )
            # Sleep outside the lock so other coroutines can proceed
            await asyncio.sleep(min(wait, deadline - time.monotonic()))

    async def record_success(self, provider: str) -> None:
        async with self._lock:
            circuit = self._circuits.setdefault(provider, _CircuitState())
            circuit.failure_streak = 0
            circuit.open_until = 0.0

    async def record_failure(self, provider: str) -> None:
        async with self._lock:
            circuit = self._circuits.setdefault(provider, _CircuitState())
            circuit.failure_streak += 1
            if circuit.failure_streak >= 5:
                circuit.open_until = time.monotonic() + 60.0

    def _consume_daily(self, provider: str) -> None:
        today = dt.date.today()
        day, count = self._daily_counts.get(provider, (today, 0))
        if day != today:
            day = today
            count = 0
        limit = self._daily_limits.get(provider)
        if limit is not None and count >= limit:
            raise ProviderBudgetExceededError(
                f"{provider} daily budget exhausted; try tomorrow"
            )
        self._daily_counts[provider] = (day, count + 1)


_controller: ProviderBudgetController | None = None


def get_provider_budget_controller() -> ProviderBudgetController:  # pragma: no cover
    global _controller
    if _controller is None:
        _controller = ProviderBudgetController()
    return _controller
