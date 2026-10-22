"""Canonical V3 contracts. FastAPI's exported schema also generates the web types."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, model_validator


def utc_now() -> datetime:
    return datetime.now(UTC)


def identifier() -> str:
    return str(uuid4())


class Contract(BaseModel):
    id: str
    event_id: str
    condition_id: str
    question: str
    outcomes: list[str] = Field(default_factory=list)
    token_ids: list[str] = Field(default_factory=list)
    prices: list[float | None] = Field(default_factory=list)
    protocol_version: str = "unknown"
    end_date: datetime | None = None
    resolution_rules: str = ""
    resolution_source: str | None = None
    active: bool = True
    closed: bool = False
    neg_risk: bool = False
    group_label: str | None = None
    group_threshold: float | None = None


class LogicRelation(BaseModel):
    kind: Literal[
        "complement", "exclusive", "exhaustive", "implies", "nested_deadline", "nested_threshold"
    ]
    market_ids: list[str]
    verified: bool = False
    rationale: str


class AttentionSummary(BaseModel):
    market_id: str
    question: str
    probability: float | None = None
    delta_1d_pp: float | None = None
    delta_7d_pp: float | None = None
    delta_30d_pp: float | None = None
    quote_type: str = "unavailable"
    spread_pp: float | None = None
    bid_depth_usd: float | None = None
    ask_depth_usd: float | None = None
    as_of: datetime | None = None
    history_status: str = "insufficient"
    issues: list[str] = Field(default_factory=list)
    score: float | None = None
    comparison_1d_at: datetime | None = None
    comparison_7d_at: datetime | None = None
    comparison_30d_at: datetime | None = None
    window_1d_elapsed_hours: float | None = None
    window_7d_elapsed_hours: float | None = None
    window_30d_elapsed_hours: float | None = None


class EventDefinition(BaseModel):
    id: str
    title: str
    slug: str
    category: str = "other"
    description: str = ""
    source_url: str
    deadline: datetime | None = None
    contracts: list[Contract] = Field(default_factory=list)
    relations: list[LogicRelation] = Field(default_factory=list)
    asset_links: dict[str, str] = Field(default_factory=dict)
    observed_at: datetime = Field(default_factory=utc_now)
    origin: Literal["live", "recorded", "synthetic", "imported"] = "live"
    attention: AttentionSummary | None = None


class Observation(BaseModel):
    id: str = Field(default_factory=identifier)
    provider: str
    kind: str
    external_id: str
    source_url: str
    observed_at: datetime
    retrieved_at: datetime = Field(default_factory=utc_now)
    available_at: datetime
    published_at: datetime | None = None
    origin: Literal["live", "recorded", "synthetic", "imported"] = "live"
    historical_reconstruction: bool = False
    payload: dict[str, Any] = Field(default_factory=dict)
    content_hash: str = ""

    @model_validator(mode="after")
    def seal(self) -> Observation:
        canonical = json.dumps(self.payload, sort_keys=True, separators=(",", ":"), default=str)
        digest = hashlib.sha256(canonical.encode()).hexdigest()
        if self.content_hash and self.content_hash != digest:
            raise ValueError("observation payload does not match its content hash")
        self.content_hash = digest
        return self


class SeriesPoint(BaseModel):
    timestamp: datetime
    value: float
    available_at: datetime | None = None


class MarketSnapshot(BaseModel):
    market_id: str
    condition_id: str
    token_id: str
    outcome: str = "Yes"
    probability: float | None = Field(default=None, ge=0, le=1)
    bid: float | None = Field(default=None, ge=0, le=1)
    ask: float | None = Field(default=None, ge=0, le=1)
    quote_type: Literal["midpoint", "last_trade", "gamma", "unavailable"] = "unavailable"
    as_of: datetime
    spread: float | None = None
    bid_depth_usd: float | None = None
    ask_depth_usd: float | None = None
    tick_size: float | None = None
    fee_rate: float | None = None
    volume_24h_usd: float | None = None
    open_interest_shares: float | None = None
    open_interest_usd: float | None = None
    trade_count: int | None = None
    taker_net_shares: float | None = None
    taker_net_notional_usd: float | None = None
    unique_participants: int | None = None
    top_holder_share: float | None = None
    holder_coverage: str | None = None
    history: list[SeriesPoint] = Field(default_factory=list)
    observation_ids: list[str] = Field(default_factory=list)
    issues: list[str] = Field(default_factory=list)


class AssetSeries(BaseModel):
    symbol: str
    provider: str
    source_url: str
    points: list[SeriesPoint] = Field(default_factory=list)
    observation_ids: list[str] = Field(default_factory=list)
    interval: Literal["daily", "hourly", "minute"] = "daily"
    adjustment: Literal["raw", "split_adjusted", "total_return", "yield", "unknown"] = "raw"
    unit: Literal["USD", "percent", "index"] = "USD"
    issues: list[str] = Field(default_factory=list)


class ContextItem(BaseModel):
    id: str = Field(default_factory=identifier)
    title: str
    source_url: str
    summary: str
    published_at: datetime | None = None
    available_at: datetime
    observation_ids: list[str] = Field(default_factory=list)
    stance: Literal["supporting", "contradicting", "context"] = "context"


class EvidenceBundle(BaseModel):
    event: EventDefinition
    observations: list[Observation] = Field(default_factory=list)
    markets: list[MarketSnapshot] = Field(default_factory=list)
    assets: list[AssetSeries] = Field(default_factory=list)
    context: list[ContextItem] = Field(default_factory=list)
    issues: list[str] = Field(default_factory=list)
    captured_at: datetime = Field(default_factory=utc_now)


class Claim(BaseModel):
    id: str = Field(default_factory=identifier)
    kind: Literal["observation", "calculation", "hypothesis", "scenario"]
    title: str
    text: str
    evidence_ids: list[str] = Field(default_factory=list)
    method: str | None = None
    assumptions: list[str] = Field(default_factory=list)
    status: Literal["source_linked", "experimental", "insufficient", "validated"] = "source_linked"


class InvalidationRule(BaseModel):
    id: str = Field(default_factory=identifier)
    label: str
    market_id: str
    operator: Literal["above", "below"]
    threshold: float = Field(ge=0, le=1)
    state: Literal["pending", "triggered", "clear", "missing", "stale"] = "pending"


class CaseCreate(BaseModel):
    event_id: str
    assets: list[str] = Field(
        default_factory=lambda: ["SPY", "QQQ", "IEF", "TLT", "BTC-USD"], max_length=10
    )
    thesis: str = Field(default="", max_length=4000)
    assumptions: list[str] = Field(default_factory=list, max_length=20)
    rules: list[InvalidationRule] = Field(default_factory=list, max_length=20)
    source_mode: Literal["live", "recorded"] = "live"


class CasePatch(BaseModel):
    thesis: str | None = Field(default=None, max_length=4000)
    assumptions: list[str] | None = Field(default=None, max_length=20)
    rules: list[InvalidationRule] | None = Field(default=None, max_length=20)
    refresh_enabled: bool | None = None
    archived: bool | None = None


class ResearchCase(CaseCreate):
    id: str = Field(default_factory=identifier)
    title: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    revision: int = 1
    refresh_enabled: bool = False
    archived: bool = False
    latest_run_id: str | None = None


class JointPayoffs(BaseModel):
    both: float = Field(ge=-1, le=10)
    first_only: float = Field(ge=-1, le=10)
    second_only: float = Field(ge=-1, le=10)
    neither: float = Field(ge=-1, le=10)


class ScenarioAssumptions(BaseModel):
    probability: float = Field(default=0.7, ge=0, le=1)
    event_return: float = Field(default=0.05, ge=-1, le=10)
    non_event_return: float = Field(default=-0.2, ge=-1, le=10)
    round_trip_cost_bps: float = Field(default=20, ge=0, le=10000)
    capital: float = Field(default=10000, gt=0, le=1e12)
    holding_sessions: int = Field(default=20, ge=1, le=252)
    assumption_source: Literal["user"] = "user"
    joint_probability: float | None = Field(default=None, ge=0, le=1)
    second_event_probability: float | None = Field(default=None, ge=0, le=1)
    joint_payoffs: JointPayoffs | None = None


class RunCreate(BaseModel):
    mode: Literal["refresh", "replay", "scenario", "historical"] = "refresh"
    parent_run_id: str | None = None
    as_of: datetime | None = None
    scenario: ScenarioAssumptions | None = None


class ProgressEvent(BaseModel):
    sequence: int
    stage: str
    message: str
    timestamp: datetime = Field(default_factory=utc_now)


class ResearchRun(BaseModel):
    id: str = Field(default_factory=identifier)
    case_id: str
    mode: Literal["refresh", "replay", "scenario", "historical"] = "refresh"
    status: Literal["queued", "running", "completed", "failed", "cancelled", "interrupted"] = (
        "queued"
    )
    parent_run_id: str | None = None
    as_of: datetime | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    method_version: str = "v3.0.0"
    seed: int = 42
    case_snapshot: ResearchCase | None = None
    bundle_id: str | None = None
    snapshot_hash: str | None = None
    claims: list[Claim] = Field(default_factory=list)
    metrics: dict[str, Any] = Field(default_factory=dict)
    progress: list[ProgressEvent] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    rules: list[InvalidationRule] = Field(default_factory=list)
    scenario: ScenarioAssumptions | None = None
    error: str | None = None


class SimulationRequest(BaseModel):
    assumptions: ScenarioAssumptions
    run_id: str | None = None
    symbol: str | None = None
    decision_at: datetime | None = None


class SimulationResult(BaseModel):
    expected_return: float
    expected_pnl: float
    event_pnl: float
    non_event_pnl: float
    break_even_probability: float | None
    feasible_break_even: bool
    cost_fraction: float
    sensitivity: list[dict[str, float]] = Field(default_factory=list)
    joint_bounds: tuple[float, float] | None = None
    joint_scenario: dict[str, Any] | None = None
    assumption_source: str = "user"
    historical_result: dict[str, Any] | None = None
    limitations: list[str] = Field(default_factory=list)


class CaseDetail(BaseModel):
    case: ResearchCase
    event: EventDefinition
    runs: list[ResearchRun]


class RunDetail(BaseModel):
    run: ResearchRun
    bundle: EvidenceBundle | None = None
    presentation: EvidenceBundle | None = None


class EventList(BaseModel):
    events: list[EventDefinition]
    issues: list[str] = Field(default_factory=list)
    source_mode: Literal["live", "recorded"] = "live"


class ImportRequest(BaseModel):
    symbol: str
    csv: str = Field(max_length=5_000_000)
    source_url: str
    adjustment: Literal["raw", "split_adjusted", "total_return", "yield", "unknown"]


class EvaluationReport(BaseModel):
    method_version: str = "v3.0.0"
    calibration: dict[str, Any] = Field(default_factory=dict)
    asset_prediction: dict[str, Any] = Field(default_factory=dict)
    simulation: dict[str, Any] = Field(default_factory=dict)
    limitations: list[str] = Field(default_factory=list)
