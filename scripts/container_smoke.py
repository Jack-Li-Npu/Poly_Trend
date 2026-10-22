"""Exercise the real container/PostgreSQL stack using only explicit recordings."""

import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

STATE = Path("/tmp/polytrend-v3-container-smoke.json")
API = "http://127.0.0.1:8000"


def request(path, payload=None, base=API):
    body = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        base + path, data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.load(response)


def wait_health():
    for _ in range(60):
        try:
            health = request("/healthz")
            assert health["storage"]["driver"] == "postgresql"
            return
        except (OSError, urllib.error.HTTPError):
            time.sleep(1)
    raise AssertionError("Container API did not become healthy")


def completed(run_id):
    for _ in range(100):
        result = request(f"/api/v3/runs/{run_id}")
        if result["run"]["status"] == "failed":
            raise AssertionError(result["run"]["error"])
        if result["run"]["status"] == "completed":
            return result
        time.sleep(0.2)
    raise AssertionError("Recorded container research did not complete")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-recovery", action="store_true")
    args = parser.parse_args()
    wait_health()
    # This must traverse the production Next.js runtime proxy, not just the API.
    events = request("/api/v3/events?source_mode=recorded", base="http://127.0.0.1:3000")["events"]
    assert len(events) == 3
    if args.verify_recovery:
        state = json.loads(STATE.read_text())
        case = request(f"/api/v3/cases/{state['case_id']}")
        assert case["case"]["id"] == state["case_id"]
        result = completed(state["run_id"])
        assert result["run"]["snapshot_hash"] == state["snapshot_hash"]
        assert result["run"]["metrics"] == state["metrics"]
        print("PostgreSQL case and numerical result recovered after container restart")
        return
    case = request(
        "/api/v3/cases",
        {
            "event_id": events[0]["id"],
            "source_mode": "recorded",
            "assets": ["BTC-USD", "DGS2", "DGS10"],
            "thesis": "Container smoke fixture; no investment recommendation.",
        },
    )
    run = request(f"/api/v3/cases/{case['id']}/runs", {})
    result = completed(run["id"])
    replay = request(
        f"/api/v3/cases/{case['id']}/runs", {"mode": "replay", "parent_run_id": run["id"]}
    )
    replay_result = completed(replay["id"])
    assert result["run"]["metrics"] == replay_result["run"]["metrics"]
    assert result["run"]["snapshot_hash"] == replay_result["run"]["snapshot_hash"]
    assert len(result["bundle"]["observations"]) > 0
    STATE.write_text(
        json.dumps(
            {
                "case_id": case["id"],
                "run_id": run["id"],
                "snapshot_hash": result["run"]["snapshot_hash"],
                "metrics": result["run"]["metrics"],
            }
        )
    )
    print("Production proxy, PostgreSQL capture and deterministic replay verified")


if __name__ == "__main__":
    main()
