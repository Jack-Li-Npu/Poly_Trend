from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Any, TypeVar

import httpx

from .config import Settings
from .models import AssetPricePoint, AssetSnapshot, EvidenceItem

T = TypeVar("T")


class ToolError(RuntimeError):
    def __init__(self, provider: str, message: str) -> None:
        super().__init__(message)
        self.provider = provider


class AsyncTTLCache:
    def __init__(self) -> None:
        self._values: dict[str, tuple[float, Any]] = {}
        self._lock = asyncio.Lock()

    async def get_or_set(self, key: str, ttl: int, factory: Callable[[], Awaitable[T]]) -> tuple[T, bool]:
        async with self._lock:
            cached = self._values.get(key)
            if cached and cached[0] > time.monotonic():
                return cached[1], True
        value = await factory()
        async with self._lock:
            self._values[key] = (time.monotonic() + ttl, value)
        return value, False


async def _retry(operation: Callable[[], Awaitable[T]], provider: str) -> tuple[T, int]:
    last: Exception | None = None
    for attempt in range(3):
        try:
            return await operation(), attempt
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            last = exc
            if attempt < 2:
                await asyncio.sleep(0.15 * (2**attempt))
    raise ToolError(provider, f"{type(last).__name__}: {last}")


class ResearchTools:
    """Typed provider tools shared by LangGraph workers, REST and MCP."""

    def __init__(self, config: Settings) -> None:
        self.config = config
        self.cache = AsyncTTLCache()
        self.last_errors: dict[str, str] = {}

    async def get_asset_snapshot(self, symbol: str, history_days: int = 180) -> tuple[AssetSnapshot, bool, int]:
        if symbol != "XAUUSD":
            raise ToolError("alpha_vantage", f"unsupported asset symbol: {symbol}")
        if not self.config.alpha_vantage_api_key:
            raise ToolError("alpha_vantage", "ALPHA_VANTAGE_API_KEY is not configured")

        async def fetch() -> AssetSnapshot:
            timeout = httpx.Timeout(self.config.request_timeout_seconds)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                spot_response, history_response = await asyncio.gather(
                    client.get(
                        self.config.alpha_vantage_url,
                        params={
                            "function": "GOLD_SILVER_SPOT",
                            "symbol": "GOLD",
                            "apikey": self.config.alpha_vantage_api_key,
                        },
                    ),
                    client.get(
                        self.config.alpha_vantage_url,
                        params={
                            "function": "GOLD_SILVER_HISTORY",
                            "symbol": "GOLD",
                            "interval": "daily",
                            "apikey": self.config.alpha_vantage_api_key,
                        },
                    ),
                )
                spot_response.raise_for_status()
                history_response.raise_for_status()
            spot_payload, history_payload = spot_response.json(), history_response.json()
            for payload in (spot_payload, history_payload):
                if isinstance(payload, dict) and (payload.get("Error Message") or payload.get("Note") or payload.get("Information")):
                    raise ValueError(payload.get("Error Message") or payload.get("Note") or payload.get("Information"))
            spot_record = spot_payload.get("data", spot_payload)
            if isinstance(spot_record, list):
                spot_record = spot_record[0] if spot_record else {}
            price = float(
                spot_record.get("price")
                or spot_record.get("value")
                or spot_record.get("05. price")
                or spot_record.get("close")
            )
            timestamp = spot_record.get("timestamp") or spot_record.get("date")
            as_of = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00")) if timestamp else datetime.now(timezone.utc)
            if as_of.tzinfo is None:
                as_of = as_of.replace(tzinfo=timezone.utc)

            raw_history = history_payload.get("data") or history_payload.get("Time Series (Daily)") or []
            records: list[dict[str, Any]] = []
            if isinstance(raw_history, dict):
                records = [{"date": date, **(value if isinstance(value, dict) else {"value": value})} for date, value in raw_history.items()]
            elif isinstance(raw_history, list):
                records = raw_history
            history: list[AssetPricePoint] = []
            for item in records:
                date_value = item.get("date") or item.get("timestamp")
                price_value = item.get("value") or item.get("price") or item.get("close") or item.get("4. close")
                if date_value is None or price_value is None:
                    continue
                point_time = datetime.fromisoformat(str(date_value).replace("Z", "+00:00"))
                if point_time.tzinfo is None:
                    point_time = point_time.replace(tzinfo=timezone.utc)
                history.append(AssetPricePoint(timestamp=point_time, value=float(price_value)))
            history.sort(key=lambda point: point.timestamp)
            return AssetSnapshot(
                symbol="XAUUSD", name="Gold spot", price=price, as_of=as_of,
                source="Alpha Vantage", source_url="https://www.alphavantage.co/documentation/",
                freshness="live provider snapshot", history=history[-history_days:],
            )

        started = time.monotonic()
        retry_count = 0

        async def retried() -> AssetSnapshot:
            nonlocal retry_count
            result, retry_count = await _retry(fetch, "alpha_vantage")
            return result

        try:
            snapshot, cached = await self.cache.get_or_set(f"asset:{symbol}:{history_days}", 60, retried)
            self.last_errors.pop("alpha_vantage", None)
            return snapshot, cached, retry_count
        except ToolError as exc:
            self.last_errors[exc.provider] = str(exc)
            raise
        finally:
            _ = started

    async def get_macro_series(self, series_id: str, limit: int = 24) -> tuple[EvidenceItem, bool, int]:
        if not self.config.fred_api_key:
            raise ToolError("fred", "FRED_API_KEY is not configured")

        async def fetch() -> EvidenceItem:
            async with httpx.AsyncClient(timeout=self.config.request_timeout_seconds) as client:
                response = await client.get(
                    f"{self.config.fred_url}/series/observations",
                    params={
                        "series_id": series_id, "api_key": self.config.fred_api_key,
                        "file_type": "json", "sort_order": "desc", "limit": limit,
                    },
                )
                response.raise_for_status()
            observations = [item for item in response.json().get("observations", []) if item.get("value") not in {None, "."}]
            latest = observations[0] if observations else None
            if not latest:
                raise ValueError("FRED returned no observations")
            return EvidenceItem(
                kind="macro", title=f"FRED {series_id}: {latest['value']}", source="Federal Reserve Economic Data",
                provider="fred", url=f"https://fred.stlouisfed.org/series/{series_id}",
                published_at=datetime.fromisoformat(latest["date"]).replace(tzinfo=timezone.utc),
                summary=f"Latest {series_id} observation is {latest['value']} ({latest['date']}).",
                freshness="latest official observation",
            )

        async def retried() -> EvidenceItem:
            result, _ = await _retry(fetch, "fred")
            return result

        value, cached = await self.cache.get_or_set(f"fred:{series_id}:{limit}", 86_400, retried)
        return value, cached, 0

    async def search_news(self, query: str, limit: int = 6) -> tuple[list[EvidenceItem], bool, int]:
        async def fetch() -> list[EvidenceItem]:
            async with httpx.AsyncClient(timeout=self.config.request_timeout_seconds) as client:
                response = await client.get(
                    f"{self.config.gdelt_url}/doc/doc",
                    params={"query": query, "mode": "artlist", "format": "json", "maxrecords": limit, "sort": "datedesc"},
                )
                response.raise_for_status()
            articles = response.json().get("articles", [])
            return [
                EvidenceItem(
                    kind="news", title=str(item.get("title") or "Untitled article"),
                    source=str(item.get("domain") or "GDELT indexed source"), provider="gdelt",
                    url=item.get("url"), summary="Recent external context; not used in the numerical forecast.",
                    freshness="recent news metadata",
                )
                for item in articles[:limit]
            ]

        async def retried() -> list[EvidenceItem]:
            result, _ = await _retry(fetch, "gdelt")
            return result

        value, cached = await self.cache.get_or_set(f"news:{query}:{limit}", 900, retried)
        return value, cached, 0

    def health(self) -> dict[str, Any]:
        return {
            "alpha_vantage": {"configured": bool(self.config.alpha_vantage_api_key), "last_error": self.last_errors.get("alpha_vantage")},
            "fred": {"configured": bool(self.config.fred_api_key), "last_error": self.last_errors.get("fred")},
            "gdelt": {"configured": True, "base_url": self.config.gdelt_url, "last_error": self.last_errors.get("gdelt")},
        }
