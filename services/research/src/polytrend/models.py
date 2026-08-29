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
    CANCELLED = "cancelled"


class InvestigationMode(StrEnum):
    FAST = "fast"
    STANDARD = "standard"
    DEEP = "deep"


class AnswerKind(StrEnum):
    MARKET_IMPLIED = "market_implied"
    MODEL_ESTIMATE = "model_estimate"
    DIRECTIONAL_ASSESSMENT = "directional_assessment"
    INSUFFICIENT = "insufficient"


class TargetCondition(StrEnum):
    TOUCH = "touch"
    CLOSE_ABOVE = "close_above"
    CLOSE_BELOW = "close_below"


class WorkerStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


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


class AssetPricePoint(BaseModel):
    timestamp: datetime
    value: float = Field(gt=0)


class QueryIntent(BaseModel):
    proposition: str
    entities: list[str] = Field(default_factory=list)
    geography: str | None = None
    horizon: str | None = None
    target_year: int | None = None
    outcome: str = "yes"
    ambiguous: bool = False
    asset: str | None = None
    symbol: str | None = None
    target_value: float | None = Field(default=None, gt=0)
    currency: str = "USD"
    target_condition: TargetCondition | None = None
    deadline: datetime | None = None
    timezone: str = "Asia/Shanghai"
    requested_answer_type: AnswerKind | None = None


class AssetSnapshot(BaseModel):
    symbol: str
    name: str
    currency: str = "USD"
    price: float = Field(gt=0)
    as_of: datetime
    source: str
    source_url: str | None = None
    freshness: str = "live"
    history: list[AssetPricePoint] = Field(default_factory=list)


class ForecastEstimate(BaseModel):
    symbol: str
    condition: TargetCondition
    current_value: float = Field(gt=0)
    target_value: float = Field(gt=0)
    target_gap: float
    deadline: datetime
    days_remaining: float = Field(ge=0)
    probability: float = Field(ge=0, le=1)
    probability_range: tuple[float, float]
    verdict: str
    confidence: float = Field(ge=0, le=1)
    realized_volatility_20d: float = Field(ge=0)
    model_probabilities: dict[str, float] = Field(default_factory=dict)
    paths: int = 20_000
    methodology: str
    evidence_ids: list[str] = Field(default_factory=list)
    as_of: datetime = Field(default_factory=utc_now)


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
    provider: str | None = None
    retrieved_at: datetime = Field(default_factory=utc_now)
    freshness: str = "unknown"


class SourceCitation(BaseModel):
    evidence_id: str
    title: str
    source: str
    url: str | None = None
    supports: str


class EvidenceNode(BaseModel):
    id: str
    kind: str
    label: str
    value: str | None = None
    source: str | None = None
    relevance: float = Field(default=0.5, ge=0, le=1)
    included: bool = True
    evidence_id: str | None = None


class EvidenceGraph(BaseModel):
    query_node: EvidenceNode
    nodes: list[EvidenceNode] = Field(default_factory=list)
    edges: list[RelationshipEdge] = Field(default_factory=list)


class RunBudget(BaseModel):
    max_workers: int
    max_tool_calls: int
    max_concurrency: int
    timeout_seconds: int


class ResearchTask(BaseModel):
    id: str
    worker_type: str
    agent_name: str = "Legacy worker"
    objective: str
    tools: list[str] = Field(default_factory=list)
    depends_on: list[str] = Field(default_factory=list)
    wave: int = Field(default=1, ge=1, le=3)
    query_variant: str | None = None
    deliver_to: str = "evidence_desk"
    success_criteria: list[str] = Field(default_factory=list)
    parameters: dict[str, Any] = Field(default_factory=dict)
    required: bool = True


class ResearchPlan(BaseModel):
    mode: InvestigationMode
    tasks: list[ResearchTask]
    budget: RunBudget
    stopping_conditions: list[str] = Field(default_factory=list)
    manager_provider: str = "deterministic"
    manager_model: str = "policy-v1"


class ToolObservation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    task_id: str
    tool: str
    provider: str
    status: str
    started_at: datetime
    completed_at: datetime
    duration_ms: int
    cached: bool = False
    retry_count: int = 0
    evidence_ids: list[str] = Field(default_factory=list)
    error: str | None = None


class WorkerRun(BaseModel):
    task_id: str
    worker_type: str
    agent_name: str = "Legacy worker"
    wave: int = 1
    objective: str
    status: WorkerStatus
    started_at: datetime
    completed_at: datetime
    duration_ms: int
    tool_calls: int = 0
    output_count: int = 0
    input_evidence_ids: list[str] = Field(default_factory=list)
    output_evidence_ids: list[str] = Field(default_factory=list)
    public_summary: str = ""
    error: str | None = None


class AgentMessage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    sequence: int
    from_agent: str
    to_agent: str
    message_type: str
    summary: str
    task_id: str | None = None
    evidence_ids: list[str] = Field(default_factory=list)
    timestamp: datetime = Field(default_factory=utc_now)


class DecisionRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    agent: str
    decision: str
    rationale_summary: str
    evidence_ids: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.5, ge=0, le=1)
    timestamp: datetime = Field(default_factory=utc_now)


class AnalysisFinding(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    task_id: str
    agent_name: str
    summary: str
    evidence_ids: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.5, ge=0, le=1)


class RunQualityReport(BaseModel):
    passed: bool = False
    supported_numeric_claims: int = 0
    missing_evidence_ids: list[str] = Field(default_factory=list)
    bounded_corrections: int = 0
    warnings: list[str] = Field(default_factory=list)


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
    answer_kind: AnswerKind = AnswerKind.MARKET_IMPLIED
    verdict: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    current_value: float | None = None
    target_value: float | None = None
    target_gap: float | None = None
    deadline: datetime | None = None
    days_remaining: float | None = None
    forecast: ForecastEstimate | None = None
    citations: list[SourceCitation] = Field(default_factory=list)


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
    mode: InvestigationMode = InvestigationMode.STANDARD
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
    plan: ResearchPlan | None = None
    workers: list[WorkerRun] = Field(default_factory=list)
    tool_observations: list[ToolObservation] = Field(default_factory=list)
    evidence_graph: EvidenceGraph | None = None
    asset_snapshot: AssetSnapshot | None = None
    forecast: ForecastEstimate | None = None
    quality_report: RunQualityReport | None = None
    agent_messages: list[AgentMessage] = Field(default_factory=list)
    decision_records: list[DecisionRecord] = Field(default_factory=list)
    analysis_findings: list[AnalysisFinding] = Field(default_factory=list)
    cancelled: bool = False


class Investigation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    query: str = Field(min_length=4, max_length=500)
    refresh_policy: RefreshPolicy = RefreshPolicy.MANUAL
    deep_mode: bool = False
    mode: InvestigationMode = InvestigationMode.STANDARD
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
    mode: InvestigationMode = InvestigationMode.STANDARD


class InvestigationPatch(BaseModel):
    refresh_policy: RefreshPolicy | None = None
    deep_mode: bool | None = None
    archived: bool | None = None
    mode: InvestigationMode | None = None


class RunCreate(BaseModel):
    included_market_ids: list[str] | None = None
    mode: InvestigationMode | None = None


class ForkCreate(BaseModel):
    included_market_ids: list[str]
