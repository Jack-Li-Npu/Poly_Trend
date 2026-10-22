# Poly Trend V3 verification

22 October 2026. The work was developed on `codex/poly-trend-v3`, isolated from the older dirty checkout.

## Automated evidence

- Python integration/regression suite: 59 passing tests under the frozen Python dependency lock.
- Seven frontend regressions plus strict TypeScript: passing.
- Production Next.js 16.4.2 build using Turbopack: passing in the managed worktree.
- npm dependency audit: zero reported vulnerabilities after patched dependencies.
- Canonical OpenAPI export and generated TypeScript: regenerated from the locked FastAPI/Pydantic runtime.
- Synthetic chronological evaluator: positive and negative controls, high-probability/negative-return check pass; results labelled synthetic only.
- Three genuine recorded investigations: source payload hashes and manifest file hashes verified offline.
- Durable case/revision persistence, interrupted-run recovery, deterministic numerical replay, SSE resume cursor,
  cancellation (including another process), invalid joint probability, missing data, credentials in failure bodies,
  historical availability, imported provenance and retired V2 numerical routes have regression coverage. Historical quote/chart presentation and cancelling a task before it starts are covered separately from numerical checks.

## Browser evidence

At 390, 768 and 1440 CSS pixels, document width equals viewport width. Wide tables scroll within
panels; narrow navigation becomes a sidebar drawer. Verified recorded discovery, exact-outcome
selection, case creation/run completion, scenario calculation, replay, evidence inspection and
saved-case recovery. The 70% / +5% / −20% scenario with 20bp costs returns −2.70% and an 80.8%
break-even probability. When the API is stopped, refresh displays a failure and retains the
selected saved run. Restart restores the same saved case. Empty search returns a clear empty state.

Screenshots: [desktop](docs/images/poly-trend-v3-desktop.png), [mobile](docs/images/poly-trend-v3-mobile.png), [historical cutoff](docs/images/poly-trend-v3-historical.png), [failed refresh](docs/images/poly-trend-v3-failed-refresh.png), [evidence drawer](docs/images/poly-trend-v3-evidence.png). They depict explicitly recorded
observations, not a continuously live terminal or a validated strategy.

## Limits of verification

Docker Compose configuration validates, but the local Docker daemon is unavailable; the images
and PostgreSQL runtime have not been exercised here. SQLite is exercised by integration tests.
The optional Alpha Vantage and FRED credentials and optional model review are not exercised against
paid/keyed services. Missing ETF data remains visible. Public REST capture succeeded; stream
reconnect/reconciliation behavior is tested with controlled sockets, without a long-running live
stream endurance test. Three unresolved event families cannot validate investment alpha.
