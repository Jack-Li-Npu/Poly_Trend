"use client";

import {
  IconArrowRight,
  IconCheck,
  IconChevronRight,
  IconDownload,
  IconFileImport,
  IconPlus,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  currency,
  dateTime,
  decimal,
  download,
  label,
  numeric,
  probability,
  record,
  rows,
  signedPercent,
  string,
  strings,
} from "@/lib/format";
import type {
  CasePatch,
  EvaluationReport,
  EvidenceBundle,
  InvalidationRule,
  Observation,
  ResearchCase,
  ResearchRun,
  RunCreate,
  RunDetail,
  ScenarioAssumptions,
  SimulationResult,
} from "@/lib/types";
import { Delta, Empty, SourceLink, Status, WindowChange } from "./Visuals";

export function AnalysisPanels({
  detail,
  marketId,
  onEvidence,
}: {
  detail: RunDetail;
  marketId?: string;
  onEvidence: (id: string) => void;
}) {
  const [holding, setHolding] = useState(5);
  const metrics = record(detail.run.metrics);
  const expectation = rows(metrics.expectation_changes);
  const consistency = rows(metrics.logical_consistency);
  const assets = rows(metrics.asset_response).filter(
    (item) =>
      numeric(item.holding_sessions) === holding &&
      (!marketId || string(item.market_id) === marketId),
  );
  const distributions = rows(metrics.family_distributions);
  const claims = detail.run.claims ?? [];
  return (
    <>
      <section className="panel repricing-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">WHAT CHANGED</span>
            <h2>Event expectations</h2>
          </div>
          <span className="subtle-label">Percentage points</span>
        </div>
        {expectation.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Contract / outcome</th>
                  <th>Now</th>
                  <th>1d target</th>
                  <th>7d target</th>
                  <th>30d target</th>
                </tr>
              </thead>
              <tbody>
                {expectation.map((item, index) => (
                  <tr key={string(item.market_id, String(index))}>
                    <td>
                      <button
                        className="table-source"
                        onClick={() => {
                          const id = strings(item.evidence_ids)[0];
                          if (id) onEvidence(id);
                        }}
                        disabled={!strings(item.evidence_ids).length}
                      >
                        {string(item.question, string(item.market_id))}
                        <IconChevronRight size={14} />
                      </button>
                    </td>
                    <td className="mono strong">
                      {probability(numeric(item.probability), 1)}
                    </td>
                    <td>
                      <WindowChange item={item} days={1} />
                    </td>
                    <td>
                      <WindowChange item={item} days={7} />
                    </td>
                    <td>
                      <WindowChange item={item} days={30} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Change requires comparable snapshots">
            No change is inferred from an isolated quote.
          </Empty>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">LOGIC BEFORE CONSENSUS</span>
            <h2>Contract coherence</h2>
          </div>
        </div>
        {consistency.length ? (
          <div className="logic-list">
            {consistency.map((item, index) => (
              <div className="logic-item" key={index}>
                <div className="row-between">
                  <strong>{label(string(item.kind))}</strong>
                  <Status
                    value={item.verified ? string(item.status) : "insufficient"}
                  />
                </div>
                <p>
                  {string(
                    item.rationale,
                    "No comparability rationale returned.",
                  )}
                </p>
                {Object.entries(record(item.coherent_ranges)).length > 0 && (
                  <div className="range-list">
                    {Object.entries(record(item.coherent_ranges)).map(
                      ([id, range]) => (
                        <div key={id}>
                          <span>
                            {detail.bundle?.event.contracts?.find(
                              (contract) => contract.id === id,
                            )?.group_label ??
                              detail.bundle?.event.contracts?.find(
                                (contract) => contract.id === id,
                              )?.question ??
                              id}
                          </span>
                          <strong className="mono">
                            {Array.isArray(range)
                              ? `${probability(numeric(range[0]), 1)}–${probability(numeric(range[1]), 1)}`
                              : "—"}
                          </strong>
                        </div>
                      ),
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="panel-note">
            No verified logical relation was supplied. Similar wording alone
            does not make contracts comparable.
          </p>
        )}
      </section>
      {distributions.length > 0 && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">JOINT LOGIC, VISIBLE BOUNDS</span>
              <h2>Event-family distributions</h2>
            </div>
          </div>
          <div className="distribution-list">
            {distributions.map((family, index) => (
              <article key={index}>
                <div className="row-between">
                  <h3>{label(string(family.kind))}</h3>
                  <Status value={string(family.status, "insufficient")} />
                </div>
                {rows(family.bins).map((bin, binIndex) => (
                  <div className="distribution-row" key={binIndex}>
                    <span>{string(bin.label, string(bin.market_id))}</span>
                    <div className="distribution-track">
                      <i
                        style={{
                          width: `${Math.min(100, Math.max(0, (numeric(bin.probability) ?? 0) * 100))}%`,
                        }}
                      />
                    </div>
                    <strong className="mono">
                      {probability(numeric(bin.probability), 1)}
                    </strong>
                    {Array.isArray(bin.range) && (
                      <small className="mono">
                        {probability(numeric(bin.range[0]))}–
                        {probability(numeric(bin.range[1]))}
                      </small>
                    )}
                  </div>
                ))}
                {family.complete_distribution === false && (
                  <p className="distribution-note">
                    Partial family: exhaustiveness is unproven.{" "}
                    {Array.isArray(family.unallocated_mass_range)
                      ? `Unallocated mass: ${probability(numeric(family.unallocated_mass_range[0]))}–${probability(numeric(family.unallocated_mass_range[1]))}.`
                      : ""}{" "}
                    {string(family.limitation, "")}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ASSET CONSEQUENCES</span>
            <h2>A hypothesis, tested in both directions</h2>
          </div>
          <div className="segmented" aria-label="Asset response window">
            {[1, 5, 20].map((sessions) => (
              <button
                key={sessions}
                aria-pressed={holding === sessions}
                onClick={() => setHolding(sessions)}
              >
                {sessions}D
              </button>
            ))}
          </div>
        </div>
        <p className="panel-note top-note">
          {holding}-session response windows for the selected contract. Forward
          association, reverse association, and reversals remain separate. These
          are experimental diagnostics.
        </p>
        {assets.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Same session</th>
                  <th>Event leads</th>
                  <th>Asset leads</th>
                  <th>Reversal</th>
                  <th>Windows</th>
                  <th>Pattern / state</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((item, index) => (
                  <tr key={`${string(item.symbol)}-${index}`}>
                    <td className="mono strong">{string(item.symbol)}</td>
                    <td>
                      <CorrelationCell value={item.contemporaneous} />
                    </td>
                    <td>
                      <CorrelationCell value={item.pm_leads_asset} />
                    </td>
                    <td>
                      <CorrelationCell value={item.asset_leads_pm} />
                    </td>
                    <td>
                      <CorrelationCell value={item.reversal} />
                    </td>
                    <td className="mono">
                      {numeric(item.independent_windows) ?? 0}
                    </td>
                    <td>
                      <Status value={string(item.status, "insufficient")} />
                      <small className="table-small">
                        {label(
                          string(item.descriptive_direction, "inconclusive"),
                        )}
                      </small>
                      <small className="table-small">
                        {label(string(item.mode, "point in time descriptive"))}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No asset response estimate">
            Overlapping histories and enough independent windows are required.
            You can import an observed series in Evidence.
          </Empty>
        )}
        <p className="panel-note">
          Intervals are exploratory Fisher-z approximations; the independence
          assumption is not robust to overlapping windows or autocorrelation.
          Correlation does not identify causal transmission. Retrospective
          reconstructions do not establish a tradable historical signal.
          Predictive performance and investment edge remain unestablished.
        </p>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">RESEARCH FINDINGS</span>
            <h2>Evidence, interpretation & challenge</h2>
          </div>
          <span className="subtle-label">{claims.length} claims</span>
        </div>
        {claims.length ? (
          <div className="claim-grid">
            {claims.map((claim) => (
              <article className={`claim claim-${claim.kind}`} key={claim.id}>
                <div className="row-between">
                  <span className="eyebrow">{label(claim.kind)}</span>
                  <Status value={claim.status ?? "source_linked"} />
                </div>
                <h3>{claim.title}</h3>
                <p>{claim.text}</p>
                {(claim.assumptions ?? []).length > 0 && (
                  <p className="claim-assumptions">
                    Assumes: {claim.assumptions?.join("; ")}
                  </p>
                )}
                {claim.method && (
                  <small className="muted">Method: {claim.method}</small>
                )}
                <div className="source-buttons">
                  {(claim.evidence_ids ?? []).slice(0, 4).map((id, index) => (
                    <button
                      className="text-button"
                      onClick={() => onEvidence(id)}
                      key={id}
                    >
                      Source {index + 1} ↗
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="No claims published yet">
            A failed or incomplete run does not become a completed research
            finding.
          </Empty>
        )}
      </section>
      {(detail.run.limitations ?? []).length > 0 && (
        <section className="limitations">
          <h3>What this run cannot establish</h3>
          <ul>
            {detail.run.limitations?.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function CorrelationCell({ value }: { value: unknown }) {
  const estimate = record(value);
  const interval = Array.isArray(estimate.ci95) ? estimate.ci95 : null;
  return (
    <div
      className="correlation-cell"
      title={string(
        estimate.inference_limit,
        "Descriptive association. No predictive or causal interpretation is established.",
      )}
    >
      <strong className="mono">{decimal(numeric(estimate.correlation))}</strong>
      <small className="mono">n={numeric(estimate.n) ?? 0}</small>
      {interval && (
        <small className="mono">
          95% [{decimal(numeric(interval[0]))}, {decimal(numeric(interval[1]))}]
        </small>
      )}
    </div>
  );
}

export function Notebook({
  researchCase,
  bundle,
  runRules,
  onSave,
  onRefresh,
}: {
  researchCase: ResearchCase;
  bundle?: EvidenceBundle | null;
  runRules?: InvalidationRule[];
  onSave: (patch: CasePatch) => Promise<void>;
  onRefresh: () => void;
}) {
  const [thesis, setThesis] = useState(researchCase.thesis ?? "");
  const [assumptions, setAssumptions] = useState(
    (researchCase.assumptions ?? []).join("\n"),
  );
  const [rules, setRules] = useState<InvalidationRule[]>(
    researchCase.rules ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ruleMarket, setRuleMarket] = useState("");
  const [operator, setOperator] = useState<"above" | "below">("below");
  const [threshold, setThreshold] = useState(40);
  const [ruleName, setRuleName] = useState("");
  useEffect(() => {
    setThesis(researchCase.thesis ?? "");
    setAssumptions((researchCase.assumptions ?? []).join("\n"));
    setRules(researchCase.rules ?? []);
    setSaved(false);
    setError(null);
  }, [researchCase.id, researchCase.revision]);
  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onSave({
        thesis,
        assumptions: assumptions
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
        rules,
      });
      setSaved(true);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The case could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }
  const contracts = bundle?.event.contracts ?? [];
  const dirty =
    thesis !== (researchCase.thesis ?? "") ||
    assumptions !== (researchCase.assumptions ?? []).join("\n") ||
    JSON.stringify(rules) !== JSON.stringify(researchCase.rules ?? []);
  return (
    <section className="panel notebook">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">YOUR WORKING THESIS</span>
          <h2>Make it falsifiable.</h2>
        </div>
        <span className="mono subtle-label">Rev {researchCase.revision}</span>
      </div>
      <label className="field-label">
        Interpretation
        <textarea
          rows={4}
          maxLength={4000}
          placeholder="What is the event repricing telling you? Separate your view from the observed facts."
          value={thesis}
          onChange={(event) => {
            setThesis(event.target.value);
            setSaved(false);
          }}
        />
      </label>
      <label className="field-label">
        Assumptions · one per line
        <textarea
          rows={3}
          maxLength={4000}
          placeholder="Which conditions must hold?"
          value={assumptions}
          onChange={(event) => {
            setAssumptions(event.target.value);
            setSaved(false);
          }}
        />
      </label>
      <div className="notebook-divider">
        <h3>What would change your mind?</h3>
        <p>
          Monitor an exact market outcome. Thresholds are your research rules.
        </p>
      </div>
      <div className="rule-list">
        {rules.map((rule) => (
          <div className="rule-item" key={rule.id}>
            <div>
              <strong>{rule.label}</strong>
              <small>
                {rule.operator} {probability(rule.threshold)} ·{" "}
                <Status
                  value={
                    runRules?.find((item) => item.id === rule.id)?.state ??
                    rule.state ??
                    "pending"
                  }
                />
              </small>
            </div>
            <button
              className="icon-button"
              aria-label={`Remove rule: ${rule.label}`}
              onClick={() =>
                setRules((current) =>
                  current.filter((item) => item.id !== rule.id),
                )
              }
            >
              <IconTrash size={15} />
            </button>
          </div>
        ))}
      </div>
      {contracts.length > 0 && (
        <details className="add-rule">
          <summary>
            <IconPlus size={14} />
            Add an invalidation rule
          </summary>
          <div className="form-stack">
            <label className="field-label">
              Rule name
              <input
                value={ruleName}
                maxLength={160}
                onChange={(event) => setRuleName(event.target.value)}
                placeholder="Reconsider the thesis if…"
              />
            </label>
            <label className="field-label">
              Contract
              <select
                value={ruleMarket || contracts[0].id}
                onChange={(event) => setRuleMarket(event.target.value)}
              >
                {contracts.map((contract) => (
                  <option key={contract.id} value={contract.id}>
                    {contract.question}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-pair">
              <label className="field-label">
                Probability
                <select
                  value={operator}
                  onChange={(event) =>
                    setOperator(event.target.value as "above" | "below")
                  }
                >
                  <option value="below">Falls below</option>
                  <option value="above">Rises above</option>
                </select>
              </label>
              <label className="field-label">
                Threshold %
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={threshold}
                  onChange={(event) => setThreshold(Number(event.target.value))}
                />
              </label>
            </div>
            <button
              className="button secondary"
              disabled={
                !ruleName.trim() ||
                !Number.isFinite(threshold) ||
                threshold < 0 ||
                threshold > 100 ||
                rules.length >= 20
              }
              onClick={() => {
                setRules((current) => [
                  ...current,
                  {
                    id: crypto.randomUUID(),
                    label: ruleName.trim(),
                    market_id: ruleMarket || contracts[0].id,
                    operator,
                    threshold: threshold / 100,
                    state: "pending",
                  },
                ]);
                setRuleName("");
              }}
            >
              Add rule to draft
            </button>
          </div>
        </details>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="save-row">
        <button
          className="button primary"
          onClick={() => void save()}
          disabled={saving || !dirty}
        >
          {saving ? (
            "Saving…"
          ) : (
            <>
              <IconCheck size={15} />
              Save thesis
            </>
          )}
        </button>
        <span className="save-state" role="status">
          {saved
            ? "Saved to this case"
            : dirty
              ? "Unsaved changes"
              : "All changes saved"}
        </span>
      </div>
      <div className="monitor-row">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={researchCase.refresh_enabled ?? false}
            disabled={saving || dirty}
            title={
              dirty
                ? "Save your thesis before changing scheduled refresh"
                : undefined
            }
            onChange={async (event) => {
              setSaving(true);
              try {
                await onSave({ refresh_enabled: event.target.checked });
              } catch (failure) {
                setError(
                  failure instanceof Error
                    ? failure.message
                    : "Refresh preference was not saved.",
                );
              } finally {
                setSaving(false);
              }
            }}
          />
          Scheduled refresh
        </label>
        <button className="text-button" onClick={onRefresh}>
          <IconRefresh size={13} />
          Refresh now
        </button>
      </div>
    </section>
  );
}

const initialScenario: ScenarioAssumptions = {
  probability: 0.6,
  event_return: 0.08,
  non_event_return: -0.05,
  round_trip_cost_bps: 20,
  capital: 10000,
  holding_sessions: 5,
  assumption_source: "user",
};
export function ScenarioLab({
  detail,
  onFork,
  busy: parentBusy = false,
}: {
  detail?: RunDetail | null;
  onFork?: (scenario: ScenarioAssumptions) => void;
  busy?: boolean;
}) {
  const [assumptions, setAssumptions] = useState<ScenarioAssumptions>(
    detail?.run.scenario ?? initialScenario,
  );
  const [symbol, setSymbol] = useState(
    detail?.bundle?.assets?.find((item) => (item.points?.length ?? 0) > 0)
      ?.symbol ??
      detail?.bundle?.assets?.[0]?.symbol ??
      "SPY",
  );
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joint, setJoint] = useState(
    detail?.run.scenario?.second_event_probability != null,
  );
  const [declareJoint, setDeclareJoint] = useState(
    detail?.run.scenario?.joint_probability != null,
  );
  const [jointPayoffsEnabled, setJointPayoffsEnabled] = useState(
    !!detail?.run.scenario?.joint_payoffs,
  );
  const [decisionAt, setDecisionAt] = useState("");
  function update<K extends keyof ScenarioAssumptions>(
    key: K,
    value: ScenarioAssumptions[K],
  ) {
    setAssumptions((current) => ({ ...current, [key]: value }));
    setResult(null);
  }
  function declaredAssumptions(): ScenarioAssumptions {
    return {
      ...assumptions,
      joint_probability:
        joint && declareJoint ? (assumptions.joint_probability ?? 0.3) : null,
      second_event_probability: joint
        ? (assumptions.second_event_probability ?? 0.5)
        : null,
      joint_payoffs:
        joint && jointPayoffsEnabled
          ? (assumptions.joint_payoffs ?? {
              both: 0.12,
              first_only: 0.08,
              second_only: 0.03,
              neither: -0.05,
            })
          : null,
    };
  }
  function updatePayoff(
    key: "both" | "first_only" | "second_only" | "neither",
    percentage: number,
  ) {
    update("joint_payoffs", {
      both: 0.12,
      first_only: 0.08,
      second_only: 0.03,
      neither: -0.05,
      ...assumptions.joint_payoffs,
      [key]: percentage / 100,
    });
  }
  async function calculate() {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.simulate({
          assumptions: declaredAssumptions(),
          run_id: detail?.run.id,
          symbol,
          decision_at: decisionAt
            ? new Date(decisionAt).toISOString()
            : undefined,
        }),
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Scenario calculation failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  const valid =
    Number.isFinite(assumptions.capital) &&
    (assumptions.capital ?? 0) > 0 &&
    (assumptions.holding_sessions ?? 0) >= 1;
  return (
    <div className="scenario-layout">
      <section className="panel scenario-inputs">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">SCENARIO LAB</span>
            <h2>Change the assumptions.</h2>
          </div>
          <Status value="experimental" />
        </div>
        <div className="notice neutral">
          Your assumptions drive this calculation. Market-implied probabilities
          are not silently substituted.
        </div>
        <label className="field-label">
          Research asset
          <select
            value={symbol}
            onChange={(event) => {
              setSymbol(event.target.value);
              setResult(null);
            }}
          >
            {(detail?.bundle?.assets?.length
              ? detail.bundle.assets
              : [{ symbol: "SPY" }, { symbol: "QQQ" }, { symbol: "BTC-USD" }]
            ).map((asset) => (
              <option key={asset.symbol}>{asset.symbol}</option>
            ))}
          </select>
        </label>
        <Slider
          label="Your event probability"
          value={(assumptions.probability ?? 0.6) * 100}
          min={0}
          max={100}
          step={1}
          suffix="%"
          onChange={(value) => update("probability", value / 100)}
        />
        <Slider
          label="Asset return if event happens"
          value={(assumptions.event_return ?? 0.08) * 100}
          min={-50}
          max={100}
          step={1}
          suffix="%"
          onChange={(value) => update("event_return", value / 100)}
        />
        <Slider
          label="Asset return if event does not happen"
          value={(assumptions.non_event_return ?? -0.05) * 100}
          min={-50}
          max={100}
          step={1}
          suffix="%"
          onChange={(value) => update("non_event_return", value / 100)}
        />
        <div className="form-pair">
          <label className="field-label">
            Illustrative capital · USD
            <input
              type="number"
              min={1}
              max={1e12}
              value={assumptions.capital}
              onChange={(event) =>
                update("capital", Number(event.target.value))
              }
            />
          </label>
          <label className="field-label">
            Round-trip cost · bps
            <input
              type="number"
              min={0}
              max={10000}
              value={assumptions.round_trip_cost_bps}
              onChange={(event) =>
                update("round_trip_cost_bps", Number(event.target.value))
              }
            />
          </label>
        </div>
        <label className="field-label">
          Holding window · sessions
          <select
            value={assumptions.holding_sessions}
            onChange={(event) =>
              update("holding_sessions", Number(event.target.value))
            }
          >
            <option value={1}>1 session</option>
            <option value={5}>5 sessions</option>
            <option value={20}>20 sessions</option>
          </select>
        </label>
        <details>
          <summary>Joint-event stress</summary>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={joint}
              onChange={(event) => {
                setJoint(event.target.checked);
                setResult(null);
              }}
            />
            Include a second event
          </label>
          {joint && (
            <>
              <Slider
                label="Second-event probability"
                value={(assumptions.second_event_probability ?? 0.5) * 100}
                min={0}
                max={100}
                step={1}
                suffix="%"
                onChange={(value) =>
                  update("second_event_probability", value / 100)
                }
              />
              <label className="checkbox-label joint-option">
                <input
                  type="checkbox"
                  checked={declareJoint}
                  onChange={(event) => {
                    setDeclareJoint(event.target.checked);
                    setResult(null);
                  }}
                />
                Declare the probability of both events
              </label>
              {declareJoint && (
                <Slider
                  label="Joint probability · both events"
                  value={(assumptions.joint_probability ?? 0.3) * 100}
                  min={0}
                  max={100}
                  step={1}
                  suffix="%"
                  onChange={(value) => update("joint_probability", value / 100)}
                />
              )}
              <label className="checkbox-label joint-option">
                <input
                  type="checkbox"
                  checked={jointPayoffsEnabled}
                  onChange={(event) => {
                    setJointPayoffsEnabled(event.target.checked);
                    setResult(null);
                  }}
                />
                Specify returns in all four states
              </label>
              {jointPayoffsEnabled && (
                <>
                  <p className="panel-note joint-input-note">
                    Returns below are your conditional assumptions. Unknown
                    dependence produces a range over feasible joint
                    probabilities.
                  </p>
                  <div className="joint-payoff-grid">
                    {(
                      [
                        ["both", "Both events"],
                        ["first_only", "First event only"],
                        ["second_only", "Second event only"],
                        ["neither", "Neither event"],
                      ] as const
                    ).map(([key, title]) => (
                      <label className="field-label" key={key}>
                        {title} · return %
                        <input
                          type="number"
                          min={-100}
                          max={1000}
                          step={1}
                          value={
                            (assumptions.joint_payoffs ?? {
                              both: 0.12,
                              first_only: 0.08,
                              second_only: 0.03,
                              neither: -0.05,
                            })[key] * 100
                          }
                          onChange={(event) =>
                            updatePayoff(key, Number(event.target.value))
                          }
                        />
                      </label>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </details>
        {detail && (
          <details>
            <summary>Historical outcome check</summary>
            <p className="panel-note">
              Select a decision time to compare this assumption with
              subsequently observed asset returns, where the stored sample
              permits.
            </p>
            <label className="field-label">
              Decision time · your local time
              <input
                type="datetime-local"
                value={decisionAt}
                onChange={(event) => {
                  setDecisionAt(event.target.value);
                  setResult(null);
                }}
              />
            </label>
          </details>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <button
          className="button primary full-width"
          disabled={busy || !valid}
          onClick={() => void calculate()}
        >
          {busy ? (
            "Calculating…"
          ) : (
            <>
              Calculate scenario
              <IconArrowRight size={16} />
            </>
          )}
        </button>
        {onFork && (
          <button
            className="button secondary full-width scenario-save"
            disabled={parentBusy || !detail?.run.bundle_id || !result}
            onClick={() => onFork(declaredAssumptions())}
          >
            Save these inputs as a scenario fork
            <IconArrowRight size={14} />
          </button>
        )}
      </section>
      <section className="scenario-output">
        {result ? (
          <>
            <div className="panel scenario-result">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">CONDITIONAL RESULT</span>
                  <h2>What follows from your inputs</h2>
                </div>
                <button
                  className="icon-button"
                  aria-label="Export scenario as JSON"
                  onClick={() =>
                    download(
                      "poly-trend-scenario.json",
                      JSON.stringify(
                        { assumptions: declaredAssumptions(), result },
                        null,
                        2,
                      ),
                      "application/json",
                    )
                  }
                >
                  <IconDownload size={18} />
                </button>
              </div>
              <div className="scenario-number">
                {signedPercent(result.expected_return)}
                <span>single-event assumption-weighted return after costs</span>
              </div>
              <div className="scenario-summary">
                <div>
                  <span>Expected P&L</span>
                  <strong>{currency(result.expected_pnl)}</strong>
                </div>
                <div>
                  <span>Break-even probability</span>
                  <strong>
                    {result.feasible_break_even
                      ? probability(result.break_even_probability, 1)
                      : "Not attainable"}
                  </strong>
                </div>
                <div>
                  <span>If event happens</span>
                  <strong>{currency(result.event_pnl)}</strong>
                </div>
                <div>
                  <span>If event does not</span>
                  <strong>{currency(result.non_event_pnl)}</strong>
                </div>
              </div>
              <p className="equation">
                p × event return + (1 − p) × non-event return − round-trip costs
              </p>
              {(result.sensitivity ?? []).length > 0 && (
                <div className="sensitivity">
                  <h3>Probability sensitivity</h3>
                  <div className="sensitivity-bars">
                    {result.sensitivity
                      ?.filter(
                        (_, index) =>
                          index %
                            Math.max(
                              1,
                              Math.floor(
                                (result.sensitivity?.length ?? 1) / 11,
                              ),
                            ) ===
                          0,
                      )
                      .map((item, index) => {
                        const value = numeric(item.expected_return) ?? 0;
                        return (
                          <div key={index}>
                            <strong className={value >= 0 ? "up" : "down"}>
                              {signedPercent(value)}
                            </strong>
                            <span
                              className="sensitivity-bar"
                              style={{
                                height: `${Math.max(3, Math.min(90, Math.abs(value) * 600))}px`,
                                background:
                                  value >= 0 ? "var(--teal)" : "var(--rust)",
                              }}
                            />
                            <small>{probability(item.probability)}</small>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
              {result.joint_bounds && (
                <p className="panel-note">
                  Feasible joint probability:{" "}
                  {probability(result.joint_bounds[0])}–
                  {probability(result.joint_bounds[1])}. Dependencies are
                  constrained, not assumed independent.
                </p>
              )}
              {result.joint_scenario && (
                <JointStressResult value={result.joint_scenario} />
              )}
              {result.historical_result && (
                <div className="historical-check">
                  <h3>Historical outcome check</h3>
                  <dl className="detail-list">
                    {Object.entries(result.historical_result).map(
                      ([key, value]) => (
                        <div key={key}>
                          <dt>{label(key)}</dt>
                          <dd>
                            {typeof value === "number"
                              ? decimal(value, 4)
                              : typeof value === "string"
                                ? label(value)
                                : JSON.stringify(value)}
                          </dd>
                        </div>
                      ),
                    )}
                  </dl>
                </div>
              )}
            </div>
            <section className="limitations">
              <h3>Interpretation boundaries</h3>
              <ul>
                <li>
                  This is a conditional calculation, not an independently
                  calibrated forecast or a trading instruction.
                </li>
                {result.limitations?.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          </>
        ) : (
          <div className="panel scenario-placeholder">
            <div className="scenario-diagram" aria-hidden="true">
              <span>p</span>
              <IconArrowRight size={24} />
              <span>r₁ / r₀</span>
              <IconArrowRight size={24} />
              <span>Σ</span>
            </div>
            <h2>A transparent scenario, all the way down.</h2>
            <p>
              Set the probability, conditional asset returns, and costs. The
              server calculates the result and the probability required to break
              even.
            </p>
            <div className="scenario-placeholder-facts">
              <span>Visible assumptions</span>
              <span>Explicit costs</span>
              <span>No hidden forecast</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function JointStressResult({ value }: { value: unknown }) {
  const stress = record(value);
  const returns = Array.isArray(stress.expected_return_bounds)
    ? stress.expected_return_bounds
    : [];
  const pnl = Array.isArray(stress.expected_pnl_bounds)
    ? stress.expected_pnl_bounds
    : [];
  const jointBounds = Array.isArray(stress.joint_probability_bounds)
    ? stress.joint_probability_bounds
    : [];
  const point = record(stress.point);
  const marginals = record(stress.marginals);
  return (
    <section className="joint-stress-result">
      <div className="row-between">
        <h3>Four-state joint stress</h3>
        <Status value={string(stress.status, "experimental")} />
      </div>
      <p className="panel-note">
        Separate from the single-event result. Your first-event probability is{" "}
        {probability(numeric(marginals.first))}; your second-event probability
        is {probability(numeric(marginals.second))}.
      </p>
      <div className="joint-return-range">
        <strong>
          {signedPercent(numeric(returns[0]))} to{" "}
          {signedPercent(numeric(returns[1]))}
        </strong>
        <span>Feasible expected-return range after declared costs</span>
      </div>
      <div className="scenario-summary">
        <div>
          <span>Worst expected P&L</span>
          <strong>{currency(numeric(pnl[0]))}</strong>
        </div>
        <div>
          <span>Best expected P&L</span>
          <strong>{currency(numeric(pnl[1]))}</strong>
        </div>
        <div>
          <span>Feasible joint probability</span>
          <strong>
            {probability(numeric(jointBounds[0]))}–
            {probability(numeric(jointBounds[1]))}
          </strong>
        </div>
        <div>
          <span>Your declared joint point</span>
          <strong>
            {numeric(point.expected_return) == null
              ? "Not assumed"
              : signedPercent(numeric(point.expected_return))}
          </strong>
        </div>
      </div>
      <details className="joint-endpoints">
        <summary>Inspect the two dependence endpoints</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Joint p</th>
                <th>Both</th>
                <th>First only</th>
                <th>Second only</th>
                <th>Neither</th>
                <th>Expected return</th>
              </tr>
            </thead>
            <tbody>
              {rows(stress.endpoints).map((endpoint, index) => {
                const weights = record(endpoint.weights);
                return (
                  <tr key={index}>
                    <td>{probability(numeric(endpoint.joint_probability))}</td>
                    <td>{probability(numeric(weights.both))}</td>
                    <td>{probability(numeric(weights.first_only))}</td>
                    <td>{probability(numeric(weights.second_only))}</td>
                    <td>{probability(numeric(weights.neither))}</td>
                    <td>{signedPercent(numeric(endpoint.expected_return))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
      <p className="panel-note">
        The bounds vary dependence while keeping both declared event
        probabilities fixed. No independence assumption or point forecast is
        inserted.
      </p>
      {strings(stress.limitations).length > 0 && (
        <ul className="joint-limitations">
          {strings(stress.limitations).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Slider({
  label: title,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider-field">
      <span>
        {title}
        <strong className="mono">
          {value.toFixed(0)}
          {suffix}
        </strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function EvidencePanel({
  bundle,
  pinnedBundle,
  run,
  onEvidence,
  onImported,
}: {
  bundle?: EvidenceBundle | null;
  pinnedBundle?: EvidenceBundle | null;
  run?: ResearchRun;
  onEvidence: (id: string) => void;
  onImported: () => void;
}) {
  const [showImport, setShowImport] = useState(false);
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">EVIDENCE LEDGER</span>
            <h2>Every observation has a source.</h2>
          </div>
          <div className="evidence-tools">
            {(pinnedBundle ?? bundle) && (
              <button
                className="button secondary"
                onClick={() =>
                  download(
                    `poly-trend-inputs-${run?.id?.slice(0, 8) ?? "snapshot"}.json`,
                    JSON.stringify(
                      {
                        run,
                        bundle: pinnedBundle ?? bundle,
                        presentation: bundle,
                        input_note:
                          "The pinned bundle is the original full capture. For cutoff runs, only the separate presentation view was available to the displayed analysis.",
                      },
                      null,
                      2,
                    ),
                    "application/json",
                  )
                }
              >
                <IconDownload size={15} />
                Export pinned inputs
              </button>
            )}
            <button
              className="button secondary"
              onClick={() => setShowImport((value) => !value)}
            >
              <IconFileImport size={16} />
              Import CSV
            </button>
          </div>
        </div>
        {run?.as_of && (
          <p className="panel-note">
            Availability-filtered ledger as of {dateTime(run.as_of)}. The pinned
            input export is the original capture, including any observations
            excluded after this cutoff.
          </p>
        )}
        {bundle?.observations?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Provider / record</th>
                  <th>Observed</th>
                  <th>Available</th>
                  <th>Origin</th>
                  <th>Record</th>
                </tr>
              </thead>
              <tbody>
                {bundle.observations.map((observation) => (
                  <tr key={observation.id}>
                    <td>
                      <strong>{observation.provider}</strong>
                      <small className="table-small">
                        {label(observation.kind)}
                      </small>
                    </td>
                    <td className="mono">
                      {dateTime(observation.observed_at)}
                    </td>
                    <td className="mono">
                      {dateTime(observation.available_at)}
                    </td>
                    <td>
                      <Status value={observation.origin ?? "live"} />
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() =>
                          onEvidence(observation.id ?? observation.external_id)
                        }
                      >
                        Inspect
                        <IconChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No source records loaded">
            Open a case to inspect its immutable input snapshot, or import a
            historical asset series.
          </Empty>
        )}
      </section>
      {showImport && <ImportPanel onImported={onImported} />}
      {(bundle?.context ?? []).length > 0 && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">SUPPORT & COUNTEREVIDENCE</span>
              <h2>Context does not silently change the number.</h2>
            </div>
          </div>
          <div className="context-grid">
            {bundle?.context?.map((item) => (
              <article className="context-card" key={item.id}>
                <Status value={item.stance ?? "context"} />
                <h3>{item.title}</h3>
                <p>{item.summary}</p>
                <SourceLink href={item.source_url}>Read source</SourceLink>
                <small>Available {dateTime(item.available_at)}</small>
                <div className="source-buttons">
                  {(item.observation_ids ?? []).map((id, index) => (
                    <button
                      className="text-button"
                      onClick={() => onEvidence(id)}
                      key={id}
                    >
                      Record {index + 1} ↗
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {(bundle?.issues ?? []).length > 0 && (
        <section className="limitations">
          <h3>Source coverage</h3>
          <ul>
            {bundle?.issues?.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function ImportPanel({ onImported }: { onImported: () => void }) {
  const [csv, setCsv] = useState("");
  const [symbol, setSymbol] = useState("SPY");
  const [source, setSource] = useState("");
  const [adjustment, setAdjustment] = useState<
    "raw" | "split_adjusted" | "total_return" | "yield" | "unknown"
  >("raw");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.import({
        symbol: symbol.trim().toUpperCase(),
        csv,
        source_url: source,
        adjustment,
      });
      setMessage(
        `Imported ${symbol.toUpperCase()} with its source and adjustment metadata. Refresh the case to use it.`,
      );
      onImported();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="panel import-panel"
      onSubmit={(event) => void submit(event)}
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">BRING YOUR DATA</span>
          <h2>Import an observed asset series</h2>
        </div>
      </div>
      <p className="panel-note">
        CSV needs timestamp (or date), value (or close), and optionally
        available_at. Imported data remain labelled imported.
      </p>
      <div className="form-pair">
        <label className="field-label">
          Symbol
          <input
            required
            value={symbol}
            maxLength={40}
            onChange={(event) => setSymbol(event.target.value)}
          />
        </label>
        <label className="field-label">
          Adjustment
          <select
            value={adjustment}
            onChange={(event) =>
              setAdjustment(event.target.value as typeof adjustment)
            }
          >
            <option value="raw">Raw price</option>
            <option value="split_adjusted">Split adjusted</option>
            <option value="total_return">Total return</option>
            <option value="yield">Yield</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
      </div>
      <label className="field-label">
        Original source URL
        <input
          required
          type="url"
          value={source}
          placeholder="https://…"
          onChange={(event) => setSource(event.target.value)}
        />
      </label>
      <label className="field-label">
        Choose a CSV file
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file) {
              if (file.size > 5000000) {
                setError("Choose a CSV smaller than 5 MB.");
                return;
              }
              setCsv(await file.text());
            }
          }}
        />
      </label>
      <label className="field-label">
        Or paste CSV
        <textarea
          required
          rows={5}
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          placeholder={
            "timestamp,value,available_at\n2026-01-02,100,2026-01-02T21:00:00Z"
          }
        />
      </label>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="notice success" role="status">
          {message}
        </div>
      )}
      <button
        className="button primary"
        type="submit"
        disabled={busy || !symbol.trim() || !csv.trim()}
      >
        {busy ? "Importing…" : "Import source series"}
      </button>
    </form>
  );
}

export function HistoryPanel({
  runs,
  currentRun,
  busy,
  onLoad,
  onRun,
}: {
  runs: ResearchRun[];
  currentRun?: ResearchRun;
  busy: boolean;
  onLoad: (id: string) => void;
  onRun: (request: RunCreate) => void;
}) {
  const [asOf, setAsOf] = useState("");
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">SNAPSHOTS & REPLAY</span>
            <h2>The evidence changes. Keep the trail.</h2>
          </div>
        </div>
        <div className="replay-actions">
          <article>
            <span className="step-number">01</span>
            <h3>Refresh sources</h3>
            <p>
              Collect new observations and compare them with the previous
              snapshot.
            </p>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => onRun({ mode: "refresh" })}
            >
              Refresh
              <IconRefresh size={14} />
            </button>
          </article>
          <article>
            <span className="step-number">02</span>
            <h3>Replay this snapshot</h3>
            <p>
              Use the pinned input bundle, method version, and seed. No new
              provider data.
            </p>
            <button
              className="button secondary"
              disabled={busy || !currentRun?.bundle_id}
              onClick={() =>
                onRun({ mode: "replay", parent_run_id: currentRun?.id })
              }
            >
              Replay
              <IconArrowRight size={14} />
            </button>
          </article>
          <article>
            <span className="step-number">03</span>
            <h3>Historical cutoff</h3>
            <p>
              Only observations available by your selected time can enter the
              result.
            </p>
            <label className="field-label">
              Cutoff · your local time
              <input
                type="datetime-local"
                value={asOf}
                onChange={(event) => setAsOf(event.target.value)}
              />
            </label>
            <button
              className="button secondary"
              disabled={busy || !asOf || !currentRun?.bundle_id}
              onClick={() =>
                onRun({
                  mode: "historical",
                  parent_run_id: currentRun?.id,
                  as_of: new Date(asOf).toISOString(),
                })
              }
            >
              Run as of cutoff
            </button>
          </article>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Saved runs</h2>
          <span className="subtle-label">{runs.length} snapshots</span>
        </div>
        {runs.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Mode</th>
                  <th>Created</th>
                  <th>State</th>
                  <th>Inputs</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    className={currentRun?.id === run.id ? "selected-row" : ""}
                  >
                    <td>
                      <button
                        className="text-button mono"
                        onClick={() => run.id && onLoad(run.id)}
                      >
                        {run.id?.slice(0, 8) ?? "Missing ID"}
                        <IconChevronRight size={14} />
                      </button>
                    </td>
                    <td>{label(run.mode ?? "refresh")}</td>
                    <td>{dateTime(run.created_at)}</td>
                    <td>
                      <Status value={run.status ?? "queued"} />
                    </td>
                    <td className="mono">
                      {run.snapshot_hash?.slice(0, 12) ?? "Not captured"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No saved runs yet">
            The first run starts a durable research history.
          </Empty>
        )}
      </section>
    </>
  );
}

export function EvaluationPanel({
  evaluation,
  error,
  onRetry,
}: {
  evaluation?: EvaluationReport | null;
  error?: string | null;
  onRetry: () => void;
}) {
  if (!evaluation)
    return (
      <section className="panel">
        <Empty
          title={
            error
              ? "Evaluation report unavailable"
              : "Loading evaluation report"
          }
        >
          {error ??
            "Calibration and predictive validation are reported separately."}
        </Empty>
        <button className="button secondary" onClick={onRetry}>
          Retry evaluation
        </button>
      </section>
    );
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">METHOD VALIDATION</span>
            <h2>Inspectable claims. Measured limits.</h2>
          </div>
          <span className="mono subtle-label">{evaluation.method_version}</span>
        </div>
        <div className="evaluation-grid">
          {[
            ["Probability calibration", evaluation.calibration],
            ["Asset prediction", evaluation.asset_prediction],
            ["Scenario engine", evaluation.simulation],
          ].map(([title, data]) => (
            <article className="evaluation-card" key={String(title)}>
              <h3>{String(title)}</h3>
              <dl className="detail-list">
                {Object.entries(record(data)).map(([key, value]) => (
                  <div key={key}>
                    <dt>{label(key)}</dt>
                    <dd>
                      {typeof value === "string"
                        ? label(value)
                        : typeof value === "number"
                          ? decimal(value, 4)
                          : typeof value === "boolean"
                            ? value
                              ? "Yes"
                              : "No"
                            : JSON.stringify(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      </section>
      <section className="limitations">
        <h3>Evidence is not a performance guarantee</h3>
        <ul>
          {evaluation.limitations?.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
