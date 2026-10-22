# Poly Trend V3 — Research desk guide

Poly Trend connects a precisely defined event to observed market expectations, asset histories, a saved investment thesis, and explicit conditions that would change that thesis. The application supports research and hypothetical scenarios. It does not place trades.

## Start the application

Use Node.js 22 and Python 3.12 or later. From the repository root:

```sh
npm ci
uv sync --project services/research --extra dev --frozen
uv run --project services/research polytrend-research
```

In a second terminal:

```sh
npm run dev
```

Open [the research desk](http://localhost:3000). API documentation is available at [the research API](http://127.0.0.1:8000/docs).

The browser calls its own `/api/v3` route. The web server forwards those requests to `INTERNAL_API_URL`, which defaults to `http://localhost:8000`. Set that environment variable for the web process when using a different API port. Keep provider credentials on the research server.

For Docker, copy `.env.example` to `.env`, set `POSTGRES_PASSWORD`, then run:

```sh
docker compose up --build -d
```

Local work uses a separate V3 SQLite database by default. Docker uses PostgreSQL. V2 investigations are not automatically converted into V3 cases.

## Choose the data mode

The source selector is always visible at the top of the workspace:

- **Recorded** opens pinned research datasets. Their records retain their own recorded, imported, or synthetic origin. A recorded dataset is not a live quote feed.
- **Live** discovers actual provider events and captures current observations. Network blocks, absent histories, rate limits, and missing keys appear as coverage gaps.

A failed live request never becomes a recorded result. Switching source mode does not convert an existing case; saved cases retain the source mode in which they were created. The selector is disabled while the selected run is active.

No model key is required for deterministic research. Public market sources and available public asset series can work without keys. Alpha Vantage and FRED keys enable their respective data coverage. Restart the API after changing its environment.

## Attention queue

The queue groups related contracts into event families. Each row names the **exact tracked outcome** behind the displayed price. For example, the price of a particular policy-decision outcome must not be read as the probability of an entire policy event family.

The queue shows the tracked outcome's price, repricing over target windows, quote type, spread, depth where available, timestamp, and data origin. Ordering by observed repricing identifies where to investigate; it does not rank investments by expected returns.

Changes are in **percentage points**. A move from 40% to 45% is +5 percentage points. Target windows use the nearest eligible observations; coarse history can make a one-day comparison span more than 24 hours. Actual elapsed intervals are shown when available.

`Capture required`, `Awaiting capture`, and em dashes mean that the value is unavailable. They are not zeros. Live event discovery can succeed before a saved run has collected enough history to show changes.

Select an event, inspect its source and available contract quotes, choose the assets to investigate, and select **Open research case**. The application creates a durable case and starts a research run. Saved cases appear in the sidebar.

## Research tab

The research view separates the event quote, its change, the captured source records, and the status of asset-response analysis.

### Timeline

The upper panel shows the selected contract's historical probability. The lower panel shows the selected asset on the same time axis with a separate scale:

- Price series show percentage change from the first visible observation.
- Yield series show changes in **basis points**, not price returns.

The `1M`, `3M`, and `All` controls change the visible sample. Select another asset using the chart selector. Source provider, adjustment metadata, data interval, and the endpoints of the historical sample remain visible. A missing history produces an explicit gap rather than a fabricated line.

Time alignment establishes chronology. It does not prove that an event caused an asset move.

### Exact contract and quote quality

Use the outcome selector to inspect another contract in the same family. Read its resolution rules and deadline before comparing its probability with another contract.

Bid and ask prices, spread, book depth, volume, open interest, and available holder coverage are separate measurements. Open interest retains its shares or gross priced USD units. Bounded trade samples can also show signed taker notional; that value and gross priced open interest are not capital inflow. Missing holder or participant data remain unavailable; the system does not infer them from liquidity.

### Logical relationships

The coherence panel identifies verified complements, exclusive outcomes, implication relationships, and nested thresholds or deadlines. It shows ranges only where the stated relationship permits a calculation. Original quotes remain visible.

A partial exclusive family need not cover every possible outcome. Its unallocated probability mass is shown where available; it is not silently normalized into a complete distribution. Similar wording or nearby deadlines alone do not establish equivalence.

### Asset consequences

Select a 1-, 5-, or 20-session response window. The diagnostics keep contemporaneous, event-leading, asset-leading, and reversal relationships distinct. They report coefficient sample counts and independent-window counts. Where shown, 95% intervals are exploratory Fisher-z approximations with an independence assumption; they are not robust to overlapping windows or autocorrelation.

These relationships remain **experimental** or **insufficient** until independently validated. Retrospective reconstructions can describe what happened, but do not establish that the same signal could have been traded at the time. Correlation is not causal identification, and a positive coefficient is not evidence of investment alpha.

### Findings and evidence

Research claims distinguish observations, calculations, hypotheses, and scenarios. Open a claim's source record to inspect the actual stored input. Claims without an available raw observation are flagged rather than given an invented source.

The three principal labels mean:

| Label | Meaning |
|---|---|
| Source linked | Traceable to a stored observation or declared deterministic input. This alone does not validate a predictive claim. |
| Experimental | An assumption, hypothesis, or method without established predictive performance. |
| Insufficient | The evidence does not support the requested estimate or comparison. |

### Working thesis and invalidation rules

Write your interpretation and list its assumptions, one per line. Add an invalidation rule by choosing an exact market contract, a probability threshold, and an above/below condition. Name the rule so its meaning is clear later.

**Save thesis** persists the draft, assumptions, and rules to the case. The inline save state distinguishes saved work from unsaved changes. Save your draft before changing scheduled refresh.

A rule can be pending, clear, triggered, missing, or stale. Missing or stale input is not treated as evidence that a rule is clear. **Refresh now** captures new evidence and reevaluates the saved rules. **Scheduled refresh** persists the monitoring preference; the service evaluates enabled cases on its configured interval.

## Scenario lab tab

The scenario lab calculates the implications of declared inputs. It does not substitute a market price for your event-probability assumption.

Set:

1. Your event probability.
2. The asset return if the event happens.
3. The asset return if the event does not happen.
4. Illustrative capital, round-trip costs, and the holding window.

Select **Calculate scenario**. The server returns assumption-weighted return after costs, expected P&L, both conditional P&Ls, a break-even probability when attainable, and probability sensitivity.

The calculation is:

```text
p × event return + (1 − p) × non-event return − round-trip costs
```

Changing an input clears the previous result until it is recalculated. Neither conditional payoffs nor their weighted result are independently calibrated forecasts.

Optional joint-event controls apply feasible probability bounds; they do not assume independence. You can supply conditional returns for both events, the first event only, the second event only, and neither event. The separate four-state stress result reports the feasible best/worst expected-return range. A point result is shown only when you explicitly declare the joint probability. The main single-event result stays separately labelled. A historical outcome check can compare a supplied decision time with subsequently observed returns when sufficient stored data exist. It reports an outcome check, not an execution backtest.

After calculating within a case, **Save these inputs as a scenario fork** stores exactly those assumptions in a separate run while preserving the baseline input snapshot. The export control saves the scenario inputs and result as JSON.

## Evidence tab

The evidence ledger lists provider, record type, observation time, availability time, and origin. **Inspect** opens a source drawer with:

- Observation, availability, retrieval, and publication timestamps.
- External record identity and source URL.
- Content hash and stored payload.
- A retrospective-reconstruction label where applicable.

Source links accept HTTP(S) URLs and remove credential-like query parameters. Payloads are rendered as text. **Export pinned inputs** downloads the selected run, original input bundle, and presentation view as JSON, including source payloads and input hashes. For a historical cutoff run, the original pinned bundle may contain later observations that were excluded from the displayed analysis; the ledger itself shows only available observations.

Supporting context and counterevidence retain their source links and availability times. Context does not silently alter a numerical result.

### Import a CSV

Select **Import CSV**, supply an asset symbol and original source URL, choose adjustment metadata, and upload or paste a CSV. The file must be smaller than 5 MB.

Expected columns are `timestamp` or `date`, and `value` or `close`. An `available_at` column can preserve declared availability where supported:

```csv
timestamp,value,available_at
2026-01-02,100,2026-01-02T21:00:00Z
2026-01-05,101,2026-01-05T21:00:00Z
```

Choose raw, split-adjusted, total-return, yield, or unknown adjustment honestly. A successful import is labelled imported and retains its source. Refresh the case to include the series in a new pinned snapshot. Importing a past series does not by itself prove point-in-time availability.

## Replay & history tab

Saved runs have durable IDs, state, creation time, mode, and input snapshot hashes. Open any run to inspect its saved result.

- **Refresh** collects new provider observations.
- **Replay** recomputes against a pinned bundle and method/seed, without replacing it with new provider inputs.
- **Historical cutoff** restricts the analysis to observations available by a selected timestamp. The form uses your browser's local timezone.
- **Scenario fork** changes declared assumptions while preserving the baseline snapshot.

Historical reconstruction remains explicitly labelled. A cutoff cannot manufacture evidence that was not captured or establish that retrospectively downloaded data were available in a live research system.

## Validation tab

Validation reports probability calibration, asset prediction, and simulation checks separately. Source integrity, logical consistency, model agreement, and historical co-movement are different claims from predictive performance.

A limited number of snapshots does not become a large independent-event sample. Synthetic positive and negative controls can test the evaluator, but cannot establish investment performance. Insufficient validation remains a published result rather than a hidden warning.

## Run failures and recovery

The activity strip reports actual stages and preserves the run ID. Expand **Activity** to inspect public progress.

If the event stream disconnects, the server may still be working. Select **Reconnect to run** to retrieve that same run's persisted state. Failed, interrupted, or cancelled runs expose a **Resume** action. A failed request never inserts a substitute seed answer.

Opening a saved case or its URL restores the selected run. Exported briefs include the case thesis, claim labels, run identity, method version, input snapshot hash, limitations, and source references.

## Reproduce checks

```sh
npm run typecheck
npm run build
npm test
uv run --project services/research python -m pytest services/research/tests
uv run --project services/research python evals/v3/run.py
```

Run `scripts/capture_showcases.py` only when you deliberately want to recapture public-network examples. Recaptured observations are new snapshots and can differ from the checked-in recordings.
