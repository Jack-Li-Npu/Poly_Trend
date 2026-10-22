# Poly Trend V3 methodology

Poly Trend measures event expectations and their association with asset prices.
An event probability is not an asset expected return. The current methods are
deterministic research diagnostics. Neither a saved research run nor an attractive
chart establishes a causal effect, an executable arbitrage, or return alpha.

## Availability, vintages and replay

Every time must include a timezone offset and is compared in UTC. The default
analysis cutoff is the bundle's captured timestamp, making replay independent of
the machine clock. `as_of` overrides it. Observations unavailable by that cutoff
and market snapshots referring to them are excluded. A later-captured event
definition cannot certify the semantics of an earlier historical investigation.
Observation content hashes provide tamper detection, not proof of source truth.

Duplicate series timestamps represent revisions. At a cutoff, the latest revision
whose `available_at` is no later than the cutoff is selected. Missing availability
is assumed equal to the observation timestamp for descriptive analytics and is
explicitly flagged. That assumption cannot certify point-in-time historical
investment evaluation.

The 1/7/30-day expectation changes compare the snapshot to the most recent history
point at or before the target timestamp, using the history vintage available at
the **report cutoff**. A point more than one day behind the requested target is
not substituted. These changes describe history as currently known. They do not
claim the historical price was available to a trader at its original timestamp.
Reconstructed retrospective histories must remain labeled as such.
Each change includes its actual comparison timestamp and elapsed hours, because
a coarse series can make a nominal one-day comparison span longer than 24 hours.

Asset timing diagnostics distinguish two modes. `point_in_time_descriptive`
uses the vintage available at each anchor. `retrospective_descriptive` aligns
historical prices known at the report cutoff, including later-retrieved or
revised history. The latter permits useful descriptive timing studies but cannot
establish historical decision availability. It always reports trading edge as
inconclusive and predictive validation as not established. Its correlations
cannot be reused as a simulated trading signal. Neither mode includes data
unavailable at the report cutoff. The separately labeled prediction benchmark
retains its strict original feature-availability gate.

## Probability, book quality and logical bounds

Probabilities remain attached to their own contract, outcome token, rules and
deadline. No averaging merges different horizons or opposite payoffs. The system
does not reinterpret a below-threshold proposition as a complement merely because
its text contains "below". No lexical-similarity edge can support a numeric
probability synthesis; the V2 heuristic synthesis path is retired from V3.
Observed prices can reflect beliefs, risk preferences, hedging demand and trading
frictions. They are not certified physical probabilities. Option-implied
risk-neutral probabilities also need not equal real-world event frequencies.
These interpretation limits are discussed by
[Wolfers and Zitzewitz](https://www.nber.org/papers/w12200) and in
[Federal Reserve research on uncertainty](https://www.federalreserve.gov/econres/ifdp/files/ifdp1294.pdf).

Book diagnostics expose supplied two-sided spreads, depth, quote age, participant
or concentration coverage when available, and missing/crossed quotes. A spread
above five percentage points and age above one hour are transparent diagnostic
flags, not empirically calibrated thresholds or confidence scores. Unknown depth
remains unknown. A displayed book does not guarantee that all shown size will
remain executable.

Only `verified=true` relations enter marginal constraints. Relations must have
distinct contract IDs; complements have exactly two. For `implies`,
`nested_deadline` and `nested_threshold`, IDs are ordered **subset/narrower first,
superset/broader second**. Direction must be established from exact payoff rules,
not inferred from numeric threshold order alone. A higher threshold is a subset
for an above-threshold payoff, but that reverses for a below-threshold payoff.

The implemented constraints are:

- Complement: the two marginal probabilities sum to one.
- Exclusive family: marginal probabilities sum to at most one.
- Exhaustive family: marginal probabilities sum to at least one.
- Verified implication or nesting: subset probability does not exceed superset
  probability.

Two-sided bid/ask intervals are narrowed by repeated interval propagation. Missing
or crossed books supply `[0,1]`, not fabricated precision. Infeasible quote
constraints are reported without silently renormalizing observations. A verified
exclusive **and** exhaustive family, or a verified complement pair, can expose a
partition. Nested thresholds expose differences for covered intervals; they are
not labeled a complete distribution without support for all tails.
An exclusive family without verified exhaustiveness is displayed as a partial
family with an unallocated-mass interval. It does not invent a missing outcome's
point probability or renormalize the listed outcomes to one.

These are necessary marginal bounds. Interval propagation is a relaxation of
global joint feasibility, not a complete linear-programming proof. No joint
distribution, causal graph, outcome independence or point forecast is invented.
Quoted intervals are price bounds under the stated marginal constraints, not
statistical confidence intervals or bounds on the true event probability.

## Asset response and sessions

For each linked market/asset pair, 1, 5 and 20 **observed daily-session** horizons
are evaluated in nonoverlapping two-sided windows. Each row reports the
correlation of past probability changes with subsequent asset changes, the reverse
direction, the same-window (contemporaneous) association, and the correlation of past with subsequent asset returns as a simple
reversal diagnostic. Probability changes are differences in probability levels,
not percentage asset returns. Yield series produce basis-point changes, never an
investable bond-return interpretation.

The actual supplied session timestamps define the calendar. The method does not
assume that Friday's next session is Saturday or manufacture holiday observations.
Missing sessions are not imputed, so incomplete feeds can span longer calendar
periods. Intraday bars are not counted as daily sessions. Unknown adjustment bases
prevent return comparability.

Twelve nonoverlapping windows are a minimum descriptive gate. Conditional on that
gate, an absolute lead/lag correlation of at least 0.30 exceeding the reverse
direction by at least 0.15 receives an `experimental` lead label; negative
return autocorrelation below -0.30 can receive an experimental reversal label.
Otherwise the label is `inconclusive`. These thresholds are transparent display
heuristics, not significance tests. Rows always expose both directions and
sample counts. Repeated windows from one event remain **one event**, and even
nonoverlapping windows need not be statistically independent. No causal inference
or universal return-prediction claim follows from these correlations.

Each nondegenerate correlation with more than three windows includes an
exploratory 95% Fisher-z interval, using `atanh(r) +/- 1.96/sqrt(n-3)` and the
inverse transform. This IID approximation is not robust to autocorrelation,
event clustering, nonstationarity or selecting many markets/horizons. It is not a
causal or investment confidence interval. A directional display label additionally
requires its interval to exclude zero; a reversal label requires the upper bound
below zero. These gates do not turn the approximation into a validated inference.

## Scenario arithmetic and dependence

The two-state scenario computes
`p * event_return + (1 - p) * non_event_return - round_trip_cost_bps / 10000`.
Returns are fractions of starting capital. Conditional scenario returns are user
assumptions. An unsupported `historical_estimate` source label is not accepted;
a separately validated point-in-time estimator would be needed to introduce it.
Conditional returns are not generated from a probability alone.

For example, a 70% event probability with a +5% event-state return and -20%
non-event-state return produces -2.7% after 20 bps costs. Break-even probability
is 80.8%. High event probability can coexist with negative expected asset return.
If conditional returns are equal, there is no probability break-even boundary.
If the event-state return is lower, the profitable inequality reverses.

Sensitivity covers changes in probability and round-trip cost. When two marginal
probabilities are supplied, joint probability is bounded by
`max(0,p+q-1) <= P(A and B) <= min(p,q)`. A supplied joint assumption outside
these Frechet bounds is rejected. Marginals are never multiplied silently.
The second event does not change two-state PnL without a specified four-state
payoff model.

When four conditional payoffs are explicitly supplied (`both`, `first_only`,
`second_only`, `neither`), the separate joint stress calculation uses state
weights `(j, p-j, q-j, 1-p-q+j)`. Its expected return after the declared cost is
linear in the feasible joint probability `j`, so worst/best expectations are
calculated at both Frechet endpoints. Without a declared joint probability the
result contains only that dependence range, with no point estimate. If a joint
probability is declared and feasible, its weights and expectation are shown
separately as an assumption. No independence value `p*q` is substituted. The
single-event scenario's headline return remains separate and unchanged. Four
payoffs without a second marginal probability are rejected.

## Historical paper marks

`paper_evaluate` is an ex-post, long-only, daily-close **proxy**. It requires an
explicit availability timestamp and known adjustment metadata. A decision needs
at least one previously available price. Entry is the first valid recorded daily
session strictly after the decision timestamp; exit follows the requested number
of further observed sessions. Revisions unavailable at a marked timestamp are
excluded. Entry and exit timestamps and the `next_observed_session_close` proxy
are returned explicitly.

This does not claim execution at the next session's open or a guaranteed close
fill. Raw prices omit cash distributions; split-adjusted prices are not total
returns; total-return adjustment must be sourced and vintage-aware. Current
backfilled adjusted history is not automatically a historically available
decision series. Yield-only series, missing availability, unsupported intervals,
unknown adjustment bases and inadequate future sessions produce `unavailable`.
Round-trip costs are deducted once from starting capital; financing, taxes,
borrow fees and partial fills are excluded.

## Evaluation: event forecasts versus investment increment

Resolved point-in-time labels are separately sourced. Saved snapshots are not
resolved event outcomes. `get_evaluation_report` reports the saved inventory as
insufficient until such labels and a conventional baseline are provided.

`evaluate_records` accepts a fixed asset/horizon dataset with event and market
identity, feature-availability timestamps, label-availability timestamps,
conventional features, baseline/Polymarket probabilities and subsequent returns.
Naive times, non-finite values, invalid probabilities, features unavailable at
decision time, decisions after their labels, and outcomes unavailable at the
evaluation cutoff are rejected.

One earliest eligible snapshot per event is selected by a prespecified rule;
repeated refreshes do not increase the independent sample. Events are ordered by
decision timestamp and split 70/30. Training rows whose outcome or return labels
were not known before the first test decision are purged. No event appears on
both sides. Thirty training and twenty test events are minimum diagnostic gates,
not a power calculation or evidence of external validity.

Forecast calibration reports Brier score, log loss and reliability bins separately
for conventional and prediction-market probabilities on held-out event groups.
It is not an investment score.

Investment evaluation compares a conventional-feature ridge regression with the
identical estimator augmented by event probability and probability change.
Standardization is fitted on training events only; the ridge coefficient is fixed
at `1e-6`. Test MSE, sign accuracy and a fixed sign-policy paper-return summary
are reported. A seeded event-level bootstrap gives an exploratory interval for
MSE improvement when at least twenty test events exist. This is conditional on
the fitted model and one chronological split. It does not establish strategy
profitability, independence across related event families, or causal transmission.

Conventional inputs must include the information actually available to investors
that could explain the signal: relevant prices and returns, futures/rate curves,
options uncertainty, credit conditions and vintage macro releases. A weak
conventional baseline cannot establish useful increment. Real deployment requires
multiple chronological folds, event-family/regime holdouts, a power-aware sample,
prespecified horizons, multiple-testing controls, and a prospective frozen log.

The CLI's positive and negative controls are explicitly synthetic. They test
arithmetic and leakage barriers only. Their status remains `synthetic_only`
regardless of scores. Real labeled results remain `experimental`. The product
does not emit a `validated` alpha badge from these diagnostics.
