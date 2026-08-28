FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
RUN groupadd --system --gid 1001 polytrend \
    && useradd --system --uid 1001 --gid polytrend --create-home polytrend

COPY services/research/pyproject.toml ./
COPY README.md ./README.md
COPY services/research/src ./src
RUN python -m pip install --upgrade pip \
    && python -m pip install '.[postgres,redis]'

RUN mkdir -p /app/data && chown -R polytrend:polytrend /app
USER polytrend
EXPOSE 8000
CMD ["uvicorn", "polytrend.api:app", "--host", "0.0.0.0", "--port", "8000"]
