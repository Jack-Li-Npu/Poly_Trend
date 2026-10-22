"""Chronological event-grouped validation, separate from descriptive run analytics.

No snapshot is an independent event. Labels must be available before a training
cutoff; features must be available at the recorded decision time. Synthetic data
exercise this pipeline and can never constitute investment evidence.
"""

from __future__ import annotations

import math
import random
from collections import Counter
from datetime import UTC, datetime
from statistics import fmean
from typing import Any

from .analytics import METHOD_VERSION, utc
from .models import EvaluationReport, EvidenceBundle, ResearchRun

REQUIRED_TIMES = (
    "decision_at",
    "features_available_at",
    "baseline_available_at",
    "pm_available_at",
    "label_available_at",
    "asset_target_available_at",
)


def _date(value: datetime | str) -> datetime:
    return utc(
        value
        if isinstance(value, datetime)
        else datetime.fromisoformat(value.replace("Z", "+00:00"))
    )


def _score(probabilities: list[float], outcomes: list[int]) -> dict[str, Any]:
    if not outcomes:
        return {"n": 0, "brier": None, "log_loss": None, "bins": []}
    brier = fmean((p - y) ** 2 for p, y in zip(probabilities, outcomes, strict=True))
    loss = -fmean(
        y * math.log(max(1e-12, min(1 - 1e-12, p)))
        + (1 - y) * math.log(max(1e-12, min(1 - 1e-12, 1 - p)))
        for p, y in zip(probabilities, outcomes, strict=True)
    )
    bins = []
    for index in range(5):
        selected = [
            (p, y)
            for p, y in zip(probabilities, outcomes, strict=True)
            if min(4, int(p * 5)) == index
        ]
        bins.append(
            {
                "lower": index / 5,
                "upper": (index + 1) / 5,
                "n": len(selected),
                "mean_probability": fmean(p for p, _ in selected) if selected else None,
                "event_frequency": fmean(y for _, y in selected) if selected else None,
            }
        )
    return {"n": len(outcomes), "brier": brier, "log_loss": loss, "bins": bins}


def _solve(matrix: list[list[float]], target: list[float]) -> list[float]:
    """Small regularized system, with partial pivoting; no external dependency."""
    rows = [list(row) + [value] for row, value in zip(matrix, target, strict=True)]
    count = len(target)
    for column in range(count):
        pivot = max(range(column, count), key=lambda index: abs(rows[index][column]))
        rows[column], rows[pivot] = rows[pivot], rows[column]
        divisor = rows[column][column]
        if abs(divisor) < 1e-14:
            raise ValueError("singular training design")
        rows[column] = [value / divisor for value in rows[column]]
        for index in range(count):
            if index == column:
                continue
            factor = rows[index][column]
            rows[index] = [a - factor * b for a, b in zip(rows[index], rows[column], strict=True)]
    return [row[-1] for row in rows]


def _predict(
    train_x: list[list[float]], train_y: list[float], test_x: list[list[float]]
) -> list[float]:
    width = len(train_x[0])
    means = [fmean(row[index] for row in train_x) for index in range(width)]
    scales = [
        math.sqrt(fmean((row[index] - means[index]) ** 2 for row in train_x)) or 1
        for index in range(width)
    ]

    def transform(row: list[float]) -> list[float]:
        return [1.0] + [(row[index] - means[index]) / scales[index] for index in range(width)]

    design = [transform(row) for row in train_x]
    matrix = [
        [sum(row[i] * row[j] for row in design) + (1e-6 if i == j else 0) for j in range(width + 1)]
        for i in range(width + 1)
    ]
    target = [
        sum(row[i] * value for row, value in zip(design, train_y, strict=True))
        for i in range(width + 1)
    ]
    coefficients = _solve(matrix, target)
    return [sum(a * b for a, b in zip(coefficients, transform(row), strict=True)) for row in test_x]


def _portfolio_score(
    predictions: list[float], actual: list[float], cost_bps: float
) -> dict[str, Any]:
    errors = [
        (prediction - target) ** 2 for prediction, target in zip(predictions, actual, strict=True)
    ]
    net = [
        (1 if prediction > 0 else -1 if prediction < 0 else 0) * target
        - (cost_bps / 10_000 if prediction else 0)
        for prediction, target in zip(predictions, actual, strict=True)
    ]
    return {
        "mse": fmean(errors),
        "direction_accuracy": fmean(
            float(prediction * target > 0)
            for prediction, target in zip(predictions, actual, strict=True)
        ),
        "mean_net_paper_return": fmean(net),
        "n": len(actual),
        "policy": (
            "one fixed long/short position from prediction sign "
            "per independently grouped event; no compounding"
        ),
    }


def _interval(values: list[float], seed: int) -> list[float] | None:
    if len(values) < 20:
        return None
    rng = random.Random(seed)
    draws = sorted(fmean(rng.choices(values, k=len(values))) for _ in range(500))
    return [draws[12], draws[487]]


def evaluate_records(
    records: list[dict[str, Any]],
    *,
    min_train_events: int = 30,
    min_test_events: int = 20,
    cost_bps: float = 20,
    seed: int = 42,
    as_of: datetime | None = None,
) -> EvaluationReport:
    """Compare conventional baseline vs the identical model plus PM features.

    Required row fields: event_id, market_id, six REQUIRED_TIMES, outcome (0/1),
    baseline_probability, pm_probability, pm_change, features (fixed-width list),
    asset_return (fixed, prespecified horizon), origin. Earliest eligible snapshot
    per event is selected, ensuring all reported observations are event-level.
    Repeated rows cannot increase the independent event count.
    """
    if min_train_events < 2 or min_test_events < 1 or not 0 <= cost_bps <= 10_000:
        raise ValueError("valid split sizes and costs in [0,10000] bps required")
    evaluation_cutoff = utc(as_of or datetime.now(UTC))
    eligible: list[dict[str, Any]] = []
    rejected: Counter[str] = Counter()
    for raw in records:
        try:
            row = dict(raw)
            if (
                not row.get("event_id")
                or not row.get("market_id")
                or row.get("origin") not in {"live", "recorded", "imported", "synthetic"}
            ):
                raise ValueError("missing_identity_or_origin")
            for key in REQUIRED_TIMES:
                row[key] = _date(row[key])
            if any(
                row[key] > row["decision_at"]
                for key in ("features_available_at", "baseline_available_at", "pm_available_at")
            ):
                raise ValueError("feature_lookahead")
            if (
                row["label_available_at"] <= row["decision_at"]
                or row["asset_target_available_at"] <= row["decision_at"]
            ):
                raise ValueError("decision_after_target")
            if max(row["label_available_at"], row["asset_target_available_at"]) > evaluation_cutoff:
                raise ValueError("labels_unavailable_at_evaluation")
            if row["outcome"] not in (0, 1):
                raise ValueError("invalid_binary_outcome")
            for key in ("baseline_probability", "pm_probability"):
                if not math.isfinite(row[key]) or not 0 <= row[key] <= 1:
                    raise ValueError("invalid_probability")
            if not row["features"] or not all(
                math.isfinite(value)
                for value in row["features"] + [row["asset_return"], row["pm_change"]]
            ):
                raise ValueError("invalid_features_or_return")
            eligible.append(row)
        except (KeyError, ValueError, TypeError) as exc:
            rejected[str(exc)] += 1
    grouped: dict[str, dict[str, Any]] = {}
    for row in sorted(
        eligible, key=lambda item: (item["decision_at"], item["event_id"], item["market_id"])
    ):
        grouped.setdefault(row["event_id"], row)
    rows = list(grouped.values())
    if rows:
        width = len(rows[0]["features"])
        clean = [row for row in rows if len(row["features"]) == width]
        rejected["feature_width_mismatch"] += len(rows) - len(clean)
        rows = clean
    synthetic = any(row["origin"] == "synthetic" for row in rows)
    limitations = [
        "Event-level chronological holdout; one earliest eligible decision per event, "
        "not one independent sample per snapshot.",
        "Feature scaling and fixed ridge coefficients are fitted on training events only.",
        "Forecast calibration and asset-return usefulness are separate targets.",
        "A single holdout is exploratory; regime robustness "
        "and prospective replication remain required.",
        "Paper sign-policy returns omit financing, borrow, partial fills and portfolio overlap; "
        "no annualized alpha is inferred.",
    ]
    if synthetic:
        limitations.append(
            "Synthetic fixture: tests pipeline mechanics only and provides no evidence "
            "of forecasting skill or investment value."
        )
    split = min(len(rows), max(1, int(len(rows) * 0.7)))
    train_candidates, test = rows[:split], rows[split:]
    test_start = test[0]["decision_at"] if test else None
    train = [
        row
        for row in train_candidates
        if test_start is not None
        and max(row["label_available_at"], row["asset_target_available_at"]) < test_start
    ]
    enough = len(train) >= min_train_events and len(test) >= min_test_events
    status = "synthetic_only" if synthetic else "experimental" if enough else "insufficient"
    counts = {
        "input_rows": len(records),
        "eligible_rows": len(eligible),
        "independent_events": len(rows),
        "duplicate_event_snapshots_removed": len(eligible) - len(grouped),
        "train_events": len(train),
        "test_events": len(test),
        "purged_unavailable_training_labels": len(train_candidates) - len(train),
        "minimum_train_events": min_train_events,
        "minimum_test_events": min_test_events,
        "train_event_ids": [row["event_id"] for row in train],
        "test_event_ids": [row["event_id"] for row in test],
        "test_start": test_start.isoformat() if test_start else None,
        "evaluation_as_of": evaluation_cutoff.isoformat(),
        "rejected": {key: value for key, value in rejected.items() if value},
    }
    calibration: dict[str, Any] = {
        "status": status,
        **counts,
        "baseline": _score(
            [row["baseline_probability"] for row in test], [row["outcome"] for row in test]
        ),
        "polymarket": _score(
            [row["pm_probability"] for row in test], [row["outcome"] for row in test]
        ),
    }
    investment: dict[str, Any] = {
        "status": status,
        "independent_events": len(rows),
        "train_events": len(train),
        "test_events": len(test),
        "cost_bps": cost_bps,
        "baseline": None,
        "baseline_plus_pm": None,
        "mse_improvement": None,
        "mse_improvement_bootstrap_95": None,
        "conclusion": "insufficient_independent_events",
    }
    if enough:

        def features(row: dict[str, Any]) -> list[float]:
            return [float(value) for value in row["features"]]

        def augmented(row: dict[str, Any]) -> list[float]:
            return features(row) + [row["pm_probability"], row["pm_change"]]

        target = [row["asset_return"] for row in train]
        actual = [row["asset_return"] for row in test]
        baseline = _predict(
            [features(row) for row in train], target, [features(row) for row in test]
        )
        combined = _predict(
            [augmented(row) for row in train], target, [augmented(row) for row in test]
        )
        gains = [
            (base - truth) ** 2 - (pm - truth) ** 2
            for base, pm, truth in zip(baseline, combined, actual, strict=True)
        ]
        interval = _interval(gains, seed)
        investment.update(
            {
                "baseline": _portfolio_score(baseline, actual, cost_bps),
                "baseline_plus_pm": _portfolio_score(combined, actual, cost_bps),
                "mse_improvement": fmean(gains),
                "mse_improvement_bootstrap_95": interval,
                "conclusion": "synthetic_mechanics_only"
                if synthetic
                else "exploratory_improvement"
                if interval and interval[0] > 0
                else "no_reliable_increment_demonstrated",
                "baseline_feature_count": len(train[0]["features"]),
                "pm_features": ["event_probability", "probability_change"],
            }
        )
    return EvaluationReport(
        method_version=METHOD_VERSION,
        calibration=calibration,
        asset_prediction=investment,
        simulation={"status": "not_a_strategy_backtest", "cost_bps": cost_bps},
        limitations=limitations,
    )


def get_evaluation_report(
    runs: list[ResearchRun], bundles: list[EvidenceBundle]
) -> EvaluationReport:
    """Inventory saved research without manufacturing outcomes or target labels.

    A service may feed independently sourced point-in-time labels to
    evaluate_records. Merely saving runs cannot certify forecasting skill.
    """
    events = {bundle.event.id for bundle in bundles}
    reconstructed = sum(
        any(observation.historical_reconstruction for observation in bundle.observations)
        for bundle in bundles
    )
    return EvaluationReport(
        calibration={
            "status": "insufficient",
            "independent_events": len(events),
            "resolved_label_count": 0,
            "saved_runs": len(runs),
            "reason": (
                "Resolved point-in-time outcome labels are required; "
                "saved snapshots are not outcomes."
            ),
        },
        asset_prediction={
            "status": "insufficient",
            "independent_events": len(events),
            "saved_bundles": len(bundles),
            "reconstructed_bundles": reconstructed,
            "reason": (
                "Run histories alone do not supply an event-grouped conventional baseline "
                "and held-out return targets."
            ),
        },
        simulation={
            "status": "assumption_only",
            "scenario_runs": sum(run.scenario is not None for run in runs),
        },
        limitations=[
            "No validated alpha claim. Use the separately labeled chronological benchmark.",
            "Independent event counts are deduplicated across repeated runs.",
            "Historical reconstruction is not a contemporaneously recorded data vintage.",
        ],
    )
