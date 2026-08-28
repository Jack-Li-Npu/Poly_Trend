from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from .config import settings
from .graph import ResearchEngine
from .model_router import ModelRouter
from .models import ResearchRun, RunEvent
from .providers import PolymarketProvider
from .retrieval import HybridRetriever
from .store import create_store


async def refresh_due() -> None:
    store = await create_store(settings.sqlite_path, settings.database_url)
    engine = ResearchEngine(HybridRetriever(PolymarketProvider(settings)), ModelRouter(settings))
    try:
        while True:
            now = datetime.now(timezone.utc)
            for investigation in await store.list_investigations():
                if investigation.next_refresh_at and investigation.next_refresh_at <= now and not investigation.archived:
                    run = ResearchRun(investigation_id=investigation.id, query=investigation.query, deep_mode=investigation.deep_mode)
                    await store.put_run(run)
                    await engine.execute(run, lambda _event: store.put_run(run))
                    await store.put_run(run)
                    investigation.latest_run_id = run.id
                    investigation.run_ids.append(run.id)
                    investigation.next_refresh_at += timedelta(days=1)
                    await store.put_investigation(investigation)
            await asyncio.sleep(30)
    finally:
        await store.close()


def main() -> None:
    asyncio.run(refresh_due())
