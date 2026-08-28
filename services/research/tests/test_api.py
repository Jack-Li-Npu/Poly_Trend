from __future__ import annotations

import time

from fastapi.testclient import TestClient

from polytrend.api import app


def test_investigation_lifecycle() -> None:
    with TestClient(app) as client:
        created = client.post("/api/v1/investigations", json={"query": "Will the U.S. enter a recession before the end of 2027?"})
        assert created.status_code == 201
        investigation = created.json()
        queued = client.post(f"/api/v1/investigations/{investigation['id']}/runs", json={})
        assert queued.status_code == 202
        run_id = queued.json()["id"]
        for _ in range(60):
            run = client.get(f"/api/v1/runs/{run_id}").json()
            if run["status"] in {"completed", "failed"}:
                break
            time.sleep(0.05)
        assert run["status"] == "completed", run.get("error")
        assert run["answer"]["probability"] is not None
        assert run["relationships"]
        assert len(run["events"]) == 8


def test_health_and_mcp_tools() -> None:
    with TestClient(app) as client:
        assert client.get("/healthz").status_code == 200
        tools = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).json()
        assert {item["name"] for item in tools["result"]["tools"]} == {
            "search_markets", "get_market", "run_investigation", "get_investigation"
        }
