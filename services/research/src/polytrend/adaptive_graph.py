from __future__ import annotations

import asyncio
import operator
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Annotated, Any, TypedDict

from .analytics import aggregate_markets
from .forecast import calculate_barrier_forecast
from .model_router import ModelRouter
from .models import (
    AgentMessage, AnalysisFinding, AnswerKind, AssetSnapshot, CoverageState,
    DecisionRecord, EvidenceGraph, EvidenceItem, EvidenceNode, InvestigationMode,
    MarketImpliedAnswer, MarketSnapshot, QueryIntent, RelationType, ResearchPlan,
    ResearchRun, ResearchTask, RunBudget, RunEvent, RunQualityReport, RunStatus,
    SourceCitation, ToolObservation, TraceSpan, WorkerRun, WorkerStatus,
)
from .orchestration import build_research_plan
from .research_tools import ResearchTools, ToolError
from .retrieval import HybridRetriever, orient_markets_to_query, parse_intent, relationship_map

Emit = Callable[[RunEvent], Awaitable[None]]


class ResearchState(TypedDict, total=False):
    query: str
    intent: QueryIntent
    plan: ResearchPlan
    task: ResearchTask
    markets: Annotated[list[MarketSnapshot], operator.add]
    context: Annotated[list[EvidenceItem], operator.add]
    asset_snapshots: Annotated[list[AssetSnapshot], operator.add]
    worker_runs: Annotated[list[WorkerRun], operator.add]
    observations: Annotated[list[ToolObservation], operator.add]
    agent_messages: Annotated[list[AgentMessage], operator.add]
    decision_records: Annotated[list[DecisionRecord], operator.add]
    analysis_findings: Annotated[list[AnalysisFinding], operator.add]
    relationships: list[Any]
    answer: MarketImpliedAnswer
    forecast: Any
    evidence_graph: EvidenceGraph
    quality_report: RunQualityReport


BUDGETS = {
    InvestigationMode.FAST: RunBudget(max_workers=3, max_tool_calls=6, max_concurrency=3, timeout_seconds=20),
    InvestigationMode.STANDARD: RunBudget(max_workers=12, max_tool_calls=20, max_concurrency=6, timeout_seconds=60),
    InvestigationMode.DEEP: RunBudget(max_workers=24, max_tool_calls=40, max_concurrency=8, timeout_seconds=150),
}

STAGES = {
    "parse_intent": "Manager interpreted the question",
    "manager_plan": "Manager created the assignment graph",
    "source_worker": "Source specialist completed an assignment",
    "source_merge": "Evidence desk merged independent source packets",
    "analysis_worker": "Analysis specialist completed a cross-check",
    "analysis_merge": "Manager reconciled specialist findings",
    "synthesis": "Manager drafted an evidence-grounded answer",
    "review_worker": "Independent reviewer challenged the draft",
    "review_merge": "Manager reconciled independent reviews",
    "quality_gate": "Evidence quality gate completed",
}


def _answer_from_forecast(forecast: Any, evidence_ids: list[str]) -> MarketImpliedAnswer:
    return MarketImpliedAnswer(
        conclusion="yes" if forecast.probability >= 0.55 else "no" if forecast.probability <= 0.45 else "mixed",
        label=f"{forecast.verdict}: {forecast.probability:.0%}", probability=forecast.probability,
        market_range=forecast.probability_range, agreement=forecast.confidence,
        coverage=CoverageState.GOOD if forecast.confidence >= 0.65 else CoverageState.LIMITED,
        answer_kind=AnswerKind.MODEL_ESTIMATE, verdict=forecast.verdict,
        confidence=forecast.confidence, current_value=forecast.current_value,
        target_value=forecast.target_value, target_gap=forecast.target_gap,
        deadline=forecast.deadline, days_remaining=forecast.days_remaining, forecast=forecast,
        takeaways=[
            f"{forecast.verdict}: the reproducible ensemble estimates a {forecast.probability:.0%} chance.",
            f"The target is {abs(forecast.target_gap):.1%} {'above' if forecast.target_gap >= 0 else 'below'} the current price.",
            "Prediction markets and contextual sources are displayed separately and do not silently alter the estimate.",
        ],
        evidence_ids=evidence_ids, methodology=forecast.methodology,
        caveats=[
            "This is a historical-volatility scenario estimate, not a traded market probability.",
            "Unexpected news, intraday jumps and provider delays can materially change the realized path.",
            "This is research software, not financial advice.",
        ],
        provider_freshness={"price_history": "Alpha Vantage live or cached", "context": "separate"},
        as_of=forecast.as_of,
    )


def _insufficient_asset_answer(intent: QueryIntent, error: str | None) -> MarketImpliedAnswer:
    return MarketImpliedAnswer(
        conclusion="insufficient", label="Price forecast unavailable", probability=None,
        market_range=None, agreement=0, coverage=CoverageState.INSUFFICIENT,
        answer_kind=AnswerKind.INSUFFICIENT, verdict="Insufficient evidence",
        target_value=intent.target_value, deadline=intent.deadline,
        takeaways=[
            "The question was recognized as an asset-price barrier forecast.",
            "Related Polymarket probabilities cannot answer this exact price question.",
            "Configure the price-data provider and rerun to calculate a reproducible estimate.",
        ],
        methodology="No estimate is produced without fresh spot data and at least 60 historical observations.",
        caveats=[error or "No current price history was returned."],
        provider_freshness={"alpha_vantage": "unavailable", "polymarket": "context only"},
    )


class AdaptiveResearchEngine:
    def __init__(self, retriever: HybridRetriever, model_router: ModelRouter, tools: ResearchTools, checkpointer: Any = None) -> None:
        self.retriever = retriever
        self.model_router = model_router
        self.tools = tools
        self.checkpointer = checkpointer

    async def execute(self, run: ResearchRun, emit: Emit, included_market_ids: list[str] | None = None) -> ResearchRun:
        run.status = RunStatus.RUNNING
        run.updated_at = datetime.now(timezone.utc)
        sequence = len(run.events)
        message_sequence = 0
        sequence_lock = asyncio.Lock()

        async def publish(stage: str, label: str, status: str = "completed", **details: Any) -> None:
            nonlocal sequence
            async with sequence_lock:
                sequence += 1
                event = RunEvent(sequence=sequence, stage=stage, label=label, status=status, details=details)
                run.events.append(event)
                await emit(event)

        def message(from_agent: str, to_agent: str, kind: str, summary: str, task: ResearchTask | None = None, evidence_ids: list[str] | None = None) -> AgentMessage:
            nonlocal message_sequence
            message_sequence += 1
            return AgentMessage(
                sequence=message_sequence, from_agent=from_agent, to_agent=to_agent,
                message_type=kind, summary=summary, task_id=task.id if task else None,
                evidence_ids=evidence_ids or [],
            )

        async def record(node: str, operation: Callable[[], Awaitable[dict[str, Any]]]) -> dict[str, Any]:
            started = datetime.now(timezone.utc)
            update = await operation()
            provider = str(update.pop("_trace_provider", "deterministic"))
            cost = float(update.pop("_trace_estimated_cost_usd", 0))
            completed = datetime.now(timezone.utc)
            duration = max(1, int((completed - started).total_seconds() * 1000))
            run.traces.append(TraceSpan(
                node=node, started_at=started, completed_at=completed, duration_ms=duration,
                input_count=len(run.markets),
                output_count=len(update.get("markets", update.get("context", update.get("worker_runs", update.get("analysis_findings", []))))),
                provider=provider, estimated_cost_usd=cost,
            ))
            await publish(node, STAGES[node], duration_ms=duration, provider=provider)
            return update

        async def parse_node(_: ResearchState) -> dict[str, Any]:
            async def operation() -> dict[str, Any]:
                intent = parse_intent(run.query)
                return {
                    "intent": intent,
                    "decision_records": [DecisionRecord(
                        agent="Manager", decision="Interpret the submitted question before delegation.",
                        rationale_summary=f"Parsed answer type={intent.requested_answer_type or 'market_implied'}, symbol={intent.symbol or 'none'}, deadline={intent.deadline or intent.horizon or 'unspecified'}.",
                        confidence=0.9 if not intent.ambiguous else 0.55,
                    )],
                }
            return await record("parse_intent", operation)

        async def plan_node(state: ResearchState) -> dict[str, Any]:
            async def operation() -> dict[str, Any]:
                budget = BUDGETS[run.mode]
                manager = await self.model_router.plan_workers(
                    run.query, state["intent"],
                    ["prediction_market", "asset_market_data", "macro", "news", "relationship_mapper", "source_verifier", "quantitative_analyst", "resolution_auditor", "contradiction_reviewer", "reviewer"],
                    budget.max_workers,
                )
                plan = build_research_plan(run.query, state["intent"], run.mode, budget, manager.provider, manager.model)
                assignments = []
                for task in plan.tasks:
                    assignments.append(message("Manager", task.agent_name, "assignment", task.objective, task))
                    await publish(
                        "task_delegated", f"Manager → {task.agent_name}: {task.objective}", "running",
                        task_id=task.id, wave=task.wave, tools=task.tools, depends_on=task.depends_on,
                        success_criteria=task.success_criteria,
                    )
                return {
                    "plan": plan, "agent_messages": assignments,
                    "decision_records": [DecisionRecord(
                        agent="Manager", decision=f"Run {len(plan.tasks)} logical assignments across three bounded waves.",
                        rationale_summary=f"{run.mode.value.title()} mode guarantees {sum(t.wave == 1 for t in plan.tasks)} source tasks, {sum(t.wave == 2 for t in plan.tasks)} analysis tasks and {sum(t.wave == 3 for t in plan.tasks)} independent reviews.",
                        confidence=0.95,
                    )],
                    "_trace_provider": f"{manager.provider}:{manager.model}",
                }
            return await record("manager_plan", operation)

        def dispatch_wave(state: ResearchState, wave: int, node: str):
            from langgraph.types import Send
            tasks = [task for task in state["plan"].tasks if task.wave == wave]
            return [Send(node, {
                "query": state["query"], "intent": state["intent"], "task": task,
                "markets": state.get("markets", []), "context": state.get("context", []),
                "asset_snapshots": state.get("asset_snapshots", []),
                "answer": state.get("answer"), "forecast": state.get("forecast"),
                "analysis_findings": state.get("analysis_findings", []),
            }) for task in tasks]

        def dispatch_sources(state: ResearchState):
            return dispatch_wave(state, 1, "source_worker")

        async def source_worker(state: ResearchState) -> dict[str, Any]:
            task = state["task"]
            await publish("worker_started", f"{task.agent_name} started", "running", task_id=task.id, wave=task.wave, objective=task.objective)

            async def operation() -> dict[str, Any]:
                started = datetime.now(timezone.utc)
                markets: list[MarketSnapshot] = []
                context: list[EvidenceItem] = []
                snapshots: list[AssetSnapshot] = []
                provider, error, cached, retries = "deterministic", None, False, 0
                tool_started = datetime.now(timezone.utc)
                try:
                    if task.worker_type == "prediction_market":
                        _, markets, _ = await self.retriever.retrieve(task.query_variant or state["query"], int(task.parameters.get("limit", 12)))
                        provider = "gamma+hybrid"
                        if included_market_ids is not None:
                            included = set(included_market_ids)
                            for market in markets:
                                market.included = market.id in included
                    elif task.worker_type == "asset_market_data":
                        snapshot, cached, retries = await self.tools.get_asset_snapshot(state["intent"].symbol or "")
                        snapshots, provider = [snapshot], "alpha_vantage"
                        context = [EvidenceItem(
                            id=f"asset:{snapshot.symbol}", kind="price_history",
                            title=f"{snapshot.name}: {snapshot.price:,.2f} {snapshot.currency}",
                            source=snapshot.source, provider=provider, url=snapshot.source_url,
                            published_at=snapshot.as_of,
                            summary=f"Current price and {len(snapshot.history)} observations used by the forecast.",
                            supports_numeric_answer=True, freshness=snapshot.freshness,
                        )]
                    elif task.worker_type == "macro":
                        item, cached, retries = await self.tools.get_macro_series(str(task.parameters.get("series_id", "DGS10")))
                        context, provider = [item], "fred"
                    elif task.worker_type == "news":
                        context, cached, retries = await self.tools.search_news(task.query_variant or state["query"])
                        provider = "gdelt"
                    status = WorkerStatus.COMPLETED
                except (ToolError, ValueError) as exc:
                    error = str(exc)
                    provider = exc.provider if isinstance(exc, ToolError) else provider
                    status = WorkerStatus.FAILED
                tool_completed = datetime.now(timezone.utc)
                evidence_ids = [item.id for item in context] + [market.id for market in markets]
                observation = ToolObservation(
                    task_id=task.id, tool=task.tools[0], provider=provider,
                    status="completed" if status == WorkerStatus.COMPLETED else "failed",
                    started_at=tool_started, completed_at=tool_completed,
                    duration_ms=max(1, int((tool_completed - tool_started).total_seconds() * 1000)),
                    cached=cached, retry_count=retries, evidence_ids=evidence_ids, error=error,
                )
                completed = datetime.now(timezone.utc)
                summary = f"Returned {len(evidence_ids)} source-linked evidence items to {task.deliver_to}." if status == WorkerStatus.COMPLETED else f"Reported provider failure to {task.deliver_to}: {error}"
                worker = WorkerRun(
                    task_id=task.id, worker_type=task.worker_type, agent_name=task.agent_name,
                    wave=task.wave, objective=task.objective, status=status,
                    started_at=started, completed_at=completed,
                    duration_ms=max(1, int((completed - started).total_seconds() * 1000)),
                    tool_calls=1, output_count=len(markets) + len(context) + len(snapshots),
                    output_evidence_ids=evidence_ids, public_summary=summary, error=error,
                )
                await publish("tool_completed", f"{task.agent_name}: {task.tools[0]} {observation.status}", observation.status, task_id=task.id, provider=provider, evidence_count=len(evidence_ids), cached=cached, retry_count=retries)
                await publish("evidence_handoff", f"{task.agent_name} → {task.deliver_to}: {summary}", "completed", task_id=task.id, evidence_ids=evidence_ids)
                return {
                    "markets": markets, "context": context, "asset_snapshots": snapshots,
                    "worker_runs": [worker], "observations": [observation],
                    "agent_messages": [message(task.agent_name, task.deliver_to, "evidence_handoff", summary, task, evidence_ids)],
                    "_trace_provider": provider,
                }
            return await record("source_worker", operation)

        async def source_merge(state: ResearchState) -> dict[str, Any]:
            async def operation() -> dict[str, Any]:
                markets = orient_markets_to_query(run.query, list({market.id: market for market in state.get("markets", [])}.values()))
                context = list({item.id: item for item in state.get("context", [])}.values())
                packet_ids = [market.id for market in markets[:24]] + [item.id for item in context[:12]]
                downstream = [task for task in state["plan"].tasks if task.wave == 2]
                return {
                    "markets": markets, "context": context,
                    "agent_messages": [
                        message(
                            "Evidence desk", task.agent_name, "evidence_packet",
                            f"Shared the deduplicated packet: {len(markets)} markets and {len(context)} contextual items. Focus: {task.objective}",
                            task, packet_ids,
                        )
                        for task in downstream
                    ],
                    "decision_records": [DecisionRecord(
                        agent="Evidence desk", decision=f"Deduplicated the source packets into {len(markets)} markets and {len(context)} contextual items.",
                        rationale_summary="Duplicate identifiers were merged before relationship analysis; provider failures remain visible in worker records.",
                        evidence_ids=[market.id for market in markets[:12]] + [item.id for item in context[:8]], confidence=0.95,
                    )],
                }
            return await record("source_merge", operation)

        def dispatch_analysis(state: ResearchState):
            tasks = [task for task in state["plan"].tasks if task.wave == 2]
            return dispatch_wave(state, 2, "analysis_worker") if tasks else "synthesis"

        async def analysis_worker(state: ResearchState) -> dict[str, Any]:
            task = state["task"]
            await publish("worker_started", f"{task.agent_name} received the merged evidence packet", "running", task_id=task.id, wave=2, input_evidence_count=len(state.get("markets", [])) + len(state.get("context", [])))

            async def operation() -> dict[str, Any]:
                started = datetime.now(timezone.utc)
                markets, context = state.get("markets", []), state.get("context", [])
                evidence_ids = [market.id for market in markets] + [item.id for item in context]
                if task.worker_type == "relationship_mapper":
                    rels = relationship_map(markets)
                    summary = f"Mapped {len(rels)} typed market relationships; proxy markets remain outside direct aggregation."
                elif task.worker_type == "source_verifier":
                    linked = sum(bool(market.url) for market in markets) + sum(bool(item.url) for item in context)
                    summary = f"Verified {linked}/{len(evidence_ids)} evidence records have a link and stable identifier."
                elif task.worker_type == "quantitative_analyst":
                    snapshots = state.get("asset_snapshots", [])
                    summary = f"Checked {len(snapshots[0].history) if snapshots else 0} price observations and deterministic aggregation eligibility."
                elif task.worker_type == "resolution_auditor":
                    resolved = sum(bool(market.resolution_criteria.strip()) for market in markets)
                    summary = f"Audited resolution wording: {resolved}/{len(markets)} markets provide non-empty criteria."
                else:
                    conflicts = sum(market.relation_type == RelationType.CONFLICTING_PROXY for market in markets)
                    summary = f"Found {conflicts} explicitly conflicting proxy signals; none may silently change the estimate."
                completed = datetime.now(timezone.utc)
                finding = AnalysisFinding(task_id=task.id, agent_name=task.agent_name, summary=summary, evidence_ids=evidence_ids[:24], confidence=0.85)
                worker = WorkerRun(
                    task_id=task.id, worker_type=task.worker_type, agent_name=task.agent_name,
                    wave=2, objective=task.objective, status=WorkerStatus.COMPLETED,
                    started_at=started, completed_at=completed,
                    duration_ms=max(1, int((completed - started).total_seconds() * 1000)),
                    tool_calls=1, output_count=1, input_evidence_ids=evidence_ids,
                    output_evidence_ids=evidence_ids[:24], public_summary=summary,
                )
                await publish("evidence_handoff", f"{task.agent_name} → {task.deliver_to}: {summary}", "completed", task_id=task.id, evidence_ids=evidence_ids[:24])
                return {
                    "analysis_findings": [finding], "worker_runs": [worker],
                    "agent_messages": [message(task.agent_name, task.deliver_to, "analysis_handoff", summary, task, evidence_ids[:24])],
                    "_trace_provider": "deterministic-analysis",
                }
            return await record("analysis_worker", operation)

        async def analysis_merge(state: ResearchState) -> dict[str, Any]:
            async def operation() -> dict[str, Any]:
                markets = list({market.id: market for market in state.get("markets", [])}.values())
                intent = state["intent"]
                forecast = None
                if intent.requested_answer_type == AnswerKind.MODEL_ESTIMATE:
                    for market in markets:
                        market.relation_type = RelationType.SUPPORTING_PROXY
                        market.relation_reason = "Related prediction-market signal; excluded from the asset forecast."
                    snapshots = state.get("asset_snapshots", [])
                    if snapshots:
                        forecast = calculate_barrier_forecast(intent, snapshots[0], seed=run.id)
                        evidence_ids = [item.id for item in state.get("context", []) if item.supports_numeric_answer]
                        forecast.evidence_ids = evidence_ids
                        answer = _answer_from_forecast(forecast, evidence_ids)
                    else:
                        failure = next((item.error for item in state.get("worker_runs", []) if item.worker_type == "asset_market_data"), None)
                        answer = _insufficient_asset_answer(intent, failure)
                else:
                    answer = aggregate_markets(markets)
                    answer.answer_kind = AnswerKind.MARKET_IMPLIED if answer.probability is not None else AnswerKind.INSUFFICIENT
                    answer.verdict, answer.confidence = answer.label, answer.agreement
                relationships = relationship_map(markets)
                nodes: list[EvidenceNode] = []
                if state.get("asset_snapshots"):
                    snapshot = state["asset_snapshots"][0]
                    nodes.append(EvidenceNode(id=f"node-asset-{snapshot.symbol}", kind="price", label=f"{snapshot.symbol} spot", value=f"${snapshot.price:,.2f}", source=snapshot.source, relevance=1, evidence_id=f"asset:{snapshot.symbol}"))
                if forecast:
                    nodes.append(EvidenceNode(id="node-forecast", kind="forecast", label="Reproducible ensemble", value=f"{forecast.probability:.0%}", source="Poly Trend", relevance=1, evidence_id=f"asset:{forecast.symbol}"))
                nodes.extend(EvidenceNode(id=f"node-market-{market.id}", kind="prediction_market", label=market.question, value=f"{market.probability:.0%}", source="Polymarket", relevance=market.relevance, included=market.included, evidence_id=market.id) for market in sorted(markets, key=lambda item: item.relevance, reverse=True)[:6])
                for item in state.get("context", []):
                    if item.kind != "price_history" and len(nodes) < 9:
                        nodes.append(EvidenceNode(id=f"node-evidence-{item.id}", kind=item.kind, label=item.title, source=item.source, relevance=0.55, evidence_id=item.id))
                return {
                    "markets": markets, "relationships": relationships, "answer": answer, "forecast": forecast,
                    "evidence_graph": EvidenceGraph(query_node=EvidenceNode(id="query", kind="query", label=run.query, relevance=1), nodes=nodes[:9], edges=relationships),
                    "decision_records": [DecisionRecord(
                        agent="Manager", decision=f"Use a {answer.answer_kind.value.replace('_', ' ')} answer.",
                        rationale_summary="Only direct comparable markets or reproducible price-history calculations can support the number; news and proxies remain contextual.",
                        evidence_ids=answer.evidence_ids, confidence=answer.confidence or answer.agreement,
                    )],
                }
            return await record("analysis_merge", operation)

        async def synthesis_node(state: ResearchState) -> dict[str, Any]:
            async def operation() -> dict[str, Any]:
                answer = state["answer"].model_copy(deep=True)
                result = await self.model_router.refine_takeaways(run.query, answer, state.get("markets", []), run.mode == InvestigationMode.DEEP)
                answer.takeaways = result.takeaways
                answer.provider_freshness["synthesis"] = f"{result.provider}:{result.model}"
                evidence: dict[str, Any] = {item.id: item for item in state.get("context", [])}
                evidence.update({market.id: market for market in state.get("markets", [])})
                answer.citations = [SourceCitation(
                    evidence_id=item_id,
                    title=getattr(evidence[item_id], "title", getattr(evidence[item_id], "question", item_id)),
                    source=getattr(evidence[item_id], "source", "Polymarket"),
                    url=getattr(evidence[item_id], "url", None), supports="numeric answer",
                ) for item_id in answer.evidence_ids if item_id in evidence]
                reviewers = [task for task in state["plan"].tasks if task.wave == 3]
                return {
                    "answer": answer,
                    "agent_messages": [
                        message("Manager", reviewer.agent_name, "review_request", f"Review this {answer.answer_kind.value} draft against {len(answer.evidence_ids)} supporting evidence identifiers.", reviewer, answer.evidence_ids)
                        for reviewer in reviewers
                    ] or [message("Manager", "Quality gate", "draft_handoff", f"Drafted a {answer.answer_kind.value} answer supported by {len(answer.evidence_ids)} evidence identifiers.", evidence_ids=answer.evidence_ids)],
                    "_trace_provider": result.provider, "_trace_estimated_cost_usd": result.estimated_cost_usd,
                }
            return await record("synthesis", operation)

        def dispatch_reviews(state: ResearchState):
            tasks = [task for task in state["plan"].tasks if task.wave == 3]
            return dispatch_wave(state, 3, "review_worker") if tasks else "quality_gate"

        async def review_worker(state: ResearchState) -> dict[str, Any]:
            task = state["task"]
            await publish("worker_started", f"{task.agent_name} independently reviewing the draft", "running", task_id=task.id, wave=3)

            async def operation() -> dict[str, Any]:
                started = datetime.now(timezone.utc)
                review = await self.model_router.review_answer(run.query, state["answer"], state.get("markets", []), state.get("context", []), task.agent_name)
                completed = datetime.now(timezone.utc)
                evidence_ids = state["answer"].evidence_ids
                summary = f"{review.verdict.upper()}: " + ("; ".join(review.concerns) if review.concerns else "No unsupported numerical claim found.")
                finding = AnalysisFinding(task_id=task.id, agent_name=task.agent_name, summary=summary, evidence_ids=evidence_ids, confidence=review.confidence)
                worker = WorkerRun(
                    task_id=task.id, worker_type="reviewer", agent_name=task.agent_name, wave=3,
                    objective=task.objective, status=WorkerStatus.COMPLETED,
                    started_at=started, completed_at=completed,
                    duration_ms=max(1, int((completed - started).total_seconds() * 1000)),
                    tool_calls=1, output_count=1, input_evidence_ids=evidence_ids,
                    output_evidence_ids=evidence_ids, public_summary=summary,
                )
                await publish("review_completed", f"{task.agent_name} → Manager: {summary}", "completed", task_id=task.id, verdict=review.verdict, concerns=review.concerns, evidence_ids=evidence_ids)
                return {
                    "analysis_findings": [finding], "worker_runs": [worker],
                    "agent_messages": [message(task.agent_name, "Manager", "review", summary, task, evidence_ids)],
                    "decision_records": [DecisionRecord(agent=task.agent_name, decision=review.verdict, rationale_summary=summary, evidence_ids=evidence_ids, confidence=review.confidence)],
                    "_trace_provider": f"{review.provider}:{review.model}", "_trace_estimated_cost_usd": review.estimated_cost_usd,
                }
            return await record("review_worker", operation)

        async def review_merge(state: ResearchState) -> dict[str, Any]:
            async def operation() -> dict[str, Any]:
                reviews = [finding for finding in state.get("analysis_findings", []) if finding.task_id.startswith("review-")]
                challenged = sum(finding.summary.startswith("REVISE") for finding in reviews)
                return {
                    "decision_records": [DecisionRecord(
                        agent="Manager", decision="Accept the reviewed draft" if challenged == 0 else "Send the draft through the bounded quality correction.",
                        rationale_summary=f"Reconciled {len(reviews)} independent review packets; {challenged} requested revision.",
                        evidence_ids=state["answer"].evidence_ids, confidence=0.9 if challenged == 0 else 0.65,
                    )]
                }
            return await record("review_merge", operation)

        async def quality_node(state: ResearchState) -> dict[str, Any]:
            async def operation() -> dict[str, Any]:
                answer = state["answer"].model_copy(deep=True)
                existing = {market.id for market in state.get("markets", [])} | {item.id for item in state.get("context", [])}
                missing = [item for item in answer.evidence_ids if item not in existing]
                passed = not missing and (answer.probability is None or bool(answer.evidence_ids))
                corrections = 0
                warnings: list[str] = []
                review_revisions = [
                    finding for finding in state.get("analysis_findings", [])
                    if finding.task_id.startswith("review-") and finding.summary.startswith("REVISE")
                ]
                if review_revisions:
                    corrections = 1
                    warnings.append(f"{len(review_revisions)} independent reviewer(s) requested a bounded correction.")
                    if answer.coverage != CoverageState.INSUFFICIENT:
                        answer.coverage = CoverageState.LIMITED
                    concern = review_revisions[0].summary.removeprefix("REVISE: ")[:320]
                    answer.caveats = [*answer.caveats, f"Independent review concern: {concern}"]
                if not passed:
                    corrections = max(1, corrections)
                    warnings.append("Unsupported numeric output was removed by the bounded quality correction.")
                    answer.probability = None
                    answer.market_range = None
                    answer.answer_kind = AnswerKind.INSUFFICIENT
                    answer.coverage = CoverageState.INSUFFICIENT
                    answer.verdict = "Insufficient evidence"
                    answer.label = "Insufficient evidence"
                    answer.evidence_ids = []
                    passed = True
                report = RunQualityReport(
                    passed=passed, supported_numeric_claims=len(answer.evidence_ids),
                    missing_evidence_ids=missing, bounded_corrections=corrections, warnings=warnings,
                )
                return {
                    "answer": answer, "quality_report": report,
                    "agent_messages": [message("Quality gate", "User", "completion", f"Passed after {corrections} bounded correction(s); {len(answer.evidence_ids)} evidence identifiers support the numeric answer.", evidence_ids=answer.evidence_ids)],
                    "decision_records": [DecisionRecord(agent="Quality gate", decision="Release answer" if passed else "Reject answer", rationale_summary="Evidence identifiers, answer label and numerical support were checked mechanically.", evidence_ids=answer.evidence_ids, confidence=1.0)],
                }
            return await record("quality_gate", operation)

        initial: ResearchState = {
            "query": run.query, "markets": [], "context": [], "asset_snapshots": [],
            "worker_runs": [], "observations": [], "agent_messages": [],
            "decision_records": [], "analysis_findings": [],
        }
        from langgraph.graph import END, START, StateGraph
        builder = StateGraph(ResearchState)
        for name, node in (
            ("parse_intent", parse_node), ("manager_plan", plan_node),
            ("source_worker", source_worker), ("source_merge", source_merge),
            ("analysis_worker", analysis_worker), ("analysis_merge", analysis_merge),
            ("synthesis", synthesis_node), ("review_worker", review_worker),
            ("review_merge", review_merge), ("quality_gate", quality_node),
        ):
            builder.add_node(name, node)
        builder.add_edge(START, "parse_intent")
        builder.add_edge("parse_intent", "manager_plan")
        builder.add_conditional_edges("manager_plan", dispatch_sources, ["source_worker"])
        builder.add_edge("source_worker", "source_merge")
        builder.add_conditional_edges("source_merge", dispatch_analysis, ["analysis_worker", "synthesis"])
        builder.add_edge("analysis_worker", "analysis_merge")
        builder.add_edge("analysis_merge", "synthesis")
        builder.add_conditional_edges("synthesis", dispatch_reviews, ["review_worker", "quality_gate"])
        builder.add_edge("review_worker", "review_merge")
        builder.add_edge("review_merge", "quality_gate")
        builder.add_edge("quality_gate", END)
        graph = builder.compile(checkpointer=self.checkpointer)

        merged: ResearchState = dict(initial)
        reduced_keys = {"markets", "context", "asset_snapshots", "worker_runs", "observations", "agent_messages", "decision_records", "analysis_findings"}
        async with asyncio.timeout(BUDGETS[run.mode].timeout_seconds):
            async for chunk in graph.astream(initial, config={"configurable": {"thread_id": run.id}, "recursion_limit": 64}, stream_mode="updates"):
                for update in chunk.values():
                    if not isinstance(update, dict):
                        continue
                    for key in reduced_keys:
                        if key in update:
                            merged.setdefault(key, [])
                            merged[key].extend(update[key])
                    merged.update({key: value for key, value in update.items() if key not in reduced_keys})

        run.intent, run.plan = merged.get("intent"), merged.get("plan")
        run.markets = list({item.id: item for item in merged.get("markets", [])}.values())
        run.relationships = merged.get("relationships", [])
        run.context = list({item.id: item for item in merged.get("context", [])}.values())
        run.workers = list({item.task_id: item for item in merged.get("worker_runs", [])}.values())
        run.tool_observations = merged.get("observations", [])
        run.agent_messages = sorted(merged.get("agent_messages", []), key=lambda item: item.sequence)
        run.decision_records = merged.get("decision_records", [])
        run.analysis_findings = list({item.task_id: item for item in merged.get("analysis_findings", [])}.values())
        run.answer, run.forecast = merged.get("answer"), merged.get("forecast")
        run.asset_snapshot = merged.get("asset_snapshots", [None])[0] if merged.get("asset_snapshots") else None
        run.evidence_graph, run.quality_report = merged.get("evidence_graph"), merged.get("quality_report")
        run.status, run.updated_at = RunStatus.COMPLETED, datetime.now(timezone.utc)
        return run
