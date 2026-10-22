from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class V3Settings:
    sqlite_path: Path = field(
        default_factory=lambda: Path(os.getenv("POLYTREND_SQLITE_PATH", "data/polytrend-v3.db"))
    )
    database_url: str | None = field(default_factory=lambda: os.getenv("DATABASE_URL") or None)
    gamma_url: str = field(
        default_factory=lambda: os.getenv(
            "POLYMARKET_GAMMA_URL", "https://gamma-api.polymarket.com"
        )
    )
    clob_url: str = field(
        default_factory=lambda: os.getenv("POLYMARKET_CLOB_URL", "https://clob.polymarket.com")
    )
    data_url: str = field(
        default_factory=lambda: os.getenv(
            "POLYMARKET_DATA_URL", "https://data-api.polymarket.com/v2"
        )
    )
    live_market_data: bool = field(
        default_factory=lambda: (
            os.getenv("POLYTREND_LIVE_MARKET_DATA", "true").lower() in {"true", "1", "yes"}
        )
    )
    request_timeout_seconds: float = field(
        default_factory=lambda: float(os.getenv("PROVIDER_TIMEOUT_SECONDS", "8"))
    )
    alpha_vantage_api_key: str | None = field(
        default_factory=lambda: os.getenv("ALPHA_VANTAGE_API_KEY") or None
    )
    alpha_vantage_url: str = field(
        default_factory=lambda: os.getenv(
            "ALPHA_VANTAGE_BASE_URL", "https://www.alphavantage.co/query"
        )
    )
    fred_api_key: str | None = field(default_factory=lambda: os.getenv("FRED_API_KEY") or None)
    fred_url: str = field(
        default_factory=lambda: os.getenv("FRED_BASE_URL", "https://api.stlouisfed.org/fred")
    )
    cors_origins: list[str] = field(
        default_factory=lambda: os.getenv(
            "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        ).split(",")
    )
    capture_enabled: bool = field(
        default_factory=lambda: os.getenv("MARKET_CAPTURE_ENABLED", "false").lower() == "true"
    )
    run_timeout_seconds: int = field(
        default_factory=lambda: int(os.getenv("INVESTIGATION_TIMEOUT_SECONDS", "300"))
    )
    refresh_interval_seconds: int = field(
        default_factory=lambda: int(os.getenv("MARKET_SYNC_INTERVAL_SECONDS", "300"))
    )
    host: str = field(default_factory=lambda: os.getenv("RESEARCH_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(os.getenv("RESEARCH_PORT", "8000")))
