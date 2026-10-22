FROM ghcr.io/astral-sh/uv:0.9.24 AS uv
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_LINK_MODE=copy
COPY --from=uv /uv /uvx /bin/
WORKDIR /app
COPY services/research/pyproject.toml services/research/uv.lock ./
COPY services/research/README.md ./README.md
COPY services/research/src ./src
RUN uv sync --frozen --no-dev --extra postgres
COPY showcase ./showcase
RUN groupadd --system --gid 1001 polytrend && useradd --system --uid 1001 --gid polytrend --create-home polytrend && mkdir -p /app/data && chown -R polytrend:polytrend /app
ENV PATH="/app/.venv/bin:$PATH" POLYTREND_SHOWCASE_DIR=/app/showcase
USER polytrend
EXPOSE 8000
CMD ["uvicorn", "polytrend.api:app", "--host", "0.0.0.0", "--port", "8000"]
