"use client";

import {
  IconArrowDownRight,
  IconArrowUpRight,
  IconExternalLink,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import {
  currency,
  dateTime,
  label,
  numeric,
  observedChange,
  probability,
  safeSourceUrl,
  shortDate,
  signedPercent,
} from "@/lib/format";
import type {
  AssetSeries,
  EvidenceBundle,
  MarketSnapshot,
  Observation,
} from "@/lib/types";

export function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value.replaceAll("_", "-")}`}>
      {label(value)}
    </span>
  );
}

export function SourceLink({
  href,
  children,
}: {
  href?: string | null;
  children: React.ReactNode;
}) {
  const safeHref = safeSourceUrl(href);
  if (!safeHref) return <span className="muted">Source unavailable</span>;
  return (
    <a className="source-link" href={safeHref} target="_blank" rel="noreferrer">
      {children}
      <IconExternalLink size={13} aria-hidden="true" />
    </a>
  );
}

export function Delta({
  value,
  suffix = "pp",
}: {
  value: number | null;
  suffix?: string;
}) {
  return (
    <span
      className={`delta ${value == null ? "" : value >= 0 ? "up" : "down"}`}
    >
      {value != null &&
        (value >= 0 ? (
          <IconArrowUpRight size={14} />
        ) : (
          <IconArrowDownRight size={14} />
        ))}
      {value == null
        ? "—"
        : `${value > 0 ? "+" : ""}${value.toFixed(1)} ${suffix}`}
    </span>
  );
}

export function WindowChange({
  item,
  days,
}: {
  item: Record<string, unknown>;
  days: 1 | 7 | 30;
}) {
  const delta = numeric(item[`delta_${days}d_pp`]);
  const hours = numeric(item[`window_${days}d_elapsed_hours`]);
  const compared = item[`comparison_${days}d_at`];
  const comparison =
    typeof compared === "string"
      ? dateTime(compared)
      : "Comparison time not supplied";
  return (
    <span
      className="window-change"
      title={`${comparison}${hours == null ? "" : ` · ${hours.toFixed(1)} hours elapsed`}`}
    >
      <Delta value={delta} />
      {hours != null && (
        <small>
          {hours < 48 ? `${hours.toFixed(0)}h` : `${(hours / 24).toFixed(1)}d`}{" "}
          elapsed
        </small>
      )}
    </span>
  );
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-cross" aria-hidden="true">
        +
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function EvidenceDrawer({
  observation,
  onClose,
}: {
  observation: Observation | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (observation) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [observation]);
  return (
    <dialog
      ref={dialogRef}
      className="evidence-drawer"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-labelledby="source-drawer-title"
    >
      {observation && (
        <>
          <div className="drawer-heading">
            <div>
              <span className="eyebrow">SOURCE RECORD</span>
              <h2 id="source-drawer-title">{label(observation.kind)}</h2>
            </div>
            <button
              className="icon-button"
              onClick={onClose}
              aria-label="Close source record"
            >
              <IconX size={20} />
            </button>
          </div>
          <div className="inline-tags">
            <Status value={observation.origin ?? "live"} />
            <span className="mono">{observation.provider}</span>
          </div>
          <p className="drawer-intro">
            The stored source payload behind this research. Observation time,
            availability, and retrieval time are kept separately.
          </p>
          <dl className="detail-list">
            <div>
              <dt>Observed</dt>
              <dd>{dateTime(observation.observed_at)}</dd>
            </div>
            <div>
              <dt>Available</dt>
              <dd>{dateTime(observation.available_at)}</dd>
            </div>
            <div>
              <dt>Retrieved</dt>
              <dd>{dateTime(observation.retrieved_at)}</dd>
            </div>
            <div>
              <dt>Published</dt>
              <dd>{dateTime(observation.published_at)}</dd>
            </div>
            <div>
              <dt>External ID</dt>
              <dd className="mono wrap">{observation.external_id}</dd>
            </div>
          </dl>
          {observation.historical_reconstruction && (
            <div className="notice warning">
              Retrospective reconstruction. This record does not establish what
              a live system knew at that historical time.
            </div>
          )}
          <SourceLink href={observation.source_url}>
            Open original source
          </SourceLink>
          <h3 className="section-subhead">Integrity hash</h3>
          <code className="hash">{observation.content_hash}</code>
          <h3 className="section-subhead">Raw observation</h3>
          <pre className="raw-payload">
            {JSON.stringify(observation.payload, null, 2)}
          </pre>
        </>
      )}
    </dialog>
  );
}

function trace(
  points: { timestamp: string; value: number }[],
  x: (timestamp: string) => number,
  y: (value: number) => number,
) {
  return points
    .map(
      (point) =>
        `${x(point.timestamp).toFixed(1)},${y(point.value).toFixed(1)}`,
    )
    .join(" ");
}

export function Timeline({
  bundle,
  market,
  asset,
  onSelectAsset,
}: {
  bundle: EvidenceBundle;
  market?: MarketSnapshot;
  asset?: AssetSeries;
  onSelectAsset: (symbol: string) => void;
}) {
  const [period, setPeriod] = useState<"1M" | "3M" | "All">("All");
  const marketPoints = market?.history ?? [];
  const assetPoints = asset?.points ?? [];
  const allTimestamps = [...marketPoints, ...assetPoints]
    .map((point) => new Date(point.timestamp).getTime())
    .filter(Number.isFinite);
  const end = allTimestamps.length ? Math.max(...allTimestamps) : 0;
  const beginning = allTimestamps.length ? Math.min(...allTimestamps) : 0;
  const cutoff =
    period === "All"
      ? beginning
      : Math.max(beginning, end - (period === "1M" ? 31 : 93) * 86400000);
  const filteredMarkets = marketPoints.filter(
    (point) => new Date(point.timestamp).getTime() >= cutoff,
  );
  const filteredAssets = assetPoints.filter(
    (point) => new Date(point.timestamp).getTime() >= cutoff,
  );
  const x = (timestamp: string) =>
    52 +
    ((new Date(timestamp).getTime() - cutoff) / Math.max(end - cutoff, 1)) *
      808;
  const first = filteredAssets[0]?.value;
  const isYield = asset?.adjustment === "yield" || asset?.unit === "percent";
  const assetChanges = filteredAssets.flatMap((point) => {
    const change = observedChange(first, point.value, isYield);
    return change == null
      ? []
      : [{ ...point, value: isYield ? change : change * 100 }];
  });
  const maxChange =
    Math.max(1, ...assetChanges.map((point) => Math.abs(point.value))) * 1.2;
  const lastMarket = filteredMarkets.at(-1);
  const lastAsset = filteredAssets.at(-1);
  const lastChange = observedChange(first, lastAsset?.value, isYield);
  const lastChangeLabel = isYield
    ? lastChange == null
      ? "—"
      : `${lastChange > 0 ? "+" : ""}${lastChange.toFixed(1)} bp`
    : signedPercent(lastChange);
  return (
    <section className="panel timeline-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">EXPECTATIONS & RESPONSE</span>
          <h2>One event. Two different signals.</h2>
        </div>
        <div className="segmented small" aria-label="Timeline range">
          {(["1M", "3M", "All"] as const).map((item) => (
            <button
              key={item}
              aria-pressed={period === item}
              onClick={() => setPeriod(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="timeline-legend">
        <span>
          <i className="line-key teal" />
          Event probability{" "}
          <strong>
            {probability(lastMarket?.value ?? market?.probability, 1)}
          </strong>
        </span>
        <label>
          <i className="line-key ink" />
          <select
            aria-label="Asset shown in timeline"
            value={asset?.symbol ?? ""}
            onChange={(event) => onSelectAsset(event.target.value)}
          >
            {(bundle.assets ?? []).map((item) => (
              <option key={item.symbol}>{item.symbol}</option>
            ))}
          </select>
          <strong>{lastChangeLabel}</strong>
        </label>
      </div>
      {filteredMarkets.length || filteredAssets.length ? (
        <div className="timeline-chart">
          <svg
            viewBox="0 0 900 340"
            role="img"
            aria-label={`Event probability and ${asset?.symbol ?? "asset"} performance, in separate panels. ${filteredMarkets.length} market observations and ${filteredAssets.length} asset observations.`}
          >
            <title>Event odds and observed asset response</title>
            <desc>
              Shared time axis. Upper chart: probability from zero to one
              hundred percent. Lower chart: price change in percent or yield
              change in basis points from the first visible observation.
              Alignment shows chronology and does not prove causation.
            </desc>
            {[0, 25, 50, 75, 100].map((value) => (
              <g key={value}>
                <line
                  x1="52"
                  x2="860"
                  y1={145 - value * 1.05}
                  y2={145 - value * 1.05}
                  stroke="#e6e9e8"
                  strokeDasharray="3 5"
                />
                <text
                  x="38"
                  y={149 - value * 1.05}
                  textAnchor="end"
                  className="chart-tick"
                >
                  {value}%
                </text>
              </g>
            ))}
            <text x="52" y="20" className="chart-label">
              EVENT PROBABILITY
            </text>
            {filteredMarkets.length > 1 && (
              <polyline
                points={trace(filteredMarkets, x, (value) => 145 - value * 105)}
                fill="none"
                stroke="#087e79"
                strokeWidth="2.6"
                strokeLinejoin="round"
              />
            )}
            {lastMarket && (
              <circle
                cx={x(lastMarket.timestamp)}
                cy={145 - lastMarket.value * 105}
                r="4"
                fill="#087e79"
                stroke="#fff"
                strokeWidth="2"
              />
            )}
            {!filteredMarkets.length && (
              <text x="450" y="100" textAnchor="middle" className="chart-empty">
                No probability history returned by the provider
              </text>
            )}
            <line x1="52" x2="860" y1="192" y2="192" stroke="#d9deda" />
            <text x="52" y="218" className="chart-label">
              {asset?.symbol ?? "ASSET"} ·{" "}
              {isYield
                ? "YIELD CHANGE · BASIS POINTS"
                : "PRICE CHANGE · PERCENT"}
            </text>
            {[-1, 0, 1].map((position) => (
              <g key={position}>
                <line
                  x1="52"
                  x2="860"
                  y1={267 - position * 36}
                  y2={267 - position * 36}
                  stroke="#e6e9e8"
                  strokeDasharray="3 5"
                />
                <text
                  x="38"
                  y={271 - position * 36}
                  textAnchor="end"
                  className="chart-tick"
                >
                  {(position * maxChange).toFixed(1)}
                  {isYield ? "bp" : "%"}
                </text>
              </g>
            ))}
            {assetChanges.length > 1 && (
              <polyline
                points={trace(
                  assetChanges,
                  x,
                  (value) => 267 - (value / maxChange) * 36,
                )}
                fill="none"
                stroke="#313e49"
                strokeWidth="2.1"
                strokeLinejoin="round"
              />
            )}
            {!assetChanges.length && (
              <text x="450" y="272" textAnchor="middle" className="chart-empty">
                No asset history available · add an imported series
              </text>
            )}
            {[cutoff, cutoff + (end - cutoff) / 2, end].map((time, index) => (
              <text
                key={index}
                x={52 + index * 404}
                y="331"
                textAnchor={
                  index === 0 ? "start" : index === 2 ? "end" : "middle"
                }
                className="chart-tick"
              >
                {end ? shortDate(new Date(time).toISOString()) : ""}
              </text>
            ))}
          </svg>
        </div>
      ) : (
        <Empty title="History is unavailable">
          The current quote is preserved. A probability and asset history are
          required for a repricing timeline.
        </Empty>
      )}
      <div className="timeline-sources">
        <span>Market history through {dateTime(lastMarket?.timestamp)}</span>
        {asset && (
          <SourceLink href={asset.source_url}>
            {asset.provider} · {asset.symbol} ·{" "}
            {label(asset.adjustment ?? "raw")} · {asset.interval ?? "daily"}
          </SourceLink>
        )}
        <span>
          {asset
            ? `Asset through ${dateTime(lastAsset?.timestamp)}`
            : "Asset unavailable"}
        </span>
      </div>
      <div className="chart-footnote">
        <span>
          Separate scales · shared time axis ·{" "}
          {isYield
            ? "yield changes in basis points"
            : "price changes in percent"}
        </span>
        <span>Observed co-movement does not establish causality.</span>
      </div>
    </section>
  );
}

export function MarketDetails({
  bundle,
  selected,
  onSelect,
  onEvidence,
}: {
  bundle: EvidenceBundle;
  selected?: MarketSnapshot;
  onSelect: (id: string) => void;
  onEvidence: (id: string) => void;
}) {
  const contract = bundle.event.contracts?.find(
    (item) => item.id === selected?.market_id,
  );
  return (
    <section className="panel market-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">THE CONTRACT</span>
          <h2>What the market actually resolves</h2>
        </div>
        <SourceLink href={bundle.event.source_url}>Market source</SourceLink>
      </div>
      <label className="field-label">
        Outcome
        <select
          value={selected?.market_id ?? ""}
          onChange={(event) => onSelect(event.target.value)}
        >
          {(bundle.markets ?? []).map((market) => (
            <option key={market.market_id} value={market.market_id}>
              {bundle.event.contracts?.find(
                (item) => item.id === market.market_id,
              )?.question ?? market.market_id}
            </option>
          ))}
        </select>
      </label>
      {selected ? (
        <>
          <div className="quote-strip">
            <div>
              <span>Observed probability</span>
              <strong>{probability(selected.probability, 1)}</strong>
              <small>{label(selected.quote_type ?? "unavailable")}</small>
            </div>
            <div>
              <span>Bid / ask</span>
              <strong>
                {probability(selected.bid, 1)} / {probability(selected.ask, 1)}
              </strong>
              <small>Spread {probability(selected.spread, 1)}</small>
            </div>
            <div>
              <span>Book depth · bid / ask</span>
              <strong>
                {currency(selected.bid_depth_usd)} /{" "}
                {currency(selected.ask_depth_usd)}
              </strong>
              <small>USD liquidity at recorded depth</small>
            </div>
          </div>
          <p className="resolution-text">
            {contract?.resolution_rules ||
              "Resolution wording unavailable. Interpret the quote with caution."}
          </p>
          <dl className="credibility-grid">
            <div>
              <dt>24h volume</dt>
              <dd>{currency(selected.volume_24h_usd)}</dd>
            </div>
            <div>
              <dt>Open interest · priced USD</dt>
              <dd>{currency(selected.open_interest_usd)}</dd>
              <small>Gross marked open interest</small>
            </div>
            <div>
              <dt>Open interest · shares</dt>
              <dd>
                {selected.open_interest_shares == null
                  ? "Unavailable"
                  : new Intl.NumberFormat("en-US", {
                      maximumFractionDigits: 0,
                    }).format(selected.open_interest_shares)}
              </dd>
            </div>
            <div>
              <dt>Unique participants</dt>
              <dd>{selected.unique_participants ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>Top holder share</dt>
              <dd>{probability(selected.top_holder_share, 1)}</dd>
            </div>
            <div>
              <dt>Trades · bounded sample</dt>
              <dd>{selected.trade_count ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>Signed taker notional · sample</dt>
              <dd>{currency(selected.taker_net_notional_usd)}</dd>
            </div>
          </dl>
          {selected.trade_count != null && (
            <p className="panel-note">
              Trade flow describes a bounded sample. Signed taker notional and
              gross priced open interest are not capital inflow.
            </p>
          )}
          {selected.holder_coverage && (
            <p className="panel-note">
              Holder coverage: {selected.holder_coverage}
            </p>
          )}
          <div className="market-meta">
            <span>
              Deadline {shortDate(contract?.end_date ?? bundle.event.deadline)}
            </span>
            <span>As of {dateTime(selected.as_of)}</span>
          </div>
          {(selected.issues ?? []).length > 0 && (
            <div className="notice warning compact">
              {selected.issues?.join(" · ")}
            </div>
          )}
          <div className="source-buttons">
            {(selected.observation_ids ?? []).map((id, index) => (
              <button
                className="text-button"
                key={id}
                onClick={() => onEvidence(id)}
              >
                Inspect source {index + 1} ↗
              </button>
            ))}
          </div>
        </>
      ) : (
        <Empty title="No contract quote available">
          The case and supporting evidence remain accessible.
        </Empty>
      )}
    </section>
  );
}
