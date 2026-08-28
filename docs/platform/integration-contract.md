# Poly Trend V2 integration contract

The web app, MCP adapter, worker, and future clients consume the same FastAPI service. The canonical schema is `packages/contracts/openapi/polytrend.openapi.yaml`; generated TypeScript types live in `packages/contracts/src/generated/openapi.ts`.

## Investigation lifecycle

1. `POST /api/v1/investigations` stores a question and refresh policy.
2. `POST /api/v1/investigations/{id}/runs` queues a research run.
3. `GET /api/v1/runs/{id}/events` streams typed public stage events over SSE.
4. `GET /api/v1/runs/{id}` returns the verified result and structured trace.
5. `POST /api/v1/runs/{id}/fork` replays the graph with revised market inclusion.
6. `PATCH /api/v1/investigations/{id}` changes manual/daily refresh or deep mode.

Aliases under `/v1` are provided for non-browser clients. `/healthz`, `/docs`, and `/mcp` are unversioned operational surfaces.

## Numerical evidence boundary

Only markets typed `direct`, `duplicate`, or `complement` can support a numerical answer. Complements are re-oriented before aggregation. Dependent propositions are clustered and discounted. Proxy, correlation, and external-context edges remain visible but never change the point estimate. Missing direct coverage produces `coverage=insufficient` and `probability=null`.

Every supported number must resolve to a stored `MarketSnapshot.id` in `answer.evidence_ids`. The quality gate rejects unsupported output.

## Public events and traces

SSE exposes stages, labels, durations, and counts. The Run Inspector may show retrieval rank changes, provider/fallback metadata, latency, cache state, token totals, estimated cost, checkpoints, and evaluation results. It must not expose hidden reasoning, raw secrets, or authentication headers.

## Provider behavior

Gamma/CLOB calls have bounded timeouts and fall back to stored or seeded evidence. OpenAI and Gemini are optional synthesis layers; deterministic parsing, retrieval, analytics, and templated synthesis stay authoritative. Keys are server-only and must never use a `NEXT_PUBLIC_` prefix.
