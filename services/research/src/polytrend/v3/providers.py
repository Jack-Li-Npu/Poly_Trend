"""Public evidence collection. Provider failures stay missing; recordings are explicit.

No order-placement or wallet-signing methods belong in this module. All payloads
are sanitized before they become content-addressed observations.
"""

from __future__ import annotations

import asyncio
import hashlib
import html
import json
import math
import os
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

from .models import (
    AssetSeries,
    Contract,
    EventDefinition,
    EvidenceBundle,
    LogicRelation,
    MarketSnapshot,
    Observation,
    SeriesPoint,
    utc_now,
)

SENSITIVE = re.compile(
    r"key|secret|password|passphrase|authorization|signature|credential|access_token", re.I
)
MACRO = re.compile(
    "\\bfed\\b|federal reserve|interest "
    "rate|inflation|recession|\\bgdp\\b|unemployment|treasury|tariff|oil|crude",
    re.I,
)


def number(value: Any) -> float | None:
    """Missing, NaN and malformed numbers never turn into a zero quote."""
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def probability(value: Any) -> float | None:
    result = number(value)
    return result if result is not None and 0 <= result <= 1 else None


def timestamp(value: Any, fallback: datetime | None = None) -> datetime | None:
    if value is None or value == "":
        return fallback
    try:
        if isinstance(value, datetime):
            result = value
        elif isinstance(value, (int, float)) or str(value).replace(".", "", 1).isdigit():
            seconds = float(value)
            result = datetime.fromtimestamp(
                seconds / 1000 if seconds > 100_000_000_000 else seconds, UTC
            )
        else:
            result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return result.replace(tzinfo=UTC) if result.tzinfo is None else result.astimezone(UTC)
    except (TypeError, ValueError, OverflowError, OSError):
        return fallback


def array(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            result = json.loads(value)
            return result if isinstance(result, list) else []
        except ValueError:
            pass
    return []


def trade_diagnostics(
    rows: list[dict[str, Any]], token: str, opposite_token: str | None = None
) -> dict[str, Any]:
    """Directional taker pressure in an observed, bounded binary-market sample.

    YES BUY and NO SELL point toward YES; YES SELL and NO BUY point away.
    Signed notional uses each executed outcome's own price. It is neither net
    capital inflow nor an equivalent synthetic YES acquisition cost.
    """
    seen: set[str] = set()
    wallets: set[str] = set()
    sample_times: list[datetime] = []
    shares, notional, count, rejected = 0.0, 0.0, 0, 0
    missing_price = False
    for row in rows:
        if not isinstance(row, dict) or str(row.get("trader_side", "TAKER")).upper() == "MAKER":
            continue
        # Prefer a source-provided fill/log identity; current public responses
        # often only permit exact composite-row deduplication.
        identity = next(
            (
                row.get(name)
                for name in ("trade_id", "sequence_id", "id")
                if row.get(name) is not None
            ),
            None,
        )
        if identity is not None:
            key = json.dumps(
                [identity, row.get("token_id"), row.get("side"), row.get("proxy_wallet")],
                sort_keys=True,
            )
        else:
            fields = (
                "transaction_hash",
                "log_index",
                "token_id",
                "asset",
                "side",
                "proxy_wallet",
                "timestamp",
                "price",
                "size",
                "outcome",
            )
            key = json.dumps([row.get(name) for name in fields], sort_keys=True, default=str)
        if key in seen:
            continue
        seen.add(key)
        asset = str(row.get("token_id") or row.get("asset") or "")
        outcome = str(row.get("outcome") or "").lower()
        direction = (
            1
            if asset == token
            else -1
            if asset
            and (asset == opposite_token if opposite_token is not None else outcome == "no")
            else None
        )
        side = str(row.get("side") or "").upper()
        size, price = number(row.get("size")), probability(row.get("price"))
        if direction is None or side not in {"BUY", "SELL"} or size is None or size <= 0:
            rejected += 1
            continue
        sign = direction * (1 if side == "BUY" else -1)
        shares += sign * size
        if price is None:
            missing_price = True
        else:
            notional += sign * size * price
        count += 1
        traded_at = timestamp(row.get("timestamp"))
        if traded_at is not None:
            sample_times.append(traded_at)
        if row.get("proxy_wallet"):
            wallets.add(str(row["proxy_wallet"]).lower())
    issues = [
        "Taker pressure is outcome-aware within a bounded recent-trades sample, not net "
        "capital inflow or predictive alpha.",
        "Exact duplicate composite rows are collapsed when no stable fill ID is supplied; "
        "identical distinct fills cannot always be distinguished.",
    ]
    if rejected:
        issues.append(
            f"{rejected} trade row(s) had missing/unsupported identity, "
            "side, outcome or size and were excluded."
        )
    if missing_price:
        issues.append("Some executed prices were unavailable; net notional is not reported.")
    if sample_times:
        issues.append(
            f"Observed trade sample spans {min(sample_times).isoformat()} to "
            f"{max(sample_times).isoformat()}; not a fixed 24-hour flow window."
        )
    return {
        "trade_count": count,
        "unique_wallets": len(wallets),
        "taker_net_shares": shares if count or not rows else None,
        "taker_net_notional_usd": notional if not missing_price and (count or not rows) else None,
        "issues": issues,
    }


def safe_url(value: str) -> str:
    """Remove credentials and secret query values, including signed source URLs."""
    try:
        parts = urlsplit(value)
        host = parts.hostname or ""
        if parts.port:
            host += f":{parts.port}"
        query = [
            (
                key,
                "[redacted]"
                if SENSITIVE.search(key) or key.lower() in {"token", "auth", "jwt", "bearer"}
                else val,
            )
            for key, val in parse_qsl(parts.query)
        ]
        return urlunsplit((parts.scheme, host, parts.path, urlencode(query), ""))
    except ValueError:
        return "[invalid source URL]"


class ProviderError(RuntimeError):
    def __init__(self, provider: str, code: str) -> None:
        self.provider, self.code = provider, code
        super().__init__(f"{provider}: {code}")


@dataclass(slots=True)
class ProviderConfig:
    gamma_url: str = "https://gamma-api.polymarket.com"
    clob_url: str = "https://clob.polymarket.com"
    data_url: str = "https://data-api.polymarket.com"
    coinbase_url: str = "https://api.exchange.coinbase.com"
    treasury_url: str = (
        "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml"
    )
    fred_url: str = "https://api.stlouisfed.org/fred"
    alpha_vantage_url: str = "https://www.alphavantage.co/query"
    fred_api_key: str | None = None
    alpha_vantage_api_key: str | None = None
    request_timeout_seconds: float = 10
    min_request_interval: float = 0.06
    max_retries: int = 2
    alpha_daily_budget: int = 20
    live_market_data: bool = True

    @classmethod
    def from_settings(cls, config: Any = None) -> ProviderConfig:
        result = cls()
        for name in cls.__dataclass_fields__:
            supplied = getattr(config, name, None) if config is not None else None
            if supplied is not None:
                setattr(result, name, supplied)
        result.data_url = os.getenv("POLYMARKET_DATA_URL", result.data_url).rstrip("/")
        if result.data_url.endswith("/v2"):
            result.data_url = result.data_url[:-3]
        result.fred_api_key = result.fred_api_key or os.getenv("FRED_API_KEY") or None
        result.alpha_vantage_api_key = (
            result.alpha_vantage_api_key or os.getenv("ALPHA_VANTAGE_API_KEY") or None
        )
        return result


class ResearchDataProvider:
    def __init__(
        self, config: Any = None, *, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self.config = ProviderConfig.from_settings(config)
        self._transport = transport
        self._cache: dict[str, tuple[float, Any]] = {}
        self._last_request: dict[str, float] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._errors: dict[str, str] = {}
        self._secrets = [
            value
            for value in (self.config.fred_api_key, self.config.alpha_vantage_api_key)
            if value
        ]
        self._alpha_used: dict[str, int] = {}

    def sanitize(self, value: Any) -> Any:
        if isinstance(value, dict):
            return {
                str(key): "[redacted]" if SENSITIVE.search(str(key)) else self.sanitize(item)
                for key, item in value.items()
            }
        if isinstance(value, (list, tuple)):
            return [self.sanitize(item) for item in value]
        if isinstance(value, str):
            result = value
            for secret in self._secrets:
                result = result.replace(secret, "[redacted]")
            is_xml = result.lstrip().startswith("<")

            def redact_url(match: re.Match[str]) -> str:
                cleaned = safe_url(html.unescape(match.group(0)) if is_xml else match.group(0))
                return html.escape(cleaned, quote=False) if is_xml else cleaned

            result = re.sub(r"https?://[^\s<>\"']+", redact_url, result)
            result = re.sub(
                r"(?i)(api[_-]?key|authorization|password|secret|passphrase)(\s*[=:]\s*)[^\s&,;]+",
                r"\1\2[redacted]",
                result,
            )
            return result
        return value

    async def _get(
        self,
        provider: str,
        url: str,
        params: dict[str, Any] | None = None,
        *,
        ttl: int = 0,
        text: bool = False,
    ) -> Any:
        cache_key = url + json.dumps(params or {}, sort_keys=True, default=str)
        cached = self._cache.get(cache_key)
        if cached and cached[0] > time.monotonic():
            return cached[1]
        lock = self._locks.setdefault(provider, asyncio.Lock())
        for attempt in range(self.config.max_retries + 1):
            try:
                async with lock:
                    pause = self.config.min_request_interval - (
                        time.monotonic() - self._last_request.get(provider, 0)
                    )
                    if pause > 0:
                        await asyncio.sleep(pause)
                    self._last_request[provider] = time.monotonic()
                    async with httpx.AsyncClient(
                        timeout=self.config.request_timeout_seconds,
                        transport=self._transport,
                        follow_redirects=True,
                        headers={"User-Agent": "PolyTrend/3.0 investment-research"},
                    ) as client:
                        response = await client.get(url, params=params)
                if (
                    response.status_code == 429 or response.status_code >= 500
                ) and attempt < self.config.max_retries:
                    retry = response.headers.get("Retry-After", "")
                    delay = number(retry)
                    if delay is None:
                        try:
                            delay = (parsedate_to_datetime(retry) - utc_now()).total_seconds()
                        except (TypeError, ValueError):
                            delay = 0.2 * (2**attempt)
                    await asyncio.sleep(min(5.0, max(0.0, delay)))
                    continue
                if response.is_error:
                    raise ProviderError(provider, f"HTTP {response.status_code}")
                value = response.text if text else response.json()
                value = self.sanitize(value)
                if ttl:
                    self._cache[cache_key] = (time.monotonic() + ttl, value)
                self._errors.pop(provider, None)
                return value
            except (httpx.HTTPError, ValueError) as exc:
                if attempt < self.config.max_retries:
                    await asyncio.sleep(0.2 * (2**attempt))
                    continue
                code = (
                    "invalid response" if isinstance(exc, ValueError) else "network request failed"
                )
                self._errors[provider] = code
                raise ProviderError(provider, code) from None
            except ProviderError as exc:
                self._errors[provider] = exc.code
                raise
        raise ProviderError(provider, "retry budget exhausted")

    def observation(
        self,
        provider: str,
        kind: str,
        external_id: str,
        url: str,
        payload: Any,
        *,
        observed_at: datetime | None = None,
        historical: bool = False,
    ) -> Observation:
        retrieved = utc_now()
        return Observation(
            provider=self.sanitize(provider),
            kind=self.sanitize(kind),
            external_id=self.sanitize(external_id),
            source_url=self.sanitize(safe_url(url)),
            observed_at=observed_at or retrieved,
            retrieved_at=retrieved,
            available_at=retrieved,
            historical_reconstruction=historical,
            payload=self.sanitize(payload if isinstance(payload, dict) else {"data": payload}),
        )

    def event_from_gamma(self, item: dict[str, Any]) -> EventDefinition:
        event_id = str(item.get("id") or "")
        if not event_id.isdigit():
            raise ProviderError("gamma", "event identifier missing")
        contracts = []
        for raw in item.get("markets") or []:
            market_id, condition = str(raw.get("id") or ""), str(raw.get("conditionId") or "")
            if not market_id.isdigit() or not re.fullmatch(
                r"0x(?:[0-9a-fA-F]{62}|[0-9a-fA-F]{64})", condition
            ):
                continue
            version = str(raw.get("version") or "unknown")
            tokens = (
                array(raw.get("positionIds"))
                if version == "v2"
                else array(raw.get("clobTokenIds"))
                if version == "v1"
                else []
            )
            labels = [str(value) for value in array(raw.get("outcomes"))]
            tokens = [str(value) for value in tokens]
            if any(not value.isdigit() for value in tokens):
                tokens = []
            if len(tokens) != len(labels):
                tokens = []
            contracts.append(
                Contract(
                    id=market_id,
                    event_id=event_id,
                    condition_id=condition,
                    question=str(raw.get("question") or ""),
                    outcomes=labels,
                    token_ids=tokens,
                    prices=[probability(value) for value in array(raw.get("outcomePrices"))],
                    protocol_version=version,
                    end_date=timestamp(raw.get("endDate")),
                    resolution_rules=str(raw.get("description") or ""),
                    resolution_source=self.sanitize(raw.get("resolutionSource"))
                    if raw.get("resolutionSource")
                    else None,
                    active=raw.get("active") is True,
                    closed=raw.get("closed") is True,
                    neg_risk=raw.get("negRisk") is True,
                    group_label=raw.get("groupItemTitle"),
                    # Gamma groupItemThreshold is frequently an ordinal, not an economic threshold.
                    group_threshold=None,
                )
            )
        title = str(item.get("title") or "Untitled event")
        slug = str(item.get("slug") or event_id)
        category = (
            "macro" if MACRO.search(title + " " + str(item.get("description") or "")) else "other"
        )
        relations = []
        if len(contracts) > 1 and all(contract.neg_risk for contract in contracts):
            relations.append(
                LogicRelation(
                    kind="exclusive",
                    market_ids=[contract.id for contract in contracts],
                    verified=True,
                    rationale="Provider negative-risk membership establishes mutually "
                    "exclusive YES outcomes; exhaustiveness is not assumed.",
                )
            )
        expected_fed_labels = {
            "50+ bps decrease",
            "25 bps decrease",
            "no change",
            "25 bps increase",
            "50+ bps increase",
        }
        labels = {str(contract.group_label or "").strip().lower() for contract in contracts}
        rules = {" ".join(contract.resolution_rules.lower().split()) for contract in contracts}
        rules_text = next(iter(rules), "")
        if (
            len(contracts) == 5
            and labels == expected_fed_labels
            and len(rules) == 1
            and all(contract.neg_risk for contract in contracts)
            and not item.get("negRiskAugmented")
            and "target federal funds" in rules_text
            and "nearest 25" in rules_text
            and "no change" in rules_text
            and "federalreserve.gov" in rules_text
        ):
            relations.append(
                LogicRelation(
                    kind="exhaustive",
                    market_ids=[contract.id for contract in contracts],
                    verified=True,
                    rationale="Reviewed five-bracket FOMC partition: 50+ cut, 25 cut, no "
                    "change, 25 hike, 50+ hike; identical rules round changes to "
                    "25bp and include the no-statement fallback. No augmented "
                    "Other outcomes.",
                )
            )
        return EventDefinition(
            id=event_id,
            title=title,
            slug=slug,
            category=category,
            description=str(item.get("description") or ""),
            source_url=f"https://polymarket.com/event/{slug}",
            deadline=timestamp(item.get("endDate")),
            contracts=contracts,
            relations=relations,
            asset_links={
                symbol: reason
                for symbol, reason in (
                    (
                        "SPY",
                        "Broad equity exposure; sensitivity is a hypothesis, not a fixed "
                        "causal coefficient.",
                    ),
                    (
                        "QQQ",
                        "Growth-equity exposure to macro repricing; effect requires validation.",
                    ),
                    (
                        "IEF",
                        "Intermediate Treasury fund exposure; yield and fund returns are distinct.",
                    ),
                    (
                        "TLT",
                        "Long-duration Treasury fund exposure; yield and fund returns are "
                        "distinct.",
                    ),
                    (
                        "BTC-USD",
                        "Crypto exposure to liquidity and risk sentiment; direction is not "
                        "guaranteed.",
                    ),
                )
            }
            if category == "macro"
            else {},
        )

    async def get_event(self, event_id: str) -> EventDefinition:
        if not self.config.live_market_data:
            raise ProviderError("polymarket", "live data disabled; select recorded mode explicitly")
        if not str(event_id).isdigit():
            raise ProviderError("gamma", "invalid event identifier")
        raw = await self._get("gamma", f"{self.config.gamma_url}/events/{event_id}", ttl=30)
        return self.event_from_gamma(raw)

    async def discover(
        self, query: str = "", include_closed: bool = False, limit: int = 20
    ) -> list[EventDefinition]:
        if not self.config.live_market_data:
            raise ProviderError("polymarket", "live data disabled; select recorded mode explicitly")
        limit = max(1, min(50, limit))
        found: dict[str, dict[str, Any]] = {}
        if query.strip():
            for page in range(1, 5):
                payload = await self._get(
                    "gamma",
                    f"{self.config.gamma_url}/public-search",
                    {
                        "q": query.strip(),
                        "limit_per_type": min(50, limit),
                        "page": page,
                        "events_status": "all" if include_closed else "active",
                        "keep_closed_markets": 1 if include_closed else 0,
                    },
                    ttl=30,
                )
                for event in payload.get("events") or []:
                    if event.get("id") and (include_closed or not event.get("closed")):
                        found[str(event["id"])] = event
                if len(found) >= limit or not payload.get("pagination", {}).get("hasMore"):
                    break
        else:
            cursor = None
            for _ in range(5):
                params: dict[str, Any] = {"limit": 100, "order": "volume", "ascending": "false"}
                if not include_closed:
                    params["closed"] = "false"
                if cursor:
                    params["after_cursor"] = cursor
                payload = await self._get(
                    "gamma", f"{self.config.gamma_url}/events/keyset", params, ttl=30
                )
                for event in payload.get("events") or []:
                    if event.get("id") and MACRO.search(str(event.get("title") or "")):
                        found[str(event["id"])] = event
                cursor = payload.get("next_cursor")
                if not cursor or len(found) >= limit:
                    break
        events = []
        for event_id in list(found)[:limit]:
            try:
                # Hydration preserves the complete family omitted by search previews.
                raw = await self._get("gamma", f"{self.config.gamma_url}/events/{event_id}", ttl=30)
            except ProviderError:
                # A search preview is not proof of a complete event family.
                continue
            events.append(self.event_from_gamma(raw))
        if found and not events:
            raise ProviderError("gamma", "event-family hydration unavailable")
        return events

    async def _data(
        self, route: str, params: dict[str, Any], *, max_pages: int = 2
    ) -> tuple[list[Any], list[Any], bool]:
        """Bound all walks; retain every raw page and disclose truncation."""
        pages, rows = [], []
        cursor = None
        for _ in range(max_pages):
            request = dict(params)
            if cursor:
                request["cursor"] = cursor
            page = await self._get(
                "polymarket_data", f"{self.config.data_url}/v2/{route}", request, ttl=20
            )
            if not isinstance(page, dict) or "data" not in page:
                raise ProviderError("polymarket_data", "v2 envelope missing")
            pages.append(page)
            data = page["data"]
            rows.extend(data if isinstance(data, list) else [data] if data is not None else [])
            cursor = (page.get("pagination") or {}).get("next_cursor")
            if not cursor:
                break
        return rows, pages, bool(cursor)

    async def capture(
        self, event: EventDefinition, assets: list[str], as_of: datetime | None = None
    ) -> EvidenceBundle:
        if not self.config.live_market_data:
            raise ProviderError("polymarket", "live data disabled; select recorded mode explicitly")
        captured = utc_now()
        cutoff = timestamp(as_of) if as_of else captured
        if cutoff is None or cutoff > captured + timedelta(seconds=1):
            raise ProviderError("capture", "as_of must not be in the future")
        historical = as_of is not None
        bundle = EvidenceBundle(event=event.model_copy(deep=True), captured_at=captured)
        bundle.issues.append(
            "Public observations are captured now; historical reconstructions do not "
            "certify that the event definition or book was available at an earlier "
            "decision time."
        )
        raw_event = None
        try:
            raw_event = await self._get("gamma", f"{self.config.gamma_url}/events/{event.id}")
            bundle.observations.append(
                self.observation(
                    "gamma",
                    "event_definition",
                    event.id,
                    f"{self.config.gamma_url}/events/{event.id}",
                    raw_event,
                    historical=historical,
                )
            )
            if not historical:
                bundle.event = self.event_from_gamma(raw_event)
                event = bundle.event
        except ProviderError as exc:
            bundle.issues.append(str(exc))
        if len(event.contracts) > 20:
            bundle.issues.append(
                "Capture bounded to 20 contracts; full event definition remains visible."
            )
        raw_markets = {str(item.get("id")): item for item in (raw_event or {}).get("markets", [])}
        for contract in event.contracts[:20]:
            raw = raw_markets.get(contract.id, {})
            labels = [label.lower() for label in contract.outcomes]
            index = labels.index("yes") if "yes" in labels else 0
            token = contract.token_ids[index] if len(contract.token_ids) > index else ""
            gamma_price = contract.prices[index] if len(contract.prices) > index else None
            snapshot = MarketSnapshot(
                market_id=contract.id,
                condition_id=contract.condition_id,
                token_id=token,
                outcome=contract.outcomes[index] if len(contract.outcomes) > index else "Unknown",
                probability=None if historical else gamma_price,
                quote_type="unavailable" if historical or gamma_price is None else "gamma",
                as_of=cutoff if historical else timestamp(raw.get("updatedAt"), captured),
                volume_24h_usd=None if historical else number(raw.get("volume24hr")),
            )
            snapshot.observation_ids.extend(
                item.id for item in bundle.observations if item.kind == "event_definition"
            )
            if not token:
                snapshot.issues.append(
                    "Outcome asset ID unavailable or unsupported market version; "
                    "CLOB/history not requested."
                )
            elif not historical:
                try:
                    book = await self._get(
                        "clob", f"{self.config.clob_url}/book", {"token_id": token}
                    )
                    observation = self.observation(
                        "clob",
                        "order_book",
                        token,
                        f"{self.config.clob_url}/book?token_id={token}",
                        book,
                        observed_at=timestamp(book.get("timestamp"), captured),
                    )
                    bundle.observations.append(observation)
                    snapshot.observation_ids.append(observation.id)
                    bids = [
                        (probability(level.get("price")), number(level.get("size")))
                        for level in book.get("bids", [])
                    ]
                    asks = [
                        (probability(level.get("price")), number(level.get("size")))
                        for level in book.get("asks", [])
                    ]
                    snapshot.bid = max(
                        (p for p, s in bids if p is not None and s is not None and s > 0),
                        default=None,
                    )
                    snapshot.ask = min(
                        (p for p, s in asks if p is not None and s is not None and s > 0),
                        default=None,
                    )
                    snapshot.bid_depth_usd = sum(
                        p * s for p, s in bids if p is not None and s is not None and s > 0
                    )
                    snapshot.ask_depth_usd = sum(
                        p * s for p, s in asks if p is not None and s is not None and s > 0
                    )
                    snapshot.tick_size = number(book.get("tick_size"))
                    snapshot.as_of = observation.observed_at
                    if (
                        snapshot.bid is not None
                        and snapshot.ask is not None
                        and snapshot.ask >= snapshot.bid
                    ):
                        snapshot.spread = snapshot.ask - snapshot.bid
                        if snapshot.spread <= 0.10:
                            snapshot.probability = (snapshot.ask + snapshot.bid) / 2
                            snapshot.quote_type = "midpoint"
                        else:
                            snapshot.probability = probability(book.get("last_trade_price"))
                            snapshot.quote_type = (
                                "last_trade" if snapshot.probability is not None else "unavailable"
                            )
                            snapshot.issues.append(
                                "Wide spread: last trade may be stale and is not an "
                                "executable midpoint."
                            )
                    else:
                        snapshot.issues.append(
                            "Two-sided non-crossed book unavailable; Gamma indication may be stale."
                        )
                    fee = await self._get(
                        "clob", f"{self.config.clob_url}/fee-rate", {"token_id": token}, ttl=300
                    )
                    fee_obs = self.observation(
                        "clob",
                        "fee_rate",
                        token,
                        f"{self.config.clob_url}/fee-rate?token_id={token}",
                        fee,
                    )
                    bundle.observations.append(fee_obs)
                    snapshot.observation_ids.append(fee_obs.id)
                    rate = number(fee.get("base_fee"))
                    snapshot.fee_rate = rate / 10000 if rate is not None else None
                except ProviderError as exc:
                    snapshot.issues.append(str(exc))
            if token:
                points, history_obs, history_issues = await self.probability_history(token, cutoff)
                snapshot.history = points
                snapshot.issues.extend(history_issues)
                if history_obs:
                    bundle.observations.append(history_obs)
                    snapshot.observation_ids.append(history_obs.id)
                    if historical and snapshot.history:
                        snapshot.probability = snapshot.history[-1].value
                        snapshot.as_of = snapshot.history[-1].timestamp
                        snapshot.issues.append(
                            "Historical chart value is reconstructed, not a certified "
                            "historical bid/ask quote."
                        )
            if not historical:
                for route, params in (
                    (
                        "trades",
                        {"condition": contract.condition_id, "limit": 100, "taker_only": "true"},
                    ),
                    ("holders", {"condition": contract.condition_id, "limit": 100}),
                    ("oi", {"condition": contract.condition_id}),
                    (
                        "positions",
                        {"condition": contract.condition_id, "limit": 100, "status": "OPEN"},
                    ),
                    ("resolutions", {"condition": contract.condition_id}),
                ):
                    try:
                        rows, pages, truncated = await self._data(route, params, max_pages=1)
                        observation = self.observation(
                            "polymarket_data",
                            route,
                            contract.condition_id,
                            f"{self.config.data_url}/v2/{route}?condition={contract.condition_id}",
                            {"pages": pages},
                        )
                        bundle.observations.append(observation)
                        snapshot.observation_ids.append(observation.id)
                        if route == "trades":
                            opposite = next(
                                (item for item in contract.token_ids if item != token), None
                            )
                            diagnostics = trade_diagnostics(rows, token, opposite)
                            snapshot.unique_participants = diagnostics["unique_wallets"]
                            for field in (
                                "trade_count",
                                "taker_net_shares",
                                "taker_net_notional_usd",
                            ):
                                if field in type(snapshot).model_fields:
                                    setattr(snapshot, field, diagnostics[field])
                            snapshot.issues.extend(diagnostics["issues"])
                            snapshot.issues.append(
                                "Participants count is observed wallets in a bounded "
                                "recent-trades page, not all traders or unique people."
                            )
                        elif route == "oi" and rows:
                            # /v2/oi value is *priced gross* interest, not shares.
                            if "open_interest_usd" in type(snapshot).model_fields:
                                snapshot.open_interest_usd = number(rows[0].get("value"))
                            else:
                                snapshot.issues.append(
                                    "Priced gross OI is retained in raw evidence; no share "
                                    "quantity is inferred from its USD value."
                                )
                        elif route == "holders":
                            snapshot.holder_coverage = (
                                "bounded per-outcome holder page; no full concentration denominator"
                            )
                        if truncated:
                            snapshot.issues.append(
                                f"{route} page budget reached; coverage is incomplete."
                            )
                    except ProviderError as exc:
                        snapshot.issues.append(f"{route}: {exc}")
            if not snapshot.history:
                snapshot.issues.append(
                    "No probability history returned; repricing and lead-lag calculations "
                    "are unavailable."
                )
            bundle.markets.append(snapshot)
        if not historical:
            try:
                payload = await self._get(
                    "polymarket_data", f"{self.config.data_url}/v2/status", ttl=20
                )
                bundle.observations.append(
                    self.observation(
                        "polymarket_data",
                        "data_freshness",
                        "status",
                        f"{self.config.data_url}/v2/status",
                        payload,
                    )
                )
            except ProviderError as exc:
                bundle.issues.append(str(exc))
        for symbol in dict.fromkeys(assets):
            series, observations = await self.asset_series(symbol, cutoff)
            bundle.assets.append(series)
            bundle.observations.extend(observations)
        # A bundle is available after its last request, not when capture starts.
        # Historical evaluation still uses the explicitly requested as_of cutoff.
        bundle.captured_at = utc_now()
        return bundle

    async def probability_history(
        self, token: str, cutoff: datetime
    ) -> tuple[list[SeriesPoint], Observation | None, list[str]]:
        """Coarse whole-life read, then explicit 180-day/as-of filtering.

        The live service rejects long explicit start/end windows even at coarse
        widths. interval=max is the documented whole-life query shape.
        """
        issues: list[str] = []
        history: list[tuple[datetime | None, float | None]] = []
        observation = None
        try:
            rows, pages, truncated = await self._data(
                "prices-history",
                {
                    "token_id": token,
                    "interval": "max",
                    "bucket_seconds": 43200,
                    "limit": 1000,
                },
                max_pages=4,
            )
            history = [
                (timestamp(row.get("timestamp")), probability(row.get("price"))) for row in rows
            ]
            observation = self.observation(
                "polymarket_data",
                "probability_history",
                token,
                f"{self.config.data_url}/v2/prices-history?token_id={token}&interval=max&bucket_seconds=43200",
                {"pages": pages},
                historical=True,
            )
            if truncated:
                issues.append("History page budget reached; history is incomplete.")
        except ProviderError as exc:
            issues.append(f"history: {exc}")
            try:
                page = await self._get(
                    "clob",
                    f"{self.config.clob_url}/prices-history",
                    {"market": token, "interval": "max", "fidelity": 720},
                    ttl=60,
                )
                history = [
                    (timestamp(row.get("t")), probability(row.get("p")))
                    for row in page.get("history", [])
                ]
                observation = self.observation(
                    "clob",
                    "probability_history",
                    token,
                    f"{self.config.clob_url}/prices-history?market={token}&interval=max&fidelity=720",
                    page,
                    historical=True,
                )
                issues.append(
                    "Compatibility history from CLOB route; retention/granularity can "
                    "differ from Data API v2."
                )
            except ProviderError as history_exc:
                issues.append(f"history: {history_exc}")
        if observation is None:
            return [], None, issues
        start = cutoff - timedelta(days=180)
        points = {
            t: SeriesPoint(timestamp=t, value=p, available_at=observation.retrieved_at)
            for t, p in history
            if t is not None and p is not None and start <= t <= cutoff
        }
        if points:
            observation.observed_at = max(points)
        return [points[t] for t in sorted(points)], observation, issues

    async def asset_series(
        self, symbol: str, cutoff: datetime
    ) -> tuple[AssetSeries, list[Observation]]:
        symbol = symbol.upper()
        if symbol in {"BTC", "BTCUSD", "BTC-USD"}:
            return await self._coinbase(cutoff)
        if symbol in {"DGS2", "DGS10", "UST2Y", "UST10Y", "TREASURY-2Y", "TREASURY-10Y"}:
            return await self._treasury("DGS2" if "2" in symbol else "DGS10", cutoff)
        if symbol.startswith("FRED:"):
            return await self._fred(symbol[5:], cutoff)
        return await self._alpha(symbol, cutoff)

    async def _coinbase(self, cutoff: datetime) -> tuple[AssetSeries, list[Observation]]:
        url = f"{self.config.coinbase_url}/products/BTC-USD/candles"
        series = AssetSeries(symbol="BTC-USD", provider="Coinbase Exchange", source_url=url)
        try:
            raw = await self._get(
                "coinbase",
                url,
                {
                    "granularity": 86400,
                    "start": (cutoff - timedelta(days=180)).isoformat(),
                    "end": cutoff.isoformat(),
                },
                ttl=300,
            )
            observation = self.observation(
                "coinbase", "daily_candles", "BTC-USD", url, raw, historical=True
            )
            points = {}
            for row in raw if isinstance(raw, list) else []:
                if not isinstance(row, list) or len(row) < 6:
                    continue
                opened, close = timestamp(row[0]), number(row[4])
                if (
                    opened
                    and close is not None
                    and close > 0
                    and opened + timedelta(days=1) <= cutoff
                ):
                    closed = opened + timedelta(days=1)
                    points[closed] = SeriesPoint(timestamp=closed, value=close, available_at=closed)
            series.points = [points[t] for t in sorted(points)]
            series.observation_ids = [observation.id]
            series.issues.append(
                "Daily candle closes are available after the UTC interval ends; historical "
                "exchange retrieval is reconstructed, not a recorded real-time response."
            )
            return series, [observation]
        except ProviderError as exc:
            series.issues.append(str(exc))
            return series, []

    async def _treasury(
        self, symbol: str, cutoff: datetime
    ) -> tuple[AssetSeries, list[Observation]]:
        url = self.config.treasury_url
        series = AssetSeries(
            symbol=symbol,
            provider="U.S. Treasury",
            source_url=url,
            adjustment="yield",
            unit="percent",
        )
        observations, points = [], {}
        field = "BC_2YEAR" if symbol == "DGS2" else "BC_10YEAR"
        for year in range((cutoff - timedelta(days=180)).year, cutoff.year + 1):
            try:
                raw = await self._get(
                    "treasury",
                    url,
                    {"data": "daily_treasury_yield_curve", "field_tdr_date_value": year},
                    ttl=3600,
                    text=True,
                )
                parse_text = re.sub(
                    r"&(?!#\d+;|#x[0-9A-Fa-f]+;|[A-Za-z][A-Za-z0-9]*;)", "&amp;", raw
                )
                if parse_text != raw:
                    series.issues.append(
                        "Bare ampersands in XML links were escaped for parsing; numeric "
                        "fields were not changed and the normalized response is retained."
                    )
                root = ET.fromstring(parse_text)
                observation = self.observation(
                    "treasury",
                    "daily_yield_curve",
                    str(year),
                    f"{url}?data=daily_treasury_yield_curve&field_tdr_date_value={year}",
                    {"xml": raw},
                    historical=True,
                )
                observations.append(observation)
                for element in root.iter():
                    children = {child.tag.rsplit("}", 1)[-1]: child.text for child in element}
                    day, value = timestamp(children.get("NEW_DATE")), number(children.get(field))
                    if day and value is not None:
                        available = day + timedelta(days=1)
                        if available <= cutoff and day >= cutoff - timedelta(days=180):
                            points[day] = SeriesPoint(
                                timestamp=day, value=value, available_at=available
                            )
            except (ProviderError, ET.ParseError) as exc:
                series.issues.append(
                    str(exc) if isinstance(exc, ProviderError) else "treasury: invalid XML"
                )
        series.points = [points[t] for t in sorted(points)]
        series.observation_ids = [item.id for item in observations]
        series.issues.extend(
            [
                "Yield levels are not investable fund returns; report changes in basis points.",
                "Availability conservatively assigned to next UTC day; exact historical "
                "release timestamps are not certified.",
            ]
        )
        return series, observations

    async def _fred(
        self, series_id: str, cutoff: datetime
    ) -> tuple[AssetSeries, list[Observation]]:
        url = f"{self.config.fred_url}/series/observations"
        series = AssetSeries(
            symbol=f"FRED:{series_id}",
            provider="FRED / ALFRED",
            source_url=f"https://fred.stlouisfed.org/series/{series_id}",
            adjustment="unknown",
            unit="index",
        )
        if not self.config.fred_api_key:
            series.issues.append(
                "FRED_API_KEY is not configured; no macro observations were fabricated."
            )
            return series, []
        try:
            # Read the last complete UTC vintage day. FRED echoes the selected
            # real-time interval; it does not expose exact intraday release times.
            day = (cutoff - timedelta(days=1)).date().isoformat()
            payload = await self._get(
                "fred",
                url,
                {
                    "series_id": series_id,
                    "api_key": self.config.fred_api_key,
                    "file_type": "json",
                    "observation_start": (cutoff - timedelta(days=400)).date().isoformat(),
                    "realtime_start": day,
                    "realtime_end": day,
                },
                ttl=3600,
            )
            observation = self.observation(
                "fred", "vintage_series", series_id, series.source_url, payload, historical=True
            )
            for row in payload.get("observations", []):
                date, value, vintage = (
                    timestamp(row.get("date")),
                    number(row.get("value")),
                    timestamp(row.get("realtime_start")),
                )
                available = (vintage + timedelta(days=1)) if vintage else None
                if date and value is not None and available and available <= cutoff:
                    series.points.append(
                        SeriesPoint(timestamp=date, value=value, available_at=available)
                    )
            series.observation_ids = [observation.id]
            series.issues.append(
                "ALFRED read as of the last complete UTC vintage day; exact intraday "
                "release times and full revision history are not certified. Availability "
                "uses next UTC day conservatively."
            )
            return series, [observation]
        except ProviderError as exc:
            series.issues.append(str(exc))
            return series, []

    async def _alpha(self, symbol: str, cutoff: datetime) -> tuple[AssetSeries, list[Observation]]:
        series = AssetSeries(
            symbol=symbol,
            provider="Alpha Vantage",
            source_url="https://www.alphavantage.co/documentation/",
            adjustment="raw",
        )
        if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,14}", symbol):
            series.issues.append("Unsupported asset symbol.")
            return series, []
        if not self.config.alpha_vantage_api_key:
            series.issues.append(
                "ALPHA_VANTAGE_API_KEY is not configured; import attributed ETF prices or "
                "configure an optional key."
            )
            return series, []
        cache_key = f"alpha:{symbol}:{cutoff.date()}"
        cached = self._cache.get(cache_key)
        if cached and cached[0] > time.monotonic():
            return cached[1]
        budget_day = utc_now().date().isoformat()
        if self._alpha_used.get(budget_day, 0) >= self.config.alpha_daily_budget:
            series.issues.append("Optional Alpha Vantage daily request budget reached.")
            return series, []
        self._alpha_used[budget_day] = self._alpha_used.get(budget_day, 0) + 1
        try:
            payload = await self._get(
                "alpha_vantage",
                self.config.alpha_vantage_url,
                {
                    "function": "TIME_SERIES_DAILY",
                    "symbol": symbol,
                    "outputsize": "compact",
                    "apikey": self.config.alpha_vantage_api_key,
                },
                ttl=21600,
            )
            raw = payload.get("Time Series (Daily)")
            if not isinstance(raw, dict):
                raise ProviderError(
                    "alpha_vantage", "daily prices unavailable or provider quota reached"
                )
            observation = self.observation(
                "alpha_vantage", "daily_prices", symbol, series.source_url, payload, historical=True
            )
            for day, row in sorted(raw.items()):
                date, close = timestamp(day), number(row.get("4. close"))
                available = date + timedelta(days=1) if date else None
                if date and close is not None and close > 0 and available and available <= cutoff:
                    series.points.append(
                        SeriesPoint(timestamp=date, value=close, available_at=available)
                    )
            series.observation_ids = [observation.id]
            series.issues.append(
                "Raw daily closes exclude dividend reinvestment and may contain splits; "
                "not total-return performance. Next-UTC-day availability is conservative."
            )
            result = (series, [observation])
            self._cache[cache_key] = (time.monotonic() + 21600, result)
            return result
        except ProviderError as exc:
            series.issues.append(str(exc))
            return series, []

    def health(self) -> dict[str, Any]:
        return {
            "mode": "public-first",
            "status": "degraded" if self._errors else "ok",
            "last_errors": dict(self._errors),
            "fred_configured": bool(self.config.fred_api_key),
            "alpha_vantage_configured": bool(self.config.alpha_vantage_api_key),
            "data_api_version": "v2",
            "live_seed_fallback": False,
            "live_enabled": self.config.live_market_data,
            "optional_price_budget_remaining": max(
                0,
                self.config.alpha_daily_budget
                - self._alpha_used.get(utc_now().date().isoformat(), 0),
            ),
        }


def load_recorded_bundles(directory: Path | None = None) -> list[EvidenceBundle]:
    candidates = [
        Path(os.getenv("POLYTREND_SHOWCASE_DIR", "showcase")),
        *(parent / "showcase" for parent in Path(__file__).resolve().parents),
    ]
    root = directory or next(
        (candidate for candidate in candidates if candidate.is_dir()), candidates[0]
    )
    bundles = []
    if not root.is_dir():
        return bundles
    manifest = root / "capture_manifest.json"
    expected_hashes = None
    if manifest.exists():
        try:
            expected_hashes = {
                item["file"]: item["sha256"] for item in json.loads(manifest.read_text())["cases"]
            }
        except (ValueError, OSError, KeyError, TypeError):
            return bundles
    for path in sorted(root.glob("*.json")):
        if path.name.endswith("manifest.json"):
            continue
        try:
            if (
                expected_hashes is not None
                and expected_hashes.get(path.name) != hashlib.sha256(path.read_bytes()).hexdigest()
            ):
                continue
            bundle = EvidenceBundle.model_validate_json(path.read_text())
            if bundle.event.origin != "recorded" or any(
                item.origin != "recorded" for item in bundle.observations
            ):
                continue
            bundles.append(bundle)
        except (ValueError, OSError):
            continue
    return bundles
