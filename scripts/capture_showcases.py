"""Record three attributed public macro cases; never synthesize missing prices.

Run from the repository with PYTHONPATH=services/research/src. An optional-key
capture must be explicitly selected; the default records honest ETF gaps.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
from datetime import timedelta
from pathlib import Path

from polytrend.v3.models import EvidenceBundle, utc_now
from polytrend.v3.providers import ProviderConfig, ResearchDataProvider, trade_diagnostics


async def augment(provider: ResearchDataProvider, output: Path) -> None:
    """Repair rejected history requests using genuine new reads, keeping old books."""
    manifest_path = output / "capture_manifest.json"
    manifest = json.loads(manifest_path.read_text())
    for path in sorted(output.glob("0*.json")):
        bundle = EvidenceBundle.model_validate_json(path.read_text())
        original_cutoff = max(
            [bundle.captured_at, *[item.retrieved_at for item in bundle.observations]]
        )
        raw_definition = next(
            (item for item in bundle.observations if item.kind == "event_definition"), None
        )
        if raw_definition is not None:
            rebuilt = provider.event_from_gamma(raw_definition.payload)
            rebuilt.origin, rebuilt.observed_at = "recorded", bundle.event.observed_at
            bundle.event = rebuilt
        for market in bundle.markets:
            if not market.token_id or market.history:
                continue
            print(
                json.dumps(
                    {
                        "stage": "augment_history",
                        "event": bundle.event.id,
                        "market": market.market_id,
                    }
                ),
                flush=True,
            )
            points, observation, issues = await provider.probability_history(
                market.token_id, original_cutoff
            )
            if observation is not None:
                observation.origin = "recorded"
                bundle.observations.append(observation)
                market.observation_ids.append(observation.id)
                market.history = points
            if points:
                market.issues = [
                    issue
                    for issue in market.issues
                    if issue
                    not in {
                        "No probability history returned; repricing and lead-lag "
                        "calculations are unavailable.",
                        "polymarket_data: HTTP 400",
                        "clob: HTTP 400",
                    }
                ]
                market.issues.append(
                    "Initial long-window history request was rejected; this genuine coarse "
                    "history was fetched later using interval=max."
                )
            market.issues.extend(issues)
            market.observation_ids = list(
                dict.fromkeys(
                    market.observation_ids
                    + [item.id for item in bundle.observations if item.kind == "event_definition"]
                )
            )
        for market in bundle.markets:
            tape = next(
                (
                    item
                    for item in bundle.observations
                    if item.kind == "trades" and item.external_id == market.condition_id
                ),
                None,
            )
            if tape is None:
                continue
            rows = [row for page in tape.payload.get("pages", []) for row in page.get("data", [])]
            contract = next(
                (item for item in bundle.event.contracts if item.id == market.market_id), None
            )
            opposite = (
                next((token for token in contract.token_ids if token != market.token_id), None)
                if contract
                else None
            )
            diagnostics = trade_diagnostics(rows, market.token_id, opposite)
            market.unique_participants = diagnostics["unique_wallets"]
            for field in ("trade_count", "taker_net_shares", "taker_net_notional_usd"):
                if field in type(market).model_fields:
                    setattr(market, field, diagnostics[field])
            market.issues = list(dict.fromkeys(market.issues + diagnostics["issues"]))
        for index, old_series in enumerate(bundle.assets):
            if old_series.symbol not in {"DGS2", "DGS10"} or old_series.points:
                continue
            print(
                json.dumps(
                    {
                        "stage": "augment_treasury",
                        "event": bundle.event.id,
                        "symbol": old_series.symbol,
                    }
                ),
                flush=True,
            )
            series, observations = await provider.asset_series(old_series.symbol, original_cutoff)
            if series.points:
                for observation in observations:
                    observation.origin = "recorded"
                bundle.assets[index] = series
                bundle.observations.extend(observations)
        bundle.captured_at = max(
            [original_cutoff, *[item.retrieved_at for item in bundle.observations]]
        )
        bundle.issues = list(
            dict.fromkeys(
                bundle.issues
                + [
                    "History was augmented after the initial book snapshot; source receipt "
                    "times preserve the different capture times. No historical book was "
                    "reconstructed."
                ]
            )
        )
        body = bundle.model_dump_json(indent=2) + "\n"
        path.write_text(body)
        case = next(item for item in manifest["cases"] if item["file"] == path.name)
        case.update(
            {
                "captured_at": bundle.captured_at.isoformat(),
                "sha256": hashlib.sha256(body.encode()).hexdigest(),
                "observations": len(bundle.observations),
                "assets": [
                    {
                        "symbol": item.symbol,
                        "points": len(item.points),
                        "provider": item.provider,
                        "issues": item.issues,
                    }
                    for item in bundle.assets
                ],
                "sources": sorted({item.source_url for item in bundle.observations}),
                "issues": sorted(
                    set(
                        bundle.issues
                        + [issue for market in bundle.markets for issue in market.issues]
                    )
                ),
            }
        )
        print(
            json.dumps(
                {
                    "stage": "augmented",
                    "file": path.name,
                    "history_points": sum(len(item.history) for item in bundle.markets),
                }
            ),
            flush=True,
        )
    manifest["augmented_at"] = utc_now().isoformat()
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=Path(__file__).resolve().parents[1] / "showcase"
    )
    parser.add_argument(
        "--event",
        action="append",
        default=[],
        help="Explicit Gamma event ID; repeat up to three times",
    )
    parser.add_argument("--optional-keys", action="store_true")
    parser.add_argument("--timeout", type=int, default=280)
    parser.add_argument(
        "--augment-history",
        action="store_true",
        help="Fix an existing recording's rejected history requests with new real reads",
    )
    args = parser.parse_args()
    if not args.optional_keys:
        os.environ.pop("FRED_API_KEY", None)
        os.environ.pop("ALPHA_VANTAGE_API_KEY", None)
    config = ProviderConfig(request_timeout_seconds=8, max_retries=1)
    provider = ResearchDataProvider(config)
    args.output.mkdir(parents=True, exist_ok=True)
    if args.augment_history:
        await augment(provider, args.output)
        return
    manifest = {
        "captured_at": utc_now().isoformat(),
        "method": "Public read-only GET capture; no seed fallback.",
        "temporal_limitations": [
            "Recorded snapshots are observed at capture time, not at an earlier investment "
            "decision.",
            "Historical charts/candles were retrieved retrospectively and do not certify "
            "point-in-time event definitions or historical books.",
            "Hypothetical simulation assumptions are not historical strategy returns or "
            "validated alpha.",
            "No ETF key is used by default; missing optional prices remain unavailable.",
        ],
        "cases": [],
        "failures": [],
    }
    queries = ["Fed decision in October", "US inflation in October", "US recession 2026"]
    selected = set()
    for index in range(3):
        label = args.event[index] if index < len(args.event) else queries[index]
        print(json.dumps({"stage": "discover", "case": index + 1, "query": label}), flush=True)
        try:
            async with asyncio.timeout(args.timeout):
                if index < len(args.event):
                    event = await provider.get_event(args.event[index])
                else:
                    candidates = await provider.discover(
                        queries[index], include_closed=True, limit=8
                    )
                    now = utc_now()
                    candidates = [
                        item for item in candidates if item.id not in selected and item.contracts
                    ]

                    def rank(item, observed_now=now):
                        future = bool(
                            item.deadline
                            and observed_now < item.deadline < observed_now + timedelta(days=180)
                        )
                        active = any(
                            contract.active and not contract.closed for contract in item.contracts
                        )
                        requested_year = "2026" in item.title
                        return future, active, requested_year, len(item.contracts)

                    candidates.sort(key=rank, reverse=True)
                    if not candidates:
                        raise ValueError(
                            "No matching public event returned; no replacement was fabricated"
                        )
                    event = candidates[0]
                selected.add(event.id)
                print(
                    json.dumps(
                        {
                            "stage": "capture",
                            "id": event.id,
                            "title": event.title,
                            "contracts": len(event.contracts),
                        }
                    ),
                    flush=True,
                )
                bundle = await provider.capture(
                    event, ["SPY", "QQQ", "IEF", "TLT", "BTC-USD", "DGS2", "DGS10"]
                )
                bundle.event.origin = "recorded"
                for observation in bundle.observations:
                    observation.origin = "recorded"
                filename = f"{index + 1:02d}-{event.slug[:100]}.json"
                body = bundle.model_dump_json(indent=2)
                (args.output / filename).write_text(body + "\n")
                manifest["cases"].append(
                    {
                        "file": filename,
                        "event_id": event.id,
                        "title": event.title,
                        "source_url": event.source_url,
                        "captured_at": bundle.captured_at.isoformat(),
                        "sha256": hashlib.sha256((body + "\n").encode()).hexdigest(),
                        "observations": len(bundle.observations),
                        "markets": len(bundle.markets),
                        "assets": [
                            {
                                "symbol": item.symbol,
                                "points": len(item.points),
                                "provider": item.provider,
                                "issues": item.issues,
                            }
                            for item in bundle.assets
                        ],
                        "sources": sorted({item.source_url for item in bundle.observations}),
                        "issues": sorted(
                            set(
                                bundle.issues
                                + [issue for market in bundle.markets for issue in market.issues]
                            )
                        ),
                    }
                )
                print(
                    json.dumps(
                        {
                            "stage": "saved",
                            "file": filename,
                            "observations": len(bundle.observations),
                            "history_points": sum(len(item.history) for item in bundle.markets),
                        }
                    ),
                    flush=True,
                )
        except Exception as exc:
            # Do not serialize exception text: network libraries can include secrets.
            manifest["failures"].append(
                {"case": index + 1, "query": label, "error_type": type(exc).__name__}
            )
            print(
                json.dumps(
                    {"stage": "failed", "case": index + 1, "error_type": type(exc).__name__}
                ),
                flush=True,
            )
        (args.output / "capture_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    if len(manifest["cases"]) != 3:
        raise SystemExit(
            "Capture incomplete; review manifest failures. Missing cases were not fabricated."
        )


if __name__ == "__main__":
    asyncio.run(main())
