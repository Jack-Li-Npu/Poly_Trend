from __future__ import annotations

from datetime import datetime, timedelta, timezone

from polytrend.forecast import calculate_barrier_forecast
from polytrend.models import AssetPricePoint, AssetSnapshot, TargetCondition
from polytrend.retrieval import parse_intent


def test_gold_month_barrier_intent_is_explicit() -> None:
    now = datetime(2026, 8, 15, 4, tzinfo=timezone.utc)
    intent = parse_intent("Will gold reach $5,000 this month?", now=now)
    assert intent.asset == "Gold"
    assert intent.symbol == "XAUUSD"
    assert intent.target_value == 5000
    assert intent.target_condition == TargetCondition.TOUCH
    assert intent.deadline is not None and intent.deadline.day == 31
    assert not intent.ambiguous


def test_barrier_forecast_is_deterministic_and_bounded() -> None:
    as_of = datetime(2026, 8, 15, tzinfo=timezone.utc)
    history = [
        AssetPricePoint(timestamp=as_of - timedelta(days=120 - index), value=3000 * (1.0015**index))
        for index in range(121)
    ]
    snapshot = AssetSnapshot(
        symbol="XAUUSD", name="Gold", price=history[-1].value, as_of=as_of,
        source="fixture", history=history,
    )
    intent = parse_intent("Will gold reach $5,000 this month?", now=as_of)
    first = calculate_barrier_forecast(intent, snapshot, paths=3_000, seed="fixture")
    second = calculate_barrier_forecast(intent, snapshot, paths=3_000, seed="fixture")
    assert first.probability == second.probability
    assert 0 <= first.probability_range[0] <= first.probability <= first.probability_range[1] <= 1
    assert first.target_gap > 0
