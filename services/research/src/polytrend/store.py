from __future__ import annotations

import asyncio
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .models import Investigation, ResearchRun


class ArtifactStore:
    """Small durable store used locally and by the no-infrastructure demo path.

    The production compose stack also provisions Postgres/pgvector. Keeping this
    repository-level adapter deliberately narrow makes a Postgres implementation a
    deployment choice rather than a condition for using the product.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(path, check_same_thread=False)
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS artifacts (
                kind TEXT NOT NULL,
                id TEXT NOT NULL,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (kind, id)
            )
            """
        )
        self._connection.commit()
        self._lock = asyncio.Lock()

    async def _put(self, kind: str, artifact_id: str, payload: str) -> None:
        async with self._lock:
            self._connection.execute(
                """INSERT INTO artifacts(kind, id, payload, updated_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(kind, id) DO UPDATE SET
                     payload=excluded.payload, updated_at=excluded.updated_at""",
                (kind, artifact_id, payload, datetime.now(timezone.utc).isoformat()),
            )
            self._connection.commit()

    async def _get(self, kind: str, artifact_id: str) -> str | None:
        async with self._lock:
            row = self._connection.execute(
                "SELECT payload FROM artifacts WHERE kind=? AND id=?", (kind, artifact_id)
            ).fetchone()
        return row[0] if row else None

    async def put_investigation(self, value: Investigation) -> None:
        await self._put("investigation", value.id, value.model_dump_json())

    async def get_investigation(self, artifact_id: str) -> Investigation | None:
        payload = await self._get("investigation", artifact_id)
        return Investigation.model_validate_json(payload) if payload else None

    async def put_run(self, value: ResearchRun) -> None:
        await self._put("run", value.id, value.model_dump_json())

    async def get_run(self, artifact_id: str) -> ResearchRun | None:
        payload = await self._get("run", artifact_id)
        return ResearchRun.model_validate_json(payload) if payload else None

    async def list_investigations(self) -> list[Investigation]:
        async with self._lock:
            rows = self._connection.execute(
                "SELECT payload FROM artifacts WHERE kind='investigation' ORDER BY updated_at DESC"
            ).fetchall()
        return [Investigation.model_validate_json(row[0]) for row in rows]

    async def list_runs(self) -> list[ResearchRun]:
        async with self._lock:
            rows = self._connection.execute(
                "SELECT payload FROM artifacts WHERE kind='run' ORDER BY updated_at DESC"
            ).fetchall()
        return [ResearchRun.model_validate_json(row[0]) for row in rows]

    async def health(self) -> dict[str, str | int]:
        async with self._lock:
            count = self._connection.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0]
        return {"status": "ok", "driver": "sqlite-wal", "artifacts": count, "path": str(self.path)}

    async def close(self) -> None:
        async with self._lock:
            self._connection.close()


class PostgresArtifactStore:
    """Postgres/pgvector implementation selected automatically in Compose."""

    def __init__(self, database_url: str) -> None:
        from psycopg_pool import AsyncConnectionPool

        connection_url = database_url.replace("postgresql+asyncpg://", "postgresql://")
        self._pool = AsyncConnectionPool(connection_url, min_size=1, max_size=8, open=False)

    async def open(self) -> None:
        await self._pool.open()
        async with self._pool.connection() as connection:
            await connection.execute(
                """
                CREATE TABLE IF NOT EXISTS artifacts (
                    kind TEXT NOT NULL,
                    id TEXT NOT NULL,
                    payload JSONB NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (kind, id)
                )
                """
            )

    async def _put(self, kind: str, artifact_id: str, payload: str) -> None:
        async with self._pool.connection() as connection:
            await connection.execute(
                """INSERT INTO artifacts(kind, id, payload, updated_at)
                   VALUES (%s, %s, %s::jsonb, NOW())
                   ON CONFLICT(kind, id) DO UPDATE SET
                     payload=excluded.payload, updated_at=excluded.updated_at""",
                (kind, artifact_id, payload),
            )

    async def _get(self, kind: str, artifact_id: str) -> str | None:
        async with self._pool.connection() as connection:
            cursor = await connection.execute(
                "SELECT payload::text FROM artifacts WHERE kind=%s AND id=%s", (kind, artifact_id)
            )
            row = await cursor.fetchone()
        return row[0] if row else None

    async def put_investigation(self, value: Investigation) -> None:
        await self._put("investigation", value.id, value.model_dump_json())

    async def get_investigation(self, artifact_id: str) -> Investigation | None:
        payload = await self._get("investigation", artifact_id)
        return Investigation.model_validate_json(payload) if payload else None

    async def put_run(self, value: ResearchRun) -> None:
        await self._put("run", value.id, value.model_dump_json())

    async def get_run(self, artifact_id: str) -> ResearchRun | None:
        payload = await self._get("run", artifact_id)
        return ResearchRun.model_validate_json(payload) if payload else None

    async def _list(self, kind: str) -> list[str]:
        async with self._pool.connection() as connection:
            cursor = await connection.execute(
                "SELECT payload::text FROM artifacts WHERE kind=%s ORDER BY updated_at DESC", (kind,)
            )
            rows = await cursor.fetchall()
        return [row[0] for row in rows]

    async def list_investigations(self) -> list[Investigation]:
        return [Investigation.model_validate_json(item) for item in await self._list("investigation")]

    async def list_runs(self) -> list[ResearchRun]:
        return [ResearchRun.model_validate_json(item) for item in await self._list("run")]

    async def health(self) -> dict[str, str | int]:
        async with self._pool.connection() as connection:
            cursor = await connection.execute("SELECT COUNT(*) FROM artifacts")
            count = (await cursor.fetchone())[0]
        return {"status": "ok", "driver": "postgresql-pgvector", "artifacts": count}

    async def close(self) -> None:
        await self._pool.close()


async def create_store(sqlite_path: Path, database_url: str | None = None) -> ArtifactStore | PostgresArtifactStore:
    if database_url:
        try:
            store = PostgresArtifactStore(database_url)
            await store.open()
            return store
        except (ImportError, OSError):
            # Local use remains available if optional infrastructure packages are absent.
            pass
    return ArtifactStore(sqlite_path)
