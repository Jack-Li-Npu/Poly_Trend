/**
 * Generated contract surface for Poly Trend V2.
 * Regenerate from openapi/polytrend.openapi.yaml with `npm run generate`.
 */
export interface paths {
  "/api/v1/investigations": {
    post: operations["createInvestigation"];
  };
  "/api/v1/investigations/{id}": {
    get: operations["getInvestigation"];
    patch: operations["updateInvestigation"];
  };
  "/api/v1/investigations/{id}/runs": {
    post: operations["createRun"];
  };
  "/api/v1/runs/{id}": {
    get: operations["getRun"];
  };
  "/api/v1/runs/{id}/events": {
    get: operations["streamRunEvents"];
  };
  "/api/v1/runs/{id}/fork": {
    post: operations["forkRun"];
  };
  "/api/v1/markets/{id}": {
    get: operations["getMarket"];
  };
  "/api/v1/providers/health": {
    get: operations["getProviderHealth"];
  };
}

export interface components {
  schemas: {
    QueryIntent: {
      proposition: string;
      entities?: string[];
      geography?: string | null;
      horizon?: string | null;
      target_year?: number | null;
      outcome?: string;
      ambiguous?: boolean;
    };
    PricePoint: { timestamp: string; probability: number };
    MarketSnapshot: {
      id: string;
      question: string;
      slug: string;
      event_id?: string | null;
      event_title?: string | null;
      clob_token_id?: string | null;
      probability: number;
      probability_change_24h?: number;
      volume_24h?: number;
      volume_total?: number;
      liquidity?: number;
      open_interest?: number;
      best_bid?: number | null;
      best_ask?: number | null;
      spread?: number | null;
      end_date?: string | null;
      resolution_criteria?: string;
      resolution_source?: string | null;
      url: string;
      tags?: string[];
      retrieval_sources?: string[];
      relevance?: number;
      relation_type?: components["schemas"]["RelationType"];
      relation_confidence?: number;
      relation_reason?: string;
      included?: boolean;
      quality?: number;
      freshness?: string;
      history?: components["schemas"]["PricePoint"][];
    };
    RelationType:
      | "direct"
      | "duplicate"
      | "complement"
      | "supporting_proxy"
      | "conflicting_proxy"
      | "measured_correlation"
      | "external_context";
    RelationshipEdge: {
      id: string;
      source_id: string;
      target_id: string;
      relation_type: components["schemas"]["RelationType"];
      confidence: number;
      explanation: string;
      measured_correlation?: number | null;
      observation_count?: number | null;
    };
    EvidenceItem: {
      id: string;
      kind: string;
      title: string;
      source: string;
      url?: string | null;
      published_at?: string | null;
      summary?: string;
      supports_numeric_answer?: boolean;
    };
    MarketImpliedAnswer: {
      conclusion: string;
      label: string;
      probability?: number | null;
      market_range?: [number, number] | null;
      agreement: number;
      coverage: "good" | "limited" | "insufficient";
      takeaways?: string[];
      evidence_ids?: string[];
      excluded_market_ids?: string[];
      methodology: string;
      caveats?: string[];
      as_of: string;
      provider_freshness?: Record<string, string>;
    };
    RunEvent: {
      sequence: number;
      stage: string;
      label: string;
      status?: string;
      timestamp: string;
      duration_ms?: number | null;
      details?: Record<string, unknown>;
    };
    TraceSpan: {
      node: string;
      started_at: string;
      completed_at: string;
      duration_ms: number;
      input_count?: number;
      output_count?: number;
      provider?: string;
      cached?: boolean;
      estimated_cost_usd?: number;
    };
    RunDiff: {
      prior_run_id?: string | null;
      probability_change?: number | null;
      added_market_ids?: string[];
      removed_market_ids?: string[];
      changed_evidence_count?: number;
    };
    ResearchRun: {
      id: string;
      investigation_id: string;
      query: string;
      status: "queued" | "running" | "completed" | "failed";
      deep_mode?: boolean;
      created_at: string;
      updated_at: string;
      intent?: components["schemas"]["QueryIntent"] | null;
      markets?: components["schemas"]["MarketSnapshot"][];
      relationships?: components["schemas"]["RelationshipEdge"][];
      context?: components["schemas"]["EvidenceItem"][];
      answer?: components["schemas"]["MarketImpliedAnswer"] | null;
      events?: components["schemas"]["RunEvent"][];
      traces?: components["schemas"]["TraceSpan"][];
      diff?: components["schemas"]["RunDiff"] | null;
      error?: string | null;
    };
    Investigation: {
      id: string;
      query: string;
      refresh_policy: "manual" | "daily";
      deep_mode?: boolean;
      created_at: string;
      updated_at: string;
      latest_run_id?: string | null;
      run_ids?: string[];
      next_refresh_at?: string | null;
      archived?: boolean;
    };
    InvestigationCreate: {
      query: string;
      refresh_policy?: "manual" | "daily";
      deep_mode?: boolean;
    };
    InvestigationPatch: {
      refresh_policy?: "manual" | "daily";
      deep_mode?: boolean;
      archived?: boolean;
    };
    RunCreate: { included_market_ids?: string[] | null };
    ForkCreate: { included_market_ids: string[] };
    ProviderHealth: {
      status: string;
      providers: Record<string, { status: string; latency_ms?: number; detail?: string }>;
    };
    ApiError: { detail: string; code?: string };
  };
}

type JsonResponse<T, Status extends number = 200> = {
  content: { "application/json": T };
  headers: Record<string, unknown>;
  status: Status;
};

export interface operations {
  createInvestigation: {
    requestBody: { content: { "application/json": components["schemas"]["InvestigationCreate"] } };
    responses: { 201: JsonResponse<components["schemas"]["Investigation"], 201> };
  };
  getInvestigation: {
    parameters: { path: { id: string } };
    responses: { 200: JsonResponse<components["schemas"]["Investigation"]> };
  };
  updateInvestigation: {
    parameters: { path: { id: string } };
    requestBody: { content: { "application/json": components["schemas"]["InvestigationPatch"] } };
    responses: { 200: JsonResponse<components["schemas"]["Investigation"]> };
  };
  createRun: {
    parameters: { path: { id: string } };
    requestBody?: { content: { "application/json": components["schemas"]["RunCreate"] } };
    responses: { 202: JsonResponse<components["schemas"]["ResearchRun"], 202> };
  };
  getRun: {
    parameters: { path: { id: string } };
    responses: { 200: JsonResponse<components["schemas"]["ResearchRun"]> };
  };
  streamRunEvents: {
    parameters: { path: { id: string } };
    responses: { 200: { content: { "text/event-stream": string } } };
  };
  forkRun: {
    parameters: { path: { id: string } };
    requestBody: { content: { "application/json": components["schemas"]["ForkCreate"] } };
    responses: { 202: JsonResponse<components["schemas"]["ResearchRun"], 202> };
  };
  getMarket: {
    parameters: { path: { id: string } };
    responses: { 200: JsonResponse<components["schemas"]["MarketSnapshot"]> };
  };
  getProviderHealth: {
    responses: { 200: JsonResponse<components["schemas"]["ProviderHealth"]> };
  };
}
