"""Relational persistence for immutable evidence and recoverable research jobs."""

from __future__ import annotations

import asyncio
import hashlib
import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .models import (
    AssetSeries,
    EventDefinition,
    EvidenceBundle,
    Observation,
    ResearchCase,
    ResearchRun,
)

SCHEMA = (
    "CREATE TABLE IF NOT EXISTS v3_events (id TEXT PRIMARY KEY, origin TEXT NOT NULL, payload TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS v3_cases (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, archived INTEGER NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS v3_case_revisions (case_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(case_id,revision))",
    "CREATE TABLE IF NOT EXISTS v3_observations (id TEXT PRIMARY KEY, provider TEXT NOT NULL, kind TEXT NOT NULL, external_id TEXT NOT NULL, observed_at TEXT NOT NULL, available_at TEXT NOT NULL, content_hash TEXT NOT NULL, payload TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS v3_obs_series ON v3_observations(provider,kind,external_id,observed_at)",
    "CREATE INDEX IF NOT EXISTS v3_obs_availability ON v3_observations(available_at)",
    "CREATE TABLE IF NOT EXISTS v3_bundles (id TEXT PRIMARY KEY, content_hash TEXT NOT NULL, payload TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS v3_runs (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS v3_runs_case ON v3_runs(case_id,updated_at)",
    "CREATE TABLE IF NOT EXISTS v3_progress (run_id TEXT NOT NULL, sequence INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,sequence))",
    "CREATE TABLE IF NOT EXISTS v3_leases (resource TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS v3_imports (symbol TEXT PRIMARY KEY, payload TEXT NOT NULL)",
)


class ResearchStore:
    def __init__(self, path: Path, database_url: str | None = None):
        self.path, self.database_url = path, database_url
        self._sqlite: sqlite3.Connection | None = None
        self._pool: Any = None
        self._lock = asyncio.Lock()

    async def open(self) -> None:
        if self.database_url:
            from psycopg_pool import AsyncConnectionPool

            self._pool = AsyncConnectionPool(
                self.database_url.replace("postgresql+asyncpg://", "postgresql://"),
                min_size=1,
                max_size=5,
                open=False,
            )
            await self._pool.open(wait=True, timeout=15)
        else:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._sqlite = sqlite3.connect(self.path, check_same_thread=False)
            self._sqlite.execute("PRAGMA journal_mode=WAL")
            self._sqlite.execute("PRAGMA busy_timeout=5000")
        for statement in SCHEMA:
            await self._query(statement)

    async def _query(self, sql: str, values: tuple = (), fetch: bool = False) -> list[tuple]:
        async with self._lock:
            if self._pool:
                async with self._pool.connection() as connection:
                    cursor = await connection.execute(sql.replace("?", "%s"), values)
                    return await cursor.fetchall() if fetch else []
            if self._sqlite is None:
                raise RuntimeError("research store is not open")
            cursor = self._sqlite.execute(sql, values)
            rows = cursor.fetchall() if fetch else []
            self._sqlite.commit()
            return rows

    async def put_event(self, event: EventDefinition) -> None:
        # Mode is part of the key: recorded examples must never replace live metadata.
        key = f"{event.origin}:{event.id}"
        await self._query(
            "INSERT INTO v3_events(id,origin,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
            (key, event.origin, event.model_dump_json()),
        )

    async def get_event(self, event_id: str, mode: str = "live") -> EventDefinition | None:
        rows = await self._query(
            "SELECT payload FROM v3_events WHERE id=?", (f"{mode}:{event_id}",), True
        )
        return EventDefinition.model_validate_json(rows[0][0]) if rows else None

    async def list_events(self, mode: str) -> list[EventDefinition]:
        rows = await self._query(
            "SELECT payload FROM v3_events WHERE origin=? ORDER BY id", (mode,), True
        )
        return [EventDefinition.model_validate_json(row[0]) for row in rows]

    async def put_case(self, case: ResearchCase) -> None:
        await self._query(
            "INSERT INTO v3_cases(id,event_id,archived,updated_at,payload) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET archived=excluded.archived,updated_at=excluded.updated_at,payload=excluded.payload",
            (
                case.id,
                case.event_id,
                int(case.archived),
                case.updated_at.isoformat(),
                case.model_dump_json(),
            ),
        )
        await self._query(
            "INSERT INTO v3_case_revisions(case_id,revision,payload) VALUES(?,?,?) ON CONFLICT(case_id,revision) DO NOTHING",
            (case.id, case.revision, case.model_dump_json()),
        )

    async def get_case(self, case_id: str) -> ResearchCase | None:
        rows = await self._query("SELECT payload FROM v3_cases WHERE id=?", (case_id,), True)
        return ResearchCase.model_validate_json(rows[0][0]) if rows else None

    async def list_cases(self) -> list[ResearchCase]:
        rows = await self._query(
            "SELECT payload FROM v3_cases WHERE archived=0 ORDER BY updated_at DESC", fetch=True
        )
        return [ResearchCase.model_validate_json(row[0]) for row in rows]

    async def revisions(self, case_id: str) -> list[dict]:
        rows = await self._query(
            "SELECT payload FROM v3_case_revisions WHERE case_id=? ORDER BY revision",
            (case_id,),
            True,
        )
        return [json.loads(row[0]) for row in rows]

    async def put_observation(self, observation: Observation) -> None:
        existing = await self._query(
            "SELECT payload FROM v3_observations WHERE id=?", (observation.id,), True
        )
        if existing and existing[0][0] != observation.model_dump_json():
            raise ValueError("immutable observation cannot be overwritten")
        await self._query(
            "INSERT INTO v3_observations(id,provider,kind,external_id,observed_at,available_at,content_hash,payload) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
            (
                observation.id,
                observation.provider,
                observation.kind,
                observation.external_id,
                observation.observed_at.isoformat(),
                observation.available_at.isoformat(),
                observation.content_hash,
                observation.model_dump_json(),
            ),
        )

    async def observations(self, external_id: str | None = None) -> list[Observation]:
        if external_id:
            rows = await self._query(
                "SELECT payload FROM v3_observations WHERE external_id=? ORDER BY observed_at",
                (external_id,),
                True,
            )
        else:
            rows = await self._query(
                "SELECT payload FROM v3_observations ORDER BY observed_at DESC LIMIT 1000",
                fetch=True,
            )
        return [Observation.model_validate_json(row[0]) for row in rows]

    async def get_observation(self, observation_id: str) -> Observation | None:
        rows = await self._query(
            "SELECT payload FROM v3_observations WHERE id=?", (observation_id,), True
        )
        return Observation.model_validate_json(rows[0][0]) if rows else None

    async def put_bundle(self, bundle: EvidenceBundle) -> tuple[str, str]:
        payload = bundle.model_dump_json()
        digest = hashlib.sha256(payload.encode()).hexdigest()
        for observation in bundle.observations:
            await self.put_observation(observation)
        await self._query(
            "INSERT INTO v3_bundles(id,content_hash,payload) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING",
            (digest, digest, payload),
        )
        return digest, digest

    async def get_bundle(self, bundle_id: str) -> EvidenceBundle | None:
        rows = await self._query(
            "SELECT payload,content_hash FROM v3_bundles WHERE id=?", (bundle_id,), True
        )
        if not rows:
            return None
        if hashlib.sha256(rows[0][0].encode()).hexdigest() != rows[0][1]:
            raise ValueError("evidence bundle hash mismatch")
        return EvidenceBundle.model_validate_json(rows[0][0])

    async def put_run(self, run: ResearchRun) -> None:
        await self._query(
            "INSERT INTO v3_runs(id,case_id,status,updated_at,payload) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,payload=excluded.payload WHERE v3_runs.status!='completed' AND (v3_runs.status!='cancelled' OR excluded.status IN ('cancelled','queued'))",
            (run.id, run.case_id, run.status, run.updated_at.isoformat(), run.model_dump_json()),
        )
        persisted = await self.get_run(run.id)
        if persisted and persisted.model_dump_json() != run.model_dump_json():
            return
        for event in run.progress:
            await self._query(
                "INSERT INTO v3_progress(run_id,sequence,payload) VALUES(?,?,?) ON CONFLICT(run_id,sequence) DO NOTHING",
                (run.id, event.sequence, event.model_dump_json()),
            )

    async def get_run(self, run_id: str) -> ResearchRun | None:
        rows = await self._query("SELECT payload FROM v3_runs WHERE id=?", (run_id,), True)
        return ResearchRun.model_validate_json(rows[0][0]) if rows else None

    async def list_runs(self, case_id: str | None = None) -> list[ResearchRun]:
        if case_id:
            rows = await self._query(
                "SELECT payload FROM v3_runs WHERE case_id=? ORDER BY updated_at DESC",
                (case_id,),
                True,
            )
        else:
            rows = await self._query(
                "SELECT payload FROM v3_runs ORDER BY updated_at DESC", fetch=True
            )
        return [ResearchRun.model_validate_json(row[0]) for row in rows]

    async def lease(self, resource: str, owner: str, seconds: int = 360) -> bool:
        now = datetime.now(UTC)
        expires = (now + timedelta(seconds=seconds)).isoformat()
        await self._query(
            "INSERT INTO v3_leases(resource,owner,expires_at) VALUES(?,?,?) ON CONFLICT(resource) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE v3_leases.expires_at<? OR v3_leases.owner=?",
            (resource, owner, expires, now.isoformat(), owner),
        )
        rows = await self._query("SELECT owner FROM v3_leases WHERE resource=?", (resource,), True)
        return bool(rows and rows[0][0] == owner)

    async def release(self, resource: str, owner: str) -> None:
        await self._query("DELETE FROM v3_leases WHERE resource=? AND owner=?", (resource, owner))

    async def put_import(self, series: AssetSeries) -> None:
        await self._query(
            "INSERT INTO v3_imports(symbol,payload) VALUES(?,?) ON CONFLICT(symbol) DO UPDATE SET payload=excluded.payload",
            (series.symbol, series.model_dump_json()),
        )

    async def get_import(self, symbol: str) -> AssetSeries | None:
        rows = await self._query("SELECT payload FROM v3_imports WHERE symbol=?", (symbol,), True)
        return AssetSeries.model_validate_json(rows[0][0]) if rows else None

    async def health(self) -> dict:
        rows = await self._query("SELECT COUNT(*) FROM v3_observations", fetch=True)
        return {
            "status": "ok",
            "driver": "postgresql" if self._pool else "sqlite-wal",
            "observations": rows[0][0],
        }

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()
        if self._sqlite:
            self._sqlite.close()
