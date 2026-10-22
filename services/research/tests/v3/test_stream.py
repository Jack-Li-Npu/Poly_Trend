from __future__ import annotations

import json

import httpx
import pytest
from polytrend.v3.providers import ProviderConfig, ResearchDataProvider
from polytrend.v3.stream import MarketStreamCollector


def event(provider):
    return provider.event_from_gamma(
        {
            "id": "1",
            "title": "Fed",
            "slug": "fed",
            "markets": [
                {
                    "id": "2",
                    "conditionId": "0x" + "a" * 64,
                    "question": "Fed cut?",
                    "version": "v1",
                    "outcomes": '["Yes","No"]',
                    "clobTokenIds": '["11","12"]',
                }
            ],
        }
    )


class Socket:
    def __init__(self, failure=False):
        self.failure = failure
        self.sent = []

    async def send(self, frame):
        self.sent.append(frame)

    async def recv(self):
        if self.failure:
            raise ConnectionError("secret exception must not enter observations")
        return json.dumps(
            {
                "event_type": "last_trade_price",
                "asset_id": "11",
                "price": "0.42",
                "timestamp": "1700000000000",
            }
        )


class Connection:
    def __init__(self, socket):
        self.socket = socket

    async def __aenter__(self):
        return self.socket

    async def __aexit__(self, *_):
        return False


@pytest.mark.asyncio
async def test_collector_reconciles_each_outcome_and_preserves_event_clock():
    provider = ResearchDataProvider(
        ProviderConfig(min_request_interval=0),
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200, json={"timestamp": "1700000000000", "bids": [], "asks": []}
            )
        ),
    )
    records, socket = [], Socket()

    async def emit(observation):
        records.append(observation)

    collector = MarketStreamCollector(
        provider, emit, connector=lambda *_args, **_kwargs: Connection(socket)
    )
    await collector.collect(event(provider), max_messages=1)
    assert [record.kind for record in records] == [
        "stream_reconcile",
        "stream_reconcile",
        "stream_last_trade_price",
    ]
    assert records[-1].observed_at.year == 2023
    assert json.loads(socket.sent[0])["custom_feature_enabled"] is True
    assert json.loads(socket.sent[0])["assets_ids"] == ["11", "12"]


@pytest.mark.asyncio
async def test_disconnect_records_gap_before_reconciliation():
    provider = ResearchDataProvider(
        ProviderConfig(min_request_interval=0),
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"bids": [], "asks": []})),
    )
    records, sockets = [], []

    def connect(*_args, **_kwargs):
        socket = Socket(failure=not sockets)
        sockets.append(socket)
        return Connection(socket)

    async def emit(observation):
        records.append(observation)

    await MarketStreamCollector(provider, emit, connector=connect).collect(
        event(provider), max_messages=1
    )
    kinds = [record.kind for record in records]
    assert kinds == [
        "stream_reconcile",
        "stream_reconcile",
        "stream_gap",
        "stream_reconcile",
        "stream_reconcile",
        "stream_last_trade_price",
    ]
    assert records[3].payload["reason"] == "reconnect"
    assert "secret exception" not in "".join(record.model_dump_json() for record in records)
