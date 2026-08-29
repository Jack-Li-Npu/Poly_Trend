# Poly Trend V2 — Installation and Usage Guide

Poly Trend V2 turns a measurable forecasting question into a probability map, a concise answer, and inspectable market evidence. It is designed for research and demonstration—not trading or financial advice.

![Recession research example](images/poly-trend-recession-case.png)

## 1. Launch locally on Windows

Requirements:

- Node.js 22
- Python 3.12
- PowerShell

From the project root:

```powershell
npm install
python -m venv .venv
.venv\Scripts\python.exe -m pip install -e "services/research[test]"
Copy-Item .env.example .env
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-local.ps1
```

Open:

- Web application: <http://localhost:3000>
- API documentation: <http://localhost:8000/docs>

Stop the local services with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop-local.ps1
```

## 2. Launch with Docker

```powershell
Copy-Item .env.example .env
docker compose up --build
```

This starts the web application, research API, worker, PostgreSQL/pgvector, and Redis.

## 3. Configure providers

Secrets belong only in the root `.env` file. Never place provider keys in frontend variables, browser storage, screenshots, or committed files.

```dotenv
# Optional model manager and synthesis layer
OPENAI_API_KEY=replace_with_your_key
OPENAI_BASE_URL=https://api.openai.com
OPENAI_API_MODE=auto
OPENAI_MODEL=replace_with_a_supported_model
OPENAI_DEEP_MODEL=replace_with_a_supported_deep_model

# Required for Gold spot/history forecasts
ALPHA_VANTAGE_API_KEY=replace_with_your_key

# Optional official macro series
FRED_API_KEY=replace_with_your_key
```

Polymarket and GDELT use public endpoints. After editing `.env`, restart the local services. Check provider readiness at <http://localhost:8000/api/v1/providers/health>.

## 4. Example cases

The application includes three clickable examples below the search bar.

### Case A: Prediction-market aggregation

```text
Will the U.S. enter a recession before the end of 2027?
```

Expected behavior:

- Finds direct recession markets and nearby time horizons.
- Separates complementary and proxy markets.
- Produces a market-implied probability only from comparable evidence.
- Shows resolution criteria, liquidity, market range, agreement, and source links.

### Case B: Asset barrier forecast

```text
Will gold reach $5,000 this month?
```

Expected behavior with `ALPHA_VANTAGE_API_KEY` configured:

- Resolves “this month” to an explicit Asia/Shanghai deadline.
- Retrieves current XAU/USD and daily history.
- Runs the reproducible GBM and block-bootstrap barrier ensemble.
- Presents the model estimate separately from related Polymarket signals.

Without a valid price-data key, the correct result is `Insufficient evidence`; related prediction-market prices are never substituted for the requested forecast.

### Case C: Policy-event research

```text
Will the Federal Reserve cut rates before the end of 2026?
```

Expected behavior:

- Searches direct and complementary rate-policy markets.
- Uses official macro context as supporting evidence only.
- Excludes unrelated markets from the numerical estimate.

## 5. Research depth

| Mode | Work performed | Typical use |
|---|---|---|
| Fast | 3 source tasks | Quick evidence scan |
| Standard | 9+ source, analysis, and review tasks | Default research workflow |
| Deep | 17+ tasks, five market searches, additional audits, two reviews | Difficult or high-ambiguity questions |

The modes change actual work performed; they are not artificial delays. Deep mode is slower because it retrieves and verifies more independent evidence.

## 6. Reading the result

- **Market-implied answer:** derived from direct, comparable prediction markets.
- **Model-estimated scenario:** derived from asset history and deterministic simulations.
- **Market range:** disagreement among eligible markets, not a confidence interval.
- **Coverage:** whether enough fresh, comparable evidence was available.
- **Supporting proxy:** contextual evidence that does not change the numerical estimate.
- **Insufficient evidence:** the system deliberately declined to fabricate a probability.

## 7. Quality checks

```powershell
npm run typecheck
npm run build
.venv\Scripts\python.exe -m pytest services/research/tests
.venv\Scripts\python.exe evals/retrieval/validate_dataset.py
.venv\Scripts\python.exe evals/retrieval/evaluate.py
.venv\Scripts\python.exe evals/orchestration_benchmark.py --tasks 90 --concurrency 8
```

The final estimate is always labelled as market-implied or model-estimated and should not be interpreted as objective truth or financial advice.
