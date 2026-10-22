from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from polytrend.v3.models import EvidenceBundle
from polytrend.v3.providers import (
    ProviderConfig,
    ProviderError,
    ResearchDataProvider,
    load_recorded_bundles,
    number,
    probability,
    safe_url,
    timestamp,
    trade_diagnostics,
)


def event_payload(event_id="42", version="v1"):
    return {
        "id": event_id,
        "title": "Fed decision in December?",
        "slug": "fed-december",
        "negRisk": True,
        "endDate": "2026-12-17T00:00:00Z",
        "markets": [
            {
                "id": "101",
                "conditionId": "0x" + "1" * 64,
                "question": "Will the Fed cut by 25 bps?",
                "version": version,
                "outcomes": '["Yes","No"]',
                "outcomePrices": '["0","1"]',
                "clobTokenIds": '["11","12"]',
                "positionIds": ["21", "22"],
                "description": "The official FOMC statement determines the rate change.",
                "active": True,
                "closed": False,
                "negRisk": True,
                "groupItemTitle": "25 bps cut",
                "groupItemThreshold": "1",
            }
        ],
    }


def config(**kwargs):
    return ProviderConfig(min_request_interval=0, max_retries=0, **kwargs)


def test_missing_zero_and_timestamp_units():
    assert number(None) is None and number("") is None and number("NaN") is None
    assert number(0) == 0 and probability("0") == 0 and probability("1") == 1
    assert probability(1.1) is None and probability(-0.1) is None
    assert timestamp(1_700_000_000) == timestamp(1_700_000_000_000)
    assert timestamp("2026-10-22").tzinfo is not None


def test_protocol_selection_never_guesses_from_field_presence():
    provider = ResearchDataProvider(config())
    assert provider.event_from_gamma(event_payload(version="v1")).contracts[0].token_ids == [
        "11",
        "12",
    ]
    v2 = provider.event_from_gamma(event_payload(version="v2"))
    assert v2.contracts[0].token_ids == ["21", "22"]
    assert v2.contracts[0].prices == [0, 1]
    assert v2.contracts[0].group_threshold is None  # ordinal is not 1 bp
    assert provider.event_from_gamma(event_payload(version="v3")).contracts[0].token_ids == []
    invalid = event_payload()
    invalid["markets"][0]["conditionId"] = "not-a-condition"
    assert not provider.event_from_gamma(invalid).contracts


def test_trade_diagnostics_deduplicates_and_orients_opposite_outcomes():
    yes_buy = {
        "transaction_hash": "0xa",
        "token_id": "11",
        "outcome": "Yes",
        "side": "BUY",
        "proxy_wallet": "0xABC",
        "timestamp": 1,
        "size": 10,
        "price": 0.4,
    }
    no_buy = {
        "transaction_hash": "0xb",
        "token_id": "12",
        "outcome": "No",
        "side": "BUY",
        "proxy_wallet": "0xDEF",
        "timestamp": 2,
        "size": 4,
        "price": 0.6,
    }
    no_sell = {**no_buy, "transaction_hash": "0xc", "side": "SELL", "size": 2}
    result = trade_diagnostics([yes_buy, dict(yes_buy), no_buy, no_sell], "11", "12")
    assert result["trade_count"] == 3 and result["unique_wallets"] == 2
    assert result["taker_net_shares"] == 8
    assert result["taker_net_notional_usd"] == pytest.approx(2.8)
    assert any("not net capital inflow" in issue for issue in result["issues"])
    unknown = trade_diagnostics([{**yes_buy, "token_id": "999", "outcome": "Unknown"}], "11", "12")
    assert unknown["taker_net_shares"] is None and unknown["trade_count"] == 0


def test_fed_exhaustiveness_requires_complete_labels_and_identical_reviewed_rules():
    provider = ResearchDataProvider(config())
    payload = event_payload()
    labels = [
        "50+ bps decrease",
        "25 bps decrease",
        "No change",
        "25 bps increase",
        "50+ bps increase",
    ]
    rules = "FOMC target federal funds changes rounded up to nearest 25. No change fallback. https://www.federalreserve.gov"
    base = payload["markets"][0]
    payload["markets"] = [
        {**base, "id": str(100 + index), "groupItemTitle": label, "description": rules}
        for index, label in enumerate(labels)
    ]
    assert any(
        relation.kind == "exhaustive" and relation.verified
        for relation in provider.event_from_gamma(payload).relations
    )
    payload["markets"].pop()
    assert not any(
        relation.kind == "exhaustive" for relation in provider.event_from_gamma(payload).relations
    )


@pytest.mark.asyncio
async def test_search_paginates_and_hydrates_complete_families():
    calls = []

    def handle(request):
        calls.append(request)
        if request.url.path == "/public-search":
            page = request.url.params.get("page")
            return httpx.Response(
                200, json={"events": [{"id": page}], "pagination": {"hasMore": page == "1"}}
            )
        return httpx.Response(200, json=event_payload(request.url.path.rsplit("/", 1)[-1]))

    provider = ResearchDataProvider(config(), transport=httpx.MockTransport(handle))
    events = await provider.discover("Fed", include_closed=True, limit=2)
    assert [event.id for event in events] == ["1", "2"]
    assert all(len(event.contracts) == 1 for event in events)
    assert calls[0].url.params["keep_closed_markets"] == "1"
    assert calls[1].url.params["page"] == "2"


@pytest.mark.asyncio
async def test_keyset_walk_keeps_closed_option_and_no_offset():
    requests = []

    def handle(request):
        requests.append(request)
        if request.url.path == "/events/keyset":
            cursor = request.url.params.get("after_cursor")
            return httpx.Response(
                200,
                json={
                    "events": [event_payload("2" if cursor else "1")],
                    "next_cursor": None if cursor else "next",
                },
            )
        return httpx.Response(200, json=event_payload(request.url.path.rsplit("/", 1)[-1]))

    provider = ResearchDataProvider(config(), transport=httpx.MockTransport(handle))
    assert len(await provider.discover(include_closed=True, limit=2)) == 2
    assert requests[1].url.params["after_cursor"] == "next"
    assert all("offset" not in request.url.params for request in requests)
    assert "closed" not in requests[0].url.params


@pytest.mark.asyncio
async def test_data_cursor_and_versioned_base():
    requests = []

    def handle(request):
        requests.append(request)
        cursor = request.url.params.get("cursor")
        return httpx.Response(
            200,
            json={
                "data": [{"value": 2 if cursor else 1}],
                "pagination": {"next_cursor": None if cursor else "opaque"},
            },
        )

    provider = ResearchDataProvider(
        config(data_url="https://data-api.polymarket.com/v2"), transport=httpx.MockTransport(handle)
    )
    rows, pages, truncated = await provider._data("oi", {"condition": "abc"}, max_pages=2)
    assert rows == [{"value": 1}, {"value": 2}] and len(pages) == 2 and not truncated
    assert requests[0].url.path == "/v2/oi"
    assert requests[1].url.params["cursor"] == "opaque"
    assert requests[1].url.params["condition"] == "abc"


@pytest.mark.asyncio
async def test_retry_after_and_errors_do_not_expose_credentials():
    calls = 0

    def handle(request):
        nonlocal calls
        calls += 1
        return (
            httpx.Response(429, headers={"Retry-After": "0"})
            if calls == 1
            else httpx.Response(200, json={"ok": True})
        )

    provider = ResearchDataProvider(
        ProviderConfig(min_request_interval=0, max_retries=1), transport=httpx.MockTransport(handle)
    )
    assert await provider._get("test", "https://example.com") == {"ok": True}
    assert calls == 2
    secret = "do-not-leak"

    def fail(request):
        raise httpx.ConnectError(
            f"https://user:password@example.com?apikey={secret}", request=request
        )

    provider = ResearchDataProvider(
        config(fred_api_key=secret), transport=httpx.MockTransport(fail)
    )
    with pytest.raises(ProviderError) as caught:
        await provider._get("fred", "https://example.com", {"api_key": secret})
    assert secret not in str(caught.value) + json.dumps(provider.health())
    observation = provider.observation(
        "test",
        "raw",
        "1",
        f"https://user:password@example.com?a=2&api_key={secret}",
        {
            "api_key": secret,
            "nested": {"url": f"https://example.com?secret={secret}", "message": f"key={secret}"},
        },
    )
    serialized = observation.model_dump_json()
    assert secret not in serialized and "user:password" not in serialized
    assert observation.content_hash
    assert "password" not in safe_url("https://user:password@example.com?a=1")
    assert "sensitive" not in safe_url("https://example.com?token=sensitive&auth=sensitive")


@pytest.mark.asyncio
async def test_capture_uses_real_book_and_preserves_partial_failures():
    now = datetime.now(UTC)

    def handle(request):
        path = request.url.path
        if path == "/events/42":
            return httpx.Response(200, json=event_payload())
        if path == "/book":
            return httpx.Response(
                200,
                json={
                    "timestamp": str(int(now.timestamp() * 1000)),
                    "bids": [{"price": ".4", "size": "10"}],
                    "asks": [{"price": ".42", "size": "10"}],
                    "tick_size": ".01",
                },
            )
        if path == "/fee-rate":
            return httpx.Response(200, json={"base_fee": 0})
        if path == "/prices-history":
            return httpx.Response(
                200, json={"history": [{"t": int((now - timedelta(days=1)).timestamp()), "p": 0.3}]}
            )
        return httpx.Response(403, json={"error": "do-not-trust-external-error"})

    provider = ResearchDataProvider(config(), transport=httpx.MockTransport(handle))
    bundle = await provider.capture(provider.event_from_gamma(event_payload()), ["SPY"])
    market = bundle.markets[0]
    assert market.probability == pytest.approx(0.41) and market.quote_type == "midpoint"
    assert market.bid_depth_usd == 4 and market.fee_rate == 0
    assert market.unique_participants is None and market.open_interest_shares is None
    assert len(market.history) == 1 and any("HTTP 403" in issue for issue in market.issues)
    assert not bundle.assets[0].points and bundle.assets[0].issues
    assert "do-not-trust-external-error" not in bundle.model_dump_json()
    assert all(item.available_at >= item.retrieved_at for item in bundle.observations)
    assert all(item.available_at <= bundle.captured_at for item in bundle.observations)


@pytest.mark.asyncio
async def test_historical_capture_does_not_fetch_present_book_or_holders():
    paths = []
    cutoff = datetime(2026, 9, 1, tzinfo=UTC)

    def handle(request):
        paths.append(request.url.path)
        if request.url.path == "/events/42":
            return httpx.Response(200, json=event_payload())
        return httpx.Response(
            200,
            json={
                "data": [{"timestamp": int(cutoff.timestamp()) - 1, "price": 0.25}],
                "pagination": {"next_cursor": None},
            },
        )

    provider = ResearchDataProvider(config(), transport=httpx.MockTransport(handle))
    bundle = await provider.capture(provider.event_from_gamma(event_payload()), [], as_of=cutoff)
    assert "/book" not in paths and "/v2/holders" not in paths
    assert bundle.markets[0].probability == 0.25
    assert all(item.historical_reconstruction for item in bundle.observations)
    assert all(item.available_at > cutoff for item in bundle.observations)


@pytest.mark.asyncio
async def test_coinbase_omits_incomplete_daily_candle():
    cutoff = datetime(2026, 10, 22, 12, tzinfo=UTC)
    yesterday = int(datetime(2026, 10, 21, tzinfo=UTC).timestamp())
    today = yesterday + 86400

    def handle(_request):
        return httpx.Response(
            200, json=[[today, 1, 2, 1.5, 2, 10], [yesterday, 1, 2, 1.5, 1.8, 10]]
        )

    provider = ResearchDataProvider(config(), transport=httpx.MockTransport(handle))
    series, observations = await provider.asset_series("BTC-USD", cutoff)
    assert len(series.points) == 1 and series.points[0].value == 1.8
    assert series.points[0].available_at == datetime(2026, 10, 22, tzinfo=UTC)
    assert observations[0].historical_reconstruction


@pytest.mark.asyncio
async def test_treasury_yield_has_unit_and_conservative_availability():
    xml = '<feed xmlns:d="urn:d"><id>https://home.treasury.gov/item?data=yield&amp;id=140</id><properties><d:NEW_DATE>2026-10-20T00:00:00</d:NEW_DATE><d:BC_10YEAR>4.2</d:BC_10YEAR></properties></feed>'

    def handle(request):
        assert request.url.path == "/resource-center/data-chart-center/interest-rates/pages/xml"
        return httpx.Response(200, text=xml)

    provider = ResearchDataProvider(config(), transport=httpx.MockTransport(handle))
    series, observations = await provider.asset_series("DGS10", datetime(2026, 10, 22, tzinfo=UTC))
    assert series.adjustment == "yield" and series.unit == "percent"
    assert series.points[0].value == 4.2
    assert series.points[0].available_at == datetime(2026, 10, 21, tzinfo=UTC)
    assert observations


def test_recorded_loader_rejects_corruption_and_live_origin(tmp_path: Path):
    provider = ResearchDataProvider(config())
    event = provider.event_from_gamma(event_payload())
    observation = provider.observation(
        "gamma", "event_definition", "42", "https://example.com", {"x": 1}
    )
    bundle = EvidenceBundle(event=event, observations=[observation])
    (tmp_path / "live.json").write_text(bundle.model_dump_json())
    assert not load_recorded_bundles(tmp_path)
    bundle.event.origin = "recorded"
    bundle.observations[0].origin = "recorded"
    (tmp_path / "recorded.json").write_text(bundle.model_dump_json())
    assert len(load_recorded_bundles(tmp_path)) == 1
    raw = json.loads(bundle.model_dump_json())
    raw["observations"][0]["payload"]["x"] = 999
    (tmp_path / "recorded.json").write_text(json.dumps(raw))
    assert not load_recorded_bundles(tmp_path)


@pytest.mark.asyncio
async def test_live_disabled_never_requests_or_loads_demo_fallback():
    def handle(_request):
        pytest.fail("live data disabled must not issue requests")

    provider = ResearchDataProvider(
        config(live_market_data=False), transport=httpx.MockTransport(handle)
    )
    with pytest.raises(ProviderError, match="select recorded mode"):
        await provider.discover("Fed")
    assert provider.health()["live_seed_fallback"] is False


@pytest.mark.asyncio
async def test_fred_vintage_is_bounded_and_key_is_redacted():
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "observations": [
                    {"date": "2026-08-01", "value": "3.2", "realtime_start": "2026-10-21"}
                ],
                "api_key": "secret-fred",
            },
        )

    provider = ResearchDataProvider(
        config(fred_api_key="secret-fred"), transport=httpx.MockTransport(handle)
    )
    cutoff = datetime(2026, 10, 22, 8, tzinfo=UTC)
    series, observations = await provider.asset_series("FRED:CPIAUCSL", cutoff)
    assert requests[0].url.params["realtime_start"] == "2026-10-21"
    assert requests[0].url.params["realtime_end"] == "2026-10-21"
    assert series.points[0].available_at <= cutoff
    assert "secret-fred" not in observations[0].model_dump_json()


@pytest.mark.asyncio
async def test_optional_etf_cache_and_daily_budget_are_real():
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(
            200, json={"Time Series (Daily)": {"2026-10-20": {"4. close": "600"}}}
        )

    provider = ResearchDataProvider(
        config(alpha_vantage_api_key="secret-alpha", alpha_daily_budget=1),
        transport=httpx.MockTransport(handle),
    )
    cutoff = datetime(2026, 10, 22, tzinfo=UTC)
    first, _ = await provider.asset_series("SPY", cutoff)
    again, _ = await provider.asset_series("SPY", cutoff)
    missing, _ = await provider.asset_series("QQQ", cutoff)
    assert first.points and again.points and len(requests) == 1
    assert not missing.points and any("budget reached" in issue for issue in missing.issues)
