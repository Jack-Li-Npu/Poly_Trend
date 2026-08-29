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
    AnswerKind, AssetSnapshot, CoverageState, EvidenceGraph, EvidenceItem, EvidenceNode,
    InvestigationMode, MarketImpliedAnswer, MarketSnapshot, QueryIntent, RelationType,
    ResearchPlan, ResearchRun, ResearchTask, RunBudget, RunEvent, RunQualityReport,
    RunStatus, SourceCitation, ToolObservation, TraceSpan, WorkerRun, WorkerStatus,
)
from .research_tools import ResearchTools, ToolError
from .retrieval import HybridRetriever, parse_intent, relationship_map

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
    relationships: list[Any]
    answer: MarketImpliedAnswer
    forecast: Any
    evidence_graph: EvidenceGraph
    quality_report: RunQualityReport


BUDGETS = {
    InvestigationMode.FAST: RunBudget(max_workers=3, max_tool_calls=6, max_concurrency=3, timeout_seconds=12),
    InvestigationMode.STANDARD: RunBudget(max_workers=8, max_tool_calls=16, max_concurrency=6, timeout_seconds=30),
    InvestigationMode.DEEP: RunBudget(max_workers=24, max_tool_calls=40, max_concurrency=8, timeout_seconds=90),
}

STAGES = {
    "parse_intent": "Understanding the question",
    "manager_plan": "Manager delegated specialist research",
    "prediction_market": "Searching prediction-market evidence",
    "asset_market_data": "Retrieving live price and history",
    "macro": "Checking official macro indicators",
    "news": "Searching recent external context",
    "evidence_merge": "Merging worker evidence",
    "quantitative_forecast": "Calculating the transparent forecast",
    "synthesis": "Drafting the evidence-grounded answer",
    "skeptical_verification": "Verifying every numerical claim",
    "quality_gate": "Saving the verified investigation",
}


def _task(worker: str, objective: str, tools: list[str]) -> ResearchTask:
    return ResearchTask(id=f"task-{worker}", worker_type=worker, objective=objective, tools=tools)


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
            f"{forecast.verdict}: the transparent ensemble estimates a {forecast.probability:.0%} chance.",
            f"The target is {abs(forecast.target_gap):.1%} {'above' if forecast.target_gap >= 0 else 'below'} the current price.",
            "Prediction markets and external context do not silently alter the estimate.",
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
            "Configure the Alpha Vantage key and rerun to calculate a transparent estimate.",
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
        sequence_lock = asyncio.Lock()

        async def record(node: str, operation: Callable[[], Awaitable[dict[str, Any]]]) -> dict[str, Any]:
            nonlocal sequence
            started = datetime.now(timezone.utc)
            update = await operation()
            provider = str(update.pop("_trace_provider", "deterministic"))
            cost = float(update.pop("_trace_estimated_cost_usd", 0))
            completed = datetime.now(timezone.utc)
            duration = max(1, int((completed - started).total_seconds() * 1000))
            async with sequence_lock:
                sequence += 1
                event = RunEvent(sequence=sequence, stage=node, label=STAGES[node], duration_ms=duration, details={"provider": provider})
                run.events.append(event)
                run.traces.append(TraceSpan(
                    node=node, started_at=started, completed_at=completed, duration_ms=duration,
                    input_count=len(run.markets),
                    output_count=len(update.get("markets", update.get("context", update.get("worker_runs", [])))),
                    provider=provider, estimated_cost_usd=cost,
                ))
                await emit(event)
            return update

        async def parse_node(_: ResearchState) -> dict[str, Any]:
            return await record("parse_intent", lambda: asyncio.sleep(0, result={"intent": parse_intent(run.query)}))

        async def plan_node(state: ResearchState) -> dict[str, Any]:
            async def operation() -> dict[str, Any]:
                budget = BUDGETS[run.mode]
                available = ["prediction_market", "asset_market_data", "macro", "news"]
                manager = await self.model_router.plan_workers(run.query, state["intent"], available, budget.max_workers)
                definitions = {
                    "prediction_market": _task("prediction_market", "Find direct and related prediction markets.", ["search_prediction_markets"]),
                    "asset_market_data": _task("asset_market_data", "Retrieve fresh spot and historical prices.", ["get_spot_price", "get_price_history"]),
                    "macro": _task("macro", "Retrieve official macro context.", ["get_macro_series"]),
                    "news": _task("news", "Find recent linkable context.", ["search_news"]),
                }
                selected = [name for name in manager.workers if name in definitions]
                priority = (
                    ["asset_market_data", "prediction_market", "news", "macro"]
                    if state["intent"].symbol
                    else ["prediction_market", "macro", "news"]
                )
                minimum = min(3, budget.max_workers)
                for name in priority:
                    if len(selected) >= minimum:
                        break
                    if name not in selected:
                        selected.append(name)
                tasks = [definitions[name] for name in selected[:budget.max_workers]]
                return {
                    "plan": ResearchPlan(
                        mode=run.mode, tasks=tasks, budget=budget,
                        stopping_conditions=["tool budget reached", "required evidence gathered", "timeout reached"],
                        manager_provider=manager.provider, manager_model=manager.model,
                    ),
                    "_trace_provider": f"{manager.provider}:{manager.model}",
                }
            return await record("manager_plan", operation)

        def dispatch(state: ResearchState):
            from langgraph.types import Send
            return [Send("research_worker", {"query": state["query"], "intent": state["intent"], "task": task}) for task in state["plan"].tasks]

        async def worker_node(state: ResearchState) -> dict[str, Any]:
            task = state["task"]
            async def operation() -> dict[str, Any]:
                started = datetime.now(timezone.utc)
                markets: list[MarketSnapshot] = []
                context: list[EvidenceItem] = []
                snapshots: list[AssetSnapshot] = []
                observations: list[ToolObservation] = []
                provider, error, cached, retries = "deterministic", None, False, 0
                tool_started = datetime.now(timezone.utc)
                try:
                    if task.worker_type == "prediction_market":
                        _, markets, _ = await self.retriever.retrieve(state["query"])
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
                        series = "DTWEXBGS" if state["intent"].symbol == "XAUUSD" else "DGS10"
                        item, cached, retries = await self.tools.get_macro_series(series)
                        context, provider = [item], "fred"
                    elif task.worker_type == "news":
                        context, cached, retries = await self.tools.search_news(state["query"])
                        provider = "gdelt"
                    tool_completed = datetime.now(timezone.utc)
                    observations.append(ToolObservation(
                        task_id=task.id, tool=task.tools[0], provider=provider, status="completed",
                        started_at=tool_started, completed_at=tool_completed,
                        duration_ms=max(1, int((tool_completed - tool_started).total_seconds() * 1000)),
                        cached=cached, retry_count=retries,
                        evidence_ids=[item.id for item in context] + [market.id for market in markets],
                    ))
                    status = WorkerStatus.COMPLETED
                except (ToolError, ValueError) as exc:
                    error = str(exc)
                    provider = exc.provider if isinstance(exc, ToolError) else provider
                    status = WorkerStatus.FAILED
                    tool_completed = datetime.now(timezone.utc)
                    observations.append(ToolObservation(
                        task_id=task.id, tool=task.tools[0], provider=provider, status="failed",
                        started_at=tool_started, completed_at=tool_completed,
                        duration_ms=max(1, int((tool_completed - tool_started).total_seconds() * 1000)),
                        cached=False, retry_count=retries, error=error,
                    ))
                completed = datetime.now(timezone.utc)
                worker = WorkerRun(
                    task_id=task.id, worker_type=task.worker_type, objective=task.objective,
                    status=status, started_at=started, completed_at=completed,
                    duration_ms=max(1, int((completed - started).total_seconds() * 1000)),
                    tool_calls=1, output_count=len(markets) + len(context) + len(snapshots), error=error,
                )
                return {
                    "markets": markets, "context": context, "asset_snapshots": snapshots,
                    "worker_runs": [worker], "observations": observations,
                    "_trace_provider": provider,
                }
            return await record(task.worker_type, operation)

        async def merge_node(state: ResearchState) -> dict[str, Any]:
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
                    nodes.append(EvidenceNode(id="node-forecast", kind="forecast", label="Transparent ensemble", value=f"{forecast.probability:.0%}", source="Poly Trend", relevance=1, evidence_id=f"asset:{forecast.symbol}"))
                nodes.extend(EvidenceNode(id=f"node-market-{market.id}", kind="prediction_market", label=market.question, value=f"{market.probability:.0%}", source="Polymarket", relevance=market.relevance, included=market.included, evidence_id=market.id) for market in sorted(markets, key=lambda item: item.relevance, reverse=True)[:6])
                for item in state.get("context", []):
                    if item.kind != "price_history" and len(nodes) < 9:
                        nodes.append(EvidenceNode(id=f"node-evidence-{item.id}", kind=item.kind, label=item.title, source=item.source, relevance=0.55, evidence_id=item.id))
                return {
                    "markets": markets, "relationships": relationships, "answer": answer, "forecast": forecast,
                    "evidence_graph": EvidenceGraph(query_node=EvidenceNode(id="query", kind="query", label=run.query, relevance=1), nodes=nodes[:9], edges=relationships),
                }
            return await record("evidence_merge", operation)

        async def forecast_node(state: ResearchState) -> dict[str, Any]:
            return await record("quantitative_forecast", lambda: asyncio.sleep(0, result={"answer": state["answer"]}))

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
                return {"answer": answer, "_trace_provider": result.provider, "_trace_estimated_cost_usd": result.estimated_cost_usd}
            return await record("synthesis", operation)

        async def verify_node(state: ResearchState) -> dict[str, Any]:
            answer = state["answer"]
            existing = {market.id for market in state.get("markets", [])} | {item.id for item in state.get("context", [])}
            missing = [item for item in answer.evidence_ids if item not in existing]
            report = RunQualityReport(passed=not missing and (answer.probability is None or bool(answer.evidence_ids)), supported_numeric_claims=len(answer.evidence_ids), missing_evidence_ids=missing)
            return await record("skeptical_verification", lambda: asyncio.sleep(0, result={"quality_report": report}))

        async def quality_node(state: ResearchState) -> dict[str, Any]:
            if not state["quality_report"].passed:
                raise ValueError("quality gate rejected an unsupported numerical answer")
            return await record("quality_gate", lambda: asyncio.sleep(0, result={"quality_report": state["quality_report"]}))

        initial: ResearchState = {"query": run.query, "markets": [], "context": [], "asset_snapshots": [], "worker_runs": [], "observations": []}
        from langgraph.graph import END, START, StateGraph
        builder = StateGraph(ResearchState)
        for name, node in (("parse_intent", parse_node), ("manager_plan", plan_node), ("research_worker", worker_node), ("evidence_merge", merge_node), ("quantitative_forecast", forecast_node), ("synthesis", synthesis_node), ("skeptical_verification", verify_node), ("quality_gate", quality_node)):
            builder.add_node(name, node)
        builder.add_edge(START, "parse_intent")
        builder.add_edge("parse_intent", "manager_plan")
        builder.add_conditional_edges("manager_plan", dispatch, ["research_worker"])
        builder.add_edge("research_worker", "evidence_merge")
        builder.add_edge("evidence_merge", "quantitative_forecast")
        builder.add_edge("quantitative_forecast", "synthesis")
        builder.add_edge("synthesis", "skeptical_verification")
        builder.add_edge("skeptical_verification", "quality_gate")
        builder.add_edge("quality_gate", END)
        graph = builder.compile(checkpointer=self.checkpointer)
        merged: ResearchState = dict(initial)
        async with asyncio.timeout(BUDGETS[run.mode].timeout_seconds):
            async for chunk in graph.astream(initial, config={"configurable": {"thread_id": run.id}, "recursion_limit": 32}, stream_mode="updates"):
                for update in chunk.values():
                    if not isinstance(update, dict):
                        continue
                    for key in ("markets", "context", "asset_snapshots", "worker_runs", "observations"):
                        if key in update:
                            merged.setdefault(key, [])
                            merged[key].extend(update[key])
                    merged.update({key: value for key, value in update.items() if key not in {"markets", "context", "asset_snapshots", "worker_runs", "observations"}})
        run.intent, run.plan = merged.get("intent"), merged.get("plan")
        run.markets = list({item.id: item for item in merged.get("markets", [])}.values())
        run.relationships = merged.get("relationships", [])
        run.context = list({item.id: item for item in merged.get("context", [])}.values())
        run.workers, run.tool_observations = merged.get("worker_runs", []), merged.get("observations", [])
        run.answer, run.forecast = merged.get("answer"), merged.get("forecast")
        run.asset_snapshot = merged.get("asset_snapshots", [None])[0] if merged.get("asset_snapshots") else None
        run.evidence_graph, run.quality_report = merged.get("evidence_graph"), merged.get("quality_report")
        run.status, run.updated_at = RunStatus.COMPLETED, datetime.now(timezone.utc)
        return run
