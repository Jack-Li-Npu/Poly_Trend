from __future__ import annotations

import hashlib
import math
import random
from statistics import fmean, median, pstdev

from .models import AssetSnapshot, ForecastEstimate, QueryIntent, TargetCondition


TRADING_DAYS = 252


def _returns(snapshot: AssetSnapshot) -> list[float]:
    ordered = sorted(snapshot.history, key=lambda point: point.timestamp)
    return [
        math.log(right.value / left.value)
        for left, right in zip(ordered, ordered[1:], strict=False)
        if left.value > 0 and right.value > 0
    ]


def _verdict(probability: float) -> str:
    if probability < 0.15:
        return "Very unlikely"
    if probability < 0.35:
        return "Unlikely"
    if probability < 0.65:
        return "Possible"
    if probability < 0.85:
        return "Likely"
    return "Very likely"


def _hits(condition: TargetCondition, path: list[float], target: float) -> bool:
    if condition == TargetCondition.CLOSE_ABOVE:
        return path[-1] >= target
    if condition == TargetCondition.CLOSE_BELOW:
        return path[-1] <= target
    if target >= path[0]:
        return max(path) >= target
    return min(path) <= target


def _gbm_probability(
    current: float,
    target: float,
    days: int,
    sigma: float,
    drift: float,
    condition: TargetCondition,
    paths: int,
    rng: random.Random,
) -> float:
    hits = 0
    barrier = math.log(target)
    variance = max(1e-12, sigma * sigma / TRADING_DAYS)
    daily_sigma = math.sqrt(variance)
    daily_drift = drift / TRADING_DAYS - variance / 2
    for _ in range(paths):
        log_value = math.log(current)
        values = [current]
        crossed = False
        for _day in range(days):
            previous = log_value
            log_value += daily_drift + daily_sigma * rng.gauss(0, 1)
            values.append(math.exp(log_value))
            if condition == TargetCondition.TOUCH:
                direct = log_value >= barrier if target >= current else log_value <= barrier
                if direct:
                    crossed = True
                elif target >= current and previous < barrier and log_value < barrier:
                    bridge = math.exp(-2 * (barrier - previous) * (barrier - log_value) / variance)
                    crossed = rng.random() < bridge
                elif target < current and previous > barrier and log_value > barrier:
                    bridge = math.exp(-2 * (previous - barrier) * (log_value - barrier) / variance)
                    crossed = rng.random() < bridge
                if crossed:
                    break
        hits += int(crossed if condition == TargetCondition.TOUCH else _hits(condition, values, target))
    return hits / paths


def _bootstrap_probability(
    current: float,
    target: float,
    days: int,
    returns: list[float],
    condition: TargetCondition,
    paths: int,
    rng: random.Random,
) -> float:
    blocks = [returns[index:index + 5] for index in range(max(1, len(returns) - 4))]
    hits = 0
    for _ in range(paths):
        sampled: list[float] = []
        while len(sampled) < days:
            sampled.extend(rng.choice(blocks))
        value = current
        path = [current]
        for daily_return in sampled[:days]:
            value *= math.exp(daily_return)
            path.append(value)
        hits += int(_hits(condition, path, target))
    return hits / paths


def calculate_barrier_forecast(
    intent: QueryIntent,
    snapshot: AssetSnapshot,
    paths: int = 20_000,
    seed: str = "polytrend",
) -> ForecastEstimate:
    if not intent.target_value or not intent.deadline or not intent.target_condition:
        raise ValueError("asset forecast requires target, condition and deadline")
    returns = _returns(snapshot)
    if len(returns) < 60:
        raise ValueError("at least 60 daily price observations are required")
    seconds = max(0, (intent.deadline - snapshot.as_of).total_seconds())
    calendar_days = seconds / 86_400
    simulation_days = max(1, math.ceil(calendar_days * 5 / 7))
    sigma20 = pstdev(returns[-20:]) * math.sqrt(TRADING_DAYS)
    sigma60 = pstdev(returns[-60:]) * math.sqrt(TRADING_DAYS)
    trend = max(-0.20, min(0.20, fmean(returns[-60:]) * TRADING_DAYS))
    digest = hashlib.sha256(f"{seed}:{snapshot.symbol}:{intent.target_value}:{intent.deadline}".encode()).digest()
    root_seed = int.from_bytes(digest[:8], "big")
    per_model = max(1_000, paths // 3)
    probabilities = {
        "driftless_gbm": _gbm_probability(
            snapshot.price, intent.target_value, simulation_days, sigma20, 0,
            intent.target_condition, per_model, random.Random(root_seed),
        ),
        "trend_capped_gbm": _gbm_probability(
            snapshot.price, intent.target_value, simulation_days, sigma60, trend,
            intent.target_condition, per_model, random.Random(root_seed + 1),
        ),
        "block_bootstrap": _bootstrap_probability(
            snapshot.price, intent.target_value, simulation_days, returns,
            intent.target_condition, per_model, random.Random(root_seed + 2),
        ),
    }
    values = sorted(probabilities.values())
    probability = median(values)
    dispersion = values[-1] - values[0]
    confidence = max(0.2, min(0.92, 0.82 - dispersion * 1.4))
    return ForecastEstimate(
        symbol=snapshot.symbol,
        condition=intent.target_condition,
        current_value=snapshot.price,
        target_value=intent.target_value,
        target_gap=intent.target_value / snapshot.price - 1,
        deadline=intent.deadline,
        days_remaining=calendar_days,
        probability=probability,
        probability_range=(values[0], values[-1]),
        verdict=_verdict(probability),
        confidence=confidence,
        realized_volatility_20d=sigma20,
        model_probabilities=probabilities,
        paths=per_model * 3,
        methodology=(
            "Median of driftless GBM, trend-capped GBM and five-day block bootstrap; "
            "touch barriers use a Brownian-bridge correction between daily steps."
        ),
        as_of=snapshot.as_of,
    )
