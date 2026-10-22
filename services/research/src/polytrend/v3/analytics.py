"""Deterministic, point-in-time descriptive analytics; no inferred causal edges.

Verified ordered relations use subset/narrower first, superset/broader second.
Quote intervals are propagated through necessary marginal constraints, not projected
into invented point probabilities. Series timestamps must have UTC offsets.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta
from statistics import fmean
from typing import Any

from .models import AssetSeries, EvidenceBundle, ScenarioAssumptions, SeriesPoint, SimulationResult

METHOD_VERSION = "v3.0.0"
MIN_WINDOWS = 12


def utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("timestamps must include a timezone offset")
    return value.astimezone(UTC)


def _finite(value: float | None) -> bool:
    return value is not None and math.isfinite(value)


def available_points(points: list[SeriesPoint], as_of: datetime) -> list[SeriesPoint]:
    """Use the last revision actually available by the cutoff, never input order."""
    cutoff = utc(as_of)
    selected: dict[datetime, SeriesPoint] = {}
    for point in points:
        timestamp = utc(point.timestamp)
        available = utc(point.available_at or point.timestamp)
        if timestamp > cutoff or available > cutoff or not math.isfinite(point.value):
            continue
        prior = selected.get(timestamp)
        if prior is None or available > utc(prior.available_at or prior.timestamp):
            selected[timestamp] = point
    return [selected[key] for key in sorted(selected)]


def _at(points: list[SeriesPoint], target: datetime) -> SeriesPoint | None:
    eligible = [point for point in points if utc(point.timestamp) <= target]
    return eligible[-1] if eligible else None


def _correlation(left: list[float], right: list[float]) -> float | None:
    if len(left) < 3:
        return None
    a, b = fmean(left), fmean(right)
    numerator = sum((x - a) * (y - b) for x, y in zip(left, right, strict=True))
    denominator = math.sqrt(sum((x - a) ** 2 for x in left) * sum((y - b) ** 2 for y in right))
    return max(-1.0, min(1.0, numerator / denominator)) if denominator > 1e-16 else None


def _fisher_interval(correlation: float | None, count: int) -> list[float] | None:
    """Exploratory IID approximation; no autocorrelation/selection correction."""
    if correlation is None or count <= 3:
        return None
    clipped = min(1 - 1e-12, max(-1 + 1e-12, correlation))
    center = math.atanh(clipped)
    radius = 1.959963984540054 / math.sqrt(count - 3)
    return [math.tanh(center - radius), math.tanh(center + radius)]


def _association(correlation: float | None, count: int, status: str) -> dict[str, Any]:
    return {
        "correlation": correlation,
        "n": count,
        "status": status,
        "ci95": _fisher_interval(correlation, count),
        "interval_method": "fisher_z_iid_approximation",
        "inference_limit": (
            "Exploratory IID approximation; not autocorrelation-, event-cluster-, "
            "or multiple-testing-robust."
        ),
    }


def _return(series: AssetSeries, start: float, end: float) -> float | None:
    if series.adjustment == "yield":
        return (end - start) * 100  # percent yield -> basis points, never an asset return
    return end / start - 1 if start > 0 and end > 0 else None


def _asset_responses(bundle: EvidenceBundle, as_of: datetime) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    observation_ids = {item.id for item in bundle.observations if utc(item.available_at) <= as_of}
    for asset in bundle.assets:
        asset_linked = not asset.observation_ids or set(asset.observation_ids) <= observation_ids
        points = available_points(asset.points, as_of) if asset_linked else []
        for market in bundle.markets:
            if utc(market.as_of) > as_of:
                continue
            market_history = available_points(market.history, as_of)
            retrospective = any(
                point.available_at is None or utc(point.available_at) > utc(point.timestamp)
                for point in points + market_history
            )
            mode = "retrospective_descriptive" if retrospective else "point_in_time_descriptive"
            for holding in (1, 5, 20):
                left: list[float] = []
                right: list[float] = []
                reverse_left: list[float] = []
                reverse_right: list[float] = []
                reversal_left: list[float] = []
                reversal_right: list[float] = []
                contemporaneous_left: list[float] = []
                contemporaneous_right: list[float] = []
                # Non-overlapping two-sided windows avoid counting a long-horizon
                # observation once for every overlapping daily snapshot.
                for index in range(holding, len(points) - holding, 2 * holding):
                    anchors = [points[index - holding], points[index], points[index + holding]]
                    vintage_anchors = []
                    for anchor in anchors:
                        timestamp = utc(anchor.timestamp)
                        vintage = (
                            points if retrospective else available_points(asset.points, timestamp)
                        )
                        selected = _at(vintage, timestamp)
                        if selected is None or utc(selected.timestamp) != timestamp:
                            break
                        vintage_anchors.append(selected)
                    if len(vintage_anchors) != 3:
                        continue
                    past, current, future = vintage_anchors
                    p_values: list[float] = []
                    for anchor in (past, current, future):
                        timestamp = utc(anchor.timestamp)
                        vintage = (
                            market_history
                            if retrospective
                            else available_points(market.history, timestamp)
                        )
                        selected = _at(vintage, timestamp)
                        # A week-old stale PM quote is not a daily innovation.
                        max_age = timedelta(days=4 if asset.interval == "daily" else 1)
                        if selected is None or timestamp - utc(selected.timestamp) > max_age:
                            break
                        p_values.append(selected.value)
                    if len(p_values) != 3 or not all(0 <= value <= 1 for value in p_values):
                        continue
                    past_return = _return(asset, past.value, current.value)
                    future_return = _return(asset, current.value, future.value)
                    if past_return is None or future_return is None:
                        continue
                    left.append(p_values[1] - p_values[0])
                    right.append(future_return)
                    reverse_left.append(past_return)
                    reverse_right.append(p_values[2] - p_values[1])
                    reversal_left.append(past_return)
                    reversal_right.append(future_return)
                    contemporaneous_left.append(p_values[1] - p_values[0])
                    contemporaneous_right.append(past_return)
                forward = _correlation(left, right)
                reverse = _correlation(reverse_left, reverse_right)
                reversal = _correlation(reversal_left, reversal_right)
                contemporaneous = _correlation(contemporaneous_left, contemporaneous_right)
                sufficient = len(left) >= MIN_WINDOWS and asset.interval == "daily"
                limits = [
                    "One event history; windows are not independent resolved events.",
                    "Associations do not identify causality or expected investment returns.",
                    "Sessions are supplied daily records; missing sessions are not imputed.",
                ]
                if any(point.available_at is None for point in asset.points + market.history):
                    limits.append(
                        "Some availability times are assumed equal to observation timestamps."
                    )
                if retrospective:
                    limits.append(
                        "Retrospective aligned prices were available at the report cutoff, "
                        "not necessarily at historical decision times; "
                        "this is not a predictive backtest."
                    )
                if asset.interval != "daily":
                    limits.append(
                        "Session analytics require daily observations; "
                        "intraday bars are not sessions."
                    )
                if asset.adjustment == "unknown":
                    limits.append(
                        "Unknown adjustment basis prevents a comparable return interpretation."
                    )
                    sufficient = False
                status = (
                    "experimental"
                    if sufficient and forward is not None and reverse is not None
                    else "insufficient"
                )
                label = "inconclusive"
                direction = "inconclusive"
                if status == "experimental":
                    forward_ci = _fisher_interval(forward, len(left))
                    reverse_ci = _fisher_interval(reverse, len(left))
                    reversal_ci = _fisher_interval(reversal, len(left))
                    forward_directional = (
                        forward_ci is not None and forward_ci[0] * forward_ci[1] > 0
                    )
                    reverse_directional = (
                        reverse_ci is not None and reverse_ci[0] * reverse_ci[1] > 0
                    )
                    if (
                        forward_directional
                        and abs(forward) >= 0.3
                        and abs(forward) - abs(reverse) >= 0.15
                    ):
                        direction = "experimental_pm_lead"
                    elif (
                        reverse_directional
                        and abs(reverse) >= 0.3
                        and abs(reverse) - abs(forward) >= 0.15
                    ):
                        direction = "experimental_asset_lead"
                    elif reversal_ci is not None and reversal_ci[1] < 0 and reversal <= -0.3:
                        direction = "experimental_reversal"
                if not retrospective:
                    label = direction
                results.append(
                    {
                        "symbol": asset.symbol,
                        "market_id": market.market_id,
                        "holding_sessions": holding,
                        "pairs": len(left),
                        "independent_windows": len(left),
                        "independent_events": 1,
                        "pm_leads_asset": _association(forward, len(left), status),
                        "asset_leads_pm": _association(reverse, len(left), status),
                        "reversal": _association(reversal, len(left), status),
                        "contemporaneous": _association(contemporaneous, len(left), status),
                        "status": status,
                        "label": label,
                        "adjustment": asset.adjustment,
                        "descriptive_direction": direction,
                        "mode": mode,
                        "historical_reconstruction": retrospective,
                        "predictive_validation": "not_established",
                        "trading_edge": "inconclusive",
                        "unit": "yield_change_bps"
                        if asset.adjustment == "yield"
                        else "simple_return",
                        "limitations": limits,
                    }
                )
    return results


def _logic(
    bundle: EvidenceBundle,
    probabilities: dict[str, float | None],
    intervals: dict[str, list[float]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    bounds = {key: list(value) for key, value in intervals.items()}

    def valid(relation: Any) -> bool:
        ids = relation.market_ids
        return (
            len(ids) >= 2
            and len(set(ids)) == len(ids)
            and (relation.kind != "complement" or len(ids) == 2)
        )

    verified = [
        relation for relation in bundle.event.relations if relation.verified and valid(relation)
    ]
    conflicts: set[str] = set()
    # Interval constraint propagation is a conservative relaxation of the full
    # marginal polytope. Never label this a proof of global feasibility.
    for _ in range(100):
        previous = {key: list(value) for key, value in bounds.items()}
        for relation in verified:
            ids = relation.market_ids
            if not ids or any(key not in bounds for key in ids):
                continue
            if relation.kind in {"implies", "nested_deadline", "nested_threshold"}:
                for subset, superset in zip(ids, ids[1:], strict=False):
                    bounds[subset][1] = min(bounds[subset][1], bounds[superset][1])
                    bounds[superset][0] = max(bounds[superset][0], bounds[subset][0])
            else:
                at_most = relation.kind in {"exclusive", "complement"}
                at_least = relation.kind in {"exhaustive", "complement"}
                for key in ids:
                    other = [bounds[item] for item in ids if item != key]
                    if at_most:
                        bounds[key][1] = min(bounds[key][1], 1 - sum(pair[0] for pair in other))
                    if at_least:
                        bounds[key][0] = max(bounds[key][0], 1 - sum(pair[1] for pair in other))
            for key in ids:
                if bounds[key][0] > bounds[key][1] + 1e-9:
                    conflicts.update(ids)
        if conflicts or all(
            abs(bounds[key][i] - previous[key][i]) < 1e-10 for key in bounds for i in (0, 1)
        ):
            break
    checks: list[dict[str, Any]] = []
    families: list[dict[str, Any]] = []
    contracts = {item.id: item for item in bundle.event.contracts}
    for relation in bundle.event.relations:
        ids = relation.market_ids
        missing = [key for key in ids if key not in probabilities or probabilities[key] is None]
        values = [
            probabilities[key]
            for key in ids
            if key in probabilities and probabilities[key] is not None
        ]
        status = (
            "invalid_relation"
            if not valid(relation)
            else "unverified"
            if not relation.verified
            else "unavailable"
            if missing
            else "quote_infeasible"
            if conflicts.intersection(ids)
            else "interval_consistent"
        )
        observed_sum = sum(values) if not missing else None
        violation = False
        if not missing and relation.verified and valid(relation):
            if relation.kind == "complement":
                violation = abs(observed_sum - 1) > 1e-6
            elif relation.kind == "exclusive":
                violation = observed_sum > 1 + 1e-6
            elif relation.kind == "exhaustive":
                violation = observed_sum < 1 - 1e-6
            else:
                violation = any(a > b + 1e-6 for a, b in zip(values, values[1:], strict=False))
        ranges = (
            {key: bounds[key] for key in ids if key in bounds}
            if relation.verified and valid(relation) and status != "quote_infeasible"
            else {}
        )
        checks.append(
            {
                "kind": relation.kind,
                "market_ids": ids,
                "verified": relation.verified,
                "status": status,
                "observed_sum": observed_sum,
                "point_estimate_violation": violation,
                "coherent_ranges": ranges,
                "rationale": relation.rationale,
                "method": "necessary marginal interval constraints; not proof of joint feasibility",
            }
        )
        partition = relation.kind == "complement" or (
            relation.kind == "exhaustive"
            and any(
                other.kind == "exclusive" and other.verified and set(other.market_ids) == set(ids)
                for other in verified
            )
        )
        if relation.verified and valid(relation) and partition:
            bins = [
                {
                    "market_id": key,
                    "label": contracts[key].group_label or contracts[key].question
                    if key in contracts
                    else key,
                    "probability": probabilities.get(key)
                    if observed_sum is not None and abs(observed_sum - 1) <= 1e-6
                    else None,
                    "range": ranges.get(key),
                }
                for key in ids
            ]
            families.append(
                {
                    "kind": "verified_partition",
                    "market_ids": ids,
                    "status": status
                    if observed_sum is None or abs(observed_sum - 1) <= 1e-6
                    else "ranges_only"
                    if status == "interval_consistent"
                    else status,
                    "bins": bins,
                }
            )
        elif (
            relation.verified
            and valid(relation)
            and relation.kind == "exclusive"
            and not any(
                other.kind == "exhaustive" and set(other.market_ids) == set(ids)
                for other in verified
            )
        ):
            bins = [
                {
                    "market_id": key,
                    "label": contracts[key].group_label or contracts[key].question
                    if key in contracts
                    else key,
                    "probability": probabilities.get(key) if not violation else None,
                    "range": ranges.get(key),
                }
                for key in ids
            ]
            unallocated = None
            if len(ranges) == len(ids):
                unallocated = [
                    max(0, 1 - sum(pair[1] for pair in ranges.values())),
                    max(0, 1 - sum(pair[0] for pair in ranges.values())),
                ]
            families.append(
                {
                    "kind": "verified_exclusive_partial",
                    "market_ids": ids,
                    "status": status,
                    "bins": bins,
                    "complete_distribution": False,
                    "unallocated_mass_range": unallocated,
                    "limitation": (
                        "Listed outcomes are exclusive; exhaustiveness was not verified. "
                        "No missing outcome point probability is invented."
                    ),
                }
            )
        elif relation.verified and relation.kind == "nested_threshold" and len(ids) >= 2:
            bins = []
            for subset, superset in zip(ids, ids[1:], strict=False):
                lo, hi = ranges.get(subset), ranges.get(superset)
                probability = (
                    None
                    if missing or violation
                    else probabilities[superset] - probabilities[subset]
                )
                bins.append(
                    {
                        "market_id": f"{superset} minus {subset}",
                        "label": f"{superset} but not {subset}",
                        "probability": probability,
                        "range": [max(0, hi[0] - lo[1]), max(0, hi[1] - lo[0])]
                        if lo and hi
                        else None,
                    }
                )
            families.append(
                {
                    "kind": "verified_threshold_intervals",
                    "market_ids": ids,
                    "status": status,
                    "bins": bins,
                    "complete_distribution": False,
                }
            )
    return checks, families


def analyze_bundle(
    bundle: EvidenceBundle, as_of: datetime | None = None, seed: int = 42
) -> dict[str, Any]:
    """Return immutable-input metrics with explicit availability and uncertainty limits."""
    cutoff = utc(as_of or bundle.captured_at)
    changes, quality = [], []
    probabilities: dict[str, float | None] = {}
    intervals: dict[str, list[float]] = {}
    available_ids = {item.id for item in bundle.observations if utc(item.available_at) <= cutoff}
    contracts = {item.id: item for item in bundle.event.contracts}
    limits = [
        "Event probabilities are not expected asset returns.",
        "Logical intervals use verified relations only; they are necessary marginal bounds, "
        "not a joint distribution.",
        "Spread, depth, holder concentration and staleness are evidence diagnostics, "
        "not calibrated confidence scores.",
        "Book depth is the supplied snapshot, not a guarantee of executable size "
        "or future liquidity.",
        "Historical price changes use the history vintage available at the report cutoff; "
        "they are descriptive, not a reconstruction of earlier decisions.",
    ]
    metadata_available = utc(bundle.event.observed_at) <= cutoff
    if not metadata_available:
        limits.append(
            "Event definitions were captured after the cutoff; "
            "historical semantic verification is unavailable."
        )
    for market in bundle.markets:
        timestamp = utc(market.as_of)
        referenced = not market.observation_ids or set(market.observation_ids) <= available_ids
        eligible = timestamp <= cutoff and referenced and metadata_available
        probability = market.probability if eligible else None
        probabilities[market.market_id] = probability
        deltas: dict[str, Any] = {}
        for days in (1, 7, 30):
            target = timestamp - timedelta(days=days)
            point = _at(available_points(market.history, cutoff), target)
            # Avoid reporting a thirty-day gap as yesterday's move.
            fresh = point is not None and target - utc(point.timestamp) <= timedelta(days=1)
            deltas[f"delta_{days}d_pp"] = (
                100 * (probability - point.value)
                if probability is not None and fresh and 0 <= point.value <= 1
                else None
            )
            deltas[f"comparison_{days}d_at"] = (
                utc(point.timestamp).isoformat() if point is not None and fresh else None
            )
            deltas[f"window_{days}d_elapsed_hours"] = (
                (timestamp - utc(point.timestamp)).total_seconds() / 3600
                if point is not None and fresh
                else None
            )
        changes.append(
            {
                "market_id": market.market_id,
                "question": contracts[market.market_id].question
                if market.market_id in contracts
                else market.market_id,
                "probability": probability,
                "as_of": timestamp.isoformat(),
                "quote_type": market.quote_type,
                "status": "available" if probability is not None else "unavailable",
                "evidence_ids": market.observation_ids,
                **deltas,
            }
        )
        issues = list(market.issues)
        age = max(0, (cutoff - timestamp).total_seconds())
        spread = (
            market.ask - market.bid if market.ask is not None and market.bid is not None else None
        )
        if not eligible:
            issues.append("snapshot_or_evidence_unavailable_at_cutoff")
        if spread is None:
            issues.append("missing_two_sided_book")
        elif spread < 0:
            issues.append("crossed_book")
        elif spread > 0.05:
            issues.append("wide_spread_above_5pp")
        if age > 3600:
            issues.append("quote_older_than_one_hour")
        if market.bid_depth_usd is None or market.ask_depth_usd is None:
            issues.append("depth_unavailable")
        if any(point.available_at is None for point in market.history):
            issues.append("history_availability_assumed")
        quality.append(
            {
                "market_id": market.market_id,
                "spread": spread,
                "spread_pp": spread * 100 if spread is not None else None,
                "bid_depth_usd": market.bid_depth_usd,
                "ask_depth_usd": market.ask_depth_usd,
                "age_seconds": age,
                "top_holder_share": market.top_holder_share,
                "unique_participants": market.unique_participants,
                "holder_coverage": market.holder_coverage,
                "status": "unavailable" if not eligible else "limited" if issues else "observed",
                "issues": sorted(set(issues)),
            }
        )
        if eligible:
            intervals[market.market_id] = (
                [market.bid, market.ask] if spread is not None and spread >= 0 else [0.0, 1.0]
            )
    logic_bundle = (
        bundle
        if metadata_available
        else bundle.model_copy(update={"event": bundle.event.model_copy(update={"relations": []})})
    )
    checks, families = _logic(logic_bundle, probabilities, intervals)
    return {
        "method_version": METHOD_VERSION,
        "as_of": cutoff.isoformat(),
        "event_id": bundle.event.id,
        "expectation_changes": changes,
        "book_quality": quality,
        "logical_consistency": checks,
        "family_distributions": families,
        "asset_response": _asset_responses(
            bundle.model_copy(
                update={
                    "markets": [
                        market
                        for market in bundle.markets
                        if probabilities[market.market_id] is not None
                    ]
                }
            ),
            cutoff,
        )
        if metadata_available
        else [],
        "provenance": {
            "seed": seed,
            "origin": bundle.event.origin,
            "captured_at": utc(bundle.captured_at).isoformat(),
            "available_observation_ids": sorted(available_ids),
            "excluded_observation_count": len(bundle.observations) - len(available_ids),
            "historical_reconstruction": any(
                item.historical_reconstruction for item in bundle.observations
            ),
            "independent_events": 1,
            "semantic_metadata_available": metadata_available,
        },
        "limitations": [*limits, *bundle.issues],
    }


def simulate(assumptions: ScenarioAssumptions) -> SimulationResult:
    """Two-state user scenario, not a forecast or a recommendation."""
    p, up, down = assumptions.probability, assumptions.event_return, assumptions.non_event_return
    cost = assumptions.round_trip_cost_bps / 10_000
    spread = up - down
    break_even = (cost - down) / spread if abs(spread) > 1e-15 else None
    net = p * up + (1 - p) * down - cost
    bounds = None
    limits = [
        "Conditional returns and event probability are assumptions, not validated forecasts.",
        "Costs are a fixed fraction of starting capital; "
        "taxes, financing and path-dependent execution are excluded.",
        "Marginal probabilities alone do not identify a joint probability or a four-state payoff.",
    ]
    if spread < 0:
        limits.append(
            "Event-state return is lower: profit requires probability "
            "BELOW the break-even boundary."
        )
    if assumptions.second_event_probability is not None:
        q = assumptions.second_event_probability
        upper = min(p, q)
        bounds = (min(upper, max(0, p + q - 1)), upper)
        if (
            assumptions.joint_probability is not None
            and not bounds[0] - 1e-12 <= assumptions.joint_probability <= bounds[1] + 1e-12
        ):
            raise ValueError("joint probability violates Frechet bounds")
    elif assumptions.joint_probability is not None:
        raise ValueError("second_event_probability is required for a joint probability")
    joint_scenario = None
    if assumptions.joint_payoffs is not None:
        if assumptions.second_event_probability is None or bounds is None:
            raise ValueError("second_event_probability is required for joint payoffs")
        second = assumptions.second_event_probability
        payoffs = assumptions.joint_payoffs.model_dump()

        def joint_result(joint: float) -> dict[str, Any]:
            weights = {
                "both": joint,
                "first_only": max(0.0, p - joint),
                "second_only": max(0.0, second - joint),
                "neither": max(0.0, 1 - p - second + joint),
            }
            expected = sum(weights[state] * payoff for state, payoff in payoffs.items()) - cost
            return {
                "joint_probability": joint,
                "weights": weights,
                "expected_return": expected,
                "expected_pnl": expected * assumptions.capital,
            }

        endpoints = [joint_result(joint) for joint in dict.fromkeys(bounds)]
        returns = [value["expected_return"] for value in endpoints]
        point = None
        if assumptions.joint_probability is not None:
            point = joint_result(min(bounds[1], max(bounds[0], assumptions.joint_probability)))
        joint_scenario = {
            "status": "assumed_joint_point" if point else "bounds_only",
            "marginals": {"first": p, "second": second},
            "payoffs": payoffs,
            "joint_probability_bounds": list(bounds),
            "expected_return_bounds": [min(returns), max(returns)],
            "expected_pnl_bounds": [
                min(returns) * assumptions.capital,
                max(returns) * assumptions.capital,
            ],
            "endpoints": endpoints,
            "point": point,
            "assumption_source": assumptions.assumption_source,
            "cost_bps": assumptions.round_trip_cost_bps,
            "method": (
                "Four-state expected payoff is linear in the joint probability; "
                "extrema occur at Frechet endpoints."
            ),
            "limitations": [
                "Four conditional state returns and both marginal probabilities "
                "are declared assumptions.",
                "Unknown dependence produces a feasible expected-return range, "
                "not an independence point forecast.",
                "The primary single-event scenario remains separate "
                "from this four-state stress calculation.",
            ],
        }
    sensitivity = []
    for cost_bps in sorted(
        {
            0.0,
            assumptions.round_trip_cost_bps,
            assumptions.round_trip_cost_bps + 25,
            assumptions.round_trip_cost_bps + 100,
        }
    ):
        for probability in sorted({0.0, max(0, p - 0.1), p, min(1, p + 0.1), 1.0}):
            expected = probability * up + (1 - probability) * down - cost_bps / 10_000
            sensitivity.append(
                {
                    "probability": probability,
                    "cost_bps": cost_bps,
                    "expected_return": expected,
                    "expected_pnl": expected * assumptions.capital,
                }
            )
    return SimulationResult(
        expected_return=net,
        expected_pnl=net * assumptions.capital,
        event_pnl=(up - cost) * assumptions.capital,
        non_event_pnl=(down - cost) * assumptions.capital,
        break_even_probability=break_even,
        feasible_break_even=break_even is not None and 0 <= break_even <= 1,
        cost_fraction=cost,
        sensitivity=sensitivity,
        joint_bounds=bounds,
        assumption_source=assumptions.assumption_source,
        limitations=limits,
        joint_scenario=joint_scenario,
    )


def paper_evaluate(
    series: AssetSeries,
    decision_at: datetime,
    holding_sessions: int,
    cost_bps: float,
    capital: float,
) -> dict[str, Any]:
    """Ex-post long-only daily-close marks with entry strictly after decision time.

    No calendar is invented: a session is a supplied observed timestamp. This is
    not an executable strategy backtest and never assumes a next-day open fill.
    """
    decision = utc(decision_at)
    if holding_sessions < 1 or not 0 <= cost_bps <= 10_000 or capital <= 0:
        raise ValueError("positive holding sessions/capital and costs in [0,10000] bps required")
    base: dict[str, Any] = {
        "symbol": series.symbol,
        "decision_at": decision.isoformat(),
        "holding_sessions": holding_sessions,
        "adjustment": series.adjustment,
        "cost_bps": cost_bps,
        "capital": capital,
        "status": "unavailable",
        "execution_proxy": "next_observed_session_close",
        "next_tradable_time": None,
        "entry_at": None,
        "exit_at": None,
        "gross_return": None,
        "net_return": None,
        "pnl": None,
        "limitations": [
            "Ex-post long-only daily-close marks; observed prices do not guarantee fills.",
            "Observed records define sessions; missing sessions/holidays are not imputed.",
            "Raw prices omit distributions; split-adjusted prices are not total returns.",
            *series.issues,
        ],
    }
    if series.interval != "daily":
        base["reason"] = "session_evaluation_requires_daily_series"
        return base
    if series.adjustment in {"unknown", "yield"}:
        base["reason"] = (
            "yield_is_not_investable_return"
            if series.adjustment == "yield"
            else "unknown_adjustment_basis"
        )
        return base
    if any(point.available_at is None for point in series.points):
        base["reason"] = "explicit_availability_required"
        return base
    known = available_points(series.points, decision)
    if not known:
        base["reason"] = "no_price_available_at_decision"
        return base
    # Backfilled corporate-action revisions may change old prices. Freeze a
    # vintage for each marked timestamp: ignore revisions arriving after it.
    marked: dict[datetime, SeriesPoint] = {}
    for point in series.points:
        timestamp = utc(point.timestamp)
        if (
            timestamp <= decision
            or utc(point.available_at) > timestamp
            or not _finite(point.value)
            or point.value <= 0
        ):
            continue
        prior = marked.get(timestamp)
        if prior is None or utc(point.available_at) > utc(prior.available_at):
            marked[timestamp] = point
    future = [marked[key] for key in sorted(marked)]
    if len(future) <= holding_sessions:
        base["reason"] = "insufficient_future_observed_sessions_or_vintages"
        return base
    entry, exit_point = future[0], future[holding_sessions]
    gross = exit_point.value / entry.value - 1
    net = gross - cost_bps / 10_000
    base.update(
        {
            "status": "paper_proxy",
            "reason": None,
            "next_tradable_time": utc(entry.timestamp).isoformat(),
            "entry_at": utc(entry.timestamp).isoformat(),
            "exit_at": utc(exit_point.timestamp).isoformat(),
            "entry_price": entry.value,
            "exit_price": exit_point.value,
            "gross_return": gross,
            "net_return": net,
            "pnl": capital * net,
            "decision_reference_at": utc(known[-1].timestamp).isoformat(),
        }
    )
    return base
