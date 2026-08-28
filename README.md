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

### OpenAI-compatible exchange endpoint

Keep model credentials on the backend. Copy `.env.example` to `.env`, then edit these four lines in the root `.env` file:

```dotenv
OPENAI_API_KEY=replace_with_your_exchange_api_key
OPENAI_BASE_URL=https://api.3366.ai
OPENAI_API_MODE=auto
OPENAI_MODEL=replace_with_a_model_id_supported_by_your_exchange
```

`OPENAI_BASE_URL` accepts either a host such as `https://api.3366.ai` or a versioned base such as `https://api.3366.ai/v1`. For a custom host, Poly Trend supports both root-style routes (`/responses`) and standard versioned routes (`/v1/responses`). In `auto` mode, it tries the Responses API and then Chat Completions. Never place the key in `NEXT_PUBLIC_*`, frontend code, or browser storage.

Restart the API and worker after editing `.env`. For the Windows local stack, run `scripts/stop-local.ps1` and then `scripts/dev-local.ps1`. For Docker, recreate the services with `docker compose up --build --force-recreate`.

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
