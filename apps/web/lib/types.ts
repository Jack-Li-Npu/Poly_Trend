export type RelationType =
  | "direct"
  | "duplicate"
  | "complement"
  | "supporting_proxy"
  | "conflicting_proxy"
  | "measured_correlation"
  | "external_context";

export type CoverageState = "good" | "limited" | "insufficient";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type InvestigationMode = "fast" | "standard" | "deep";
export type AnswerKind = "market_implied" | "model_estimate" | "directional_assessment" | "insufficient";
export type TargetCondition = "touch" | "close_above" | "close_below";

export interface PricePoint {
  timestamp: string;
  probability: number;
}

export interface QueryIntent {
  proposition: string;
  entities: string[];
  geography?: string | null;
  horizon?: string | null;
  target_year?: number | null;
  outcome: string;
  ambiguous: boolean;
  asset?: string | null;
  symbol?: string | null;
  target_value?: number | null;
  currency?: string;
  target_condition?: TargetCondition | null;
  deadline?: string | null;
  timezone?: string;
  requested_answer_type?: AnswerKind | null;
}

export interface AssetPricePoint { timestamp: string; value: number; }
export interface AssetSnapshot {
  symbol: string; name: string; currency: string; price: number; as_of: string;
  source: string; source_url?: string | null; freshness: string; history: AssetPricePoint[];
}

export interface ForecastEstimate {
  symbol: string; condition: TargetCondition; current_value: number; target_value: number;
  target_gap: number; deadline: string; days_remaining: number; probability: number;
  probability_range: [number, number]; verdict: string; confidence: number;
  realized_volatility_20d: number; model_probabilities: Record<string, number>;
  paths: number; methodology: string; evidence_ids: string[]; as_of: string;
}

export interface MarketSnapshot {
  id: string;
  question: string;
  slug: string;
  event_id?: string | null;
  event_title?: string | null;
  probability: number;
  probability_change_24h: number;
  volume_24h: number;
  volume_total: number;
  liquidity: number;
  open_interest: number;
  best_bid?: number | null;
  best_ask?: number | null;
  spread?: number | null;
  end_date?: string | null;
  resolution_criteria: string;
  resolution_source?: string | null;
  url: string;
  tags: string[];
  retrieval_sources?: string[];
  relevance: number;
  relation_type: RelationType;
  relation_confidence: number;
  relation_reason: string;
  included: boolean;
  quality: number;
  freshness: string;
  history: PricePoint[];
}

export interface RelationshipEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: RelationType;
  confidence: number;
  explanation: string;
  measured_correlation?: number | null;
  observation_count?: number | null;
}

export interface EvidenceItem {
  id: string;
  kind: string;
  title: string;
  source: string;
  url?: string | null;
  published_at?: string | null;
  summary: string;
  supports_numeric_answer: boolean;
  provider?: string | null;
  retrieved_at?: string;
  freshness?: string;
}

export interface SourceCitation { evidence_id: string; title: string; source: string; url?: string | null; supports: string; }
export interface EvidenceNode { id: string; kind: string; label: string; value?: string | null; source?: string | null; relevance: number; included: boolean; evidence_id?: string | null; }
export interface EvidenceGraph { query_node: EvidenceNode; nodes: EvidenceNode[]; edges: RelationshipEdge[]; }
export interface RunBudget { max_workers: number; max_tool_calls: number; max_concurrency: number; timeout_seconds: number; }
export interface ResearchTask { id: string; worker_type: string; objective: string; tools: string[]; depends_on: string[]; required: boolean; }
export interface ResearchPlan { mode: InvestigationMode; tasks: ResearchTask[]; budget: RunBudget; stopping_conditions: string[]; manager_provider: string; manager_model: string; }
export interface WorkerRun { task_id: string; worker_type: string; objective: string; status: string; started_at: string; completed_at: string; duration_ms: number; tool_calls: number; output_count: number; error?: string | null; }
export interface ToolObservation { id: string; task_id: string; tool: string; provider: string; status: string; started_at: string; completed_at: string; duration_ms: number; cached: boolean; retry_count: number; evidence_ids: string[]; error?: string | null; }
export interface RunQualityReport { passed: boolean; supported_numeric_claims: number; missing_evidence_ids: string[]; bounded_corrections: number; warnings: string[]; }

export interface MarketImpliedAnswer {
  conclusion: string;
  label: string;
  probability: number | null;
  market_range: [number, number] | null;
  agreement: number;
  coverage: CoverageState;
  takeaways: string[];
  evidence_ids: string[];
  excluded_market_ids: string[];
  methodology: string;
  caveats: string[];
  as_of: string;
  provider_freshness: Record<string, string>;
  answer_kind?: AnswerKind;
  verdict?: string | null;
  confidence?: number | null;
  current_value?: number | null;
  target_value?: number | null;
  target_gap?: number | null;
  deadline?: string | null;
  days_remaining?: number | null;
  forecast?: ForecastEstimate | null;
  citations?: SourceCitation[];
}

export interface RunEvent {
  sequence: number;
  stage: string;
  label: string;
  status: string;
  timestamp: string;
  duration_ms?: number | null;
  details?: Record<string, unknown>;
}

export interface TraceSpan {
  node: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  input_count: number;
  output_count: number;
  provider: string;
  cached: boolean;
  estimated_cost_usd: number;
}

export interface RunDiff {
  prior_run_id?: string | null;
  probability_change?: number | null;
  added_market_ids: string[];
  removed_market_ids: string[];
  changed_evidence_count: number;
}

export interface ResearchRun {
  id: string;
  investigation_id: string;
  query: string;
  status: RunStatus;
  deep_mode: boolean;
  mode?: InvestigationMode;
  created_at: string;
  updated_at: string;
  intent?: QueryIntent | null;
  markets: MarketSnapshot[];
  relationships: RelationshipEdge[];
  context: EvidenceItem[];
  answer?: MarketImpliedAnswer | null;
  events: RunEvent[];
  traces: TraceSpan[];
  diff?: RunDiff | null;
  error?: string | null;
  plan?: ResearchPlan | null;
  workers?: WorkerRun[];
  tool_observations?: ToolObservation[];
  evidence_graph?: EvidenceGraph | null;
  asset_snapshot?: AssetSnapshot | null;
  forecast?: ForecastEstimate | null;
  quality_report?: RunQualityReport | null;
  cancelled?: boolean;
}

export interface Investigation {
  id: string;
  query: string;
  refresh_policy: "manual" | "daily";
  deep_mode: boolean;
  mode?: InvestigationMode;
  created_at: string;
  updated_at: string;
  latest_run_id?: string | null;
  run_ids: string[];
  next_refresh_at?: string | null;
  archived: boolean;
}

export type WorkspaceView = "graph" | "list";
