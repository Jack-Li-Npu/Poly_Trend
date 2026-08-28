from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from .models import MarketSnapshot, PricePoint, RelationType


def _history(current: float, phase: float) -> list[PricePoint]:
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    points: list[PricePoint] = []
    for index in range(30):
        trend = (index - 29) * 0.0022
        wave = math.sin(index * 0.72 + phase) * 0.025
        probability = min(0.97, max(0.03, current + trend + wave))
        points.append(PricePoint(timestamp=now - timedelta(days=29 - index), probability=probability))
    points[-1].probability = current
    return points


def seed_markets() -> list[MarketSnapshot]:
    raw = [
        ("recession-2027", "Will the U.S. enter a recession before the end of 2027?", 0.41, 0.03, 2_305_417, 124_863, 1_102_770, RelationType.DIRECT, 0.98, "Directly matches the outcome and time window."),
        ("recession-2026", "Will the U.S. enter a recession before Dec 31, 2026?", 0.35, 0.02, 1_240_000, 88_120, 742_000, RelationType.DIRECT, 0.92, "Same outcome with an earlier horizon."),
        ("recession-in-2027", "Will there be a U.S. recession during 2027?", 0.45, 0.04, 1_180_000, 103_442, 690_000, RelationType.DIRECT, 0.94, "Same event family and target year."),
        ("recession-before-2028", "Will the U.S. have a recession before 2028?", 0.42, 0.01, 421_000, 31_900, 213_000, RelationType.DUPLICATE, 0.89, "Near-duplicate wording of the target proposition."),
        ("no-recession-before-2028", "Will the U.S. avoid a recession through the end of 2027?", 0.58, -0.01, 388_000, 28_430, 206_000, RelationType.COMPLEMENT, 0.86, "Logical complement of the target proposition; orientation is inverted before aggregation."),
        ("yield-curve-negative", "Will the 10Y–2Y yield curve be negative on Dec 31, 2026?", 0.68, 0.05, 742_000, 64_120, 310_000, RelationType.SUPPORTING_PROXY, 0.71, "A macro-financial proxy that can support recession risk."),
        ("real-gdp-negative", "Will U.S. real GDP growth be below 0% in any quarter of 2026?", 0.38, 0.02, 563_000, 40_088, 267_000, RelationType.SUPPORTING_PROXY, 0.67, "Growth contraction is related but not equivalent to recession resolution."),
        ("fed-75bps", "Will the Fed cut rates by at least 75 bps before Dec 31, 2026?", 0.61, -0.03, 1_010_000, 75_211, 489_000, RelationType.CONFLICTING_PROXY, 0.63, "Policy easing can reflect risk but has ambiguous direction."),
        ("sp500-ath", "Will the S&P 500 make a new all-time high in 2026?", 0.62, -0.02, 1_370_000, 91_227, 575_000, RelationType.CONFLICTING_PROXY, 0.58, "Risk-asset optimism offsets recession pricing."),
        ("core-pce", "Will core PCE fall below 2.5% by Dec 31, 2026?", 0.35, -0.01, 368_000, 25_001, 184_000, RelationType.CONFLICTING_PROXY, 0.55, "Disinflation changes the policy path but is not the target event."),
    ]
    result: list[MarketSnapshot] = []
    for i, (market_id, question, probability, move, total, day, liquidity, relation, relevance, reason) in enumerate(raw):
        bid = max(0.01, probability - 0.01)
        ask = min(0.99, probability + 0.01)
        result.append(
            MarketSnapshot(
                id=market_id,
                question=question,
                slug=market_id,
                event_id="macro-recession-2027" if i < 5 else f"macro-proxy-{i}",
                event_title="U.S. recession outlook" if i < 5 else "Macro indicators",
                probability=probability,
                probability_change_24h=move,
                volume_24h=day,
                volume_total=total,
                liquidity=liquidity,
                open_interest=liquidity * 0.72,
                best_bid=bid,
                best_ask=ask,
                spread=ask - bid,
                end_date=datetime(2027 if i in (0, 2, 3, 4) else 2026, 12, 31, 23, 59, tzinfo=timezone.utc),
                resolution_criteria=(
                    "Resolves YES if the National Bureau of Economic Research dates the start of a U.S. recession within the stated period; otherwise NO."
                    if i < 5
                    else "Resolves from the named official statistical or market source using the threshold in the question."
                ),
                resolution_source="https://www.nber.org/research/business-cycle-dating",
                url=f"https://polymarket.com/event/{market_id}",
                tags=["economy", "macro", "recession" if i < 5 else "indicator"],
                relevance=relevance,
                relation_type=relation,
                relation_confidence=min(0.98, relevance),
                relation_reason=reason,
                quality=min(0.97, 0.55 + math.log10(total + 1) / 16),
                history=_history(probability, i * 0.8),
            )
        )
    return result
