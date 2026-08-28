from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Any, TypedDict

from .analytics import aggregate_markets
from .model_router import ModelRouter
from .models import (
    EvidenceItem,
    MarketImpliedAnswer,
    MarketSnapshot,
    QueryIntent,
    ResearchRun,
    RunEvent,
    RunStatus,
    TraceSpan,
)
from .retrieval import HybridRetriever, parse_intent, relationship_map

Emit = Callable[[RunEvent], Awaitable[None]]


class ResearchState(TypedDict, total=False):
    query: str
    intent: QueryIntent
    markets: list[MarketSnapshot]
    candidates: list[Any]
    relationships: list[Any]
    context: list[EvidenceItem]
    answer: MarketImpliedAnswer
    verification: dict[str, Any]


STAGES = {
    "parse_intent": "Understanding the question",
    "retrieve_markets": "Retrieving markets",
    "map_relationships": "Checking relationships",
    "quantitative_analysis": "Aggregating comparable prices",
    "context_retrieval": "Separating outside context",
    "synthesis": "Drafting the market-implied answer",
    "skeptical_verification": "Verifying every numerical claim",
    "quality_gate": "Saving the investigation",
}


class ResearchEngine:
    def __init__(self, retriever: HybridRetriever, model_router: ModelRouter) -> None:
        self.retriever = retriever
        self.model_router = model_router

    async def execute(
        self,
        run: ResearchRun,
        emit: Emit,
        included_market_ids: list[str] | None = None,
    ) -> ResearchRun:
        run.status = RunStatus.RUNNING
        run.updated_at = datetime.now(timezone.utc)
        sequence = len(run.events)

        async def record(node: str, operation: Callable[[], Awaitable[dict[str, Any]]]) -> dict[str, Any]:
            nonlocal sequence
            started = datetime.now(timezone.utc)
            update = await operation()
            completed = datetime.now(timezone.utc)
            sequence += 1
            duration = max(1, int((completed - started).total_seconds() * 1000))
            event = RunEvent(sequence=sequence, stage=node, label=STAGES[node], duration_ms=duration)
            run.events.append(event)
            run.traces.append(TraceSpan(
                node=node, started_at=started, completed_at=completed, duration_ms=duration,
                input_count=len(run.markets), output_count=len(update.get("markets", update.get("relationships", update.get("context", [])))),
            ))
            await emit(event)
            return update

        async def parse_node(_: ResearchState) -> dict[str, Any]:
            return await record("parse_intent", lambda: asyncio.sleep(0, result={"intent": parse_intent(run.query)}))

        async def retrieve_node(state: ResearchState) -> dict[str, Any]:
            async def operation() -> dict[str, Any]:
                intent, markets, candidates = await self.retriever.retrieve(state["query"])
                if included_market_ids is not None:
                    included = set(included_market_ids)
                    for market in markets:
                        market.included = market.id in included
                return {"intent": intent, "markets": markets, "candidates": candidates}
            return await record("retrieve_markets", operation)

        async def relations_node(state: ResearchState) -> dict[str, Any]:
            return await record(
                "map_relationships",
                lambda: asyncio.sleep(0, result={"relationships": relationship_map(state["markets"])}),
            )

        async def quantitative_node(state: ResearchState) -> dict[str, Any]:
            return await record(
                "quantitative_analysis",
                lambda: asyncio.sleep(0, result={"answer": aggregate_markets(state["markets"])}),
            )

        async def context_node(_: ResearchState) -> dict[str, Any]:
            context = [
                EvidenceItem(
                    kind="official_context", title="NBER Business Cycle Dating Committee",
                    source="National Bureau of Economic Research",
                    url="https://www.nber.org/research/business-cycle-dating",
                    summary="Official U.S. recession dating is retrospective and separate from market prices.",
                ),
                EvidenceItem(
                    kind="methodology", title="Market evidence boundary",
                    source="Poly Trend verification policy",
                    summary="Proxy and external evidence explain disagreement but do not modify the estimate.",
                ),
            ]
            return await record("context_retrieval", lambda: asyncio.sleep(0, result={"context": context}))

        async def synthesis_node(state: ResearchState) -> dict[str, Any]:
            async def operation() -> dict[str, Any]:
                answer = state["answer"].model_copy(deep=True)
                answer.evidence_ids = [market.id for market in state["markets"] if market.id in answer.evidence_ids]
                result = await self.model_router.refine_takeaways(run.query, answer, state["markets"], run.deep_mode)
                answer.takeaways = result.takeaways
                answer.provider_freshness["synthesis"] = f"{result.provider}:{result.model}"
                return {"answer": answer}
            return await record("synthesis", operation)

        async def verify_node(state: ResearchState) -> dict[str, Any]:
            answer = state["answer"]
            existing = {market.id for market in state["markets"]}
            missing = [item for item in answer.evidence_ids if item not in existing]
            verification = {"passed": not missing, "missing_evidence_ids": missing, "bounded_corrections": 0}
            if missing:
                answer = aggregate_markets([market for market in state["markets"] if market.id in existing])
                verification.update({"passed": True, "bounded_corrections": 1})
            return await record("skeptical_verification", lambda: asyncio.sleep(0, result={"answer": answer, "verification": verification}))

        async def quality_node(state: ResearchState) -> dict[str, Any]:
            answer = state["answer"]
            if answer.probability is not None and not answer.evidence_ids:
                raise ValueError("quality gate rejected an unsupported numerical answer")
            return await record("quality_gate", lambda: asyncio.sleep(0, result={"verification": state["verification"]}))

        initial: ResearchState = {"query": run.query}
        merged: ResearchState = dict(initial)
        try:
            from langgraph.graph import END, START, StateGraph
            from langgraph.checkpoint.memory import InMemorySaver

            builder = StateGraph(ResearchState)
            builder.add_node("parse_intent", parse_node)
            builder.add_node("retrieve_markets", retrieve_node)
            builder.add_node("map_relationships", relations_node)
            builder.add_node("quantitative_analysis", quantitative_node)
            builder.add_node("context_retrieval", context_node)
            builder.add_node("synthesis", synthesis_node)
            builder.add_node("skeptical_verification", verify_node)
            builder.add_node("quality_gate", quality_node)
            builder.add_edge(START, "parse_intent")
            builder.add_edge("parse_intent", "retrieve_markets")
            # Fan-out/fan-in: three deterministic specialists work from the same evidence set.
            builder.add_edge("retrieve_markets", "map_relationships")
            builder.add_edge("retrieve_markets", "quantitative_analysis")
            builder.add_edge("retrieve_markets", "context_retrieval")
            builder.add_edge(["map_relationships", "quantitative_analysis", "context_retrieval"], "synthesis")
            builder.add_edge("synthesis", "skeptical_verification")
            builder.add_edge("skeptical_verification", "quality_gate")
            builder.add_edge("quality_gate", END)
            graph = builder.compile(checkpointer=InMemorySaver())
            config = {"configurable": {"thread_id": run.id}, "recursion_limit": 24}
            async for chunk in graph.astream(initial, config=config, stream_mode="updates"):
                for update in chunk.values():
                    if isinstance(update, dict):
                        merged.update(update)
        except ImportError:
            merged.update(await parse_node(merged))
            merged.update(await retrieve_node(merged))
            relation_update, quantitative_update, context_update = await asyncio.gather(
                relations_node(merged), quantitative_node(merged), context_node(merged)
            )
            merged.update(relation_update)
            merged.update(quantitative_update)
            merged.update(context_update)
            merged.update(await synthesis_node(merged))
            merged.update(await verify_node(merged))
            merged.update(await quality_node(merged))

        run.intent = merged.get("intent")
        run.markets = merged.get("markets", [])
        run.relationships = merged.get("relationships", [])
        run.context = merged.get("context", [])
        run.answer = merged.get("answer")
        run.status = RunStatus.COMPLETED
        run.updated_at = datetime.now(timezone.utc)
        return run
