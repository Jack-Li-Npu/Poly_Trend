from __future__ import annotations

import random
from datetime import UTC, datetime, timedelta

import pytest
from polytrend.v3.evaluation import evaluate_records, get_evaluation_report
from polytrend.v3.models import EventDefinition, EvidenceBundle, ResearchRun


def records(count: int = 100) -> list[dict]:
    rng = random.Random(12)
    start = datetime(2020, 1, 1, tzinfo=UTC)
    result = []
    for index in range(count):
        decision = start + timedelta(days=3 * index)
        conventional, pm = rng.uniform(-1, 1), rng.uniform(0.05, 0.95)
        result.append(
            {
                "event_id": f"event-{index:03d}",
                "market_id": f"market-{index}",
                "origin": "synthetic",
                "decision_at": decision.isoformat(),
                "features_available_at": decision.isoformat(),
                "baseline_available_at": decision.isoformat(),
                "pm_available_at": decision.isoformat(),
                "label_available_at": (decision + timedelta(days=1)).isoformat(),
                "asset_target_available_at": (decision + timedelta(days=2)).isoformat(),
                "outcome": int(rng.random() < pm),
                "baseline_probability": 0.5,
                "pm_probability": pm,
                "pm_change": rng.uniform(-0.1, 0.1),
                "features": [conventional],
                "asset_return": 0.01 * conventional + 0.02 * (pm - 0.5) + rng.gauss(0, 0.002),
            }
        )
    return result


def test_chronological_grouped_baseline_comparison_never_certifies_synthetic_alpha() -> None:
    rows = records()
    report = evaluate_records(rows)
    calibration, asset = report.calibration, report.asset_prediction
    assert calibration["status"] == "synthetic_only"
    assert asset["status"] == "synthetic_only"
    assert asset["conclusion"] == "synthetic_mechanics_only"
    assert asset["baseline"]["mse"] > asset["baseline_plus_pm"]["mse"]
    assert asset["mse_improvement_bootstrap_95"] is not None
    assert set(calibration["train_event_ids"]).isdisjoint(calibration["test_event_ids"])
    assert max(calibration["train_event_ids"]) < min(calibration["test_event_ids"])
    assert calibration["polymarket"]["n"] == 30
    assert 0 <= calibration["polymarket"]["brier"] <= 1
    assert calibration["polymarket"]["log_loss"] > 0


def test_duplicate_snapshots_cannot_inflate_independent_count() -> None:
    rows = records(10)
    duplicated = [
        dict(
            row,
            decision_at=(
                datetime.fromisoformat(row["decision_at"]) + timedelta(minutes=1)
            ).isoformat(),
        )
        for row in rows
        for _ in range(50)
    ]
    report = evaluate_records(rows + duplicated)
    assert report.calibration["independent_events"] == 10
    assert report.calibration["duplicate_event_snapshots_removed"] == 500
    assert report.asset_prediction["baseline"] is None
    assert report.asset_prediction["conclusion"] == "insufficient_independent_events"


def test_rejects_feature_lookahead_and_purges_training_labels_unavailable_at_split() -> None:
    rows = records()
    rows[0]["pm_available_at"] = "2030-01-01T00:00:00+00:00"
    rows[1]["label_available_at"] = "2022-01-01T00:00:00+00:00"
    report = evaluate_records(rows)
    assert report.calibration["rejected"]["feature_lookahead"] == 1
    assert report.calibration["purged_unavailable_training_labels"] == 1
    assert "event-001" not in report.calibration["train_event_ids"]


def test_naive_time_future_targets_invalid_probability_are_excluded() -> None:
    rows = records(5)
    rows[0]["decision_at"] = "2020-01-01T00:00:00"
    rows[1]["asset_target_available_at"] = "2035-01-01T00:00:00+00:00"
    rows[2]["pm_probability"] = 1.2
    report = evaluate_records(rows, as_of=datetime(2025, 1, 1, tzinfo=UTC))
    assert report.calibration["independent_events"] == 2
    assert report.calibration["rejected"]["labels_unavailable_at_evaluation"] == 1
    assert report.calibration["rejected"]["invalid_probability"] == 1
    assert report.asset_prediction["baseline"] is None


def test_conventional_and_augmented_paper_returns_deduct_same_cost() -> None:
    rows = records()
    zero = evaluate_records(rows, cost_bps=0).asset_prediction
    costly = evaluate_records(rows, cost_bps=100).asset_prediction
    for model in ("baseline", "baseline_plus_pm"):
        assert zero[model]["mean_net_paper_return"] - costly[model][
            "mean_net_paper_return"
        ] == pytest.approx(0.01)
        assert zero[model]["mse"] == costly[model]["mse"]


def test_saved_runs_without_resolutions_are_insufficient_not_fabricated_labels() -> None:
    event = EventDefinition(
        id="a", slug="a", title="A", source_url="https://example.org", origin="synthetic"
    )
    report = get_evaluation_report(
        [ResearchRun(case_id="case", mode="scenario")],
        [EvidenceBundle(event=event), EvidenceBundle(event=event)],
    )
    assert report.calibration["independent_events"] == 1
    assert report.calibration["resolved_label_count"] == 0
    assert report.calibration["status"] == "insufficient"
    assert report.asset_prediction["status"] == "insufficient"
