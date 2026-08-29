import type {
  Investigation,
  MarketImpliedAnswer,
  MarketSnapshot,
  RelationType,
  RelationshipEdge,
  ResearchRun,
  TraceSpan,
} from "./types";

// A fixed demonstration snapshot keeps server and client rendering identical.
// Live investigations replace it with their provider as-of timestamp.
const now = new Date("2026-08-27T02:31:00.000Z");

function history(current: number, phase: number) {
  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - (29 - index));
    const trend = (index - 29) * 0.0022;
    const wave = Math.sin(index * 0.72 + phase) * 0.025;
    return {
      timestamp: date.toISOString(),
      probability:
        index === 29
          ? current
          : Math.max(0.03, Math.min(0.97, current + trend + wave)),
    };
  });
}

type SeedMarket = [
  string,
  string,
  number,
  number,
  number,
  number,
  number,
  RelationType,
  number,
  string,
];

const raw: SeedMarket[] = [
  [
    "recession-2027",
    "Will the U.S. enter a recession before the end of 2027?",
    0.41,
    0.03,
    2_305_417,
    124_863,
    1_102_770,
    "direct",
    0.98,
    "Directly matches the outcome and time window.",
  ],
  [
    "recession-2026",
    "Will the U.S. enter a recession before Dec 31, 2026?",
    0.35,
    0.02,
    1_240_000,
    88_120,
    742_000,
    "direct",
    0.92,
    "Same outcome with an earlier horizon.",
  ],
  [
    "recession-in-2027",
    "Will there be a U.S. recession during 2027?",
    0.45,
    0.04,
    1_180_000,
    103_442,
    690_000,
    "direct",
    0.94,
    "Same event family and target year.",
  ],
  [
    "recession-before-2028",
    "Will the U.S. have a recession before 2028?",
    0.42,
    0.01,
    421_000,
    31_900,
    213_000,
    "duplicate",
    0.89,
    "Near-duplicate wording of the target proposition.",
  ],
  [
    "no-recession-before-2028",
    "Will the U.S. avoid a recession through the end of 2027?",
    0.58,
    -0.01,
    388_000,
    28_430,
    206_000,
    "complement",
    0.86,
    "Logical complement; its outcome is inverted before aggregation.",
  ],
  [
    "yield-curve-negative",
    "Will the 10Y–2Y yield curve be negative on Dec 31, 2026?",
    0.68,
    0.05,
    742_000,
    64_120,
    310_000,
    "supporting_proxy",
    0.71,
    "A macro-financial proxy that supports recession risk.",
  ],
  [
    "real-gdp-negative",
    "Will U.S. real GDP growth be below 0% in any quarter of 2026?",
    0.38,
    0.02,
    563_000,
    40_088,
    267_000,
    "supporting_proxy",
    0.67,
    "Growth contraction is related but not equivalent to recession resolution.",
  ],
  [
    "fed-75bps",
    "Will the Fed cut rates by at least 75 bps before Dec 31, 2026?",
    0.61,
    -0.03,
    1_010_000,
    75_211,
    489_000,
    "conflicting_proxy",
    0.63,
    "Policy easing can reflect risk but has ambiguous direction.",
  ],
  [
    "sp500-ath",
    "Will the S&P 500 make a new all-time high in 2026?",
    0.62,
    -0.02,
    1_370_000,
    91_227,
    575_000,
    "conflicting_proxy",
    0.58,
    "Risk-asset optimism offsets recession pricing.",
  ],
  [
    "core-pce",
    "Will core PCE fall below 2.5% by Dec 31, 2026?",
    0.35,
    -0.01,
    368_000,
    25_001,
    184_000,
    "conflicting_proxy",
    0.55,
    "Disinflation changes the policy path but is not the target event.",
  ],
];

export const seedMarkets: MarketSnapshot[] = raw.map(
  ([id, question, probability, move, total, day, liquidity, relation, relevance, reason], index) => ({
    id,
    question,
    slug: id,
    event_id: index < 5 ? "macro-recession-2027" : `macro-proxy-${index}`,
    event_title: index < 5 ? "U.S. recession outlook" : "Macro indicators",
    probability,
    probability_change_24h: move,
    volume_24h: day,
    volume_total: total,
    liquidity,
    open_interest: Math.round(liquidity * 0.72),
    best_bid: Math.max(0.01, probability - 0.01),
    best_ask: Math.min(0.99, probability + 0.01),
    spread: 0.02,
    end_date: new Date(
      Date.UTC(index === 0 || index === 2 || index === 3 || index === 4 ? 2027 : 2026, 11, 31, 23, 59),
    ).toISOString(),
    resolution_criteria:
      index < 5
        ? "Resolves YES if the National Bureau of Economic Research dates the start of a U.S. recession within the stated period; otherwise NO."
        : "Resolves from the named official statistical or market source using the threshold in the question.",
    resolution_source: "https://www.nber.org/research/business-cycle-dating",
    url: `https://polymarket.com/event/${id}`,
    tags: ["economy", "macro", index < 5 ? "recession" : "indicator"],
    retrieval_sources: ["Gamma", index < 5 ? "full-text" : "BGE dense"],
    relevance,
    relation_type: relation,
    relation_confidence: Math.min(0.98, relevance),
    relation_reason: reason,
    included: true,
    quality: Math.min(0.97, 0.55 + Math.log10(total + 1) / 16),
    freshness: "live",
    history: history(probability, index * 0.8),
  }),
);

export function recomputeAnswer(markets: MarketSnapshot[]): MarketImpliedAnswer {
  const comparable = markets.filter(
    (market) =>
      market.included &&
      ["direct", "duplicate", "complement"].includes(market.relation_type) &&
      market.relevance >= 0.58,
  );
  const excluded = markets.filter((market) => !comparable.includes(market)).map((market) => market.id);
  if (!comparable.length) {
    return {
      conclusion: "insufficient",
      label: "Insufficient market evidence",
      probability: null,
      market_range: null,
      agreement: 0,
      coverage: "insufficient",
      takeaways: [
        "No directly comparable market remains in the estimate.",
        "Proxy markets are visible for context, but cannot create a point estimate.",
        "Re-include a direct market or refine the research question.",
      ],
      evidence_ids: [],
      excluded_market_ids: excluded,
      methodology: "No estimate without directly comparable market evidence.",
      caveats: ["Proxy markets never silently change the estimate."],
      as_of: now.toISOString(),
      provider_freshness: { polymarket: "seeded demonstration" },
    };
  }

  const weights = comparable.map((market) => {
    const liquidityWeight = Math.min(1, Math.log10(Math.max(10, market.liquidity)) / 6);
    return Math.max(0.01, market.relevance * market.quality * liquidityWeight);
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const probability = comparable.reduce((sum, market, index) => {
    const oriented = market.relation_type === "complement" ? 1 - market.probability : market.probability;
    const clipped = Math.min(0.995, Math.max(0.005, oriented));
    return sum + Math.log(clipped / (1 - clipped)) * weights[index];
  }, 0);
  const pooled = 1 / (1 + Math.exp(-probability / totalWeight));
  const values = comparable
    .map((market) => (market.relation_type === "complement" ? 1 - market.probability : market.probability))
    .sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const agreement = Math.max(0, Math.min(1, 1 - Math.sqrt(variance) * 3.2));
  const proxyCount = markets.filter((market) => market.relation_type.includes("proxy")).length;
  return {
    conclusion: pooled >= 0.55 ? "yes" : pooled <= 0.45 ? "no" : "mixed",
    label: pooled >= 0.55 ? "Yes" : pooled <= 0.45 ? "No" : "Mixed pricing",
    probability: pooled,
    market_range: [Math.max(0, values[0] - 0.03), Math.min(1, values.at(-1)! + 0.03)],
    agreement,
    coverage: comparable.length >= 3 ? "good" : "limited",
    takeaways: [
      `${comparable.length} comparable markets imply ${Math.round(pooled * 100)}% with ${Math.round(agreement * 100)}% agreement.`,
      `${proxyCount} macro proxies explain disagreement but do not enter the estimate.`,
      "Dependency, liquidity, quality and relevance weights reduce double counting.",
    ],
    evidence_ids: comparable.map((market) => market.id),
    excluded_market_ids: excluded,
    methodology: "Dependency-discounted liquidity, quality and relevance weighted log-odds pool.",
    caveats: [
      "The range shows disagreement across markets, not a statistical confidence interval.",
      "Market prices are signals, not objective truth or financial advice.",
    ],
    as_of: comparable[0]?.history.at(-1)?.timestamp ?? now.toISOString(),
    provider_freshness: { polymarket: "live or latest cached snapshot", context: "separate" },
  };
}

export const seedRelationships: RelationshipEdge[] = seedMarkets.slice(1).map((market) => ({
  id: `edge-${market.id}`,
  source_id: "recession-2027",
  target_id: market.id,
  relation_type: market.relation_type,
  confidence: market.relation_confidence,
  explanation: market.relation_reason,
  measured_correlation:
    market.relation_type === "supporting_proxy"
      ? 0.56 + (market.id === "yield-curve-negative" ? 0.08 : 0)
      : market.relation_type === "conflicting_proxy"
        ? -0.32 - (market.id === "sp500-ath" ? 0.13 : 0)
        : market.relation_confidence,
  observation_count: 29,
}));

const baseAnswer = recomputeAnswer(seedMarkets);
const createdAt = new Date(now.getTime() - 72_000).toISOString();
const completedAt = new Date(now.getTime() - 70_800).toISOString();

const trace = (
  node: string,
  offset: number,
  duration: number,
  input: number,
  output: number,
  provider = "deterministic",
  cached = false,
): TraceSpan => ({
  node,
  started_at: new Date(now.getTime() - 72_000 + offset).toISOString(),
  completed_at: new Date(now.getTime() - 72_000 + offset + duration).toISOString(),
  duration_ms: duration,
  input_count: input,
  output_count: output,
  provider,
  cached,
  estimated_cost_usd: provider === "deterministic" ? 0 : 0.0034,
});

export const seedInvestigation: Investigation = {
  id: "demo-investigation",
  query: "Will the U.S. enter a recession before the end of 2027?",
  refresh_policy: "manual",
  deep_mode: false,
  created_at: createdAt,
  updated_at: completedAt,
  latest_run_id: "demo-run",
  run_ids: ["demo-run"],
  next_refresh_at: null,
  archived: false,
};

export const seedRun: ResearchRun = {
  id: "demo-run",
  investigation_id: seedInvestigation.id,
  query: seedInvestigation.query,
  status: "completed",
  deep_mode: false,
  created_at: createdAt,
  updated_at: completedAt,
  intent: {
    proposition: seedInvestigation.query,
    entities: ["United States", "recession"],
    geography: "United States",
    horizon: "before the end of 2027",
    target_year: 2027,
    outcome: "yes",
    ambiguous: false,
  },
  markets: seedMarkets,
  relationships: seedRelationships,
  context: [
    {
      id: "bls-claims",
      kind: "official_release",
      title: "Initial claims four-week average remains below 300k",
      source: "U.S. Department of Labor",
      url: "https://www.dol.gov/ui/data.pdf",
      published_at: new Date(now.getTime() - 86_400_000 * 2).toISOString(),
      summary: "Labor-market context is shown separately and does not alter the numeric estimate.",
      supports_numeric_answer: false,
    },
    {
      id: "atlanta-fed",
      kind: "official_release",
      title: "Atlanta Fed GDPNow estimate: 2.1%",
      source: "Federal Reserve Bank of Atlanta",
      url: "https://www.atlantafed.org/cqer/research/gdpnow",
      published_at: now.toISOString(),
      summary: "A current growth reference point for the evidence inspector.",
      supports_numeric_answer: false,
    },
  ],
  answer: baseAnswer,
  events: [
    { sequence: 1, stage: "intent", label: "Parsed question and horizon", status: "completed", timestamp: createdAt, duration_ms: 74 },
    { sequence: 2, stage: "retrieval", label: "Retrieved 48 market candidates", status: "completed", timestamp: createdAt, duration_ms: 286 },
    { sequence: 3, stage: "reranking", label: "Reranked and deduplicated evidence", status: "completed", timestamp: createdAt, duration_ms: 192 },
    { sequence: 4, stage: "relations", label: "Checked market relationships", status: "completed", timestamp: createdAt, duration_ms: 208 },
    { sequence: 5, stage: "verification", label: "Verified every numerical claim", status: "completed", timestamp: completedAt, duration_ms: 131 },
  ],
  traces: [
    trace("parse_intent", 0, 74, 1, 1),
    trace("parallel_retrieval", 74, 286, 1, 48, "Gamma + local indexes"),
    trace("fusion_reranking", 360, 192, 48, 14, "BGE cross-encoder", true),
    trace("market_enrichment", 552, 243, 9, 9, "Gamma / CLOB"),
    trace("relation_mapping", 795, 208, 9, 8),
    trace("quantitative_analysis", 1003, 66, 9, 1),
    trace("skeptical_verification", 1069, 131, 12, 12, "gpt-5.6-terra"),
  ],
  diff: {
    prior_run_id: "demo-run-prior",
    probability_change: 0.03,
    added_market_ids: ["recession-before-2028"],
    removed_market_ids: [],
    changed_evidence_count: 3,
  },
  error: null,
};

export function makeSeedRun(query: string): ResearchRun {
  const assetQuestion = /\b(gold|xau|bitcoin|btc)\b/i.test(query) && /\d{3,}/.test(query);
  const fallbackAnswer: MarketImpliedAnswer = assetQuestion ? {
    conclusion: "insufficient",
    label: "Live asset data unavailable",
    probability: null,
    market_range: null,
    agreement: 0,
    coverage: "insufficient",
    answer_kind: "insufficient",
    verdict: "Insufficient evidence",
    takeaways: [
      "This is an asset-price forecast, not a prediction-market aggregation question.",
      "The local web fallback cannot retrieve the spot price or price history.",
      "Start the research API and configure Alpha Vantage to calculate the estimate.",
    ],
    evidence_ids: [], excluded_market_ids: seedMarkets.map((market) => market.id),
    methodology: "No forecast is created without the live research service and price evidence.",
    caveats: ["Related seed markets are not used as a substitute probability."],
    as_of: new Date().toISOString(), provider_freshness: { asset_data: "unavailable" },
  } : recomputeAnswer(seedMarkets);
  return {
    ...seedRun,
    id: `demo-${Date.now()}`,
    query,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    answer: fallbackAnswer,
  };
}
