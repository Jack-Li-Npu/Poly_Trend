"""Optional standalone scheduler; identical research service and shared job leases."""

from __future__ import annotations

import asyncio

from .v3.providers import ResearchDataProvider
from .v3.service import ResearchService
from .v3.settings import V3Settings
from .v3.store import ResearchStore


async def refresh_due() -> None:
    config = V3Settings()
    store = ResearchStore(config.sqlite_path, config.database_url)
    await store.open()
    provider = ResearchDataProvider(config)
    service = ResearchService(store, provider, config)
    try:
        while True:
            await service.start()
            await service.refresh_due()
            await asyncio.sleep(30)
    finally:
        await service.close()
        if hasattr(provider, "close"):
            await provider.close()
        await store.close()


def main() -> None:
    asyncio.run(refresh_due())


if __name__ == "__main__":
    main()
