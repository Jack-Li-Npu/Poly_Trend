"""Run reproducible V3 validation mechanics, or an explicit labeled JSONL input.

Synthetic results must never be presented as historical investment performance.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "research" / "src"))

from fixtures import synthetic_records  # noqa: E402
from polytrend.v3.analytics import simulate  # noqa: E402
from polytrend.v3.evaluation import evaluate_records  # noqa: E402
from polytrend.v3.models import ScenarioAssumptions  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        help="Point-in-time labeled JSONL; never inferred from saved run snapshots",
    )
    parser.add_argument("--as-of", help="Timezone-aware evaluation cutoff; required with --input")
    parser.add_argument("--cost-bps", type=float, default=20)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if args.input:
        if not args.as_of:
            parser.error("--as-of is required with --input to bound label availability")
        records = [json.loads(line) for line in args.input.read_text().splitlines() if line.strip()]
        cutoff = datetime.fromisoformat(args.as_of.replace("Z", "+00:00"))
        result = {
            "input": str(args.input),
            "report": evaluate_records(
                records, as_of=cutoff, seed=args.seed, cost_bps=args.cost_bps
            ).model_dump(mode="json"),
        }
    else:
        cutoff = datetime(2025, 1, 1, tzinfo=UTC)
        positive = evaluate_records(
            synthetic_records(incremental_signal=True, seed=args.seed),
            as_of=cutoff,
            seed=args.seed,
            cost_bps=args.cost_bps,
        )
        negative = evaluate_records(
            synthetic_records(incremental_signal=False, seed=args.seed),
            as_of=cutoff,
            seed=args.seed,
            cost_bps=args.cost_bps,
        )
        result = {
            "dataset": {
                "origin": "synthetic",
                "purpose": (
                    "Positive/negative pipeline controls only; "
                    "no historical alpha or calibration claim"
                ),
                "seed": args.seed,
            },
            "positive_control": positive.model_dump(mode="json"),
            "negative_control": negative.model_dump(mode="json"),
            "scenario": simulate(
                ScenarioAssumptions(
                    probability=0.7,
                    event_return=0.05,
                    non_event_return=-0.2,
                    round_trip_cost_bps=args.cost_bps,
                    second_event_probability=0.6,
                )
            ).model_dump(mode="json"),
            "checks": {
                "positive_control_detected": positive.asset_prediction["mse_improvement"] > 0,
                "no_synthetic_validated_status": positive.asset_prediction["status"]
                == negative.asset_prediction["status"]
                == "synthetic_only",
                "high_probability_can_have_negative_expected_return": simulate(
                    ScenarioAssumptions()
                ).expected_return
                < 0,
            },
        }
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
