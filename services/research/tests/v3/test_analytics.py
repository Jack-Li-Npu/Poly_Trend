from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

import pytest
from polytrend.v3.analytics import (
    _fisher_interval,
    analyze_bundle,
    available_points,
    paper_evaluate,
    simulate,
)
from polytrend.v3.models import (
    AssetSeries,
    Contract,
    EventDefinition,
    EvidenceBundle,
    JointPayoffs,
    LogicRelation,
    MarketSnapshot,
    Observation,
    ScenarioAssumptions,
    SeriesPoint,
)

NOW = datetime(2025, 1, 10, 21, tzinfo=UTC)


def point(timestamp: datetime, value: float, available_at: datetime | None = None) -> SeriesPoint:
    return SeriesPoint(timestamp=timestamp, value=value, available_at=available_at or timestamp)


def bundle() -> EvidenceBundle:
    return EvidenceBundle(
        event=EventDefinition(
            id="event",
            title="Synthetic policy event",
            slug="synthetic",
            source_url="https://example.org/synthetic",
            observed_at=NOW - timedelta(days=100),
            origin="synthetic",
            contracts=[
                Contract(id=key, event_id="event", condition_id=key, question=key)
                for key in ("a", "b")
            ],
            relations=[
                LogicRelation(
                    kind="complement",
                    market_ids=["a", "b"],
                    verified=True,
                    rationale="Explicit synthetic complements",
                )
            ],
        ),
        markets=[
            MarketSnapshot(
                market_id="a",
                condition_id="a",
                token_id="a-yes",
                probability=0.7,
                bid=0.68,
                ask=0.72,
                quote_type="midpoint",
                as_of=NOW,
                bid_depth_usd=500,
                ask_depth_usd=700,
                history=[point(NOW - timedelta(days=days), 0.6) for days in (1, 7, 30)],
            ),
            MarketSnapshot(
                market_id="b",
                condition_id="b",
                token_id="b-yes",
                probability=0.3,
                bid=0.28,
                ask=0.32,
                quote_type="midpoint",
                as_of=NOW,
                bid_depth_usd=500,
                ask_depth_usd=700,
            ),
        ],
        captured_at=NOW,
    )


def test_scenario_distinguishes_high_probability_from_positive_expected_return() -> None:
    result = simulate(
        ScenarioAssumptions(
            probability=0.7,
            event_return=0.05,
            non_event_return=-0.2,
            round_trip_cost_bps=20,
            capital=10000,
            second_event_probability=0.6,
        )
    )
    assert result.expected_return == pytest.approx(-0.027)
    assert result.expected_pnl == pytest.approx(-270)
    assert result.break_even_probability == pytest.approx(0.808)
    assert result.joint_bounds == pytest.approx((0.3, 0.6))
    assert len({row["cost_bps"] for row in result.sensitivity}) == 4
    with pytest.raises(ValueError, match="Frechet"):
        simulate(
            ScenarioAssumptions(
                probability=0.7, second_event_probability=0.6, joint_probability=0.1
            )
        )
    constant = simulate(ScenarioAssumptions(event_return=0.02, non_event_return=0.02))
    assert constant.break_even_probability is None
    assert constant.feasible_break_even is False


def test_four_state_stress_uses_frechet_endpoints_and_no_assumed_independence() -> None:
    assumptions = ScenarioAssumptions(
        probability=0.7,
        second_event_probability=0.6,
        round_trip_cost_bps=20,
        joint_payoffs=JointPayoffs(both=-0.3, first_only=0.1, second_only=-0.1, neither=0.05),
    )
    result = simulate(assumptions)
    joint = result.joint_scenario
    assert result.expected_return == pytest.approx(-0.027)
    assert joint["status"] == "bounds_only"
    assert joint["point"] is None
    assert joint["joint_probability_bounds"] == pytest.approx([0.3, 0.6])
    assert joint["expected_return_bounds"] == pytest.approx([-0.157, -0.082])
    assert joint["expected_pnl_bounds"] == pytest.approx([-1570, -820])
    for endpoint in joint["endpoints"]:
        weights = endpoint["weights"]
        assert sum(weights.values()) == pytest.approx(1)
        assert all(value >= 0 for value in weights.values())
        assert weights["both"] + weights["first_only"] == pytest.approx(0.7)
        assert weights["both"] + weights["second_only"] == pytest.approx(0.6)
    assumptions.joint_probability = 0.42
    specified = simulate(assumptions).joint_scenario
    assert specified["status"] == "assumed_joint_point"
    assert specified["point"]["expected_return"] == pytest.approx(-0.112)
    assert specified["point"]["weights"] == pytest.approx(
        {"both": 0.42, "first_only": 0.28, "second_only": 0.18, "neither": 0.12}
    )
    assumptions.second_event_probability = None
    assumptions.joint_probability = None
    with pytest.raises(ValueError, match="joint payoffs"):
        simulate(assumptions)


def test_four_state_cost_sensitivity_and_degenerate_dependence_bounds() -> None:
    assumptions = ScenarioAssumptions(
        probability=1,
        second_event_probability=0.6,
        round_trip_cost_bps=0,
        joint_payoffs=JointPayoffs(both=0.1, first_only=-0.1, second_only=1, neither=-1),
    )
    zero = simulate(assumptions).joint_scenario
    assert zero["joint_probability_bounds"] == [0.6, 0.6]
    assert len(zero["endpoints"]) == 1
    assert zero["expected_return_bounds"] == pytest.approx([0.02, 0.02])
    assumptions.round_trip_cost_bps = 100
    costly = simulate(assumptions).joint_scenario
    assert costly["expected_return_bounds"] == pytest.approx([0.01, 0.01])


def test_analyze_is_immutable_and_applies_only_verified_logic() -> None:
    evidence = bundle()
    before = evidence.model_dump_json()
    result = analyze_bundle(evidence)
    assert evidence.model_dump_json() == before
    assert result["expectation_changes"][0]["delta_1d_pp"] == pytest.approx(10)
    assert result["expectation_changes"][0]["window_1d_elapsed_hours"] == 24
    assert result["logical_consistency"][0]["status"] == "interval_consistent"
    assert result["logical_consistency"][0]["coherent_ranges"]["a"] == pytest.approx([0.68, 0.72])
    assert result["family_distributions"][0]["bins"][0]["probability"] == 0.7
    evidence.event.relations[0].verified = False
    unchecked = analyze_bundle(evidence)
    assert unchecked["logical_consistency"][0]["status"] == "unverified"
    assert unchecked["logical_consistency"][0]["coherent_ranges"] == {}
    assert unchecked["family_distributions"] == []


def test_inconsistent_quotes_are_not_renormalized_into_fake_distribution() -> None:
    evidence = bundle()
    evidence.markets[1].probability = 0.6
    evidence.markets[1].bid = 0.58
    evidence.markets[1].ask = 0.62
    result = analyze_bundle(evidence)
    assert result["expectation_changes"][1]["probability"] == 0.6
    assert result["logical_consistency"][0]["status"] == "quote_infeasible"
    assert result["logical_consistency"][0]["coherent_ranges"] == {}
    assert all(item["probability"] is None for item in result["family_distributions"][0]["bins"])


def test_verified_nested_relation_has_explicit_subset_direction() -> None:
    evidence = bundle()
    evidence.event.relations = [
        LogicRelation(
            kind="nested_threshold",
            market_ids=["b", "a"],
            verified=True,
            rationale="b is higher threshold, hence subset",
        )
    ]
    result = analyze_bundle(evidence)
    family = result["family_distributions"][0]
    assert family["complete_distribution"] is False
    assert family["bins"][0]["probability"] == pytest.approx(0.4)
    assert family["bins"][0]["range"] == pytest.approx([0.36, 0.44])


def test_exclusive_family_is_partial_without_verified_exhaustiveness() -> None:
    evidence = bundle()
    evidence.event.relations = [
        LogicRelation(
            kind="exclusive",
            market_ids=["a", "b"],
            verified=True,
            rationale="Explicit synthetic exclusive outcomes; other outcomes may exist",
        )
    ]
    evidence.markets[1].probability = 0.1
    evidence.markets[1].bid = 0.08
    evidence.markets[1].ask = 0.12
    family = analyze_bundle(evidence)["family_distributions"][0]
    assert family["kind"] == "verified_exclusive_partial"
    assert family["complete_distribution"] is False
    assert family["unallocated_mass_range"] == pytest.approx([0.16, 0.24])
    assert family["bins"][0]["probability"] == 0.7


def test_verified_partition_is_not_duplicated_as_a_partial_family() -> None:
    evidence = bundle()
    evidence.event.relations = [
        LogicRelation(
            kind=kind,
            market_ids=["a", "b"],
            verified=True,
            rationale="Explicit synthetic complete partition",
        )
        for kind in ("exclusive", "exhaustive")
    ]
    families = analyze_bundle(evidence)["family_distributions"]
    assert len(families) == 1
    assert families[0]["kind"] == "verified_partition"


def test_as_of_excludes_future_evidence_metadata_and_delayed_revisions() -> None:
    evidence = bundle()
    evidence.observations = [
        Observation(
            id="delayed",
            provider="test",
            kind="quote",
            external_id="a",
            source_url="https://example.org/synthetic",
            observed_at=NOW,
            available_at=NOW + timedelta(hours=1),
            payload={},
        )
    ]
    evidence.markets[0].observation_ids = ["delayed"]
    result = analyze_bundle(evidence)
    assert result["expectation_changes"][0]["probability"] is None
    assert result["book_quality"][0]["status"] == "unavailable"
    assert result["provenance"]["excluded_observation_count"] == 1
    evidence.event.observed_at = NOW + timedelta(days=1)
    assert analyze_bundle(evidence)["logical_consistency"] == []
    day = NOW - timedelta(days=1)
    revisions = [point(day, 0.5), point(day, 0.99, NOW + timedelta(days=1))]
    assert available_points(revisions, NOW)[0].value == 0.5
    with pytest.raises(ValueError, match="timezone"):
        analyze_bundle(bundle(), datetime(2025, 1, 10))


def test_changes_use_report_cutoff_vintage_without_leaking_after_cutoff() -> None:
    evidence = bundle()
    yesterday = NOW - timedelta(days=1)
    evidence.markets[0].history = [
        point(yesterday, 0.5),
        point(yesterday, 0.1, NOW),
        point(yesterday, 0.99, NOW + timedelta(days=1)),
    ]
    assert analyze_bundle(evidence)["expectation_changes"][0]["delta_1d_pp"] == pytest.approx(60)
    evidence.markets[0].history = [point(yesterday, 0.5, NOW)]
    assert analyze_bundle(evidence)["expectation_changes"][0]["delta_1d_pp"] == pytest.approx(20)
    assert available_points(evidence.markets[0].history, yesterday) == []


def test_paper_entry_waits_next_observed_session_and_costs_are_explicit() -> None:
    friday = datetime(2025, 1, 10, 16, tzinfo=timezone(timedelta(hours=-5)))
    monday = friday + timedelta(days=3)
    tuesday = monday + timedelta(days=1)
    series = AssetSeries(
        symbol="SPY",
        provider="fixture",
        source_url="https://example.org/synthetic",
        adjustment="total_return",
        points=[point(friday, 100), point(monday, 110), point(tuesday, 121)],
    )
    result = paper_evaluate(series, friday, 1, 25, 10000)
    assert result["status"] == "paper_proxy"
    assert result["entry_at"] == monday.astimezone(UTC).isoformat()
    assert result["exit_at"] == tuesday.astimezone(UTC).isoformat()
    assert result["gross_return"] == pytest.approx(0.1)
    assert result["net_return"] == pytest.approx(0.0975)
    assert result["pnl"] == pytest.approx(975)
    assert paper_evaluate(series, tuesday, 1, 0, 100)["status"] == "unavailable"
    series.adjustment = "yield"
    assert paper_evaluate(series, friday, 1, 0, 100)["reason"] == "yield_is_not_investable_return"


def test_paper_evaluation_rejects_backfilled_vintages_and_unknown_adjustments() -> None:
    series = AssetSeries(
        symbol="SPY",
        provider="fixture",
        source_url="https://example.org/synthetic",
        adjustment="split_adjusted",
        points=[
            point(NOW, 100, NOW + timedelta(days=10)),
            point(NOW + timedelta(days=1), 110),
            point(NOW + timedelta(days=2), 120),
        ],
    )
    assert paper_evaluate(series, NOW, 1, 0, 100)["reason"] == "no_price_available_at_decision"
    series.points[0].available_at = NOW
    series.points.append(point(NOW, 1, NOW + timedelta(days=20)))
    assert paper_evaluate(series, NOW, 1, 0, 100)["gross_return"] == pytest.approx(120 / 110 - 1)
    series.adjustment = "unknown"
    assert paper_evaluate(series, NOW, 1, 0, 100)["reason"] == "unknown_adjustment_basis"
    series.adjustment = "raw"
    series.points[0].available_at = None
    assert paper_evaluate(series, NOW, 1, 0, 100)["reason"] == "explicit_availability_required"


def test_asset_response_reports_both_directions_and_nonoverlapping_windows() -> None:
    evidence = bundle()
    start = NOW - timedelta(days=80)
    evidence.markets[0].history = [
        point(start + timedelta(days=i), 0.4 + 0.1 * ((i % 7) / 7)) for i in range(81)
    ]
    evidence.assets = [
        AssetSeries(
            symbol="BTC-USD",
            provider="fixture",
            source_url="https://example.org/synthetic",
            points=[point(start + timedelta(days=i), 100 + i + (i % 3)) for i in range(81)],
        )
    ]
    rows = analyze_bundle(evidence)["asset_response"]
    assert {row["holding_sessions"] for row in rows} == {1, 5, 20}
    row = next(item for item in rows if item["market_id"] == "a" and item["holding_sessions"] == 20)
    assert row["independent_windows"] <= 2
    assert row["status"] == "insufficient"
    assert row["label"] == "inconclusive"
    assert row["independent_events"] == 1
    assert {"pm_leads_asset", "asset_leads_pm", "reversal", "contemporaneous"} <= row.keys()


def test_retrospective_timing_study_is_available_but_never_a_trading_backtest() -> None:
    evidence = bundle()
    start = NOW - timedelta(days=80)
    evidence.markets[0].history = [
        point(start + timedelta(days=i), 0.3 + 0.005 * (i % 21), NOW) for i in range(81)
    ]
    evidence.assets = [
        AssetSeries(
            symbol="BTC-USD",
            provider="fixture",
            source_url="https://example.org/synthetic",
            points=[point(start + timedelta(days=i), 100 + i + (i % 3), NOW) for i in range(81)],
        )
    ]
    row = next(
        item
        for item in analyze_bundle(evidence)["asset_response"]
        if item["market_id"] == "a" and item["holding_sessions"] == 1
    )
    assert row["pairs"] > 12
    assert row["mode"] == "retrospective_descriptive"
    assert row["historical_reconstruction"] is True
    assert row["pm_leads_asset"]["correlation"] is not None
    assert row["label"] == row["trading_edge"] == "inconclusive"
    assert row["predictive_validation"] == "not_established"
    assert available_points(evidence.assets[0].points, NOW - timedelta(seconds=1)) == []


def test_fisher_intervals_are_exploratory_and_widen_with_small_samples() -> None:
    assert _fisher_interval(None, 100) is None
    assert _fisher_interval(0.5, 3) is None
    zero = _fisher_interval(0, 20)
    assert zero[0] < 0 < zero[1]
    small, large = _fisher_interval(0.5, 12), _fisher_interval(0.5, 120)
    assert small[1] - small[0] > large[1] - large[0]
    assert small[0] < 0 < small[1]
    assert 0 < large[0] < 0.5 < large[1] < 1
    assert all(-1 <= value <= 1 for value in _fisher_interval(1, 20))


def test_contemporaneous_association_uses_same_window_not_future_return() -> None:
    evidence = bundle()
    start = NOW - timedelta(days=80)
    probabilities = [0.4 + 0.1 * ((i % 7) / 7) for i in range(81)]
    prices = [100.0]
    for index in range(1, 81):
        prices.append(prices[-1] * (1 + (probabilities[index] - probabilities[index - 1]) / 10))
    evidence.markets[0].history = [
        point(start + timedelta(days=i), value) for i, value in enumerate(probabilities)
    ]
    evidence.assets = [
        AssetSeries(
            symbol="SYNTHETIC",
            provider="fixture",
            source_url="https://example.org/synthetic",
            points=[point(start + timedelta(days=i), value) for i, value in enumerate(prices)],
        )
    ]
    row = next(
        item
        for item in analyze_bundle(evidence)["asset_response"]
        if item["market_id"] == "a" and item["holding_sessions"] == 1
    )
    association = row["contemporaneous"]
    assert association["correlation"] == pytest.approx(1)
    assert association["ci95"][0] > 0.99
    assert association["n"] == row["independent_windows"]
    assert association["interval_method"] == "fisher_z_iid_approximation"
    assert "not autocorrelation" in association["inference_limit"]
