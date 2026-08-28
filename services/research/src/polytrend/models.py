from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class RefreshPolicy(StrEnum):
    MANUAL = "manual"
    DAILY = "daily"


class RunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class CoverageState(StrEnum):
    GOOD = "good"
    LIMITED = "limited"
    INSUFFICIENT = "insufficient"


class RelationType(StrEnum):
    DIRECT = "direct"
    DUPLICATE = "duplicate"
    COMPLEMENT = "complement"
    SUPPORTING_PROXY = "supporting_proxy"
    CONFLICTING_PROXY = "conflicting_proxy"
    MEASURED_CORRELATION = "measured_correlation"
    EXTERNAL_CONTEXT = "external_context"


class PricePoint(BaseModel):
    timestamp: datetime
    probability: float = Field(ge=0, le=1)


class QueryIntent(BaseModel):
    proposition: str
    entities: list[str] = Field(default_factory=list)
    geography: str | None = None
    horizon: str | None = None
    target_year: int | None = None
    outcome: str = "yes"
    ambiguous: bool = False


class MarketSnapshot(BaseModel):
    id: str
    question: str
    slug: str
    event_id: str | None = None
    event_title: str | None = None
    clob_token_id: str | None = None
    probability: float = Field(ge=0, le=1)
    probability_change_24h: float = 0
    volume_24h: float = 0
    volume_total: float = 0
    liquidity: float = 0
    open_interest: float = 0
    best_bid: float | None = None
    best_ask: float | None = None
    spread: float | None = None
    end_date: datetime | None = None
    resolution_criteria: str = ""
    resolution_source: str | None = None
    url: str
    tags: list[str] = Field(default_factory=list)
    retrieval_sources: list[str] = Field(default_factory=list)
    relevance: float = Field(default=0, ge=0, le=1)
    relation_type: RelationType = RelationType.DIRECT
    relation_confidence: float = Field(default=0.5, ge=0, le=1)
    relation_reason: str = ""
    included: bool = True
    quality: float = Field(default=0.5, ge=0, le=1)
    freshness: str = "live"
    history: list[PricePoint] = Field(default_factory=list)


class MarketCandidate(BaseModel):
    market: MarketSnapshot
    lexical_rank: int | None = None
    semantic_rank: int | None = None
    provider_rank: int | None = None
    entity_rank: int | None = None
    rrf_score: float = 0
    rerank_score: float = 0


class RelationshipEdge(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    source_id: str
    target_id: str
    relation_type: RelationType
    confidence: float = Field(ge=0, le=1)
    explanation: str
    measured_correlation: float | None = Field(default=None, ge=-1, le=1)
    observation_count: int | None = None


class EvidenceItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    kind: str
    title: str
    source: str
    url: str | None = None
    published_at: datetime | None = None
    summary: str = ""
    supports_numeric_answer: bool = False


class MarketImpliedAnswer(BaseModel):
    conclusion: str
    label: str
    probability: float | None = Field(default=None, ge=0, le=1)
    market_range: tuple[float, float] | None = None
    agreement: float = Field(default=0, ge=0, le=1)
    coverage: CoverageState
    takeaways: list[str] = Field(default_factory=list, max_length=3)
    evidence_ids: list[str] = Field(default_factory=list)
    excluded_market_ids: list[str] = Field(default_factory=list)
    methodology: str
    caveats: list[str] = Field(default_factory=list)
    as_of: datetime = Field(default_factory=utc_now)
    provider_freshness: dict[str, str] = Field(default_factory=dict)


class RunEvent(BaseModel):
    sequence: int
    stage: str
    label: str
    status: str = "completed"
    timestamp: datetime = Field(default_factory=utc_now)
    duration_ms: int | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class TraceSpan(BaseModel):
    node: str
    started_at: datetime
    completed_at: datetime
    duration_ms: int
    input_count: int = 0
    output_count: int = 0
    provider: str = "deterministic"
    cached: bool = False
    estimated_cost_usd: float = 0


class RunDiff(BaseModel):
    prior_run_id: str | None = None
    probability_change: float | None = None
    added_market_ids: list[str] = Field(default_factory=list)
    removed_market_ids: list[str] = Field(default_factory=list)
    changed_evidence_count: int = 0


class ResearchRun(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    investigation_id: str
    query: str
    status: RunStatus = RunStatus.QUEUED
    deep_mode: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    intent: QueryIntent | None = None
    markets: list[MarketSnapshot] = Field(default_factory=list)
    relationships: list[RelationshipEdge] = Field(default_factory=list)
    context: list[EvidenceItem] = Field(default_factory=list)
    answer: MarketImpliedAnswer | None = None
    events: list[RunEvent] = Field(default_factory=list)
    traces: list[TraceSpan] = Field(default_factory=list)
    diff: RunDiff | None = None
    error: str | None = None


class Investigation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    query: str = Field(min_length=4, max_length=500)
    refresh_policy: RefreshPolicy = RefreshPolicy.MANUAL
    deep_mode: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    latest_run_id: str | None = None
    run_ids: list[str] = Field(default_factory=list)
    next_refresh_at: datetime | None = None
    archived: bool = False


class InvestigationCreate(BaseModel):
    query: str = Field(min_length=4, max_length=500)
    refresh_policy: RefreshPolicy = RefreshPolicy.MANUAL
    deep_mode: bool = False


class InvestigationPatch(BaseModel):
    refresh_policy: RefreshPolicy | None = None
    deep_mode: bool | None = None
    archived: bool | None = None


class RunCreate(BaseModel):
    included_market_ids: list[str] | None = None


class ForkCreate(BaseModel):
    included_market_ids: list[str]

