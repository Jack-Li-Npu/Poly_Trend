from __future__ import annotations

import math
import re
from collections.abc import Iterable
from statistics import fmean, pstdev

from .models import CoverageState, MarketImpliedAnswer, MarketSnapshot, RelationType


def normalize_probability(value: float | int | str) -> float:
    number = float(value)
    if number > 1:
        number /= 100
    return min(1.0, max(0.0, number))


def _logit(value: float) -> float:
    clipped = min(0.995, max(0.005, value))
    return math.log(clipped / (1 - clipped))


def _sigmoid(value: float) -> float:
    return 1 / (1 + math.exp(-value))


def _weighted_quantile(values: list[tuple[float, float]], quantile: float) -> float:
    ordered = sorted(values)
    total = sum(weight for _, weight in ordered) or 1
    cursor = 0.0
    for value, weight in ordered:
        cursor += weight
        if cursor / total >= quantile:
            return value
    return ordered[-1][0]


def proposition_cluster(question: str) -> str:
    words = re.findall(r"[a-z0-9]+", question.lower())
    stop = {"will", "the", "a", "an", "before", "during", "by", "of", "be", "have"}
    return " ".join(word for word in words if word not in stop and not word.isdigit())[:100]


def aggregate_markets(markets: list[MarketSnapshot]) -> MarketImpliedAnswer:
    eligible = [
        market
        for market in markets
        if market.included
        and market.relation_type in {RelationType.DIRECT, RelationType.COMPLEMENT, RelationType.DUPLICATE}
        and market.relevance >= 0.58
    ]
    excluded = [market.id for market in markets if market not in eligible]
    if not eligible:
        return MarketImpliedAnswer(
            conclusion="insufficient",
            label="Insufficient market evidence",
            coverage=CoverageState.INSUFFICIENT,
            agreement=0,
            methodology="No point estimate is produced without a direct, comparable prediction market.",
            caveats=["Related proxy markets are shown for context but are excluded from aggregation."],
            excluded_market_ids=excluded,
            provider_freshness={"polymarket": "seeded fallback"},
        )

    clusters: dict[str, list[MarketSnapshot]] = {}
    for market in eligible:
        clusters.setdefault(proposition_cluster(market.question), []).append(market)

    weighted: list[tuple[float, float, MarketSnapshot]] = []
    for cluster_markets in clusters.values():
        dependency_discount = 1 / len(cluster_markets)
        for market in cluster_markets:
            probability = 1 - market.probability if market.relation_type == RelationType.COMPLEMENT else market.probability
            liquidity_factor = min(1.0, math.log10(max(10, market.liquidity)) / 6)
            weight = max(0.01, market.relevance * market.quality * liquidity_factor * dependency_discount)
            weighted.append((probability, weight, market))

    pooled_logit = sum(_logit(probability) * weight for probability, weight, _ in weighted) / sum(
        weight for _, weight, _ in weighted
    )
    probability = _sigmoid(pooled_logit)
    distribution = [(value, weight) for value, weight, _ in weighted]
    lower = _weighted_quantile(distribution, 0.2)
    upper = _weighted_quantile(distribution, 0.8)
    if lower == upper:
        lower = max(0, lower - 0.03)
        upper = min(1, upper + 0.03)
    dispersion = pstdev([value for value, _, _ in weighted]) if len(weighted) > 1 else 0.08
    agreement = min(1.0, max(0.0, 1 - dispersion * 3.2))
    coverage = CoverageState.GOOD if len(weighted) >= 3 and sum(w for _, w, _ in weighted) >= 0.8 else CoverageState.LIMITED

    supporting = [m for m in markets if m.relation_type == RelationType.SUPPORTING_PROXY]
    conflicting = [m for m in markets if m.relation_type == RelationType.CONFLICTING_PROXY]
    takeaways = [
        f"{len(weighted)} comparable market views imply {probability:.0%} with {agreement:.0%} agreement.",
    ]
    if supporting:
        takeaways.append(f"{len(supporting)} macro proxies lean supportive but do not enter the numeric estimate.")
    if conflicting:
        takeaways.append(f"{len(conflicting)} offsetting proxies keep the conclusion from being treated as consensus.")
    while len(takeaways) < 3:
        takeaways.append("Liquidity and relevance weights reduce the influence of thin or loosely related markets.")

    return MarketImpliedAnswer(
        conclusion="yes" if probability >= 0.55 else "no" if probability <= 0.45 else "mixed",
        label=("Yes" if probability >= 0.55 else "No" if probability <= 0.45 else "Mixed pricing"),
        probability=probability,
        market_range=(lower, upper),
        agreement=agreement,
        coverage=coverage,
        takeaways=takeaways[:3],
        evidence_ids=[market.id for _, _, market in weighted],
        excluded_market_ids=excluded,
        methodology="Dependency-discounted liquidity, quality and relevance weighted log-odds pool of comparable markets.",
        caveats=[
            "The displayed range is disagreement across markets, not a statistical confidence interval.",
            "External context and proxy markets never silently change the numeric estimate.",
        ],
        provider_freshness={"polymarket": "live or most recent cached snapshot", "context": "separate"},
    )


def aligned_logit_return_correlation(left: MarketSnapshot, right: MarketSnapshot, minimum: int = 12) -> tuple[float | None, int]:
    left_map = {point.timestamp.replace(minute=0, second=0, microsecond=0): point.probability for point in left.history}
    right_map = {point.timestamp.replace(minute=0, second=0, microsecond=0): point.probability for point in right.history}
    timestamps = sorted(set(left_map).intersection(right_map))
    if len(timestamps) < minimum + 1:
        return None, max(0, len(timestamps) - 1)
    left_returns = [_logit(left_map[timestamps[i]]) - _logit(left_map[timestamps[i - 1]]) for i in range(1, len(timestamps))]
    right_returns = [_logit(right_map[timestamps[i]]) - _logit(right_map[timestamps[i - 1]]) for i in range(1, len(timestamps))]
    left_mean, right_mean = fmean(left_returns), fmean(right_returns)
    numerator = sum((a - left_mean) * (b - right_mean) for a, b in zip(left_returns, right_returns, strict=True))
    denominator = math.sqrt(
        sum((a - left_mean) ** 2 for a in left_returns) * sum((b - right_mean) ** 2 for b in right_returns)
    )
    if denominator == 0:
        return None, len(left_returns)
    raw = numerator / denominator
    shrinkage = len(left_returns) / (len(left_returns) + 12)
    return raw * shrinkage, len(left_returns)

