# Poly Trend V3 research service

FastAPI + LangGraph application service for immutable event observations, saved research cases,
asset-response diagnostics, deterministic replay and hypothetical simulations.

From the repository root, install with `uv sync --project services/research --extra dev`, then run
`uv run --project services/research polytrend-research`. SQLite is the local default. Set
`DATABASE_URL` to use PostgreSQL; database connection failure never falls back to SQLite.

See [the repository guide](../../README.md), [API documentation](../../docs/POLYMARKET_API.md),
and [methodology](../../docs/METHODOLOGY.md). The retired V2 HTTP routes return 410.
