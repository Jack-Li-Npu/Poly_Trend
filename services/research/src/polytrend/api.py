from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import settings
from .adaptive_graph import AdaptiveResearchEngine
from .model_router import ModelRouter
from .models import (
    ForkCreate,
    Investigation,
    InvestigationCreate,
    InvestigationPatch,
    InvestigationMode,
    RefreshPolicy,
    ResearchRun,
    RunCreate,
    RunDiff,
    RunEvent,
    RunStatus,
)
from .providers import PolymarketProvider
from .research_tools import ResearchTools, ToolError
from .retrieval import HybridRetriever
from .seed import seed_markets
from .store import ArtifactStore, PostgresArtifactStore, create_store


def _next_daily_refresh() -> datetime:
    zone = ZoneInfo("Asia/Shanghai")
    now = datetime.now(zone)
    target = now.replace(hour=8, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return target.astimezone(timezone.utc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    store = await create_store(settings.sqlite_path, settings.database_url)
    provider = PolymarketProvider(settings)
    checkpointer = None
    checkpointer_context = None
    if settings.database_url:
        try:
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

            connection_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
            checkpointer_context = AsyncPostgresSaver.from_conn_string(connection_url)
            checkpointer = await checkpointer_context.__aenter__()
            await checkpointer.setup()
        except Exception:  # noqa: BLE001 - checkpointing is optional in local fallback mode
            checkpointer = None
    app.state.store = store
    app.state.provider = provider
    app.state.research_tools = ResearchTools(settings)
    app.state.model_router = ModelRouter(settings)
    app.state.engine = AdaptiveResearchEngine(
        HybridRetriever(provider), app.state.model_router, app.state.research_tools, checkpointer
    )
    app.state.tasks = set()
    app.state.run_tasks = {}
    yield
    for task in app.state.tasks:
        task.cancel()
    if app.state.tasks:
        await asyncio.gather(*app.state.tasks, return_exceptions=True)
    if checkpointer_context:
        await checkpointer_context.__aexit__(None, None, None)
    await store.close()


app = FastAPI(
    title="Poly Trend Research API", version="2.0.0", lifespan=lifespan,
    description="Verified, resumable prediction-market investigations.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3100"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
router = APIRouter()


def _store(request: Request) -> ArtifactStore | PostgresArtifactStore:
    return request.app.state.store


async def _execute_run(request: Request, run: ResearchRun, included: list[str] | None = None) -> None:
    store = _store(request)

    async def emit(_: RunEvent) -> None:
        await store.put_run(run)

    try:
        await request.app.state.engine.execute(run, emit, included)
        prior_runs = [item for item in await store.list_runs() if item.investigation_id == run.investigation_id and item.id != run.id and item.status == RunStatus.COMPLETED]
        if prior_runs:
            prior = prior_runs[0]
            current_ids, prior_ids = {m.id for m in run.markets}, {m.id for m in prior.markets}
            current_p = run.answer.probability if run.answer else None
            prior_p = prior.answer.probability if prior.answer else None
            run.diff = RunDiff(
                prior_run_id=prior.id,
                probability_change=(current_p - prior_p) if current_p is not None and prior_p is not None else None,
                added_market_ids=sorted(current_ids - prior_ids), removed_market_ids=sorted(prior_ids - current_ids),
            )
        await store.put_run(run)
    except asyncio.CancelledError:
        run.status = RunStatus.CANCELLED
        run.cancelled = True
        run.updated_at = datetime.now(timezone.utc)
        await store.put_run(run)
    except Exception as exc:  # noqa: BLE001 - error is persisted for the run inspector
        run.status = RunStatus.FAILED
        run.error = f"{type(exc).__name__}: {exc}"
        run.updated_at = datetime.now(timezone.utc)
        await store.put_run(run)


def _schedule(request: Request, run: ResearchRun, included: list[str] | None = None) -> None:
    task = asyncio.create_task(_execute_run(request, run, included))
    request.app.state.tasks.add(task)
    request.app.state.run_tasks[run.id] = task
    task.add_done_callback(request.app.state.tasks.discard)
    task.add_done_callback(lambda _: request.app.state.run_tasks.pop(run.id, None))


@router.post("/investigations", response_model=Investigation, status_code=201)
async def create_investigation(payload: InvestigationCreate, request: Request) -> Investigation:
    investigation = Investigation(**payload.model_dump())
    if payload.deep_mode and payload.mode == InvestigationMode.STANDARD:
        investigation.mode = InvestigationMode.DEEP
    if investigation.refresh_policy == RefreshPolicy.DAILY:
        investigation.next_refresh_at = _next_daily_refresh()
    await _store(request).put_investigation(investigation)
    return investigation


@router.get("/investigations/{investigation_id}", response_model=Investigation)
async def get_investigation(investigation_id: str, request: Request) -> Investigation:
    result = await _store(request).get_investigation(investigation_id)
    if not result:
        raise HTTPException(404, "investigation not found")
    return result


@router.patch("/investigations/{investigation_id}", response_model=Investigation)
async def patch_investigation(investigation_id: str, payload: InvestigationPatch, request: Request) -> Investigation:
    store = _store(request)
    result = await store.get_investigation(investigation_id)
    if not result:
        raise HTTPException(404, "investigation not found")
    for key, value in payload.model_dump(exclude_none=True).items():
        setattr(result, key, value)
    result.updated_at = datetime.now(timezone.utc)
    result.next_refresh_at = _next_daily_refresh() if result.refresh_policy == RefreshPolicy.DAILY else None
    await store.put_investigation(result)
    return result


@router.post("/investigations/{investigation_id}/runs", response_model=ResearchRun, status_code=202)
async def create_run(investigation_id: str, payload: RunCreate, request: Request) -> ResearchRun:
    store = _store(request)
    investigation = await store.get_investigation(investigation_id)
    if not investigation:
        raise HTTPException(404, "investigation not found")
    mode = payload.mode or investigation.mode
    run = ResearchRun(
        investigation_id=investigation.id, query=investigation.query,
        deep_mode=mode == InvestigationMode.DEEP, mode=mode,
    )
    investigation.latest_run_id = run.id
    investigation.run_ids.append(run.id)
    investigation.updated_at = datetime.now(timezone.utc)
    await store.put_investigation(investigation)
    await store.put_run(run)
    _schedule(request, run, payload.included_market_ids)
    return run


@router.get("/runs/{run_id}", response_model=ResearchRun)
async def get_run(run_id: str, request: Request) -> ResearchRun:
    result = await _store(request).get_run(run_id)
    if not result:
        raise HTTPException(404, "run not found")
    return result


@router.get("/runs/{run_id}/trace")
async def get_run_trace(run_id: str, request: Request) -> dict[str, Any]:
    run = await _store(request).get_run(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    return {
        "plan": run.plan, "workers": run.workers, "tool_observations": run.tool_observations,
        "traces": run.traces, "quality_report": run.quality_report,
    }


@router.post("/runs/{run_id}/cancel", response_model=ResearchRun)
async def cancel_run(run_id: str, request: Request) -> ResearchRun:
    run = await _store(request).get_run(run_id)
    if not run:
        raise HTTPException(404, "run not found")
    task = request.app.state.run_tasks.get(run_id)
    if task and not task.done():
        task.cancel()
    run.cancelled = True
    run.status = RunStatus.CANCELLED
    run.updated_at = datetime.now(timezone.utc)
    await _store(request).put_run(run)
    return run


@router.get("/runs/{run_id}/events")
async def stream_events(run_id: str, request: Request) -> StreamingResponse:
    async def generate():
        cursor = 0
        idle = 0
        while idle < 900:
            run = await _store(request).get_run(run_id)
            if not run:
                yield "event: error\ndata: {\"message\":\"run not found\"}\n\n"
                return
            while cursor < len(run.events):
                event = run.events[cursor]
                cursor += 1
                yield f"id: {event.sequence}\nevent: stage\ndata: {event.model_dump_json()}\n\n"
            if run.status in {RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED}:
                yield f"event: complete\ndata: {run.model_dump_json()}\n\n"
                return
            idle += 1
            yield ": keep-alive\n\n"
            await asyncio.sleep(0.4)
    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/runs/{run_id}/fork", response_model=ResearchRun, status_code=202)
async def fork_run(run_id: str, payload: ForkCreate, request: Request) -> ResearchRun:
    original = await _store(request).get_run(run_id)
    if not original:
        raise HTTPException(404, "run not found")
    run = ResearchRun(
        investigation_id=original.investigation_id, query=original.query,
        deep_mode=original.deep_mode, mode=original.mode,
    )
    await _store(request).put_run(run)
    _schedule(request, run, payload.included_market_ids)
    return run


@router.get("/markets/{market_id}")
async def get_market(market_id: str, request: Request):
    for run in await _store(request).list_runs():
        for market in run.markets:
            if market.id == market_id:
                return market
    for market in seed_markets():
        if market.id == market_id:
            return market
    raise HTTPException(404, "market not found")


@router.get("/assets/{symbol}/snapshot")
async def get_asset_snapshot(symbol: str, request: Request):
    try:
        snapshot, cached, retries = await request.app.state.research_tools.get_asset_snapshot(symbol.upper())
        return {"snapshot": snapshot, "cached": cached, "retry_count": retries}
    except ToolError as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/providers/health")
async def provider_health(request: Request) -> dict[str, Any]:
    return {
        "polymarket": request.app.state.provider.health(),
        "storage": await _store(request).health(),
        "orchestrator": {"status": "ok", "name": "langgraph", "fallback": "deterministic"},
        "model_router": request.app.state.model_router.health(),
        "research_tools": request.app.state.research_tools.health(),
        "models": {"normal": settings.openai_model, "deep": settings.openai_deep_model, "fallback": settings.gemini_model, "keys_required": False},
    }


@app.get("/healthz")
async def healthz(request: Request) -> dict[str, Any]:
    return {"status": "ok", "service": "polytrend-research", "storage": await _store(request).health()}


@app.post("/mcp")
async def mcp_adapter(payload: dict[str, Any], request: Request) -> dict[str, Any]:
    method, params = payload.get("method"), payload.get("params", {})
    request_id = payload.get("id")
    if method == "tools/list":
        result = {"tools": [
            {"name": "search_markets", "description": "Retrieve and rank prediction markets for a question", "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
            {"name": "get_market", "description": "Get a stored market snapshot", "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}},
            {"name": "run_investigation", "description": "Create and run a verified investigation", "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
            {"name": "get_investigation", "description": "Read a saved investigation", "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}},
            {"name": "get_spot_price", "description": "Get a server-side asset price snapshot", "inputSchema": {"type": "object", "properties": {"symbol": {"type": "string"}}, "required": ["symbol"]}},
            {"name": "get_price_history", "description": "Get server-side asset price history", "inputSchema": {"type": "object", "properties": {"symbol": {"type": "string"}}, "required": ["symbol"]}},
            {"name": "get_macro_series", "description": "Get an official FRED macro observation", "inputSchema": {"type": "object", "properties": {"series_id": {"type": "string"}}, "required": ["series_id"]}},
            {"name": "search_news", "description": "Search recent GDELT news metadata", "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
        ]}
    elif method == "tools/call":
        name, arguments = params.get("name"), params.get("arguments", {})
        if name == "search_markets":
            _, markets, _ = await request.app.state.engine.retriever.retrieve(arguments["query"])
            result = {"content": [{"type": "text", "text": json.dumps([market.model_dump(mode="json") for market in markets])}]}
        elif name == "get_market":
            market = next((market for run in await _store(request).list_runs() for market in run.markets if market.id == arguments["id"]), None)
            result = {"content": [{"type": "text", "text": market.model_dump_json() if market else "not found"}]}
        elif name == "run_investigation":
            investigation = Investigation(query=arguments["query"])
            await _store(request).put_investigation(investigation)
            run = ResearchRun(investigation_id=investigation.id, query=investigation.query)
            await _store(request).put_run(run)
            _schedule(request, run)
            result = {"content": [{"type": "text", "text": run.model_dump_json()}]}
        elif name == "get_investigation":
            investigation = await _store(request).get_investigation(arguments["id"])
            result = {"content": [{"type": "text", "text": investigation.model_dump_json() if investigation else "not found"}]}
        elif name in {"get_spot_price", "get_price_history"}:
            snapshot, _, _ = await request.app.state.research_tools.get_asset_snapshot(arguments["symbol"].upper())
            value = snapshot.model_dump(mode="json") if name == "get_price_history" else {
                "symbol": snapshot.symbol, "price": snapshot.price, "as_of": snapshot.as_of.isoformat(),
                "source": snapshot.source,
            }
            result = {"content": [{"type": "text", "text": json.dumps(value, default=str)}]}
        elif name == "get_macro_series":
            item, _, _ = await request.app.state.research_tools.get_macro_series(arguments["series_id"])
            result = {"content": [{"type": "text", "text": item.model_dump_json()}]}
        elif name == "search_news":
            items, _, _ = await request.app.state.research_tools.search_news(arguments["query"])
            result = {"content": [{"type": "text", "text": json.dumps([item.model_dump(mode="json") for item in items], default=str)}]}
        else:
            result = {"isError": True, "content": [{"type": "text", "text": "unknown tool"}]}
    else:
        result = {"protocolVersion": "2025-03-26", "capabilities": {"tools": {}}, "serverInfo": {"name": "polytrend", "version": "2.0.0"}}
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


app.include_router(router, prefix="/api/v1")
app.include_router(router, prefix="/v1", include_in_schema=False)


def serve() -> None:
    import uvicorn
    uvicorn.run("polytrend.api:app", host=settings.host, port=settings.port, reload=settings.app_env == "development")
