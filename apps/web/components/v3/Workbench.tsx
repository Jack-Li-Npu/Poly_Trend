"use client";

import {
  IconActivity,
  IconArrowRight,
  IconArrowUpRight,
  IconBook2,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconDatabase,
  IconDownload,
  IconFlask,
  IconFolder,
  IconLayoutDashboard,
  IconLoader2,
  IconMenu2,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, streamRun } from "@/lib/api";
import { presentationForRun } from "@/lib/presentation";
import {
  currency,
  dateTime,
  download,
  label,
  numeric,
  probability,
  record,
  rows,
  safeSourceUrl,
  shortDate,
  string,
} from "@/lib/format";
import type {
  CaseDetail,
  CasePatch,
  EvaluationReport,
  EventDefinition,
  Observation,
  ProgressEvent,
  ResearchCase,
  ResearchRun,
  RunCreate,
  RunDetail,
  SourceMode,
  WorkspaceTab,
} from "@/lib/types";
import {
  AnalysisPanels,
  EvidencePanel,
  EvaluationPanel,
  HistoryPanel,
  Notebook,
  ScenarioLab,
} from "./ResearchPanels";
import {
  Delta,
  Empty,
  EvidenceDrawer,
  MarketDetails,
  SourceLink,
  Status,
  Timeline,
  WindowChange,
} from "./Visuals";

const tabs: { id: WorkspaceTab; title: string; icon: typeof IconActivity }[] = [
  { id: "overview", title: "Research", icon: IconLayoutDashboard },
  { id: "scenario", title: "Scenario lab", icon: IconFlask },
  { id: "evidence", title: "Evidence", icon: IconDatabase },
  { id: "history", title: "Replay & history", icon: IconClock },
  { id: "evaluation", title: "Validation", icon: IconShieldCheck },
];
const defaultAssets = ["SPY", "QQQ", "IEF", "TLT", "BTC-USD"];
const terminalStatuses = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something prevented this request. Your saved research is preserved.";

export function Workbench() {
  const [sourceMode, setSourceMode] = useState<SourceMode>("recorded");
  const [events, setEvents] = useState<EventDefinition[]>([]);
  const [eventIssues, setEventIssues] = useState<string[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [eventsRevision, setEventsRevision] = useState(0);
  const [cases, setCases] = useState<ResearchCase[]>([]);
  const [casesError, setCasesError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EventDefinition | null>(
    null,
  );
  const [activeCase, setActiveCase] = useState<ResearchCase | null>(null);
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const [selectedMarket, setSelectedMarket] = useState("");
  const [selectedAsset, setSelectedAsset] = useState("");
  const [assetDraft, setAssetDraft] = useState(defaultAssets);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [connection, setConnection] = useState<
    "idle" | "connected" | "disconnected"
  >("idle");
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [progressExpanded, setProgressExpanded] = useState(false);
  const [drawerObservation, setDrawerObservation] =
    useState<Observation | null>(null);
  const [sourceNotice, setSourceNotice] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationReport | null>(null);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const stopStream = useRef<(() => void) | null>(null);
  const selectionVersion = useRef(0);
  const activeRunId = useRef<string | null>(null);
  const restoring = useRef(false);
  const pinnedBundle = detail?.bundle;
  const bundle = presentationForRun(detail);
  const run = detail?.run;
  const activeEvent = bundle?.event ?? selectedEvent ?? caseDetail?.event;
  const metrics = record(run?.metrics);
  const expectation = rows(metrics.expectation_changes);
  const changes = new Map(
    expectation.map((item) => [
      string(item.market_id),
      numeric(item.delta_7d_pp),
    ]),
  );
  const preferredMarkets = [...(bundle?.markets ?? [])].sort((left, right) => {
    const leftChange = changes.get(left.market_id);
    const rightChange = changes.get(right.market_id);
    if (leftChange != null || rightChange != null)
      return (
        (rightChange == null ? -Infinity : Math.abs(rightChange)) -
        (leftChange == null ? -Infinity : Math.abs(leftChange))
      );
    const leftDepth = (left.bid_depth_usd ?? 0) + (left.ask_depth_usd ?? 0);
    const rightDepth = (right.bid_depth_usd ?? 0) + (right.ask_depth_usd ?? 0);
    return (
      rightDepth - leftDepth ||
      (right.probability ?? -1) - (left.probability ?? -1)
    );
  });
  const currentMarket =
    bundle?.markets?.find((item) => item.market_id === selectedMarket) ??
    preferredMarkets[0];
  const currentAsset =
    bundle?.assets?.find((item) => item.symbol === selectedAsset) ??
    bundle?.assets?.find((item) => (item.points?.length ?? 0) > 0) ??
    bundle?.assets?.[0];
  const running = !!run && !terminalStatuses.has(run.status ?? "queued");
  const busy = !!operation || running;
  const leadingChange =
    expectation.find(
      (item) => string(item.market_id) === currentMarket?.market_id,
    ) ?? expectation[0];

  const updateLocation = useCallback(
    (caseId?: string, runId?: string, mode?: SourceMode) => {
      const url = new URL(window.location.href);
      if (caseId) url.searchParams.set("case", caseId);
      else url.searchParams.delete("case");
      if (runId) url.searchParams.set("run", runId);
      else url.searchParams.delete("run");
      if (mode) url.searchParams.set("source", mode);
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    },
    [],
  );

  const refreshCases = useCallback(async () => {
    try {
      setCases(await api.cases());
      setCasesError(null);
    } catch (failure) {
      setCasesError(message(failure));
    }
  }, []);
  const loadEvaluation = useCallback(async () => {
    try {
      setEvaluation(await api.evaluations());
      setEvaluationError(null);
    } catch (failure) {
      setEvaluationError(message(failure));
    }
  }, []);

  const watch = useCallback(
    (researchRun: ResearchRun) => {
      const runId = researchRun.id;
      if (!runId) {
        setError(
          "The server returned a run without an ID. No research result was accepted.",
        );
        return;
      }
      stopStream.current?.();
      activeRunId.current = runId;
      setConnection("connected");
      setProgress(researchRun.progress ?? []);
      stopStream.current = streamRun(
        runId,
        (stage) => {
          if (activeRunId.current !== runId) return;
          setProgress((current) =>
            current.some((item) => item.sequence === stage.sequence)
              ? current
              : [...current, stage],
          );
        },
        (completed) => {
          if (activeRunId.current !== runId) return;
          setDetail(completed);
          setConnection("idle");
          setProgress(completed.run.progress ?? []);
          if (completed.run.error) setError(completed.run.error);
          void refreshCases();
          void api
            .case(completed.run.case_id)
            .then((value) => {
              setCaseDetail(value);
              setActiveCase(value.case);
            })
            .catch(() => undefined);
        },
        () => {
          if (activeRunId.current !== runId) return;
          setConnection("disconnected");
          // A stream failure does not imply the server run failed. Recover its persisted state once.
          void api
            .run(runId)
            .then((value) => {
              if (activeRunId.current !== runId) return;
              setDetail(value);
              if (terminalStatuses.has(value.run.status ?? "queued")) {
                setConnection("idle");
                void refreshCases();
              }
            })
            .catch(() => undefined);
        },
      );
    },
    [refreshCases],
  );

  const loadRun = useCallback(
    async (id: string) => {
      const version = ++selectionVersion.current;
      setOperation("Opening snapshot");
      setError(null);
      stopStream.current?.();
      try {
        const value = await api.run(id);
        if (version !== selectionVersion.current) return;
        setDetail(value);
        setProgress(value.run.progress ?? []);
        setSelectedMarket("");
        setSelectedAsset("");
        activeRunId.current = id;
        updateLocation(
          value.run.case_id,
          id,
          value.bundle?.event.origin === "recorded" ? "recorded" : undefined,
        );
        if (!terminalStatuses.has(value.run.status ?? "queued"))
          watch(value.run);
        else setConnection("idle");
      } catch (failure) {
        setError(message(failure));
      } finally {
        if (version === selectionVersion.current) setOperation(null);
      }
    },
    [updateLocation, watch],
  );

  const openCase = useCallback(
    async (id: string, preferredRun?: string) => {
      const version = ++selectionVersion.current;
      setOperation("Opening case");
      setError(null);
      stopStream.current?.();
      try {
        const value = await api.case(id);
        if (version !== selectionVersion.current) return;
        setCaseDetail(value);
        setActiveCase(value.case);
        setSelectedEvent(value.event);
        setSelectedMarket("");
        setSelectedAsset("");
        setSourceMode(value.case.source_mode ?? "live");
        setTab("overview");
        setSidebarOpen(false);
        setDetail(null);
        const runId = preferredRun ?? value.case.latest_run_id;
        updateLocation(
          id,
          runId ?? undefined,
          value.case.source_mode ?? "live",
        );
        if (runId) {
          const snapshot = await api.run(runId);
          if (version !== selectionVersion.current) return;
          setDetail(snapshot);
          setProgress(snapshot.run.progress ?? []);
          activeRunId.current = runId;
          if (!terminalStatuses.has(snapshot.run.status ?? "queued"))
            watch(snapshot.run);
          else setConnection("idle");
        } else setConnection("idle");
      } catch (failure) {
        setError(message(failure));
      } finally {
        if (version === selectionVersion.current) setOperation(null);
      }
    },
    [updateLocation, watch],
  );

  useEffect(() => {
    void refreshCases();
    void loadEvaluation();
    const params = new URLSearchParams(window.location.search);
    const id = params.get("case");
    const mode = params.get("source");
    if (mode === "live" || mode === "recorded") setSourceMode(mode);
    if (id && !restoring.current) {
      restoring.current = true;
      void openCase(id, params.get("run") ?? undefined);
    }
    return () => {
      stopStream.current?.();
    };
  }, [refreshCases, loadEvaluation, openCase]);

  useEffect(() => {
    let cancelled = false;
    setLoadingEvents(true);
    setEventsError(null);
    setEvents([]);
    void api
      .events(sourceMode, search)
      .then((value) => {
        if (cancelled) return;
        setEvents(value.events ?? []);
        setEventIssues(value.issues ?? []);
      })
      .catch((failure) => {
        if (!cancelled) setEventsError(message(failure));
      })
      .finally(() => {
        if (!cancelled) setLoadingEvents(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceMode, search, eventsRevision]);

  function selectEvent(event: EventDefinition) {
    selectionVersion.current += 1;
    stopStream.current?.();
    activeRunId.current = null;
    setSelectedEvent(event);
    setSelectedMarket("");
    setSelectedAsset("");
    setActiveCase(null);
    setCaseDetail(null);
    setDetail(null);
    setConnection("idle");
    setProgress([]);
    setTab("overview");
    setSidebarOpen(false);
    setError(null);
    const linked = Object.keys(event.asset_links ?? {});
    setAssetDraft(linked.length ? linked.slice(0, 10) : defaultAssets);
    updateLocation(undefined, undefined, sourceMode);
  }
  function changeMode(mode: SourceMode) {
    if (mode === sourceMode || busy) return;
    selectionVersion.current += 1;
    stopStream.current?.();
    setSourceMode(mode);
    setActiveCase(null);
    setCaseDetail(null);
    setSelectedEvent(null);
    setDetail(null);
    setError(null);
    setEventIssues([]);
    setConnection("idle");
    setProgress([]);
    updateLocation(undefined, undefined, mode);
  }
  async function createResearch() {
    if (!activeEvent || !assetDraft.length || busy) return;
    setOperation("Creating research case");
    setError(null);
    try {
      const researchCase = await api.createCase({
        event_id: activeEvent.id,
        assets: assetDraft,
        source_mode: sourceMode,
        thesis: "",
        assumptions: [],
        rules: [],
      });
      if (!researchCase.id)
        throw new Error(
          "The saved case has no identifier. Please retry opening the case.",
        );
      setActiveCase(researchCase);
      setCaseDetail({ case: researchCase, event: activeEvent, runs: [] });
      updateLocation(researchCase.id, undefined, sourceMode);
      await refreshCases();
      const queued = await api.createRun(researchCase.id, { mode: "refresh" });
      setDetail({ run: queued, bundle: null });
      updateLocation(researchCase.id, queued.id, sourceMode);
      watch(queued);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setOperation(null);
    }
  }
  async function startRun(request: RunCreate) {
    if (!activeCase?.id || busy) return;
    setOperation("Starting research");
    setError(null);
    try {
      const queued = await api.createRun(activeCase.id, request);
      setDetail({ run: queued, bundle: null });
      setTab("overview");
      updateLocation(activeCase.id, queued.id, sourceMode);
      watch(queued);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setOperation(null);
    }
  }
  async function patchCase(patch: CasePatch) {
    if (!activeCase?.id) return;
    const value = await api.patchCase(activeCase.id, patch);
    setActiveCase(value);
    setCaseDetail((current) =>
      current ? { ...current, case: value } : current,
    );
    await refreshCases();
  }
  function inspectEvidence(id: string) {
    const observation = bundle?.observations?.find(
      (item) => item.id === id || item.external_id === id,
    );
    if (observation) {
      setDrawerObservation(observation);
      setSourceNotice(null);
    } else {
      setSourceNotice(
        "This claim does not resolve to a raw observation in the selected snapshot. Review its provenance before relying on it.",
      );
      setTab("evidence");
    }
  }
  async function cancelRun() {
    if (!run?.id) return;
    setOperation("Cancelling run");
    try {
      const value = await api.cancel(run.id);
      stopStream.current?.();
      setDetail((current) => (current ? { ...current, run: value } : current));
      setConnection("idle");
      void refreshCases();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setOperation(null);
    }
  }
  async function reconnect() {
    if (!run?.id) return;
    setOperation("Recovering run");
    setError(null);
    try {
      const value = await api.run(run.id);
      setDetail(value);
      if (terminalStatuses.has(value.run.status ?? "queued"))
        setConnection("idle");
      else watch(value.run);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setOperation(null);
    }
  }
  async function resumeRun() {
    if (!run?.id) return;
    setOperation("Resuming run");
    setError(null);
    try {
      const value = await api.resume(run.id);
      setDetail({ run: value, bundle: null });
      watch(value);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setOperation(null);
    }
  }
  function exportReport() {
    if (!detail?.run.id || !activeCase) return;
    const lines = [
      `# ${activeCase.title}`,
      "",
      `Source mode: ${activeCase.source_mode}`,
      `Run: ${detail.run.id}`,
      `Method: ${detail.run.method_version}`,
      `Snapshot hash: ${detail.run.snapshot_hash ?? "unavailable"}`,
      `Captured: ${pinnedBundle?.captured_at ?? "unavailable"}`,
      `Historical cutoff: ${detail.run.as_of ?? "None"}`,
      "",
      "## Working thesis",
      activeCase.thesis || "No thesis supplied.",
      "",
      "## Findings",
      ...(detail.run.claims ?? []).flatMap((claim) => [
        `### ${claim.title}`,
        `Kind: ${claim.kind} | Status: ${claim.status}`,
        claim.text,
        `Evidence: ${(claim.evidence_ids ?? []).join(", ") || "None"}`,
        "",
      ]),
      "## Limitations",
      ...(detail.run.limitations ?? []).map((item) => `- ${item}`),
      "",
      "## Sources",
      ...(bundle?.observations ?? []).map(
        (item) =>
          `- ${item.provider} · ${item.kind} · observed ${item.observed_at} · available ${item.available_at} · ${safeSourceUrl(item.source_url) ?? "Source URL unavailable"}`,
      ),
    ];
    download(
      `poly-trend-${detail.run.id.slice(0, 8)}.md`,
      lines.join("\n"),
      "text/markdown",
    );
  }

  return (
    <div className="desk-shell">
      <a className="skip-link" href="#research-main">
        Skip to research
      </a>
      <header className="desk-topbar">
        <div className="brand">
          <span className="brand-symbol" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            poly trend<span className="version">V3</span>
          </span>
        </div>
        <div className="topbar-caption">
          <span className="availability-dot" />
          Event-driven research desk
        </div>
        <div className="topbar-right">
          <span className="research-only">Research, with a paper trail.</span>
          <button className="docs-link" onClick={() => setTab("evaluation")}>
            Methods
            <IconShieldCheck size={13} />
          </button>
          <button
            className="icon-button mobile-menu"
            aria-label={
              sidebarOpen ? "Close research sidebar" : "Open research sidebar"
            }
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((current) => !current)}
          >
            <IconMenu2 size={20} />
          </button>
        </div>
      </header>
      <div className="source-banner">
        <div>
          <span className={`source-dot ${sourceMode}`} />
          <strong>
            {sourceMode === "recorded"
              ? "RECORDED WORKSPACE"
              : "LIVE WORKSPACE"}
          </strong>
          <span>
            {sourceMode === "recorded"
              ? "A pinned research dataset. Recorded or synthetic origins remain visible; these are not live quotes."
              : "Actual provider observations. Missing data and connection failures remain visible."}
          </span>
        </div>
        <div className="source-toggle" aria-label="Data source">
          <button
            aria-pressed={sourceMode === "recorded"}
            disabled={busy}
            onClick={() => changeMode("recorded")}
          >
            Recorded
          </button>
          <button
            aria-pressed={sourceMode === "live"}
            disabled={busy}
            onClick={() => changeMode("live")}
          >
            <span className="live-dot" />
            Live
          </button>
        </div>
      </div>
      <div className="desk-body">
        <aside
          className={`desk-sidebar ${sidebarOpen ? "is-open" : ""}`}
          aria-label="Research navigation"
        >
          <div className="sidebar-heading">
            <span className="eyebrow">RESEARCH UNIVERSE</span>
            <button
              className="icon-button mobile-close"
              aria-label="Close sidebar"
              onClick={() => setSidebarOpen(false)}
            >
              <IconX size={17} />
            </button>
          </div>
          <form
            className="sidebar-search"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(query.trim());
            }}
          >
            <IconSearch size={16} aria-hidden="true" />
            <input
              aria-label="Find an event"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find an event…"
            />
            <button type="submit" aria-label="Search events">
              <IconArrowRight size={15} />
            </button>
          </form>
          <div className="sidebar-section-title">
            <h2>Attention queue</h2>
            <span className="count">{events.length}</span>
          </div>
          <p className="sidebar-explainer">
            Events to investigate. No opportunity score.
          </p>
          {loadingEvents ? (
            <div className="sidebar-loading">
              <IconLoader2 className="spin" size={16} />
              Loading {sourceMode} events…
            </div>
          ) : eventsError ? (
            <div className="sidebar-error">
              <p>{eventsError}</p>
              <button
                className="text-button"
                onClick={() => setEventsRevision((current) => current + 1)}
              >
                Retry connection
              </button>
            </div>
          ) : !events.length ? (
            <p className="sidebar-empty">
              No matching events. Try a broader search.
            </p>
          ) : (
            <div className="event-queue">
              {events.map((event, index) => (
                <button
                  className={`queue-item ${activeEvent?.id === event.id ? "is-active" : ""}`}
                  key={event.id}
                  onClick={() => selectEvent(event)}
                  disabled={busy}
                >
                  <span className="queue-index mono">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="queue-copy">
                    <span className="queue-category">
                      {label(event.category ?? "event")}
                    </span>
                    <strong>{event.title}</strong>
                    <QueueSignal event={event} />
                    <span className="queue-meta">
                      {event.contracts?.length ?? 0} contracts<span>·</span>
                      {shortDate(event.deadline)}
                    </span>
                  </span>
                  <IconChevronRight size={14} />
                </button>
              ))}
            </div>
          )}
          {eventIssues.length > 0 && (
            <details className="provider-issues">
              <summary>Provider coverage · {eventIssues.length}</summary>
              {eventIssues.map((issue) => (
                <p key={issue}>{issue}</p>
              ))}
            </details>
          )}
          <div className="sidebar-section-title case-list-title">
            <h2>
              <IconFolder size={15} />
              Saved cases
            </h2>
            <button
              className="icon-button"
              aria-label="Reload saved cases"
              onClick={() => void refreshCases()}
            >
              <IconRefresh size={13} />
            </button>
          </div>
          {casesError && <p className="sidebar-error">{casesError}</p>}
          <div className="saved-case-list">
            {cases
              .filter((item) => !item.archived)
              .map((item) => (
                <button
                  className={`saved-case ${activeCase?.id === item.id ? "is-active" : ""}`}
                  key={item.id}
                  onClick={() => item.id && void openCase(item.id)}
                  disabled={busy}
                >
                  <IconBook2 size={15} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.source_mode} · revision {item.revision}
                      {item.refresh_enabled ? " · monitoring" : ""}
                    </small>
                  </span>
                  <IconChevronRight size={12} />
                </button>
              ))}
            {!cases.length && !casesError && (
              <p className="sidebar-empty">
                Open an event to start a case. Thesis, evidence, and run history
                stay together.
              </p>
            )}
          </div>
          <div className="sidebar-footer">
            <IconShieldCheck size={16} />
            <span>
              Source-linked ≠ validated
              <br />A scenario is an assumption, not a forecast.
            </span>
          </div>
        </aside>
        {sidebarOpen && (
          <button
            className="sidebar-scrim"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <main className="desk-main" id="research-main">
          <div className="desk-page-heading">
            <div>
              <div className="breadcrumb">
                Workspace
                <IconChevronRight size={12} />
                <span>{activeCase ? "Research case" : "Attention queue"}</span>
              </div>
              <h1>
                {activeEvent
                  ? activeEvent.title
                  : "Find the change. Question the consequence."}
              </h1>
              <p>
                {activeEvent
                  ? `${label(activeEvent.category ?? "event")} · ${activeEvent.contracts?.length ?? 0} contracts · resolves ${shortDate(activeEvent.deadline)}`
                  : "Follow event repricing, investigate the asset response, and define what would change your mind."}
              </p>
            </div>
            <div className="heading-actions">
              {detail && (
                <button className="button secondary" onClick={exportReport}>
                  <IconDownload size={15} />
                  Export brief
                </button>
              )}
              {activeCase && (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void startRun({ mode: "refresh" })}
                >
                  <IconRefresh size={15} />
                  Refresh sources
                </button>
              )}
            </div>
          </div>
          {error && (
            <div className="notice error global-error" role="alert">
              <div>
                <strong>Research needs attention</strong>
                <p>{error}</p>
                {run && (
                  <small className="mono">
                    Run {run.id} · saved state preserved
                  </small>
                )}
              </div>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError(null)}
              >
                <IconX size={17} />
              </button>
            </div>
          )}
          {operation && (
            <div className="operation-status" role="status">
              <IconLoader2 size={15} className="spin" />
              {operation}…
            </div>
          )}
          {run && (
            <section
              className={`run-strip ${running ? "is-running" : ""}`}
              aria-label="Research run status"
            >
              <div>
                <span className={`run-state-dot ${run.status}`} />
                <strong>
                  {connection === "disconnected"
                    ? "Connection interrupted"
                    : running
                      ? (progress.at(-1)?.message ?? "Research queued")
                      : `Run ${label(run.status ?? "queued")}`}
                </strong>
                <span className="run-id mono" title={run.id}>
                  {run.id?.slice(0, 8) ?? "Missing ID"}
                </span>
              </div>
              <div className="run-strip-actions">
                {connection === "disconnected" && (
                  <button
                    className="text-button"
                    onClick={() => void reconnect()}
                  >
                    Reconnect to run
                  </button>
                )}
                {running && (
                  <button
                    className="text-button"
                    onClick={() => void cancelRun()}
                    disabled={!!operation}
                  >
                    <IconPlayerPause size={13} />
                    Cancel
                  </button>
                )}
                {["failed", "interrupted", "cancelled"].includes(
                  run.status ?? "",
                ) && (
                  <button
                    className="text-button"
                    onClick={() => void resumeRun()}
                    disabled={!!operation}
                  >
                    <IconPlayerPlay size={13} />
                    Resume
                  </button>
                )}
                <button
                  className="text-button"
                  onClick={() => setProgressExpanded((current) => !current)}
                  aria-expanded={progressExpanded}
                >
                  Activity {progress.length}
                  <IconChevronRight
                    size={13}
                    className={progressExpanded ? "rotate" : ""}
                  />
                </button>
              </div>
            </section>
          )}
          {connection === "disconnected" && (
            <div className="notice warning">
              The server may still be working. Reconnect to the same run to
              recover its status; no replacement data have been inserted.
            </div>
          )}
          {progressExpanded && (
            <ol className="progress-log">
              {progress.map((stage) => (
                <li key={stage.sequence}>
                  <span className="mono">
                    {String(stage.sequence).padStart(2, "0")}
                  </span>
                  <strong>{stage.message}</strong>
                  <time>{dateTime(stage.timestamp)}</time>
                </li>
              ))}
            </ol>
          )}
          {run?.as_of && (
            <div className="notice warning historical-view">
              <div>
                <strong>Historical cutoff view · {dateTime(run.as_of)}</strong>
                <p>
                  Charts, quotes, context, and the evidence ledger show only
                  observations available by this cutoff. Event metadata may be
                  reconstructed later; availability is not inferred from the
                  event date. The pinned input export retains the original full
                  snapshot and may contain later observations.
                </p>
              </div>
            </div>
          )}
          {sourceNotice && (
            <div className="notice warning" role="status">
              {sourceNotice}
              <button
                className="text-button"
                onClick={() => setSourceNotice(null)}
              >
                Dismiss
              </button>
            </div>
          )}
          <nav className="workspace-tabs" aria-label="Research views">
            {tabs.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                aria-current={tab === item.id ? "page" : undefined}
              >
                <item.icon size={16} />
                {item.title}
                {item.id === "evidence" && !!bundle?.observations?.length && (
                  <span>{bundle.observations.length}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="view-content">
            {tab === "overview" && !detail && (
              <>
                {!activeEvent ? (
                  <>
                    <section className="intro-grid">
                      <div className="intro-statement">
                        <span className="eyebrow">
                          A RESEARCH PROCESS THAT LEAVES EVIDENCE
                        </span>
                        <h2>
                          Start with an event.
                          <br />
                          End with a testable view.
                        </h2>
                        <p>
                          Probability is the beginning of the investigation.
                          Trace the change, inspect the sources, and stress the
                          consequences.
                        </p>
                        <div className="intro-flow">
                          <span>
                            <i>01</i>Repricing
                          </span>
                          <IconArrowRight size={15} />
                          <span>
                            <i>02</i>Response
                          </span>
                          <IconArrowRight size={15} />
                          <span>
                            <i>03</i>Disconfirmation
                          </span>
                        </div>
                      </div>
                      <div className="intro-aside">
                        <IconActivity size={28} stroke={1.3} />
                        <h3>
                          {sourceMode === "recorded"
                            ? "Explore a recorded research case"
                            : "Explore live event markets"}
                        </h3>
                        <p>
                          {sourceMode === "recorded"
                            ? "Choose an event below. Its dataset has an explicit origin and can be replayed without changing the sources."
                            : "Select a live event. Quote quality, missing histories, and evidence gaps remain part of the answer."}
                        </p>
                        <span className="intro-data-note">
                          <Status value={sourceMode} />
                          You control the data mode
                        </span>
                      </div>
                    </section>
                    <EventTable
                      events={events}
                      loading={loadingEvents}
                      onSelect={selectEvent}
                    />
                  </>
                ) : (
                  <section className="panel event-preview">
                    <div className="panel-heading">
                      <div>
                        <span className="eyebrow">OPEN A RESEARCH CASE</span>
                        <h2>What changed, and why might it matter?</h2>
                      </div>
                      <Status value={activeEvent.origin ?? sourceMode} />
                    </div>
                    <p className="event-description">
                      {activeEvent.description ||
                        "Investigate the event, compare its observed asset response, and save a thesis with explicit disconfirmation rules."}
                    </p>
                    <SourceLink href={activeEvent.source_url}>
                      Inspect event source
                    </SourceLink>
                    <div className="contract-preview-grid">
                      {(activeEvent.contracts ?? [])
                        .slice(0, 6)
                        .map((contract) => (
                          <article key={contract.id}>
                            <span>
                              {contract.group_label || contract.question}
                            </span>
                            <strong>
                              {probability(contract.prices?.[0], 1)}
                            </strong>
                            <small>
                              Provider event quote · confirm in research
                            </small>
                          </article>
                        ))}
                    </div>
                    <label className="field-label">Assets to investigate</label>
                    <div className="asset-picker">
                      {Array.from(
                        new Set([
                          ...defaultAssets,
                          ...Object.keys(activeEvent.asset_links ?? {}),
                        ]),
                      ).map((asset) => (
                        <button
                          key={asset}
                          aria-pressed={assetDraft.includes(asset)}
                          onClick={() =>
                            setAssetDraft((current) =>
                              current.includes(asset)
                                ? current.filter((item) => item !== asset)
                                : [...current, asset].slice(0, 10),
                            )
                          }
                        >
                          {assetDraft.includes(asset) && (
                            <IconCheck size={12} />
                          )}
                          {asset}
                        </button>
                      ))}
                    </div>
                    <p className="panel-note">
                      Observed histories are retrieved where available. A
                      missing history produces a visible evidence gap.
                    </p>
                    <div className="preview-action">
                      <button
                        className="button primary"
                        disabled={busy || !assetDraft.length}
                        onClick={() => void createResearch()}
                      >
                        Open research case
                        <IconArrowRight size={16} />
                      </button>
                      <span>
                        Sources, thesis, and history are saved together.
                      </span>
                    </div>
                  </section>
                )}
              </>
            )}
            {tab === "overview" && detail && (
              <>
                <div className="summary-grid">
                  <article className="summary-stat">
                    <span>MARKET EXPECTATION</span>
                    <div>
                      {probability(currentMarket?.probability, 1)}
                      <Status
                        value={
                          currentMarket?.probability == null
                            ? "insufficient"
                            : "source_linked"
                        }
                      />
                    </div>
                    <small>
                      {currentMarket
                        ? `${label(currentMarket.quote_type ?? "unavailable")} · ${dateTime(currentMarket.as_of)}`
                        : "No quote captured"}
                    </small>
                    <small className="tracked-stat">
                      {bundle?.event.contracts?.find(
                        (item) => item.id === currentMarket?.market_id,
                      )?.group_label ??
                        bundle?.event.contracts?.find(
                          (item) => item.id === currentMarket?.market_id,
                        )?.question ??
                        "Select an exact contract"}
                    </small>
                  </article>
                  <article className="summary-stat">
                    <span>7-DAY REPRICING</span>
                    <div>
                      <Delta value={numeric(leadingChange?.delta_7d_pp)} />
                      <small>percentage points</small>
                    </div>
                    <small>
                      {numeric(leadingChange?.window_7d_elapsed_hours) != null
                        ? `${((numeric(leadingChange?.window_7d_elapsed_hours) ?? 0) / 24).toFixed(1)} days actually elapsed · same contract`
                        : "Target window · exact interval requires history"}
                    </small>
                  </article>
                  <article className="summary-stat">
                    <span>EVIDENCE SNAPSHOT</span>
                    <div>
                      {bundle?.observations?.length ?? 0}
                      <small>source records</small>
                    </div>
                    <small>
                      {bundle
                        ? `Captured ${dateTime(bundle.captured_at)}`
                        : "Waiting for immutable inputs"}
                    </small>
                  </article>
                  <article className="summary-stat">
                    <span>ASSET RESPONSE</span>
                    <div className="summary-label">
                      {rows(metrics.asset_response).some(
                        (item) => string(item.status) === "experimental",
                      )
                        ? "Experimental"
                        : "Insufficient"}
                    </div>
                    <small>Association is not a causal forecast</small>
                  </article>
                </div>
                <div className="research-layout">
                  <div className="research-primary">
                    {bundle ? (
                      <>
                        <Timeline
                          bundle={bundle}
                          market={currentMarket}
                          asset={currentAsset}
                          onSelectAsset={setSelectedAsset}
                        />
                        <MarketDetails
                          bundle={bundle}
                          selected={currentMarket}
                          onSelect={setSelectedMarket}
                          onEvidence={inspectEvidence}
                        />
                      </>
                    ) : (
                      <section className="panel">
                        <Empty
                          title={
                            running
                              ? "Research is in progress"
                              : "No input snapshot published"
                          }
                        >
                          {running
                            ? "The research service is collecting and checking source observations. Activity above records its actual progress."
                            : run?.error ||
                              "The question and saved case remain available. Resume or refresh the run to try again."}
                        </Empty>
                      </section>
                    )}
                    <AnalysisPanels
                      detail={detail}
                      marketId={currentMarket?.market_id}
                      onEvidence={inspectEvidence}
                    />
                  </div>
                  <aside className="research-notebook">
                    {activeCase && (
                      <Notebook
                        researchCase={activeCase}
                        bundle={bundle}
                        runRules={run?.rules}
                        onSave={patchCase}
                        onRefresh={() => void startRun({ mode: "refresh" })}
                      />
                    )}
                    <div className="desk-principles">
                      <span className="eyebrow">READ THE LABELS</span>
                      <p>
                        <Status value="source_linked" />
                        Traceable to stored evidence
                      </p>
                      <p>
                        <Status value="experimental" />
                        An assumption or unvalidated method
                      </p>
                      <p>
                        <Status value="insufficient" />
                        The data do not support an estimate
                      </p>
                    </div>
                  </aside>
                </div>
              </>
            )}
            {tab === "scenario" && (
              <ScenarioLab
                key={run?.id ?? "standalone"}
                detail={detail}
                busy={busy}
                onFork={
                  activeCase
                    ? (scenario) =>
                        void startRun({
                          mode: "scenario",
                          parent_run_id: run?.id,
                          scenario,
                        })
                    : undefined
                }
              />
            )}
            {tab === "evidence" && (
              <EvidencePanel
                bundle={bundle}
                pinnedBundle={pinnedBundle}
                run={run}
                onEvidence={inspectEvidence}
                onImported={() =>
                  setSourceNotice(
                    "CSV source imported. Refresh the case to collect the new series into a pinned snapshot.",
                  )
                }
              />
            )}
            {tab === "history" &&
              (activeCase ? (
                <HistoryPanel
                  runs={caseDetail?.runs ?? (run ? [run] : [])}
                  currentRun={run}
                  busy={busy}
                  onLoad={(id) => void loadRun(id)}
                  onRun={(request) => void startRun(request)}
                />
              ) : (
                <section className="panel">
                  <Empty title="A research case starts the history">
                    Select an event and open a case to capture, replay, and
                    compare source snapshots.
                  </Empty>
                </section>
              ))}
            {tab === "evaluation" && (
              <EvaluationPanel
                evaluation={evaluation}
                error={evaluationError}
                onRetry={() => void loadEvaluation()}
              />
            )}
          </div>
          <footer className="desk-footer">
            <span>
              POLY TREND V3<span className="footer-divider">/</span>Event
              research, not trade execution.
            </span>
            <span>
              Market observations, model assumptions, and validated claims
              remain distinct.
            </span>
          </footer>
        </main>
      </div>
      <EvidenceDrawer
        observation={drawerObservation}
        onClose={() => setDrawerObservation(null)}
      />
    </div>
  );
}

function QueueSignal({ event }: { event: EventDefinition }) {
  const attention = record(event.attention);
  const delta = numeric(attention.delta_7d_pp);
  return (
    <>
      <span
        className="queue-outcome"
        title={string(attention.question, "Contract not captured")}
      >
        {string(attention.question, "Contract capture required")}
      </span>
      <span className="queue-signal">
        <strong className="mono">
          {probability(numeric(attention.probability), 1)}
        </strong>
        {delta == null ? (
          <small>Capture required</small>
        ) : (
          <span>
            <Delta value={delta} />
            <small>7d</small>
          </span>
        )}
      </span>
    </>
  );
}

function EventTable({
  events,
  loading,
  onSelect,
}: {
  events: EventDefinition[];
  loading: boolean;
  onSelect: (event: EventDefinition) => void;
}) {
  return (
    <section className="panel attention-table">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">WHERE EXPECTATIONS ARE MOVING</span>
          <h2>Event attention queue</h2>
        </div>
        <span className="subtle-label">{events.length} event families</span>
      </div>
      <p className="panel-note top-note">
        Ordered by observed repricing where history is available. Each row
        tracks the named outcome. Changes use the nearest available observation
        to the target window; inspect elapsed time where shown. This ranks
        research attention, not expected returns.
      </p>
      {loading ? (
        <Empty title="Connecting to research data">
          The workspace is waiting for the selected data source.
        </Empty>
      ) : !events.length ? (
        <Empty title="No events returned">
          Check the connection or change the search. No demonstration data are
          inserted into live mode.
        </Empty>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Event family</th>
                <th>Outcome price</th>
                <th>1d target</th>
                <th>7d target</th>
                <th>30d target</th>
                <th>Quote quality</th>
                <th>As of / origin</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const attention = record(event.attention);
                const delta7 = numeric(attention.delta_7d_pp);
                const spread = numeric(attention.spread_pp);
                return (
                  <tr key={event.id}>
                    <td>
                      <button
                        className="event-table-link"
                        onClick={() => onSelect(event)}
                      >
                        <span>
                          {label(event.category ?? "event")} ·{" "}
                          {event.contracts?.length ?? 0} contracts
                        </span>
                        <strong>{event.title}</strong>
                        <small className="tracked-outcome">
                          Tracked:{" "}
                          {string(
                            attention.question,
                            "Contract capture required",
                          )}
                        </small>
                      </button>
                    </td>
                    <td className="mono strong attention-probability">
                      {probability(numeric(attention.probability), 1)}
                    </td>
                    <td>
                      <WindowChange item={attention} days={1} />
                    </td>
                    <td>
                      {delta7 == null ? (
                        <span className="capture-needed">Capture required</span>
                      ) : (
                        <WindowChange item={attention} days={7} />
                      )}
                    </td>
                    <td>
                      <WindowChange item={attention} days={30} />
                    </td>
                    <td>
                      <span className="mono">
                        {spread == null
                          ? "Spread unavailable"
                          : `${spread.toFixed(1)} pp spread`}
                      </span>
                      <small className="table-small">
                        {label(
                          string(attention.quote_type, "No quote captured"),
                        )}
                      </small>
                      <small className="table-small">
                        Depth {currency(numeric(attention.bid_depth_usd))} /{" "}
                        {currency(numeric(attention.ask_depth_usd))}
                      </small>
                    </td>
                    <td>
                      <span className="attention-asof">
                        {typeof attention.as_of === "string"
                          ? dateTime(attention.as_of)
                          : "Awaiting capture"}
                      </span>
                      <small className="table-small">
                        <Status value={event.origin ?? "live"} />
                      </small>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Open ${event.title}`}
                        onClick={() => onSelect(event)}
                      >
                        <IconArrowUpRight size={18} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
