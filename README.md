# Poly Trend V2

Poly Trend V2 is a practical prediction-market research terminal. It turns a measurable question into a saved, inspectable market-implied answer:

`question → hybrid retrieval → relationship map → quantitative aggregation → skeptical verification → saved run`

The product is deliberately a single-analyst tool. It does not include trading, portfolios, authentication, or report-style agent demonstrations.

## What is implemented

- Graph-first Probability Map with a ranked-list alternative and evidence inspector.
- Concurrent Gamma, full-text, local dense, and entity/date candidate generation; Reciprocal Rank Fusion and deterministic reranking.
- Direct, duplicate, complement, proxy, correlation, and external-context relationships.
- Dependency-discounted, liquidity/quality/relevance weighted log-odds aggregation.
- Strict evidence boundary: proxies explain disagreement but never silently change the estimate.
- LangGraph 1.2 fan-out/fan-in runtime, checkpointed runs, one bounded verification correction, SSE progress, fork/replay, and durable investigations.
- Optional OpenAI normal/deep routing with Gemini fallback; useful deterministic operation without any model key.
- PostgreSQL/pgvector and Redis production stack, plus SQLite-WAL local fallback.
- Run Inspector, daily 08:00 Asia/Shanghai refresh, MCP adapter, project-local skill, OpenAPI contracts, retrieval benchmark, and CI.

## Launch

### Complete stack with Docker

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000). API documentation is at [http://localhost:8000/docs](http://localhost:8000/docs).

Provider keys are optional. Without them, retrieval, analytics, verification, persistence, the graph workspace, and seeded demonstration remain useful.

### Windows local launch without Docker

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-local.ps1
```

Stop it with `scripts/stop-local.ps1`.

## Repository map

```text
apps/web                         Next.js analyst terminal
services/research                FastAPI + LangGraph research runtime
packages/contracts               OpenAPI schema and generated TypeScript types
infra/postgres                   pgvector schema and indexes
evals/retrieval                  50-question labelled benchmark
.agents/skills/polytrend-research Project-local analyst skill
```

## Quality commands

```powershell
npm run typecheck
npm run build
.venv\Scripts\python.exe -m pytest services/research/tests
.venv\Scripts\python.exe evals/retrieval/validate_dataset.py
.venv\Scripts\python.exe evals/retrieval/evaluate.py
```

Market prices are signals, not objective truth or financial advice. Every point estimate includes its as-of time, included evidence, range, coverage state, method, freshness, and caveats.
