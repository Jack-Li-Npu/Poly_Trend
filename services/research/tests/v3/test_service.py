from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from polytrend.api import create_app
from polytrend.v3.models import (
    Contract,
    EventDefinition,
    EvidenceBundle,
    MarketSnapshot,
    Observation,
    ResearchCase,
    ResearchRun,
    SeriesPoint,
)
from polytrend.v3.settings import V3Settings
from polytrend.v3.store import ResearchStore

NOW = datetime(2026, 10, 22, 12, tzinfo=UTC)


def bundle_fixture():
    observation = Observation(
        id="quote-1",
        provider="recorded_public_test",
        kind="book",
        external_id="123",
        source_url="https://example.org/book",
        observed_at=NOW,
        available_at=NOW,
        retrieved_at=NOW,
        origin="synthetic",
        payload={"bid": 0.29, "ask": 0.31},
    )
    event = EventDefinition(
        id="event-1",
        title="Will the policy rate fall by December?",
        slug="policy-rate",
        category="monetary_policy",
        source_url="https://example.org/event",
        observed_at=NOW,
        origin="live",
        contracts=[
            Contract(
                id="market-1",
                event_id="event-1",
                condition_id="0xcondition",
                question="Will the policy rate fall by December?",
                token_ids=["123", "456"],
                outcomes=["Yes", "No"],
                prices=[0.3, 0.7],
            )
        ],
    )
    history = [
        SeriesPoint(
            timestamp=NOW - timedelta(days=day),
            value=0.3 - day * 0.001,
            available_at=NOW - timedelta(days=day),
        )
        for day in range(39, -1, -1)
    ]
    market = MarketSnapshot(
        market_id="market-1",
        condition_id="0xcondition",
        token_id="123",
        probability=0.3,
        bid=0.29,
        ask=0.31,
        quote_type="midpoint",
        as_of=NOW,
        history=history,
        observation_ids=["quote-1"],
        bid_depth_usd=200,
        ask_depth_usd=220,
    )
    return EvidenceBundle(
        event=event, observations=[observation], markets=[market], captured_at=NOW
    )


class Provider:
    def __init__(self):
        self.calls = 0
        self.fail = False

    async def discover(self, **kwargs):
        if self.fail:
            raise RuntimeError("https://example.org/?apikey=FAKE_SENTINEL")
        return [bundle_fixture().event]

    async def get_event(self, event_id):
        return bundle_fixture().event

    async def capture(self, event, assets, as_of=None):
        self.calls += 1
        if self.fail:
            raise RuntimeError("https://example.org/?apikey=FAKE_SENTINEL")
        return bundle_fixture()

    def health(self):
        return {"status": "test"}


def wait_run(client, run_id):
    for _ in range(200):
        value = client.get(f"/api/v3/runs/{run_id}").json()
        if value["run"]["status"] in {"completed", "failed", "cancelled"}:
            return value
        time.sleep(0.02)
    raise AssertionError("run did not reach a terminal state")


def make_case(client):
    assert client.get("/api/v3/events").status_code == 200
    result = client.post(
        "/api/v3/cases",
        json={
            "event_id": "event-1",
            "thesis": "Lower discount rates may support duration.",
            "assets": ["SPY", "BTC-USD"],
        },
    )
    assert result.status_code == 201, result.text
    return result.json()


def test_case_lifecycle_replay_sse_and_persistence(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    config = V3Settings(
        sqlite_path=tmp_path / "research.db", database_url=None, live_market_data=True
    )
    provider = Provider()
    with TestClient(create_app(config, provider)) as client:
        case = make_case(client)
        created = client.post(f"/api/v3/cases/{case['id']}/runs", json={}).json()
        first = wait_run(client, created["id"])
        assert first["run"]["status"] == "completed", first
        assert first["run"]["claims"]
        assert first["run"]["snapshot_hash"]
        assert first["run"]["metrics"]["expectation_changes"][0]["probability"] == 0.3
        updated = client.patch(
            f"/api/v3/cases/{case['id']}",
            json={"thesis": "Updated thesis", "refresh_enabled": True},
        ).json()
        assert updated["revision"] == 2
        assert len(client.get(f"/api/v3/cases/{case['id']}/revisions").json()) == 2
        # Replay must work even when provider capture would now fail.
        provider.fail = True
        replay = client.post(
            f"/api/v3/cases/{case['id']}/runs",
            json={"mode": "replay", "parent_run_id": created["id"]},
        ).json()
        second = wait_run(client, replay["id"])
        assert second["run"]["status"] == "completed", second
        assert second["run"]["metrics"] == first["run"]["metrics"]
        assert second["run"]["snapshot_hash"] == first["run"]["snapshot_hash"]
        assert second["run"]["case_snapshot"]["thesis"] == first["run"]["case_snapshot"]["thesis"]
        assert provider.calls == 1
        stream = client.get(f"/api/v3/runs/{replay['id']}/events", headers={"Last-Event-ID": "2"})
        assert "id: 1\n" not in stream.text
        assert "event: complete" in stream.text
        assert client.get(f"/api/v3/runs/{replay['id']}/export?format=markdown").status_code == 200
    with TestClient(create_app(config, Provider())) as client:
        cases = client.get("/api/v3/cases").json()
        assert len(cases) == 1
        assert cases[0]["thesis"] == "Updated thesis"
        assert client.get(f"/api/v3/runs/{created['id']}").json()["run"]["status"] == "completed"


def test_live_failure_never_returns_seed_or_secrets(tmp_path):
    provider = Provider()
    provider.fail = True
    with TestClient(
        create_app(V3Settings(sqlite_path=tmp_path / "failure.db", database_url=None), provider)
    ) as client:
        response = client.get("/api/v3/events")
        assert response.status_code == 503
        assert "SENTINEL" not in response.text
        assert "recession-2027" not in response.text
        assert (
            client.post("/api/v1/investigations", json={"query": "not recession"}).status_code
            == 410
        )
        assert client.get("/api/v3/runs/missing/events").status_code == 404


@pytest.mark.asyncio
async def test_observations_are_immutable_and_hash_checked(tmp_path):
    store = ResearchStore(tmp_path / "immutable.db")
    await store.open()
    original = bundle_fixture().observations[0]
    await store.put_observation(original)
    different = original.model_copy(deep=True)
    different.payload = {"bid": 0.99}
    with pytest.raises(ValueError):
        await store.put_observation(different)
    with pytest.raises(ValueError):
        Observation.model_validate(different.model_dump())
    await store.close()


def test_startup_recovers_a_persisted_running_run(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    path = tmp_path / "recover.db"

    async def seed():
        store = ResearchStore(path)
        await store.open()
        bundle = bundle_fixture()
        await store.put_event(bundle.event)
        case = ResearchCase(event_id="event-1", title=bundle.event.title)
        await store.put_case(case)
        bundle_id, digest = await store.put_bundle(bundle)
        run = ResearchRun(
            case_id=case.id,
            status="running",
            case_snapshot=case,
            bundle_id=bundle_id,
            snapshot_hash=digest,
        )
        await store.put_run(run)
        await store.close()
        return run.id

    run_id = asyncio.run(seed())
    provider = Provider()
    provider.fail = True
    with TestClient(
        create_app(V3Settings(sqlite_path=path, database_url=None), provider)
    ) as client:
        detail = wait_run(client, run_id)
        assert detail["run"]["status"] == "completed", detail
        assert provider.calls == 0


def test_scenarios_and_import_validation(tmp_path):
    with TestClient(
        create_app(
            V3Settings(sqlite_path=tmp_path / "simulation.db", database_url=None), Provider()
        )
    ) as client:
        result = client.post(
            "/api/v3/simulations",
            json={
                "assumptions": {
                    "probability": 0.7,
                    "event_return": 0.05,
                    "non_event_return": -0.2,
                    "round_trip_cost_bps": 20,
                }
            },
        )
        assert result.status_code == 200
        assert result.json()["expected_return"] == pytest.approx(-0.027)
        assert result.json()["break_even_probability"] == pytest.approx(0.808)
        invalid = client.post(
            "/api/v3/imports",
            json={
                "symbol": "SPY",
                "source_url": "https://example.org/data",
                "adjustment": "raw",
                "csv": "date,close\n2026-10-20,0\n",
            },
        )
        assert invalid.status_code == 422
        imported = client.post(
            "/api/v3/imports",
            json={
                "symbol": "SPY",
                "source_url": "https://example.org/data",
                "adjustment": "raw",
                "csv": "date,close\n2026-10-20,500\n2026-10-21,501\n",
            },
        )
        assert imported.status_code == 201, imported.text
        assert imported.json()["issues"]
        assert client.get("/api/v3/observations").json()[0]["origin"] == "imported"


def test_replay_preserves_historical_cutoff_and_scenario_inputs(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    config = V3Settings(sqlite_path=tmp_path / "pinning.db", database_url=None)
    with TestClient(create_app(config, Provider())) as client:
        case = make_case(client)
        original = client.post(f"/api/v3/cases/{case['id']}/runs", json={}).json()
        wait_run(client, original["id"])
        historical = client.post(
            f"/api/v3/cases/{case['id']}/runs",
            json={
                "mode": "historical",
                "parent_run_id": original["id"],
                "as_of": (NOW - timedelta(days=2)).isoformat(),
            },
        ).json()
        historical_result = wait_run(client, historical["id"])
        replay = client.post(
            f"/api/v3/cases/{case['id']}/runs",
            json={
                "mode": "replay",
                "parent_run_id": historical["id"],
            },
        ).json()
        replay_result = wait_run(client, replay["id"])
        assert replay_result["run"]["metrics"] == historical_result["run"]["metrics"]
        assert replay_result["run"]["as_of"] == historical_result["run"]["as_of"]
        scenario = client.post(
            f"/api/v3/cases/{case['id']}/runs",
            json={
                "mode": "scenario",
                "parent_run_id": original["id"],
                "scenario": {"probability": 0.7, "event_return": 0.05, "non_event_return": -0.2},
            },
        ).json()
        scenario_result = wait_run(client, scenario["id"])
        replay = client.post(
            f"/api/v3/cases/{case['id']}/runs",
            json={
                "mode": "replay",
                "parent_run_id": scenario["id"],
            },
        ).json()
        assert wait_run(client, replay["id"])["run"]["metrics"] == scenario_result["run"]["metrics"]
        invalid = client.post(
            f"/api/v3/cases/{case['id']}/runs",
            json={
                "mode": "replay",
                "parent_run_id": original["id"],
                "as_of": NOW.isoformat(),
            },
        )
        assert invalid.status_code == 422


@pytest.mark.asyncio
async def test_immediate_cancel_before_scheduled_task_starts(tmp_path):
    from polytrend.v3.models import RunCreate
    from polytrend.v3.service import ResearchService

    store = ResearchStore(tmp_path / "immediate.db")
    await store.open()
    provider = Provider()
    service = ResearchService(store, provider, V3Settings(database_url=None))
    event = bundle_fixture().event
    await store.put_event(event)
    case = ResearchCase(event_id=event.id, title=event.title)
    await store.put_case(case)
    run = await service.create_run(case, RunCreate())
    stopped = await service.cancel(run.id)
    assert stopped.status == "cancelled"
    assert (await store.get_run(run.id)).status == "cancelled"
    assert provider.calls == 0
    await service.close()
    await store.close()


def test_historical_presentation_excludes_future_data_but_keeps_auditable_inputs(tmp_path):
    config = V3Settings(sqlite_path=tmp_path / "presentation.db", database_url=None)
    with TestClient(create_app(config, Provider())) as client:
        case = make_case(client)
        parent = client.post(f"/api/v3/cases/{case['id']}/runs", json={}).json()
        wait_run(client, parent["id"])
        cutoff = (NOW - timedelta(days=2)).isoformat()
        created = client.post(
            f"/api/v3/cases/{case['id']}/runs",
            json={
                "mode": "historical",
                "parent_run_id": parent["id"],
                "as_of": cutoff,
            },
        ).json()
        result = wait_run(client, created["id"])
        assert result["run"]["status"] == "completed"
        assert result["bundle"]["markets"][0]["probability"] == 0.3
        display = result["presentation"]
        assert display["markets"][0]["probability"] is None
        assert display["markets"][0]["bid"] is None
        assert not display["markets"][0]["history"]
        assert not display["observations"]
        assert not display["event"]["contracts"][0]["prices"]
        assert all(not asset["points"] for asset in display["assets"])
        # Export still pins original source data, with the display view separate.
        exported = client.get(f"/api/v3/runs/{created['id']}/export").json()
        assert exported["bundle"]["markets"][0]["probability"] == 0.3


def test_import_attribution_does_not_persist_url_credentials():
    from polytrend.v3.models import ImportRequest
    from polytrend.v3.service import import_series

    series, observation = import_series(
        ImportRequest(
            symbol="SPY",
            csv="date,close\n2026-10-01,100",
            adjustment="raw",
            source_url="https://user:secret@example.org/export?apikey=FAKE_IMPORT_KEY&symbol=SPY",
        )
    )
    serialized = series.model_dump_json() + observation.model_dump_json()
    assert "secret" not in serialized
    assert "FAKE_IMPORT_KEY" not in serialized
    assert "symbol=SPY" in series.source_url
