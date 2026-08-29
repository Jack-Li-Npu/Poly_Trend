"use client";

import type { KeyboardEvent } from "react";

import type { EvidenceGraph, EvidenceNode, MarketImpliedAnswer, MarketSnapshot, QueryIntent, RelationType, RelationshipEdge, WorkspaceView } from "@/lib/types";

type ProbabilityGraphProps = {
  markets: MarketSnapshot[];
  relationships: RelationshipEdge[];
  selectedId: string;
  onSelect: (marketId: string) => void;
  view: WorkspaceView;
  zoom: number;
  query: string;
  intent?: QueryIntent | null;
  answer?: MarketImpliedAnswer | null;
  evidenceGraph?: EvidenceGraph | null;
};

const slots = [
  { x: 220, y: 58, radius: 44 },
  { x: 540, y: 58, radius: 44 },
  { x: 78, y: 170, radius: 43 },
  { x: 682, y: 170, radius: 43 },
  { x: 78, y: 350, radius: 43 },
  { x: 682, y: 350, radius: 43 },
  { x: 220, y: 462, radius: 44 },
  { x: 540, y: 462, radius: 44 },
  { x: 380, y: 470, radius: 42 },
];

const evidenceColors: Record<string, string> = {
  forecast: "#6236e7", price: "#1684ff", macro: "#d97706", news: "#727987",
  official_context: "#727987", prediction_market: "#20a344",
};

const relationMeta: Record<RelationType, { color: string; dash?: string; label: string }> = {
  direct: { color: "#6236e7", label: "Direct match" },
  duplicate: { color: "#1684ff", dash: "5 5", label: "Duplicate / similar" },
  complement: { color: "#6236e7", dash: "9 4", label: "Complement" },
  supporting_proxy: { color: "#20a344", label: "Supporting proxy" },
  conflicting_proxy: { color: "#ee2b34", label: "Conflicting proxy" },
  measured_correlation: { color: "#7b8494", dash: "3 5", label: "Measured correlation" },
  external_context: { color: "#8d96a6", dash: "3 5", label: "External context" },
};

function compactMoney(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 2)}m`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
}

function wrappedLines(value: string, target = 20, limit = 4) {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > target && line) {
      lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, limit);
}

function nodeLines(market: MarketSnapshot) {
  const text = market.question
    .replace(/^Will (the|there) /i, "")
    .replace(/\?$/, "")
    .replace("United States", "U.S.");
  const target = market.id === "recession-before-2028" ? 16 : 18;
  return wrappedLines(text, target, 3);
}

function RankedList({ markets, selectedId, onSelect }: Pick<ProbabilityGraphProps, "markets" | "selectedId" | "onSelect">) {
  const sorted = [...markets].sort((a, b) => b.relevance - a.relevance);
  return (
    <div className="ranked-list" aria-label="Ranked market evidence">
      <div className="ranked-header">
        <span>Rank</span>
        <span>Market evidence</span>
        <span>Probability</span>
        <span>Liquidity</span>
        <span>Relevance</span>
      </div>
      {sorted.map((market, index) => {
        const meta = relationMeta[market.relation_type];
        return (
          <button
            type="button"
            className={`ranked-row ${selectedId === market.id ? "is-selected" : ""} ${!market.included ? "is-excluded" : ""}`}
            key={market.id}
            onClick={() => onSelect(market.id)}
          >
            <span className="rank-number">{String(index + 1).padStart(2, "0")}</span>
            <span className="rank-market-copy">
              <span className="rank-question">{market.question}</span>
              <span className="relation-pill" style={{ color: meta.color, borderColor: `${meta.color}55` }}>
                {meta.label}
              </span>
            </span>
            <strong className="rank-probability">{Math.round(market.probability * 100)}%</strong>
            <span>{compactMoney(market.liquidity)}</span>
            <span className="rank-score">{Math.round(market.relevance * 100)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ProbabilityGraph(props: ProbabilityGraphProps) {
  const { markets, relationships, selectedId, onSelect, view, zoom, query, intent, answer, evidenceGraph } = props;
  if (view === "list") {
    return <RankedList markets={markets} selectedId={selectedId} onSelect={onSelect} />;
  }

  const fallbackEvidence: EvidenceNode[] = markets.slice(0, 9).map((market) => ({
    id: `node-market-${market.id}`, kind: "prediction_market", label: market.question,
    value: `${Math.round(market.probability * 100)}%`, source: "Polymarket",
    relevance: market.relevance, included: market.included, evidence_id: market.id,
  }));
  const evidenceNodes = (evidenceGraph?.nodes?.length ? evidenceGraph.nodes : fallbackEvidence).slice(0, 9);
  const marketMap = new Map(markets.map((market) => [market.id, market]));
  const graphPositions = new Map(evidenceNodes.map((node, index) => {
    const slot = slots[index];
    return [node.id, slot] as const;
  }));
  const evidencePosition = new Map(evidenceNodes.map((node) => [node.evidence_id, graphPositions.get(node.id)]));
  const queryPosition = { x: 380, y: 260, radius: 68 };
  const queryLabel = intent?.proposition?.trim() || query.trim() || "Research question";
  const queryLines = wrappedLines(queryLabel, 22, 4);
  const handleKey = (event: KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(id);
    }
  };

  return (
    <div className="graph-scroll" aria-label="Interactive market relationship graph">
      <svg
        className="probability-graph"
        viewBox="0 0 760 520"
        role="img"
        aria-label="Probability map of direct markets and macro proxies"
        style={{ transform: `scale(${zoom})` }}
      >
        <g className="graph-edges">
          {evidenceNodes.map((node) => {
            const target = graphPositions.get(node.id);
            if (!target) return null;
            const market = node.evidence_id ? marketMap.get(node.evidence_id) : undefined;
            const color = market ? relationMeta[market.relation_type].color : evidenceColors[node.kind] ?? "#8d96a6";
            return (
              <line
                key={`query-${node.id}`}
                x1={queryPosition.x}
                y1={queryPosition.y}
                x2={target.x}
                y2={target.y}
                stroke={color}
                strokeWidth="1.35"
                strokeDasharray={market ? relationMeta[market.relation_type].dash : undefined}
                opacity={node.included ? 0.65 : 0.18}
              />
            );
          })}
          {relationships.map((edge) => {
            if (![edge.source_id, edge.target_id].includes(selectedId)) return null;
            const source = evidencePosition.get(edge.source_id);
            const target = evidencePosition.get(edge.target_id);
            if (!source || !target) return null;
            const meta = relationMeta[edge.relation_type];
            const targetMarket = marketMap.get(edge.target_id);
            const labelX = source.x + (target.x - source.x) * 0.53;
            const labelY = source.y + (target.y - source.y) * 0.53;
            const label = edge.measured_correlation != null
              ? `r=${edge.measured_correlation.toFixed(2)}`
              : `n=${edge.confidence.toFixed(2)}`;
            return (
              <g key={edge.id} opacity={targetMarket?.included === false ? 0.24 : 1}>
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={meta.color}
                  strokeWidth="1.7"
                  strokeDasharray={meta.dash}
                />
                <rect
                  x={labelX - 24}
                  y={labelY - 9}
                  width="48"
                  height="18"
                  rx="9"
                  fill="#ffffff"
                />
                <text x={labelX} y={labelY + 4} textAnchor="middle" fill={meta.color} fontSize="10.5" fontWeight="650">
                  {label}
                </text>
              </g>
            );
          })}
        </g>

        <g className="graph-nodes">
          <g className="query-node" aria-label={`Research query: ${queryLabel}`}>
            <circle cx={queryPosition.x} cy={queryPosition.y} r={queryPosition.radius + 7} fill="none" stroke="#6236e7" strokeWidth="1.2" opacity="0.18" />
            <circle cx={queryPosition.x} cy={queryPosition.y} r={queryPosition.radius} fill="#ffffff" stroke="#6236e7" strokeWidth="2.4" />
            <text x={queryPosition.x} y={queryPosition.y - 50} textAnchor="middle" fill="#6236e7" fontSize="9.5" fontWeight="750" letterSpacing="1.2">
              RESEARCH QUERY
            </text>
            {queryLines.map((line, index) => (
              <text
                key={`query-line-${index}`}
                x={queryPosition.x}
                y={queryPosition.y - 27 + index * 17}
                textAnchor="middle"
                fill="#17131f"
                fontSize="14"
                fontWeight="650"
              >
                {line}
              </text>
            ))}
            <text x={queryPosition.x} y={queryPosition.y + 52} textAnchor="middle" fill="#6236e7" fontSize="20" fontWeight="750">
              {answer?.probability == null ? (intent?.symbol ? "Price data needed" : "Evidence map") : `${Math.round(answer.probability * 100)}%`}
            </text>
            <text x={queryPosition.x} y={queryPosition.y + 70} textAnchor="middle" fill="#7a7484" fontSize="10.5">
              {answer?.probability == null ? (intent?.symbol ? "Forecast unavailable" : "No comparable estimate") : answer?.answer_kind === "model_estimate" ? "Model-estimated scenario" : "Market-implied answer"}
            </text>
          </g>
          {evidenceNodes.map((node) => {
            const pos = graphPositions.get(node.id);
            if (!pos) return null;
            const market = node.evidence_id ? marketMap.get(node.evidence_id) : undefined;
            const color = market ? relationMeta[market.relation_type].color : evidenceColors[node.kind] ?? "#8d96a6";
            const dash = market ? relationMeta[market.relation_type].dash : node.kind === "news" ? "3 5" : undefined;
            const lines = wrappedLines(node.label, 16, 3);
            const selected = market ? selectedId === market.id : false;
            const top = pos.y - Math.min(24, lines.length * 6);
            return (
              <g
                key={node.id}
                className={`market-node ${selected ? "is-selected" : ""} ${!node.included ? "is-excluded" : ""}`}
                role={market ? "button" : "img"}
                tabIndex={market ? 0 : undefined}
                aria-label={`${node.label}${node.value ? `, ${node.value}` : ""}`}
                onClick={() => market && onSelect(market.id)}
                onKeyDown={(event) => market && handleKey(event, market.id)}
              >
                {selected && (
                  <circle cx={pos.x} cy={pos.y} r={pos.radius + 6} fill="none" stroke={color} strokeWidth="1.2" opacity="0.22" />
                )}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={pos.radius}
                  fill="#ffffff"
                  stroke={color}
                  strokeWidth={selected ? 2.4 : 1.75}
                  strokeDasharray={dash}
                />
                {!node.included && <circle cx={pos.x} cy={pos.y} r={pos.radius} fill="#f4f3f7" opacity="0.72" />}
                {lines.map((line, index) => (
                  <text
                    key={`${node.id}-line-${index}`}
                    x={pos.x}
                    y={top + index * 12}
                    textAnchor="middle"
                    fill="#17131f"
                    fontSize="9.5"
                    fontWeight="570"
                  >
                    {line}
                  </text>
                ))}
                <text
                  x={pos.x}
                  y={top + lines.length * 12 + 8}
                  textAnchor="middle"
                  fill={color}
                  fontSize="15"
                  fontWeight="720"
                >
                  {node.value ?? node.kind.replaceAll("_", " ")}
                </text>
                <text
                  x={pos.x}
                  y={top + lines.length * 12 + 22}
                  textAnchor="middle"
                  fill="#7a7484"
                  fontSize="8.5"
                >
                  {node.source ?? node.kind.replaceAll("_", " ")}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
