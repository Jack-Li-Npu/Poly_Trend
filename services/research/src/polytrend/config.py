from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _openai_api_mode() -> str:
    value = os.getenv("OPENAI_API_MODE", "auto").strip().lower()
    if value not in {"auto", "responses", "chat_completions"}:
        raise ValueError(
            "OPENAI_API_MODE must be auto, responses, or chat_completions"
        )
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    app_env: str = os.getenv("APP_ENV", "development")
    host: str = os.getenv("RESEARCH_HOST", "0.0.0.0")
    port: int = int(os.getenv("RESEARCH_PORT", "8000"))
    gamma_url: str = os.getenv("POLYMARKET_GAMMA_URL", "https://gamma-api.polymarket.com")
    clob_url: str = os.getenv("POLYMARKET_CLOB_URL", "https://clob.polymarket.com")
    live_market_data: bool = _flag("POLYTREND_LIVE_MARKET_DATA", True)
    request_timeout_seconds: float = float(os.getenv("PROVIDER_TIMEOUT_SECONDS", "7"))
    sqlite_path: Path = Path(os.getenv("POLYTREND_SQLITE_PATH", "data/polytrend.db"))
    database_url: str | None = os.getenv("DATABASE_URL")
    redis_url: str | None = os.getenv("REDIS_URL")
    openai_base_url: str = os.getenv(
        "OPENAI_BASE_URL", "https://api.openai.com"
    ).rstrip("/")
    openai_api_mode: str = _openai_api_mode()
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-5.6-terra")
    openai_deep_model: str = os.getenv("OPENAI_DEEP_MODEL", "gpt-5.6-sol")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3.7-flash")


settings = Settings()
