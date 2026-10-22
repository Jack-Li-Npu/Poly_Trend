"""Synthetic controls only. These rows are not Polymarket/provider observations."""

from __future__ import annotations

import random
from datetime import UTC, datetime, timedelta
from typing import Any


def synthetic_records(
    *, incremental_signal: bool, count: int = 120, seed: int = 42
) -> list[dict[str, Any]]:
    rng = random.Random(seed)
    start = datetime(2020, 1, 1, tzinfo=UTC)
    rows = []
    for index in range(count):
        decision = start + timedelta(days=index * 5)
        conventional = rng.uniform(-1, 1)
        probability = rng.uniform(0.05, 0.95)
        probability_change = rng.uniform(-0.1, 0.1)
        pm_component = 0.025 * (probability - 0.5) if incremental_signal else 0
        target = 0.01 * conventional + pm_component + rng.gauss(0, 0.002)
        rows.append(
            {
                "event_id": f"SYNTHETIC-event-{index:03d}",
                "market_id": f"SYNTHETIC-market-{index:03d}",
                "origin": "synthetic",
                "decision_at": decision.isoformat(),
                "features_available_at": decision.isoformat(),
                "baseline_available_at": decision.isoformat(),
                "pm_available_at": decision.isoformat(),
                "label_available_at": (decision + timedelta(days=1)).isoformat(),
                "asset_target_available_at": (decision + timedelta(days=2)).isoformat(),
                "features": [conventional],
                "baseline_probability": 0.5,
                "pm_probability": probability,
                "pm_change": probability_change,
                "outcome": int(rng.random() < probability),
                "asset_return": target,
            }
        )
    return rows
