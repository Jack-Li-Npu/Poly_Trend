export type RelationType =
  | "direct"
  | "duplicate"
  | "complement"
  | "supporting_proxy"
  | "conflicting_proxy"
  | "measured_correlation"
  | "external_context";

export type CoverageState = "good" | "limited" | "insufficient";
export type RunStatus = "queued" | "running" | "completed" | "failed";

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
}

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
}

export interface Investigation {
  id: string;
  query: string;
  refresh_policy: "manual" | "daily";
  deep_mode: boolean;
  created_at: string;
  updated_at: string;
  latest_run_id?: string | null;
  run_ids: string[];
  next_refresh_at?: string | null;
  archived: boolean;
}

export type WorkspaceView = "graph" | "list";
