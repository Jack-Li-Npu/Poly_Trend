# Three recorded macro investigations

These are genuine public API observations captured on **22 October 2026**, with
later history/official-yield augmentation recorded separately in each observation's
receipt time. They are retrospective research examples, not decisions made before
the events, recommended trades, or evidence of predictive investment performance.
Open a recorded case explicitly in the application. Live discovery never substitutes
these files when a provider fails.

The manifest records exact source URLs, receipt times, payload counts, gaps and file
SHA-256 hashes. Each raw observation also has its own normalized-payload hash. The
bundles contain 16 market snapshots, 1,733 genuine probability-history points and
143 observations in total. Each bundle includes 179 completed Coinbase BTC daily
candles and 123 official Treasury observations for each of the 2Y and 10Y yields.
ETF prices for SPY, QQQ, IEF and TLT remain unavailable because no optional key was
used. Yield levels are not substitutes for ETF total returns.

## Meaningful expectation change: October Fed decision

[The event](https://polymarket.com/event/fed-decision-in-october-20260617190323537)
contains five rate-change brackets with identical FOMC resolution rules. The
captured no-change contract has an 87.5% midpoint, versus a 46.5% historical chart
comparison approximately 30 days earlier: a **41 percentage-point change** in this
particular event's pricing. Its captured bid/ask is 87%/88%. The signal is useful as
a quantified change in expectations and an input to a disclosed scenario.

The rules, exact five labels and rounding/fallback provisions support a reviewed
exclusive/exhaustive partition. Midpoints sum to 100.65%, so the app shows quote
interval constraints instead of silently normalizing five numbers into a perfect
distribution. One extreme contract has no two-sided book. This event still does
not supply a causal coefficient for equities, yields or Bitcoin, and the examples
do not demonstrate that the repricing preceded those assets.

File: `01-fed-decision-in-october-20260617190323537.json`; 5 contracts, 1,247 history
points, 45 raw observations.

## Potentially misleading strength: October core CPI bins

[The event](https://polymarket.com/event/core-cpi-yoy-october-2026) has ten CPI bins.
The 2.6% bin's captured midpoint is 79.5%, with a 79%/80% book and approximately
40 percentage points of change against the seven-day comparison. That precise
number can look stronger than its evidence: the captured priced gross OI for the
central bin is only about $757, and several tails have less than $2 of resting bid
notional across their supplied book levels. Some spreads approach ten percentage
points. There are only 13 returned half-day chart observations per contract.

The app exposes those depth, spread, participation and sample limitations. It does
not turn the highest bin into a calibrated confidence score or invent a complete
joint distribution. A large historical move can reflect a fragile market, a changed
information state, or both; source timestamps alone do not establish its cause.

File: `02-core-cpi-yoy-october-2026.json`; 10 contracts, 130 history points, 85 raw
observations.

## Inconclusive investment edge: recession by year-end

[The event](https://polymarket.com/event/us-recession-by-end-of-2026) is a single
binary recession contract. Its captured midpoint is 7.5%, with a 7%/8% book. The
30-day comparison changes by only about 0.5 percentage points. This can inform an
analyst's event-risk ledger, but it does not directly answer whether to buy or sell
a stock, Treasury fund or Bitcoin.

The bundle provides 356 probability-history points alongside the public BTC/yield
series. Any aligned association remains retrospective and derives from one event
history. Missing ETF data, non-independent overlapping windows and the absence of
an out-of-sample multi-event test make the trading-edge conclusion **inconclusive**.
Hypothetical scenario outcomes remain explicitly tied to the user's assumptions.

File: `03-us-recession-by-end-of-2026.json`; 1 contract, 356 history points, 13 raw
observations.

## Reproduce and inspect

```bash
PYTHONPATH=services/research/src python scripts/capture_showcases.py
```

The script makes public GET requests, records provider failures and creates a new
manifest. To augment an existing capture with later genuine history/yields while
preserving its original book timestamps:

```bash
PYTHONPATH=services/research/src python scripts/capture_showcases.py --augment-history
```

The capture initially used an unsupported long explicit history window; the API
returned HTTP 400. The retained chart evidence comes from subsequent documented
`interval=max` requests. History receipt times are not backdated to the original
book. Polymarket feeds, Coinbase candles and Treasury XML are the recorded sources;
no model-generated prices or seed-market histories are present.
