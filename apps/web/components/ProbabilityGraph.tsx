"use client";

import type { KeyboardEvent } from "react";

import type { MarketSnapshot, RelationType, RelationshipEdge, WorkspaceView } from "@/lib/types";

type ProbabilityGraphProps = {
  markets: MarketSnapshot[];
  relationships: RelationshipEdge[];
  selectedId: string;
  onSelect: (marketId: string) => void;
  view: WorkspaceView;
  zoom: number;
};

const slots = [
  { x: 380, y: 335, radius: 91 },
  { x: 285, y: 90, radius: 62 },
  { x: 485, y: 90, radius: 62 },
  { x: 90, y: 245, radius: 58 },
  { x: 665, y: 245, radius: 58 },
  { x: 105, y: 435, radius: 59 },
  { x: 655, y: 435, radius: 59 },
  { x: 205, y: 575, radius: 62 },
  { x: 555, y: 575, radius: 62 },
  { x: 380, y: 625, radius: 62 },
];

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

function nodeLines(market: MarketSnapshot, central: boolean) {
  if (central) return ["Will the U.S. enter", "a recession before", "the end of 2027?"];
  const text = market.question
    .replace(/^Will (the|there) /i, "")
    .replace(/\?$/, "")
    .replace("United States", "U.S.");
  const words = text.split(" ");
  const target = market.id === "recession-before-2028" ? 16 : 18;
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
  return lines.slice(0, 3);
}

function RankedList({ markets, selectedId, onSelect }: Omit<ProbabilityGraphProps, "relationships" | "view" | "zoom">) {
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
  const { markets, relationships, selectedId, onSelect, view, zoom } = props;
  if (view === "list") {
    return <RankedList markets={markets} selectedId={selectedId} onSelect={onSelect} />;
  }

  const marketMap = new Map(markets.map((market) => [market.id, market]));
  const graphPositions = new Map(markets.map((market, index) => {
    const slot = slots[index];
    if (slot) return [market.id, slot] as const;
    const angle = ((index - slots.length) / Math.max(1, markets.length - slots.length)) * Math.PI * 2;
    return [market.id, { x: 380 + Math.cos(angle) * 300, y: 350 + Math.sin(angle) * 285, radius: 48 }] as const;
  }));
  const centralId = markets[0]?.id;
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
        viewBox="0 0 760 700"
        role="img"
        aria-label="Probability map of direct markets and macro proxies"
        style={{ transform: `scale(${zoom})` }}
      >
        <g className="graph-edges">
          {relationships.map((edge) => {
            const source = graphPositions.get(edge.source_id);
            const target = graphPositions.get(edge.target_id);
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
          {markets.map((market) => {
            const pos = graphPositions.get(market.id);
            if (!pos) return null;
            const central = market.id === centralId;
            const meta = relationMeta[market.relation_type];
            const lines = nodeLines(market, central);
            const selected = selectedId === market.id;
            const top = pos.y - (central ? 28 : Math.min(30, lines.length * 7));
            return (
              <g
                key={market.id}
                className={`market-node ${selected ? "is-selected" : ""} ${!market.included ? "is-excluded" : ""}`}
                role="button"
                tabIndex={0}
                aria-label={`${market.question}, ${Math.round(market.probability * 100)} percent`}
                onClick={() => onSelect(market.id)}
                onKeyDown={(event) => handleKey(event, market.id)}
              >
                {selected && (
                  <circle cx={pos.x} cy={pos.y} r={pos.radius + 7} fill="none" stroke={meta.color} strokeWidth="1.2" opacity="0.22" />
                )}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={pos.radius}
                  fill="#ffffff"
                  stroke={meta.color}
                  strokeWidth={selected ? 2.4 : central ? 2.1 : 1.75}
                  strokeDasharray={meta.dash}
                />
                {!market.included && <circle cx={pos.x} cy={pos.y} r={pos.radius} fill="#f4f3f7" opacity="0.72" />}
                {lines.map((line, index) => (
                  <text
                    key={`${market.id}-line-${index}`}
                    x={pos.x}
                    y={top + index * (central ? 18 : 14)}
                    textAnchor="middle"
                    fill="#17131f"
                    fontSize={central ? "15" : "11.5"}
                    fontWeight={central ? "620" : "570"}
                  >
                    {line}
                  </text>
                ))}
                <text
                  x={pos.x}
                  y={top + lines.length * (central ? 18 : 14) + (central ? 10 : 9)}
                  textAnchor="middle"
                  fill={meta.color}
                  fontSize={central ? "31" : "18"}
                  fontWeight="720"
                >
                  {Math.round(market.probability * 100)}%
                </text>
                <text
                  x={pos.x}
                  y={top + lines.length * (central ? 18 : 14) + (central ? 30 : 25)}
                  textAnchor="middle"
                  fill="#7a7484"
                  fontSize={central ? "11.5" : "10.5"}
                >
                  {central ? "Direct match" : compactMoney(market.liquidity)}
                </text>
                <text
                  x={pos.x}
                  y={top + lines.length * (central ? 18 : 14) + (central ? 47 : 40)}
                  textAnchor="middle"
                  fill={market.probability_change_24h >= 0 ? "#149540" : "#e22b37"}
                  fontSize="10.5"
                  fontWeight="650"
                >
                  {market.probability_change_24h >= 0 ? "+" : "−"}{Math.abs(Math.round(market.probability_change_24h * 100))}pp
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
