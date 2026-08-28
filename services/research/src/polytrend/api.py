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
from .graph import ResearchEngine
from .model_router import ModelRouter
from .models import (
    ForkCreate,
    Investigation,
    InvestigationCreate,
    InvestigationPatch,
    RefreshPolicy,
    ResearchRun,
    RunCreate,
    RunDiff,
    RunEvent,
    RunStatus,
)
from .providers import PolymarketProvider
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
    app.state.store = store
    app.state.provider = provider
    app.state.model_router = ModelRouter(settings)
    app.state.engine = ResearchEngine(HybridRetriever(provider), app.state.model_router)
    app.state.tasks = set()
    yield
    for task in app.state.tasks:
        task.cancel()
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
    except Exception as exc:  # noqa: BLE001 - error is persisted for the run inspector
        run.status = RunStatus.FAILED
        run.error = f"{type(exc).__name__}: {exc}"
        run.updated_at = datetime.now(timezone.utc)
        await store.put_run(run)


def _schedule(request: Request, run: ResearchRun, included: list[str] | None = None) -> None:
    task = asyncio.create_task(_execute_run(request, run, included))
    request.app.state.tasks.add(task)
    task.add_done_callback(request.app.state.tasks.discard)


@router.post("/investigations", response_model=Investigation, status_code=201)
async def create_investigation(payload: InvestigationCreate, request: Request) -> Investigation:
    investigation = Investigation(**payload.model_dump())
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
    run = ResearchRun(investigation_id=investigation.id, query=investigation.query, deep_mode=investigation.deep_mode)
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
            if run.status in {RunStatus.COMPLETED, RunStatus.FAILED}:
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
    run = ResearchRun(investigation_id=original.investigation_id, query=original.query, deep_mode=original.deep_mode)
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


@router.get("/providers/health")
async def provider_health(request: Request) -> dict[str, Any]:
    return {
        "polymarket": request.app.state.provider.health(),
        "storage": await _store(request).health(),
        "orchestrator": {"status": "ok", "name": "langgraph", "fallback": "deterministic"},
        "model_router": request.app.state.model_router.health(),
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
