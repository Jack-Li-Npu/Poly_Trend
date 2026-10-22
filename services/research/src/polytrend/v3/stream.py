"""Optional, bounded public CLOB journal with explicit reconnect gaps.

The journal records observations, not trades or automated investment actions.
REST reconciliation seeds each connection; no replay guarantee is invented.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Any

from .models import EventDefinition, Observation, utc_now
from .providers import ProviderError, ResearchDataProvider, timestamp

ObservationCallback = Callable[[Observation], Awaitable[None]]


class MarketStreamCollector:
    def __init__(
        self,
        provider: ResearchDataProvider,
        callback: ObservationCallback | None = None,
        *,
        url: str = "wss://ws-subscriptions-clob.polymarket.com/ws/market",
        max_contracts: int = 20,
        connector: Any = None,
    ) -> None:
        self.provider, self.callback, self.url = provider, callback, url
        self.max_contracts = min(20, max(1, max_contracts))
        self.connector = connector

    def token_ids(self, events: list[EventDefinition]) -> list[str]:
        contracts = [contract for event in events for contract in event.contracts][
            : self.max_contracts
        ]
        return list(
            dict.fromkeys(
                token for contract in contracts for token in contract.token_ids if token.isdigit()
            )
        )

    async def collect(
        self,
        events: list[EventDefinition] | EventDefinition,
        callback: ObservationCallback | None = None,
        *,
        stop_event: asyncio.Event | None = None,
        max_messages: int | None = None,
    ) -> None:
        emit = callback or self.callback
        if emit is None:
            raise ValueError("an observation callback is required")
        events = [events] if isinstance(events, EventDefinition) else events
        assets = self.token_ids(events)
        if not assets:
            return
        stop = stop_event or asyncio.Event()
        connector = self.connector
        if connector is None:
            from websockets.asyncio.client import connect

            connector = connect
        attempts, received = 0, 0
        while not stop.is_set():
            heartbeat = None
            try:
                async with connector(
                    self.url, ping_interval=None, max_size=1_048_576, close_timeout=3
                ) as socket:
                    await socket.send(
                        json.dumps(
                            {"type": "market", "assets_ids": assets, "custom_feature_enabled": True}
                        )
                    )
                    # Always reconcile, including the first connection. REST reads are
                    # tagged separately from deltas and cannot hide a disconnect.
                    for token in assets:
                        try:
                            book = await self.provider._get(
                                "clob", f"{self.provider.config.clob_url}/book", {"token_id": token}
                            )
                            await emit(
                                self.provider.observation(
                                    "clob",
                                    "stream_reconcile",
                                    token,
                                    f"{self.provider.config.clob_url}/book?token_id={token}",
                                    {
                                        "book": book,
                                        "reason": "reconnect" if attempts else "initial_connection",
                                    },
                                    observed_at=timestamp(book.get("timestamp"), utc_now()),
                                )
                            )
                        except ProviderError as exc:
                            await emit(
                                self.provider.observation(
                                    "clob",
                                    "stream_gap",
                                    token,
                                    self.url,
                                    {
                                        "reason": "reconciliation_failed",
                                        "error": str(exc),
                                        "complete": False,
                                    },
                                )
                            )

                    async def ping() -> None:
                        while True:
                            await asyncio.sleep(10)
                            await socket.send("PING")

                    heartbeat = asyncio.create_task(ping())
                    while not stop.is_set():
                        try:
                            frame = await asyncio.wait_for(socket.recv(), timeout=1)
                        except TimeoutError:
                            if heartbeat.done():
                                heartbeat.result()
                            continue
                        if frame in {"PONG", "PING"}:
                            if frame == "PING":
                                await socket.send("PONG")
                            continue
                        try:
                            payload = json.loads(frame)
                        except (TypeError, ValueError):
                            await emit(
                                self.provider.observation(
                                    "clob",
                                    "stream_gap",
                                    "market",
                                    self.url,
                                    {"reason": "malformed_frame", "complete": False},
                                )
                            )
                            continue
                        for row in payload if isinstance(payload, list) else [payload]:
                            if not isinstance(row, dict):
                                continue
                            observed = timestamp(row.get("timestamp"), utc_now())
                            await emit(
                                self.provider.observation(
                                    "clob",
                                    f"stream_{row.get('event_type', 'unknown')}",
                                    str(row.get("asset_id") or row.get("market") or "market"),
                                    self.url,
                                    row,
                                    observed_at=observed,
                                )
                            )
                            received += 1
                            if max_messages is not None and received >= max_messages:
                                return
            except asyncio.CancelledError:
                raise
            except Exception:
                # Exception text may contain a signed proxy URL or credential.
                attempts += 1
                await emit(
                    self.provider.observation(
                        "clob",
                        "stream_gap",
                        "market",
                        self.url,
                        {
                            "reason": "connection_interrupted",
                            "reconnect_attempt": attempts,
                            "complete": False,
                            "message": "Reconnect requires REST reconciliation; missing "
                            "deltas are not reconstructed.",
                        },
                    )
                )
                if not stop.is_set():
                    with suppress(TimeoutError):
                        await asyncio.wait_for(
                            stop.wait(), timeout=min(30, 0.25 * (2 ** min(attempts, 7)))
                        )
            finally:
                if heartbeat is not None:
                    heartbeat.cancel()
                    with suppress(asyncio.CancelledError, Exception):
                        await heartbeat

    async def run(self, events: list[EventDefinition] | EventDefinition, **kwargs: Any) -> None:
        await self.collect(events, **kwargs)
