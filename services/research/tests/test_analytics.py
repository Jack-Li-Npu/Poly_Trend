from __future__ import annotations

from datetime import datetime, timedelta, timezone

from polytrend.analytics import aggregate_markets, aligned_logit_return_correlation, normalize_probability
from polytrend.models import CoverageState, PricePoint, RelationType
from polytrend.seed import seed_markets


def test_probability_normalization() -> None:
    assert normalize_probability(42) == 0.42
    assert normalize_probability("0.61") == 0.61
    assert normalize_probability(130) == 1


def test_proxies_never_enter_numeric_answer() -> None:
    markets = seed_markets()
    answer = aggregate_markets(markets)
    proxy_ids = {market.id for market in markets if market.relation_type in {RelationType.SUPPORTING_PROXY, RelationType.CONFLICTING_PROXY}}
    assert answer.probability is not None
    assert not proxy_ids.intersection(answer.evidence_ids)


def test_inadequate_coverage_returns_no_probability() -> None:
    markets = seed_markets()
    for market in markets:
        market.included = False
    answer = aggregate_markets(markets)
    assert answer.coverage == CoverageState.INSUFFICIENT
    assert answer.probability is None


def test_complement_market_is_oriented_before_pooling() -> None:
    markets = seed_markets()
    complement = next(market for market in markets if market.relation_type == RelationType.COMPLEMENT)
    for market in markets:
        market.included = market.id == complement.id
    answer = aggregate_markets(markets)
    assert answer.probability is not None
    assert abs(answer.probability - (1 - complement.probability)) < 1e-9


def test_correlation_aligns_timestamps_and_shrinks() -> None:
    left, right = seed_markets()[:2]
    start = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    left.history = [PricePoint(timestamp=start + timedelta(hours=i), probability=0.25 + i * 0.01) for i in range(15)]
    right.history = [PricePoint(timestamp=start + timedelta(hours=i), probability=0.35 + i * 0.008) for i in range(2, 15)]
    correlation, observations = aligned_logit_return_correlation(left, right, minimum=10)
    assert observations == 12
    assert correlation is not None and 0 < correlation < 1
