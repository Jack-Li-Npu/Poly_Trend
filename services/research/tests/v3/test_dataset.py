"""Offline provenance checks; recorded source data are not synthetic benchmarks."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from polytrend.v3.analytics import analyze_bundle
from polytrend.v3.evaluation import get_evaluation_report
from polytrend.v3.models import EvidenceBundle


def test_recorded_cases_match_manifest_hashes_and_keep_empirical_status_insufficient() -> None:
    root = Path(__file__).resolve().parents[4]
    manifest_path = root / "showcase" / "capture_manifest.json"
    manifest = json.loads(manifest_path.read_text())
    assert len(manifest["cases"]) == 3
    bundles = []
    for case in manifest["cases"]:
        path = manifest_path.parent / case["file"]
        raw = path.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == case["sha256"]
        bundle = EvidenceBundle.model_validate_json(raw)
        assert bundle.event.id == case["event_id"]
        assert bundle.event.origin == "recorded"
        assert all(observation.origin == "recorded" for observation in bundle.observations)
        assert len(bundle.observations) == case["observations"]
        assert len(bundle.markets) == case["markets"]
        assert all(
            observation.available_at <= bundle.captured_at for observation in bundle.observations
        )
        metrics = analyze_bundle(bundle)
        for market, change in zip(bundle.markets, metrics["expectation_changes"], strict=True):
            if not market.history:
                assert change["delta_1d_pp"] is None
        assert all(
            row["predictive_validation"] == "not_established" for row in metrics["asset_response"]
        )
        bundles.append(bundle)
    report = get_evaluation_report([], bundles)
    assert report.calibration["independent_events"] == 3
    assert report.calibration["status"] == "insufficient"
    assert report.calibration["resolved_label_count"] == 0
    assert report.asset_prediction["status"] == "insufficient"
