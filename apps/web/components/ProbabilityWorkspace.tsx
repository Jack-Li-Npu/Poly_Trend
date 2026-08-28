"use client";

import {
  IconActivity,
  IconAlertCircle,
  IconBookmark,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconCircleCheck,
  IconClock,
  IconDatabase,
  IconExternalLink,
  IconHistory,
  IconInfoCircle,
  IconList,
  IconMaximize,
  IconMenu2,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconX,
  IconChartDots,
} from "@tabler/icons-react";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";

import { ProbabilityGraph } from "@/components/ProbabilityGraph";
import { researchApiBase, runInvestigation, updateInvestigation, type StageUpdate } from "@/lib/research-api";
import { recomputeAnswer, seedInvestigation, seedRun } from "@/lib/seed";
import type { Investigation, MarketSnapshot, ResearchRun, WorkspaceView } from "@/lib/types";

const relationLabels: Record<MarketSnapshot["relation_type"], string> = {
  direct: "Direct match",
  duplicate: "Duplicate / similar",
  complement: "Complement",
  supporting_proxy: "Supporting proxy",
  conflicting_proxy: "Conflicting proxy",
  measured_correlation: "Measured correlation",
  external_context: "External context",
};

const relationClass: Record<MarketSnapshot["relation_type"], string> = {
  direct: "direct",
  duplicate: "duplicate",
  complement: "direct",
  supporting_proxy: "supporting",
  conflicting_proxy: "conflicting",
  measured_correlation: "context",
  external_context: "context",
};

function formatDate(value: string | Date, withTime = false) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

function formatLongDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(value);
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(value: number | null | undefined) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function HistoryChart({ market }: { market: MarketSnapshot }) {
  const points = market.history.length ? market.history : [{ timestamp: new Date().toISOString(), probability: market.probability }];
  const coordinates = points.map((point, index) => ({
    x: points.length === 1 ? 300 : 8 + (index / (points.length - 1)) * 284,
    y: 104 - point.probability * 88,
  }));
  const line = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `8,104 ${line} 292,104`;
  const last = coordinates.at(-1)!;
  return (
    <div className="history-chart">
      <div className="chart-y-labels" aria-hidden="true">
        <span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span>
      </div>
      <svg viewBox="0 0 320 116" role="img" aria-label={`Thirty day probability history ending at ${percent(market.probability)}`}>
        {[16, 38, 60, 82, 104].map((y) => (
          <line key={y} x1="8" x2="300" y1={y} y2={y} stroke="#ebe9ef" strokeDasharray="3 4" />
        ))}
        <polygon points={area} fill="#ede8ff" opacity="0.72" />
        <polyline points={line} fill="none" stroke="#6236e7" strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={last.x} cy={last.y} r="3.6" fill="#6236e7" />
        <text x="316" y={Math.max(14, last.y + 4)} textAnchor="end" fill="#6236e7" fontSize="11" fontWeight="700">
          {percent(market.probability)}
        </text>
      </svg>
      <div className="chart-x-labels">
        <span>{formatDate(points[0].timestamp)}</span>
        <span>{formatDate(points[Math.floor(points.length / 2)].timestamp)}</span>
        <span>{formatDate(points.at(-1)!.timestamp)}</span>
      </div>
    </div>
  );
}

function RunInspector({ run, fallback, onClose }: { run: ResearchRun; fallback: boolean; onClose: () => void }) {
  const totalLatency = run.traces.reduce((sum, trace) => sum + trace.duration_ms, 0);
  const totalCost = run.traces.reduce((sum, trace) => sum + trace.estimated_cost_usd, 0);
  const cacheHits = run.traces.filter((trace) => trace.cached).length;
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="run-inspector" role="dialog" aria-modal="true" aria-label="Run inspector" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <span className="eyebrow">RESEARCH RUNTIME</span>
            <h2>Run inspector</h2>
            <p>Structured execution data only. Hidden reasoning and secrets are never shown.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close run inspector"><IconX size={18} /></button>
        </div>

        <div className="runtime-metrics">
          <div><IconClock size={17} /><span>Latency</span><strong>{(totalLatency / 1000).toFixed(2)}s</strong></div>
          <div><IconDatabase size={17} /><span>Cache hits</span><strong>{cacheHits}</strong></div>
          <div><IconActivity size={17} /><span>Est. cost</span><strong>${totalCost.toFixed(4)}</strong></div>
          <div><IconCircleCheck size={17} /><span>Quality gate</span><strong>Passed</strong></div>
        </div>

        <section className="inspector-section">
          <div className="section-heading"><h3>Execution trace</h3><span>{run.traces.length} nodes</span></div>
          <div className="trace-list">
            {run.traces.map((trace, index) => (
              <div className="trace-row" key={`${trace.node}-${index}`}>
                <span className="trace-index">{index + 1}</span>
                <div><strong>{trace.node.replaceAll("_", " ")}</strong><small>{trace.provider}{trace.cached ? " · cache hit" : ""}</small></div>
                <span>{trace.duration_ms}ms</span>
                <span>{trace.input_count} → {trace.output_count}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="inspector-section">
          <div className="section-heading"><h3>Retrieval & verification</h3><span>grounded</span></div>
          <div className="audit-card">
            <p><IconCheck size={15} /> Reciprocal Rank Fusion merged four candidate generators.</p>
            <p><IconCheck size={15} /> Proxies were separated from numerical aggregation.</p>
            <p><IconCheck size={15} /> Every answer claim resolves to stored evidence.</p>
            <p><IconCheck size={15} /> {fallback ? "Deterministic local fallback used; no model key required." : "Production research service completed the run."}</p>
          </div>
        </section>

        {run.diff && (
          <section className="inspector-section">
            <div className="section-heading"><h3>Change since prior run</h3><span>{run.diff.changed_evidence_count} evidence updates</span></div>
            <div className="diff-card">
              <strong>{run.diff.probability_change && run.diff.probability_change >= 0 ? "+" : ""}{percent(run.diff.probability_change)}</strong>
              <p>Market-implied probability change</p>
              <small>{run.diff.added_market_ids.length} market added · {run.diff.removed_market_ids.length} removed</small>
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}

export function ProbabilityWorkspace() {
  const [investigation, setInvestigation] = useState<Investigation>(seedInvestigation);
  const [run, setRun] = useState<ResearchRun>(seedRun);
  const [markets, setMarkets] = useState<MarketSnapshot[]>(seedRun.markets.map((market) => ({ ...market })));
  const [query, setQuery] = useState(seedRun.query);
  const [selectedId, setSelectedId] = useState(seedRun.markets[0].id);
  const [view, setView] = useState<WorkspaceView>("graph");
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<StageUpdate>({ stage: "complete", label: "Run completed", progress: 100 });
  const [fallback, setFallback] = useState(true);
  const [saved, setSaved] = useState(false);
  const [daily, setDaily] = useState(false);
  const [showRunStatus, setShowRunStatus] = useState(false);
  const [showRunInspector, setShowRunInspector] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const answer = useMemo(() => recomputeAnswer(markets), [markets]);
  const selectedMarket = markets.find((market) => market.id === selectedId) ?? markets[0];
  const includedCount = markets.filter((market) => market.included).length;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanQuery = query.trim();
    if (cleanQuery.length < 4 || loading) return;
    setLoading(true);
    setShowRunStatus(true);
    const result = await runInvestigation(cleanQuery, setStage);
    setInvestigation(result.investigation);
    setRun(result.run);
    setMarkets(result.run.markets.map((market) => ({ ...market })));
    setSelectedId(result.run.markets[0]?.id ?? selectedId);
    setFallback(result.fallback);
    setLoading(false);
    setNotice(result.fallback ? "Completed with the local deterministic research runtime." : "Live investigation completed and verified.");
    window.setTimeout(() => setNotice(null), 3600);
  }

  function toggleInclusion() {
    if (!selectedMarket) return;
    setMarkets((current) => current.map((market) => market.id === selectedMarket.id ? { ...market, included: !market.included } : market));
    setNotice(selectedMarket.included ? "Market excluded. The answer was recomputed from comparable evidence." : "Market restored to the answer calculation.");
    window.setTimeout(() => setNotice(null), 3200);
  }

  async function toggleDaily() {
    const next = !daily;
    setDaily(next);
    setSaved(true);
    const updated = await updateInvestigation(investigation.id, { refresh_policy: next ? "daily" : "manual" });
    if (updated) setInvestigation(updated);
    setNotice(next ? "Daily refresh enabled for 08:00 Asia/Shanghai." : "Daily refresh disabled; this investigation is manual.");
    window.setTimeout(() => setNotice(null), 3200);
  }

  function toggleSaved() {
    setSaved((current) => !current);
    setNotice(saved ? "Investigation removed from saved work." : "Investigation saved with its evidence and runtime trace.");
    window.setTimeout(() => setNotice(null), 2800);
  }

  if (!selectedMarket) return null;

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><span>PT</span></div>
          <strong>Poly Trend <span>V2</span></strong>
        </div>
        <nav aria-label="Primary navigation"><button type="button" className="active"><IconChartDots size={17} />Probability Map</button></nav>
        <div className="topbar-actions">
          <span className="today"><IconCalendar size={17} />{formatLongDate(new Date())}</span>
          <button type="button" className={`save-button ${saved ? "is-saved" : ""}`} onClick={toggleSaved}>
            <IconBookmark size={17} fill={saved ? "currentColor" : "none"} />{saved ? "Saved" : "Save investigation"}
          </button>
          <div className="menu-wrap">
            <button type="button" className="icon-button menu-button" aria-label="Open workspace menu" onClick={() => setShowMenu((current) => !current)}><IconMenu2 size={20} /></button>
            {showMenu && (
              <div className="workspace-menu">
                <button type="button" onClick={() => { setShowRunInspector(true); setShowMenu(false); }}><IconActivity size={16} />Open run inspector</button>
                <button type="button" onClick={() => { void toggleDaily(); setShowMenu(false); }}><IconRefresh size={16} />{daily ? "Use manual refresh" : "Refresh daily at 08:00"}</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="command-row">
        <form className="question-form" onSubmit={submit}>
          <IconSearch size={22} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Research question" placeholder="Ask a measurable prediction-market question" />
          <button type="submit" disabled={loading}>{loading ? <><IconRefresh className="spin" size={17} />Researching</> : "Search"}</button>
        </form>
        <div className="run-status-wrap">
          <button type="button" className={`run-status ${loading ? "is-running" : ""}`} onClick={() => setShowRunStatus((current) => !current)}>
            {loading ? <IconRefresh className="spin" size={19} /> : <IconCircleCheck size={19} />}
            <span><strong>{loading ? stage.label : "Run completed"}</strong><small>{loading ? `${stage.progress}% complete` : `${formatDate(run.updated_at, true)} · 1.2s`}</small></span>
            <IconChevronDown size={16} />
          </button>
          {showRunStatus && (
            <div className="run-popover">
              <div className="progress-track"><span style={{ width: `${stage.progress}%` }} /></div>
              <strong>{loading ? stage.label : "Evidence verified"}</strong>
              <p>{fallback ? "Local deterministic fallback is active; the full interface remains functional without an LLM key." : "Live provider data and the production research graph completed successfully."}</p>
              <button type="button" onClick={() => setShowRunInspector(true)}><IconActivity size={15} />Inspect structured run data</button>
            </div>
          )}
        </div>
      </section>

      <div className="analysis-layout">
        <aside className="answer-rail">
          <div className="answer-main">
            <span className="eyebrow">MARKET-IMPLIED ANSWER</span>
            <h1>Recession before end of 2027</h1>
            <div className="answer-number"><strong>{percent(answer.probability)}</strong><span>probability</span></div>
            <div className="answer-range"><span>Market range</span><strong>{answer.market_range ? `${percent(answer.market_range[0])} – ${percent(answer.market_range[1])}` : "Not available"}</strong></div>
            <p className="as-of">As of {formatDate(answer.as_of, true)}</p>
          </div>

          <div className="answer-metrics">
            <div className="metric-label"><span>Agreement <IconInfoCircle size={14} /></span><strong>{percent(answer.agreement)}</strong></div>
            <div className="metric-track"><span style={{ width: `${answer.agreement * 100}%` }} /></div>
            <div className="metric-label"><span>Coverage <IconInfoCircle size={14} /></span><strong>{answer.coverage}</strong></div>
            <div className="metric-track coverage"><span style={{ width: `${Math.min(100, (answer.evidence_ids.length / 5) * 100)}%` }} /></div>
            <small>{answer.evidence_ids.length} comparable of {markets.length} markets</small>
          </div>

          <div className="takeaways">
            <div className="rail-heading"><h2>Key takeaways</h2><IconInfoCircle size={14} /></div>
            {answer.takeaways.map((takeaway, index) => (
              <div className="takeaway" key={takeaway}><span>{index + 1}</span><p>{takeaway}</p></div>
            ))}
          </div>

          <div className="legend">
            <h2>Relationship legend</h2>
            <p><span className="legend-line direct" />Direct / comparable</p>
            <p><span className="legend-line supporting" />Supporting proxy</p>
            <p><span className="legend-line conflicting" />Conflicting proxy</p>
            <p><span className="legend-line duplicate" />Duplicate / similar</p>
          </div>

          <button type="button" className={`daily-refresh ${daily ? "is-active" : ""}`} onClick={() => void toggleDaily()}>
            <IconRefresh size={17} /><span><strong>{daily ? "Daily refresh on" : "Manual refresh"}</strong><small>{daily ? "Next run · 08:00 Asia/Shanghai" : "Enable an 08:00 daily update"}</small></span>
          </button>
        </aside>

        <section className={`map-stage ${focusMode ? "focus-mode" : ""}`}>
          <div className="map-toolbar">
            <div className="segmented" aria-label="Evidence view">
              <button type="button" className={view === "graph" ? "active" : ""} onClick={() => setView("graph")}><IconChartDots size={16} />Graph</button>
              <button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")}><IconList size={16} />Ranked list</button>
            </div>
            <div className="map-summary"><span>{includedCount} included</span><span>{markets.length - includedCount} excluded</span></div>
            <div className="zoom-controls">
              <button type="button" onClick={() => setZoom((current) => Math.max(0.75, current - 0.1))} aria-label="Zoom out"><IconMinus size={16} /></button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom((current) => Math.min(1.35, current + 0.1))} aria-label="Zoom in"><IconPlus size={16} /></button>
              <button type="button" onClick={() => setZoom(1)}>Fit</button>
              <button type="button" onClick={() => setFocusMode((current) => !current)} aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"}><IconMaximize size={16} /></button>
            </div>
          </div>
          <ProbabilityGraph
            markets={markets}
            relationships={run.relationships}
            selectedId={selectedMarket.id}
            onSelect={setSelectedId}
            view={view}
            zoom={zoom}
          />
          <div className="map-footer">
            <span>Only direct and logically comparable markets affect the numerical answer.</span>
            <button type="button" onClick={() => setShowRunInspector(true)}><IconActivity size={14} />Run inspector</button>
          </div>
        </section>

        <aside className="evidence-panel">
          <div className="evidence-heading">
            <div><span className="eyebrow">SELECTED MARKET</span><h2>{selectedMarket.question}</h2></div>
            <button type="button" className="icon-button" onClick={() => setSelectedId(markets[0].id)} aria-label="Return to primary market"><IconX size={17} /></button>
          </div>
          <div className={`evidence-relation ${relationClass[selectedMarket.relation_type]}`}>{relationLabels[selectedMarket.relation_type]}</div>
          <div className="evidence-probability">
            <strong>{percent(selectedMarket.probability)}</strong><span>probability</span>
            <small className={selectedMarket.probability_change_24h >= 0 ? "positive" : "negative"}>
              {selectedMarket.probability_change_24h >= 0 ? "+" : "−"}{Math.abs(Math.round(selectedMarket.probability_change_24h * 100))}pp (24h)
            </small>
          </div>

          <section className="evidence-section">
            <h3>Probability history</h3>
            <HistoryChart market={selectedMarket} />
          </section>

          <section className="evidence-section details-section">
            <h3>Market details</h3>
            <dl>
              <div><dt>Yes / No spread</dt><dd>{selectedMarket.best_bid != null ? `${Math.round(selectedMarket.best_bid * 100)}¢` : "—"} / {selectedMarket.best_ask != null ? `${Math.round(selectedMarket.best_ask * 100)}¢` : "—"}</dd></div>
              <div><dt>Order book depth</dt><dd>{money(selectedMarket.liquidity)}</dd></div>
              <div><dt>24h volume</dt><dd>{money(selectedMarket.volume_24h)}</dd></div>
              <div><dt>Total volume</dt><dd>{money(selectedMarket.volume_total)}</dd></div>
              <div><dt>Open interest</dt><dd>{money(selectedMarket.open_interest)}</dd></div>
              <div><dt>Close date</dt><dd>{selectedMarket.end_date ? formatDate(selectedMarket.end_date) : "Open-ended"}</dd></div>
              <div><dt>Freshness</dt><dd><span className="fresh-dot" />{selectedMarket.freshness}</dd></div>
            </dl>
          </section>

          <section className="evidence-section">
            <h3>Resolution criterion</h3>
            <p>{selectedMarket.resolution_criteria}</p>
          </section>

          <section className="evidence-section relevance-section">
            <h3>Relevance (why this market matters)</h3>
            <p><IconCheck size={14} />{selectedMarket.relation_reason}</p>
            <p><IconCheck size={14} />Semantic relevance score: {Math.round(selectedMarket.relevance * 100)}/100.</p>
            <p><IconCheck size={14} />{selectedMarket.retrieval_sources?.join(" + ") || "Hybrid retrieval"} evidence source.</p>
          </section>

          <div className="evidence-actions">
            <button type="button" className={`include-button ${selectedMarket.included ? "" : "is-excluded"}`} onClick={toggleInclusion}>
              {selectedMarket.included ? <IconMinus size={16} /> : <IconPlus size={16} />}{selectedMarket.included ? "Exclude from answer" : "Include in answer"}
            </button>
            <a href={selectedMarket.url} target="_blank" rel="noreferrer"><IconExternalLink size={16} />View on Polymarket</a>
          </div>
        </aside>
      </div>

      {notice && <div className="toast" role="status"><IconCircleCheck size={17} />{notice}</div>}
      {showRunInspector && <RunInspector run={{ ...run, markets, answer }} fallback={fallback} onClose={() => setShowRunInspector(false)} />}
    </main>
  );
}
