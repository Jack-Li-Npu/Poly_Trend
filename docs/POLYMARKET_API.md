# Public research data contract

Last checked against official documentation: **2026-10-22**. Poly Trend reads public
evidence and runs research simulations. It does not submit orders, sign trades,
copy wallets, or accept funds. API availability can vary by deployment; a failed
request is recorded as unavailable and never replaced with demonstration data.

## Identifiers and definitions

Gamma event IDs and market IDs are different from onchain condition IDs and outcome
asset IDs. Store all of them. The provider selects outcome identifiers using the
market's `version`: `v1` uses JSON-encoded `clobTokenIds`; `v2` uses `positionIds`.
The presence of either field does not establish the protocol. Unsupported versions
or missing/misaligned identifiers prevent CLOB reads. Zero is a legitimate
probability; absent, invalid and non-finite values remain null.

An event is a family of contracts. Search results are hydrated with `/events/{id}`
before an event is returned. Discovery supports search pages and keyset catalog
walks, open/closed selection and bounded pagination. The default catalog scans up
to five pages and filters macro titles; it is a bounded discovery view, not proof
that every macro contract has been indexed. Refine the search if a family is absent.

Exact resolution wording controls the proposition, not title similarity. Do not
pool contracts with different deadlines, thresholds, time zones or sources. Gamma
`groupItemThreshold` can be a display ordinal rather than a financial threshold
(the live October 2026 Fed event uses 0–4 for its five rate-change brackets), so it
is not assigned to the economic threshold field. Provider negative-risk membership
can establish exclusive YES outcomes; it does not establish that the selected
outcomes exhaust every possibility. Joint probabilities and causal asset effects
are not supplied by these APIs.

Sources: [market details](https://docs.polymarket.com/market-data/market-details),
[resolution](https://docs.polymarket.com/concepts/resolution),
[keyset market listing](https://docs.polymarket.com/api-reference/markets/list-markets-keyset-pagination).

## Endpoints actually used

| Host | Reads | Use and limit |
|---|---|---|
| Gamma | `/public-search`, `/events/keyset`, `/events/{id}` | Full-family discovery, rules, deadlines, status, outcome and protocol identifiers. Search up to 4 pages; catalog up to 5 × 100. |
| CLOB | `/book`, `/fee-rate` | Two-sided quotes, USD depth, tick and fee metadata. Capture at most 20 contracts. |
| Data API v2 | `/prices-history` | Whole-life `interval=max` half-day read, filtered to the last 180 days, at most four 1,000-row pages per contract. |
| Data API v2 | `/trades`, `/holders`, `/positions`, `/oi`, `/resolutions`, `/status` | Public participation, positions, priced OI, resolution lifecycle and data freshness. Current feed snapshots use one bounded 100-row page per contract; raw envelopes preserve truncation. |
| CLOB | `/prices-history` | Explicit compatibility fallback when v2 history is unavailable. It is labeled and can have different retention and granularity. |
| Coinbase Exchange | `/products/BTC-USD/candles` | Public daily candles; incomplete UTC-day candles are omitted. |
| U.S. Treasury | annual daily yield-curve XML | Public 2Y and 10Y yield levels. Unit is percent; changes belong in basis points, not fund-return/PnL calculations. |
| FRED / ALFRED, optional | `/series/observations` | A selected date-vintage, using the last complete UTC day and an optional free key. Exact intraday release timestamps and full revision histories are not certified. |
| Alpha Vantage, optional | `TIME_SERIES_DAILY` | Compact raw daily ETF closes. Explicitly not dividend-adjusted/total-return performance. Missing keys and quota failures remain missing. |

Data API v1 is scheduled to retire on **2026-10-24**. New reads use `/v2`, the
`condition` selector, snake_case and `{data,pagination}`. Follow opaque
`pagination.next_cursor`; never send `offset` to v2 or infer completion merely from
an empty-looking first page. Gamma keyset uses `after_cursor` instead. Partial
walks are labeled, not represented as the complete market population.

OI `/v2/oi` returns **priced gross interest** in `value`; it is stored in
`open_interest_usd`, never `open_interest_shares`. Participant counts are wallets
observed in a bounded recent trade page, not unique people or all participants.
The holder page does not establish a complete concentration denominator, so
`top_holder_share` stays unavailable. Default holder balances are netted; enabling
the optional PnL mode changes to per-side gross balances. They must not be mixed.
Every matched buy has a seller: volume is not net inflow or evidence of informed
trading.

The observed trade sample is deduplicated using source fill identifiers when
present, otherwise an exact composite identity. Directional taker pressure counts
YES buys and NO sells toward YES, and YES sells and NO buys away from YES. Net
shares and signed executed USD notional are different quantities; the latter uses
each outcome's actual execution price. Neither is capital inflow, a portfolio's
net risk or proof of informed trading. Identical distinct fills can be ambiguous
when the public feed supplies no stable fill identity, which is disclosed.

Sources: [Data API migration](https://docs.polymarket.com/migrate/data-api-v1-to-v2),
[trades](https://docs.polymarket.com/api-reference/feeds/list-trades),
[holders](https://docs.polymarket.com/api-reference/markets/list-a-markets-top-holders),
[OI](https://docs.polymarket.com/api-reference/markets/get-open-interest),
[freshness](https://docs.polymarket.com/api-reference/service/get-data-freshness).

## Probability and time semantics

The snapshot uses a midpoint only for a valid two-sided book with spread at most
10 cents. Wider spreads use an available last-trade indication and a staleness
warning. Gamma-only prices are explicitly labeled. Fee metadata describes provider
fee rates, not an independently verified flat transaction cost or ETF trading cost.

The timestamp parser distinguishes epoch seconds from milliseconds, normalizes to
UTC, and keeps source observation time separate from retrieval time. Every raw
observation has a source URL, `observed_at`, `retrieved_at`, `available_at`, origin,
and SHA-256 hash of its normalized, redacted payload. No secret query parameter or
provider exception body is persisted. Histories queried today are marked
`historical_reconstruction=true` and their observation availability is today.

Historical `as_of` capture never reads the present order book, holder list or trade
feed as though it existed at the earlier decision time. Event definitions cannot
be backdated. Coinbase closes become available at the UTC interval end; Treasury
and date-vintage series use conservative next-UTC-day availability and disclose
that exact publication times are not certified. These rules prevent a recorded
showcase from becoming a false point-in-time backtest.

Data API price history supports `interval`, explicit windows and `as_of`, but
historical high-resolution retention is limited. Requesting an unavailable explicit
grain can return an empty series. No documented endpoint supplies complete historic
order-book depth, all historical holder snapshots or a true cross-event joint
distribution. Collect prospectively and reconcile gaps before testing lead–lag.
Coarse historical charts cannot substantiate millisecond information advantage.

Sources: [quote semantics](https://docs.polymarket.com/concepts/prices-orderbook),
[v2 price history](https://docs.polymarket.com/api-reference/markets/get-a-tokens-price-history),
[Coinbase candles](https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles),
[Treasury data](https://home.treasury.gov/treasury-daily-interest-rate-xml-feed),
[FRED observations](https://fred.stlouisfed.org/docs/api/fred/series_observations.html).

## Optional stream capture

`MarketStreamCollector` journals the public CLOB market WebSocket. It subscribes to
both known outcome IDs of at most 20 contracts, sends a text `PING` every 10 seconds,
and records books, price-level changes, last trades and lifecycle messages.
`stream_reconcile` observations seed each connection from REST books. Disconnects,
malformed frames and failed reconciliation create explicit `stream_gap` observations;
missing deltas are not manufactured. A timestamp/hash is not a global sequence or a
historical replay guarantee. The API's user channel is authenticated private account
data and is not used.

RTDS reference-price topics are migrating to PolyBolt. Licensed crypto/equity/forex/
metal reference channels on PolyBolt require CLOB credentials, so they are excluded
from the public-first MVP. Coinbase/Treasury and optional attributed price imports
keep the research workflow useful without wallet keys. Public Polymarket access
does not grant a license to redistribute every third-party reference feed.

Sources: [market channel](https://docs.polymarket.com/api-reference/wss/market),
[PolyBolt migration](https://docs.polymarket.com/migrate/rtds-to-polybolt).

## Budgets, failures and recordings

Public requests are paced independently per provider, cached when appropriate, and
retried at most twice for network errors, HTTP 429 and server failures. Retry-After
is honored with a 5-second per-wait bound. A new HTTP client is closed after every
request. The optional Alpha adapter has a process-local daily budget (default 20)
and six-hour response caching; provider-side limits still apply and a restart does
not reserve additional provider quota. Large production deployments should share
budgets in durable storage before increasing concurrency.

Published API limits vary by family; the current reference lists Gamma search at
350/10s, Data v2 overall at 800/10s and CLOB books at 1,500/10s. Do not multiply
per-process limits across replicas without a shared limiter.
[Official limits](https://docs.polymarket.com/api-reference/rate-limits)

Generate attributed recordings with:

```bash
PYTHONPATH=services/research/src python scripts/capture_showcases.py
```

This writes three actual public captures plus `showcase/capture_manifest.json` with
source URLs, observation counts, times, file hashes and provider gaps. It uses no
optional keys unless `--optional-keys` is explicit. Default candidates are a Fed
decision, inflation and recession. `--event` can pin specific Gamma IDs.

Recordings are opt-in and labeled `origin=recorded` on every event/observation. Live
discovery never falls back to them. The loader validates payload hashes and rejects
corrupt or mislabeled files. Simulations use disclosed assumptions; recordings do
not claim a historical decision was made or that an investment edge was validated.
