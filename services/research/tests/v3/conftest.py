"""Tests control providers explicitly and never inherit real credentials or database URLs."""

import pytest


@pytest.fixture(autouse=True)
def isolated_provider_environment(monkeypatch):
    for key in ("OPENAI_API_KEY", "FRED_API_KEY", "ALPHA_VANTAGE_API_KEY", "DATABASE_URL"):
        monkeypatch.delenv(key, raising=False)
    # API tests inject controlled providers; disabled-mode tests pass an explicit setting.
    monkeypatch.setenv("POLYTREND_LIVE_MARKET_DATA", "true")
