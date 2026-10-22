# V3 evaluation controls

Run from the repository root:

```sh
PYTHONPATH=services/research/src python evals/v3/run.py
python -m pytest services/research/tests/v3/test_analytics.py services/research/tests/v3/test_evaluation.py
```

The default dataset is explicitly **synthetic**. `fixtures.py` creates 120
independent artificial event groups with a known signal and a no-incremental-signal
control. It exercises split mechanics, conventional-versus-augmented models,
forecast scores, costs and scenario arithmetic. It is not a Polymarket backtest,
and it cannot validate forecasting skill or investment value. No provider-owned
recordings or showcase datasets are modified by this script.

For separately sourced real labels:

```sh
python evals/v3/run.py --input /absolute/path/labeled.jsonl --as-of 2026-10-22T00:00:00Z
```

Each row requires `event_id`, `market_id`, `origin`, `decision_at`,
`features_available_at`, `baseline_available_at`, `pm_available_at`,
`label_available_at`, `asset_target_available_at`, `outcome` (0/1),
`baseline_probability`, `pm_probability`, `pm_change`, a fixed-width numeric
`features` list containing conventional inputs, and `asset_return`. All times
must include UTC offsets. Use one explicitly chosen asset and target horizon per
input dataset. Inputs and targets must be created independently of test outcomes.

The earliest eligible decision per event is the prespecified selection rule.
Events are sorted chronologically, split 70/30, and training events whose labels
were not available before the test period are purged. Thirty training and twenty
test events are minimum diagnostic gates, not a statistical power guarantee.
Synthetic controls retain `synthetic_only` status even when the known artificial
signal improves the model. Real-data results remain `experimental`, never a
validated investment recommendation.

See `docs/METHODOLOGY.md` for availability, revision, calendar, payoff and inference
limitations. Saved research snapshots without separately sourced resolved labels
produce `insufficient`, not manufactured calibration metrics.
