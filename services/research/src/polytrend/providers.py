from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import httpx

from .analytics import normalize_probability
from .config import Settings
from .models import MarketSnapshot, RelationType


def _jsonish(value: Any, fallback: list[Any] | None = None) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
            return decoded if isinstance(decoded, list) else (fallback or [])
        except json.JSONDecodeError:
            return fallback or []
    return fallback or []


def _date(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


class PolymarketProvider:
    def __init__(self, config: Settings) -> None:
        self.config = config
        self.last_error: str | None = None
        self.last_result_count = 0

    async def search(self, query: str, limit: int = 24) -> list[MarketSnapshot]:
        if not self.config.live_market_data:
            return []
        params = {
            "q": query,
            "limit_per_type": max(5, min(limit, 50)),
            "events_status": "active",
        }
        try:
            timeout = httpx.Timeout(self.config.request_timeout_seconds)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                response = await client.get(f"{self.config.gamma_url}/public-search", params=params)
                response.raise_for_status()
                payload = response.json()
            records: list[tuple[dict[str, Any], dict[str, Any] | None]] = []
            if isinstance(payload, dict):
                for event in payload.get("events", []) or []:
                    for market in event.get("markets", []) or []:
                        records.append((market, event))
                for market in payload.get("markets", []) or []:
                    records.append((market, None))
            elif isinstance(payload, list):
                records.extend((market, None) for market in payload)
            mapped = [market for item, event in records if (market := self._map_market(item, event))]
            unique = {market.id: market for market in mapped}
            self.last_result_count = len(unique)
            self.last_error = None
            return list(unique.values())[:limit]
        except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            self.last_result_count = 0
            return []

    def _map_market(self, item: dict[str, Any], event: dict[str, Any] | None) -> MarketSnapshot | None:
        market_id = str(item.get("id") or item.get("conditionId") or "").strip()
        question = str(item.get("question") or item.get("title") or "").strip()
        if not market_id or not question:
            return None
        outcomes = [str(value).lower() for value in _jsonish(item.get("outcomes"), ["yes", "no"])]
        prices = _jsonish(item.get("outcomePrices"), [])
        yes_index = outcomes.index("yes") if "yes" in outcomes else 0
        try:
            probability = normalize_probability(prices[yes_index])
        except (IndexError, TypeError, ValueError):
            probability = normalize_probability(item.get("lastTradePrice") or 0.5)
        bid = item.get("bestBid")
        ask = item.get("bestAsk")
        bid_value = normalize_probability(bid) if bid is not None else None
        ask_value = normalize_probability(ask) if ask is not None else None
        slug = str(item.get("slug") or market_id)
        event_id = str((event or {}).get("id") or item.get("eventId") or "") or None
        tags = []
        for tag in (event or {}).get("tags", []) or []:
            tags.append(str(tag.get("label") if isinstance(tag, dict) else tag))
        return MarketSnapshot(
            id=market_id,
            question=question,
            slug=slug,
            event_id=event_id,
            event_title=str((event or {}).get("title") or "") or None,
            probability=probability,
            probability_change_24h=float(item.get("oneDayPriceChange") or 0),
            volume_24h=float(item.get("volume24hr") or item.get("volume24h") or 0),
            volume_total=float(item.get("volumeNum") or item.get("volume") or 0),
            liquidity=float(item.get("liquidityNum") or item.get("liquidity") or 0),
            open_interest=float(item.get("openInterest") or 0),
            best_bid=bid_value,
            best_ask=ask_value,
            spread=(ask_value - bid_value) if bid_value is not None and ask_value is not None else None,
            end_date=_date(item.get("endDateIso") or item.get("endDate")),
            resolution_criteria=str(item.get("description") or item.get("rules") or ""),
            resolution_source=str(item.get("resolutionSource") or "") or None,
            url=f"https://polymarket.com/event/{(event or {}).get('slug') or slug}",
            tags=tags,
            retrieval_sources=["gamma"],
            relevance=0.5,
            relation_type=RelationType.DIRECT,
            relation_reason="Discovered from Polymarket Gamma search.",
            quality=0.65,
            freshness="live gamma snapshot",
        )

    def health(self) -> dict[str, Any]:
        return {
            "status": "degraded" if self.last_error else "ok",
            "enabled": self.config.live_market_data,
            "base_url": self.config.gamma_url,
            "last_result_count": self.last_result_count,
            "last_error": self.last_error,
        }
