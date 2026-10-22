# V3 data provenance and coverage

This repository contains three distinct kinds of material. They answer different
questions and must not be mixed when describing project results.

| Material | Location | Purpose | What it establishes |
| --- | --- | --- | --- |
| Recorded public research cases | `showcase/*.json` and `showcase/capture_manifest.json` | Inspect and replay attributed provider observations | Source linkage, captured coverage and reproducible calculations on those inputs |
| Synthetic evaluation controls | `evals/v3/fixtures.py` | Exercise known positive and negative signal controls | Evaluation mechanics and leakage barriers; no empirical investment evidence |
| Mocked test inputs | `services/research/tests/v3/` | Verify API, storage, calendar, availability and failure behavior | Software behavior under declared fixtures; no real-world forecasting accuracy |

## Public recordings

The initial capture used `scripts/capture_showcases.py`, read-only public HTTP
GET requests, and no model or price-data key. The three event definitions were
discovered from Polymarket and captured on **22 October 2026**, with initial books
around 00:03–00:05 UTC and separately retrieved history around 00:08 UTC
(08:03–08:08 Asia/Shanghai). Treasury history was added around 00:13 UTC
(08:13 Asia/Shanghai). Each observation retains its own receipt time; history
augmentation does not pretend that those observations arrived simultaneously.
Each bundle exposes its precise capture completion time.
The manifest records the file SHA-256, source URLs, counts and collection issues.
If a case is recaptured, the new manifest is authoritative for exact counts,
timestamps and hashes; a recording does not become a continuously live quote.

The checked, history-augmented recording contains:

| Event | Gamma event ID | Contract snapshots | Observation records |
| --- | --- | ---: | ---: |
| [Fed Decision in October?](https://polymarket.com/event/fed-decision-in-october-20260617190323537) | `606422` | 5 | 45 |
| [Core CPI YoY – October 2026](https://polymarket.com/event/core-cpi-yoy-october-2026) | `1189689` | 10 | 85 |
| [US recession by end of 2026?](https://polymarket.com/event/us-recession-by-end-of-2026) | `48802` | 1 | 13 |

That is **three event definitions**, sixteen related contract snapshots and 143
observation records. Metadata, book, fee and participant-response records do not
constitute independent events. CPI bins and Fed outcomes in one family are
related propositions, not sixteen independent forecasting trials.

The recorded Fed family was reviewed against its five exact outcome labels and
shared FOMC rounding/resolution rules. Its verified exclusivity and exhaustiveness
permit a partition with coherent quote intervals. The raw indicative prices are
not silently rescaled when they fail to sum exactly to one: the current family
view is `ranges_only`. The CPI family has verified exclusivity but not verified
exhaustiveness and remains a partial family. Recession has no invented logical
relationship to those families.

Gamma supplies event metadata and resolution descriptions. CLOB supplies current
books/fees where available. Polymarket Data API v2 supplies bounded activity,
holder, interest, position and resolution responses where accessible. Coinbase
Exchange supplies public BTC-USD daily candles; the U.S. Treasury supplies the
official daily yield curve. All observations carry provider,
external ID, source URL, observed/receipt/availability times, raw sanitized payload
and payload hash. Recorded origin is explicitly `recorded`. Historical retrieval
is separately labeled `historical_reconstruction` when applicable.

The payload hash verifies that stored content has not changed without detection.
It does not authenticate the provider's underlying economic claim, establish a
complete dataset, or certify the response existed at a past investment decision.

## Honest collection gaps

The first capture returned BTC-USD history with **179 completed daily records**,
from 27 April to 22 October 2026 UTC closing timestamps. The same BTC series can
appear in several bundles; those copies are not additional independent evidence.
Public daily candles are retrospectively retrieved, not an archived historical
order book. Intraday bars are not relabeled as sessions.

The history augmentation returned **1,733 Polymarket chart points** at a requested
12-hour bucket: 1,247 across the five Fed contracts (18 June–20 October), 130
across the ten core-CPI contracts (14–20 October), and 356 for recession
(25 April–20 October). Dates describe UTC point timestamps and coverage can vary
within a family. The chart's latest point can precede the current book. The
actual comparison timestamp and elapsed hours accompany each nominal 1/7/30-day
change; sparse histories do not become exact 24-hour returns.

Each bundle also contains **123 DGS2 and 123 DGS10 yield-level observations**
dated 27 April–21 October 2026, obtained from the public Treasury daily curve
feed. Values are in percent, and changes are expressed in basis points.
Availability is conservatively assigned to the next UTC day; exact historical
release times are not certified. Repeated copies across bundles do not add new
independent observations or independent policy events.

The initial requests had gaps, some subsequently repaired. Remaining limitations
and the collection history are retained in the manifest:

- The first explicit date-window Polymarket probability-history requests returned
  HTTP 400, including the CLOB compatibility path. Subsequent public Data API v2
  `prices-history` requests using `interval=max&bucket_seconds=43200` supplied the
  attributed histories above. Their later receipt times remain intact. No old
  order book or synthetic price path was invented to fill the failed request.
- SPY, QQQ, IEF and TLT history was unavailable because the optional Alpha Vantage
  key was not configured. Their series contain zero points and an explicit issue.
  Analysts may import attributed prices or configure the optional provider.
- Initial Treasury DGS2/DGS10 requests returned HTTP 404. A later annual XML
  request using `field_tdr_date_value=2026` supplied the attributed yield history
  above. Original receipt times and the correction history remain visible.
  Treasury yield changes are not treated as bond-fund total returns or PnL.
- Wallet counts cover a bounded recent activity page, not all participants or
  unique people. Holder pages without a full denominator cannot certify market
  concentration. Bounded pages and truncation flags remain visible.
- Quote freshness, spread, depth and protocol/token mapping vary by contract.
  Missing, crossed or stale books must not be replaced with confident price
  estimates, zero spreads or assumed depth.

These gaps are coverage findings, not test failures to conceal. Software tests
can pass while a provider has incomplete data. The UI and exported evidence
retain those limitations and distinguish recorded research from live collection.

## Availability and historical replay

`observed_at` describes the supplied event time; `retrieved_at` is receipt time;
`available_at` is the earliest availability the system can attest for that
observation. A newly downloaded chart may describe old prices while still being
unavailable in a historical run cutoff preceding its receipt. The capture
completion timestamp follows all network responses, so an ordinary current
report can use the responses it just captured.

Descriptive event changes may compare historical prices as known at the report
cutoff. Retrospective aligned timing studies are explicitly experimental and do
not certify tradable lead signals. Historical prediction evaluation separately
requires original feature availability, resolved outcome labels and return
targets. Neither source URLs nor successful replay supply those labels.

The histories permit descriptive timing diagnostics for the better-covered BTC
and Treasury-yield pairs. A number on a short core-CPI history can still have too
few nonoverlapping windows and remains insufficient. Repeated contract-level correlations from one
event are not independent event-level backtest outcomes. Retrospective timing
rows retain `trading_edge=inconclusive` and `predictive_validation=not_established`.

The frozen recordings currently produce these descriptive diagnostics:

| Case | Asset/horizon rows | Non-null PM-lead correlations | Fisher intervals available | Rows meeting the minimum window gate |
| --- | ---: | ---: | ---: | ---: |
| Fed | 105 | 30 | 30 | 15 |
| Core CPI | 210 | 7 | 0 | 0 |
| Recession | 21 | 9 | 7 | 6 |

Same-window correlations are available for the same 46 rows. The 37 available
Fisher intervals are exploratory IID approximations, not autocorrelation-robust
or causal inference. Only 21 rows meet the minimum nonoverlapping-window gate;
all of those remain retrospective and experimental. Core CPI's seven numerical
correlations have too few windows for these intervals or an experimental label.
All 336 displayed asset/horizon rows retain unestablished predictive validation.

The three recorded investigations are therefore **source-backed examples, not a
validated investment benchmark**. They do not establish incremental return alpha,
event calibration or reliable portfolio hedging. `get_evaluation_report` reports
insufficient resolved/held-out evidence rather than filling in performance scores.

## Synthetic controls and empirical benchmark requirements

`evals/v3/run.py` produces 120 explicitly synthetic event groups for a known-signal
control and a no-incremental-signal control. The same conventional baseline is
compared with a model augmented by synthetic event probability and probability
change. Chronological grouping, train-only scaling, label-availability purging,
costs and separate Brier/log-loss scores are exercised. Status remains
`synthetic_only` even when the constructed signal improves prediction.

A real benchmark needs independently sourced, frozen decision features, a
specified conventional-information baseline, point-in-time event rules, resolved
labels, and a fixed asset/horizon return target. Repeated snapshot rows are
deduplicated by event. One should also hold out event families/regimes and test
both directions and reversals before discussing investment increment.

Method details, assumptions and limits are in `docs/METHODOLOGY.md`. To repeat the
software/recording checks without calling any provider:

```sh
PYTHONPATH=services/research/src python -m pytest services/research/tests/v3
PYTHONPATH=services/research/src python evals/v3/run.py
```

To perform a new public collection deliberately:

```sh
PYTHONPATH=services/research/src python scripts/capture_showcases.py --output /absolute/path/new-recordings
```

Use a fresh destination when preserving an earlier capture matters. Provider
responses, public API coverage and retention can change. No availability or
licensing promise for third-party data is inferred from its accessibility.
