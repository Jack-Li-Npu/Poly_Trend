"""User-visible boundaries that unit arithmetic and provider mocks cannot cover."""

from __future__ import annotations

import asyncio
import time
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from polytrend.api import create_app
from polytrend.v3.models import ContextItem, ResearchCase, ResearchRun
from polytrend.v3.service import ResearchService
from polytrend.v3.settings import V3Settings
from polytrend.v3.store import ResearchStore

from .test_service import NOW, Provider, bundle_fixture, make_case, wait_run


def test_retired_numerical_paths_and_mutating_mcp_tool_cannot_execute(tmp_path) -> None:
    with TestClient(
        create_app(V3Settings(sqlite_path=tmp_path / "retired.db", database_url=None), Provider())
    ) as client:
        for prefix in ("/api/v1", "/v1"):
            assert (
                client.post(
                    f"{prefix}/investigations", json={"query": "Will markets rise?"}
                ).status_code
                == 410
            )
            assert (
                client.post(f"{prefix}/runs/old/fork", json={"included_market_ids": []}).status_code
                == 410
            )
            assert client.get(f"{prefix}/runs/old").status_code == 410
        advertised = client.post(
            "/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
        ).json()
        assert {tool["name"] for tool in advertised["result"]["tools"]} == {
            "search_events",
            "get_research_run",
        }
        retired = client.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "run_investigation",
                    "arguments": {"query": "Will markets rise?"},
                },
            },
        ).json()
        assert "error" in retired
        assert client.get("/api/v3/cases").json() == []


def test_impossible_joint_scenario_is_a_validation_error_not_server_failure(tmp_path) -> None:
    with TestClient(
        create_app(V3Settings(sqlite_path=tmp_path / "joint.db", database_url=None), Provider()),
        raise_server_exceptions=False,
    ) as client:
        response = client.post(
            "/api/v3/simulations",
            json={
                "assumptions": {
                    "probability": 0.7,
                    "second_event_probability": 0.6,
                    "joint_probability": 0.1,
                }
            },
        )
        assert response.status_code == 422
        assert "Frechet" in response.text


def test_user_cannot_claim_an_unsupported_historical_estimate(tmp_path) -> None:
    with TestClient(
        create_app(
            V3Settings(sqlite_path=tmp_path / "assumption-source.db", database_url=None), Provider()
        )
    ) as client:
        response = client.post(
            "/api/v3/simulations",
            json={"assumptions": {"assumption_source": "historical_estimate"}},
        )
        assert response.status_code == 422


def test_historical_replay_filters_numerical_and_context_claims_by_cutoff(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    path = tmp_path / "historical.db"
    cutoff = NOW - timedelta(days=2)

    async def seed() -> tuple[str, str]:
        store = ResearchStore(path)
        await store.open()
        bundle = bundle_fixture()
        bundle.event.observed_at = cutoff - timedelta(days=1)
        bundle.context = [
            ContextItem(
                title="FUTURE_OUTCOME_REVEALED",
                source_url="https://example.org/future",
                summary="This information arrived after the historical decision.",
                available_at=NOW,
                observation_ids=["quote-1"],
            )
        ]
        await store.put_event(bundle.event)
        case = ResearchCase(event_id=bundle.event.id, title=bundle.event.title)
        await store.put_case(case)
        key, digest = await store.put_bundle(bundle)
        parent = ResearchRun(
            case_id=case.id,
            status="completed",
            case_snapshot=case,
            bundle_id=key,
            snapshot_hash=digest,
        )
        await store.put_run(parent)
        await store.close()
        return case.id, parent.id

    case_id, parent_id = asyncio.run(seed())
    provider = Provider()
    provider.fail = True
    with TestClient(
        create_app(V3Settings(sqlite_path=path, database_url=None), provider)
    ) as client:
        created = client.post(
            f"/api/v3/cases/{case_id}/runs",
            json={"mode": "historical", "parent_run_id": parent_id, "as_of": cutoff.isoformat()},
        )
        assert created.status_code == 202
        detail = wait_run(client, created.json()["id"])
        assert detail["run"]["status"] == "completed", detail
        metrics = detail["run"]["metrics"]
        assert all(row["probability"] is None for row in metrics["expectation_changes"])
        assert metrics["provenance"]["available_observation_ids"] == []
        assert not any(
            claim["title"] == "FUTURE_OUTCOME_REVEALED" for claim in detail["run"]["claims"]
        )
        assert provider.calls == 0


def test_imported_history_is_pinned_with_its_source_observation(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with TestClient(
        create_app(V3Settings(sqlite_path=tmp_path / "import.db", database_url=None), Provider())
    ) as client:
        case = make_case(client)
        imported = client.post(
            "/api/v3/imports",
            json={
                "symbol": "SPY",
                "source_url": "https://example.org/import.csv",
                "adjustment": "raw",
                "csv": "timestamp,close\n2026-10-19T20:00:00Z,500\n2026-10-20T20:00:00Z,501\n",
            },
        )
        assert imported.status_code == 201
        created = client.post(f"/api/v3/cases/{case['id']}/runs", json={}).json()
        detail = wait_run(client, created["id"])
        assert detail["run"]["status"] == "completed", detail
        series = next(series for series in detail["bundle"]["assets"] if series["symbol"] == "SPY")
        pinned = {observation["id"] for observation in detail["bundle"]["observations"]}
        assert series["observation_ids"]
        assert set(series["observation_ids"]) <= pinned
        assert any(
            observation["origin"] == "imported" for observation in detail["bundle"]["observations"]
        )


class BlockingProvider(Provider):
    def __init__(self) -> None:
        super().__init__()
        self.block = True
        self.entered = False

    async def capture(self, event, assets, as_of=None):
        self.calls += 1
        self.entered = True
        if self.block:
            await asyncio.Event().wait()
        return bundle_fixture()


def test_cancel_persists_then_explicit_resume_uses_same_run(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    path = tmp_path / "cancel.db"
    provider = BlockingProvider()
    config = V3Settings(sqlite_path=path, database_url=None)
    with TestClient(create_app(config, provider)) as client:
        case = make_case(client)
        run = client.post(f"/api/v3/cases/{case['id']}/runs", json={}).json()
        for _ in range(100):
            if provider.entered:
                break
            time.sleep(0.01)
        assert provider.entered
        cancelled = client.post(f"/api/v3/runs/{run['id']}/cancel")
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "cancelled"
    with TestClient(create_app(config, Provider())) as client:
        assert client.get(f"/api/v3/runs/{run['id']}").json()["run"]["status"] == "cancelled"
        resumed = client.post(f"/api/v3/runs/{run['id']}/resume")
        assert resumed.status_code == 202
        assert resumed.json()["id"] == run["id"]
        assert wait_run(client, run["id"])["run"]["status"] == "completed"


def test_capture_failure_does_not_persist_or_stream_http_credentials(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    provider = Provider()
    with TestClient(
        create_app(V3Settings(sqlite_path=tmp_path / "secrets.db", database_url=None), provider)
    ) as client:
        case = make_case(client)
        provider.fail = True
        run = client.post(f"/api/v3/cases/{case['id']}/runs", json={}).json()
        detail = wait_run(client, run["id"])
        assert detail["run"]["status"] == "failed"
        assert "FAKE_SENTINEL" not in str(detail)
        assert "FAKE_SENTINEL" not in client.get(f"/api/v3/runs/{run['id']}/events").text
        assert "FAKE_SENTINEL" not in client.get(f"/api/v3/runs/{run['id']}/export").text
        assert detail["bundle"] is None


@pytest.mark.asyncio
async def test_cancellation_from_another_process_cannot_be_overwritten_by_worker(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    path = tmp_path / "cross-process-cancel.db"
    store = ResearchStore(path)
    await store.open()
    event = bundle_fixture().event
    await store.put_event(event)
    case = ResearchCase(event_id=event.id, title=event.title)
    await store.put_case(case)
    run = ResearchRun(case_id=case.id, case_snapshot=case)
    await store.put_run(run)

    class WaitingProvider:
        def __init__(self):
            self.started = asyncio.Event()
            self.release = asyncio.Event()

        async def capture(self, *_args, **_kwargs):
            self.started.set()
            await self.release.wait()
            return bundle_fixture()

    provider = WaitingProvider()
    config = V3Settings(sqlite_path=path, database_url=None)
    worker = ResearchService(store, provider, config)
    other_process = ResearchService(store, provider, config)
    task = asyncio.create_task(worker.execute(run.id))
    try:
        await asyncio.wait_for(provider.started.wait(), 2)
        assert (await other_process.cancel(run.id)).status == "cancelled"
        provider.release.set()
        await asyncio.wait_for(task, 5)
        assert (await store.get_run(run.id)).status == "cancelled"
    finally:
        provider.release.set()
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        await store.close()


@pytest.mark.asyncio
async def test_atomic_store_guard_survives_cancel_between_publish_check_and_write(tmp_path) -> None:
    store = ResearchStore(tmp_path / "atomic-cancel.db")
    await store.open()
    run = ResearchRun(case_id="case", status="running")
    await store.put_run(run)
    stale_completion = run.model_copy(deep=True)
    run.status = "cancelled"
    await store.put_run(run)
    # A remote worker may have checked cancellation immediately before the
    # other process wrote it. The storage write must still preserve cancellation.
    stale_completion.status = "completed"
    await store.put_run(stale_completion)
    assert (await store.get_run(run.id)).status == "cancelled"
    # Only an explicit queued transition may begin a resumed execution.
    run.status = "queued"
    await store.put_run(run)
    assert (await store.get_run(run.id)).status == "queued"
    await store.close()
