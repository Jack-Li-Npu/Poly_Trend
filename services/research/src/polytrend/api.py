"""Poly Trend V3 public research API. Legacy numerical-answer routes are retired."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, StreamingResponse

from .v3.models import (
    AssetSeries,
    AttentionSummary,
    CaseCreate,
    CaseDetail,
    CasePatch,
    EvaluationReport,
    EventDefinition,
    EventList,
    ImportRequest,
    Observation,
    ResearchCase,
    ResearchRun,
    RunCreate,
    RunDetail,
    SimulationRequest,
    SimulationResult,
    utc_now,
)
from .v3.service import ResearchService, import_series
from .v3.settings import V3Settings
from .v3.store import ResearchStore


def create_app(
    config: V3Settings | None = None, provider: Any = None, store: ResearchStore | None = None
) -> FastAPI:
    config = config or V3Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        from .v3.providers import ResearchDataProvider, load_recorded_bundles

        app.state.store = store or ResearchStore(config.sqlite_path, config.database_url)
        await app.state.store.open()
        app.state.provider = provider or ResearchDataProvider(config)
        app.state.config = config
        app.state.service = ResearchService(app.state.store, app.state.provider, config)
        for bundle in load_recorded_bundles():
            await app.state.store.put_event(bundle.event)
        await app.state.service.start()

        async def scheduler():
            while True:
                await asyncio.sleep(30)
                try:
                    await app.state.service.start()
                    await app.state.service.refresh_due()
                except Exception:
                    # Provider failures belong to individual runs. Scheduler remains alive.
                    continue

        app.state.scheduler = asyncio.create_task(scheduler())
        app.state.collector = None
        if config.capture_enabled:
            app.state.collector = asyncio.create_task(capture_watched(app))
        yield
        app.state.scheduler.cancel()
        if app.state.collector:
            app.state.collector.cancel()
        await asyncio.gather(
            app.state.scheduler,
            *([app.state.collector] if app.state.collector else []),
            return_exceptions=True,
        )
        await app.state.service.close()
        if hasattr(app.state.provider, "close"):
            await app.state.provider.close()
        await app.state.store.close()

    app = FastAPI(
        title="Poly Trend V3 — Event Expectations & Asset Response Lab",
        version="3.0.0",
        lifespan=lifespan,
        description="Source-linked event research, falsifiable investment theses and reproducible simulation. No real order placement.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[value.strip() for value in config.cors_origins if value.strip()],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["Content-Type", "Last-Event-ID"],
    )
    prefix = "/api/v3"

    async def rank_attention(
        values: list[EventDefinition], request: Request, mode: str
    ) -> list[EventDefinition]:
        from .v3.analytics import analyze_bundle
        from .v3.providers import load_recorded_bundles

        metrics_by_event: dict[str, dict] = {}
        if mode == "recorded":
            for bundle in load_recorded_bundles():
                metrics_by_event[bundle.event.id] = analyze_bundle(bundle)
        else:
            # Use captured research only; discovery prices are not a measured change.
            cases = {
                case.id: case
                for case in await request.app.state.store.list_cases()
                if case.source_mode == mode
            }
            for run in await request.app.state.store.list_runs():
                case = cases.get(run.case_id)
                if (
                    case
                    and run.status == "completed"
                    and run.mode == "refresh"
                    and run.as_of is None
                    and case.event_id not in metrics_by_event
                ):
                    metrics_by_event[case.event_id] = run.metrics
        for event in values:
            metrics = metrics_by_event.get(event.id, {})
            changes = metrics.get("expectation_changes", [])
            if not changes:
                continue

            def magnitude(item):
                return abs(
                    item.get("delta_7d_pp")
                    if item.get("delta_7d_pp") is not None
                    else item.get("delta_1d_pp") or 0
                )

            change = max(changes, key=magnitude)
            quality = next(
                (
                    item
                    for item in metrics.get("book_quality", [])
                    if item.get("market_id") == change["market_id"]
                ),
                {},
            )
            measured = any(
                change.get(key) is not None
                for key in ("delta_1d_pp", "delta_7d_pp", "delta_30d_pp")
            )
            event.attention = AttentionSummary(
                market_id=change["market_id"],
                question=change.get("question", event.title),
                probability=change.get("probability"),
                delta_1d_pp=change.get("delta_1d_pp"),
                delta_7d_pp=change.get("delta_7d_pp"),
                delta_30d_pp=change.get("delta_30d_pp"),
                quote_type=change.get("quote_type", "unavailable"),
                as_of=change.get("as_of"),
                spread_pp=quality.get("spread_pp"),
                bid_depth_usd=quality.get("bid_depth_usd"),
                ask_depth_usd=quality.get("ask_depth_usd"),
                history_status=change.get("status", "insufficient"),
                issues=quality.get("issues", []),
                score=magnitude(change) if measured else None,
                **{
                    key: change.get(key)
                    for key in (
                        "comparison_1d_at",
                        "comparison_7d_at",
                        "comparison_30d_at",
                        "window_1d_elapsed_hours",
                        "window_7d_elapsed_hours",
                        "window_30d_elapsed_hours",
                    )
                },
            )
        return sorted(
            values,
            key=lambda event: (
                event.attention is not None and event.attention.score is not None,
                event.attention.score
                if event.attention and event.attention.score is not None
                else 0,
            ),
            reverse=True,
        )

    @app.get("/healthz")
    async def health(request: Request) -> dict:
        return {
            "status": "ok",
            "version": "3.0.0",
            "storage": await request.app.state.store.health(),
        }

    @app.get(f"{prefix}/providers/health")
    async def providers_health(request: Request) -> dict:
        return request.app.state.provider.health()

    @app.get(f"{prefix}/events", response_model=EventList)
    async def events(
        request: Request,
        query: str = Query(default="", max_length=200),
        source_mode: Literal["live", "recorded"] = "live",
        include_closed: bool = False,
    ) -> EventList:
        store = request.app.state.store
        if source_mode == "recorded":
            values = await store.list_events("recorded")
            if query:
                values = [
                    event
                    for event in values
                    if query.casefold() in (event.title + event.description).casefold()
                ]
            return EventList(
                events=await rank_attention(values, request, source_mode),
                source_mode="recorded",
                issues=[
                    "Recorded source-backed investigations; not live quotes. Ranked by absolute available seven-day change, then one-day change; this measures research attention."
                ],
            )
        if not config.live_market_data:
            return EventList(
                events=[],
                issues=[
                    "Live market data is disabled. Recorded investigations are a separate, explicit mode."
                ],
            )
        try:
            values = await request.app.state.provider.discover(
                query=query, include_closed=include_closed, limit=20
            )
            for event in values:
                await store.put_event(event)
            return EventList(events=await rank_attention(values, request, source_mode))
        except Exception:
            # Do not silently substitute seed data or return credential-bearing HTTP errors.
            raise HTTPException(
                503,
                "Live event discovery is unavailable. Retry or explicitly choose recorded investigations.",
            ) from None

    @app.get(f"{prefix}/events/{{event_id}}", response_model=EventDefinition)
    async def event_detail(
        event_id: str, request: Request, source_mode: Literal["live", "recorded"] = "live"
    ) -> EventDefinition:
        value = await request.app.state.store.get_event(event_id, source_mode)
        if value is None and source_mode == "live" and config.live_market_data:
            try:
                value = await request.app.state.provider.get_event(event_id)
                await request.app.state.store.put_event(value)
            except Exception:
                raise HTTPException(404, "event definition unavailable") from None
        if value is None:
            raise HTTPException(404, "event not found")
        return value

    @app.post(f"{prefix}/cases", response_model=ResearchCase, status_code=201)
    async def create_case(payload: CaseCreate, request: Request) -> ResearchCase:
        event = await event_detail(payload.event_id, request, payload.source_mode)
        case = ResearchCase(**payload.model_dump(), title=event.title)
        await request.app.state.store.put_case(case)
        return case

    @app.get(f"{prefix}/cases", response_model=list[ResearchCase])
    async def list_cases(request: Request) -> list[ResearchCase]:
        return await request.app.state.store.list_cases()

    @app.get(f"{prefix}/cases/{{case_id}}", response_model=CaseDetail)
    async def case_detail(case_id: str, request: Request) -> CaseDetail:
        case = await request.app.state.store.get_case(case_id)
        if not case:
            raise HTTPException(404, "case not found")
        event = await event_detail(case.event_id, request, case.source_mode)
        return CaseDetail(
            case=case, event=event, runs=await request.app.state.store.list_runs(case_id)
        )

    @app.patch(f"{prefix}/cases/{{case_id}}", response_model=ResearchCase)
    async def update_case(case_id: str, payload: CasePatch, request: Request) -> ResearchCase:
        case = await request.app.state.store.get_case(case_id)
        if not case:
            raise HTTPException(404, "case not found")
        values = payload.model_dump(exclude_none=True)
        case = ResearchCase.model_validate(
            {**case.model_dump(), **values, "revision": case.revision + 1, "updated_at": utc_now()}
        )
        await request.app.state.store.put_case(case)
        return case

    @app.get(f"{prefix}/cases/{{case_id}}/revisions")
    async def revisions(case_id: str, request: Request) -> list[dict]:
        return await request.app.state.store.revisions(case_id)

    @app.post(f"{prefix}/cases/{{case_id}}/runs", response_model=ResearchRun, status_code=202)
    async def start_run(case_id: str, payload: RunCreate, request: Request) -> ResearchRun:
        case = await request.app.state.store.get_case(case_id)
        if not case:
            raise HTTPException(404, "case not found")
        try:
            return await request.app.state.service.create_run(case, payload)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None

    @app.get(f"{prefix}/runs/{{run_id}}", response_model=RunDetail)
    async def run_detail(run_id: str, request: Request) -> RunDetail:
        run = await request.app.state.store.get_run(run_id)
        if not run:
            raise HTTPException(404, "run not found")
        bundle = await request.app.state.store.get_bundle(run.bundle_id) if run.bundle_id else None
        from .v3.presentation import availability_view

        presentation = availability_view(bundle, run.as_of) if bundle and run.as_of else None
        return RunDetail(run=run, bundle=bundle, presentation=presentation)

    @app.get(f"{prefix}/runs/{{run_id}}/events")
    async def run_events(run_id: str, request: Request) -> StreamingResponse:
        if not await request.app.state.store.get_run(run_id):
            raise HTTPException(404, "run not found")
        try:
            after = max(0, int(request.headers.get("Last-Event-ID", "0")))
        except ValueError:
            raise HTTPException(400, "Last-Event-ID must be an integer") from None

        async def stream():
            cursor = after
            while not await request.is_disconnected():
                run = await request.app.state.store.get_run(run_id)
                if not run:
                    return
                for event in run.progress:
                    if event.sequence > cursor:
                        yield f"id: {event.sequence}\nevent: stage\ndata: {event.model_dump_json()}\n\n"
                        cursor = event.sequence
                if run.status in {"completed", "failed", "cancelled", "interrupted"}:
                    result = await run_detail(run_id, request)
                    yield f"event: complete\ndata: {result.model_dump_json()}\n\n"
                    return
                yield ": keep-alive\n\n"
                await asyncio.sleep(0.3)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.post(f"{prefix}/runs/{{run_id}}/cancel", response_model=ResearchRun)
    async def cancel_run(run_id: str, request: Request) -> ResearchRun:
        try:
            return await request.app.state.service.cancel(run_id)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from None

    @app.post(f"{prefix}/runs/{{run_id}}/resume", response_model=ResearchRun, status_code=202)
    async def resume_run(run_id: str, request: Request) -> ResearchRun:
        try:
            return await request.app.state.service.resume(run_id)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from None

    @app.get(f"{prefix}/runs/{{run_id}}/export")
    async def export_run(
        run_id: str, request: Request, format: Literal["json", "markdown"] = "json"
    ) -> Response:
        detail = await run_detail(run_id, request)
        if format == "json":
            return Response(
                detail.model_dump_json(indent=2),
                media_type="application/json",
                headers={
                    "Content-Disposition": f'attachment; filename="poly-trend-v3-{run_id}.json"'
                },
            )
        lines = [
            "# Poly Trend V3 research record",
            "",
            f"Run: {run_id}",
            f"Method: {detail.run.method_version}",
            f"Snapshot hash: {detail.run.snapshot_hash}",
            f"Operation: {detail.run.mode}",
            f"Availability cutoff: {detail.run.as_of.isoformat() if detail.run.as_of else 'capture completion'}",
            "Source manifest lists the full pinned capture; observations after a historical cutoff are excluded from its displayed findings.",
            "",
        ]
        if detail.bundle:
            lines += [f"## {detail.bundle.event.title}", "", detail.bundle.event.source_url, ""]
        for claim in detail.run.claims:
            lines += [f"### {claim.title} ({claim.kind}; {claim.status})", "", claim.text, ""]
        lines += [
            "## Limitations",
            "",
            *[f"- {value}" for value in detail.run.limitations],
            "",
            "## Sources",
            "",
        ]
        if detail.bundle:
            lines += [
                f"- {observation.provider}: {observation.source_url} (hash {observation.content_hash})"
                for observation in detail.bundle.observations
            ]
        return PlainTextResponse(
            "\n".join(lines),
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="poly-trend-v3-{run_id}.md"'},
        )

    @app.post(f"{prefix}/simulations", response_model=SimulationResult)
    async def simulation(payload: SimulationRequest, request: Request) -> SimulationResult:
        from .v3.analytics import paper_evaluate, simulate

        try:
            result = simulate(payload.assumptions)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        if payload.run_id and payload.symbol and payload.decision_at:
            detail = await run_detail(payload.run_id, request)
            series = (
                next(
                    (value for value in detail.bundle.assets if value.symbol == payload.symbol),
                    None,
                )
                if detail.bundle
                else None
            )
            if series:
                result.historical_result = paper_evaluate(
                    series,
                    payload.decision_at,
                    payload.assumptions.holding_sessions,
                    payload.assumptions.round_trip_cost_bps,
                    payload.assumptions.capital,
                )
            else:
                result.limitations.append(
                    "The selected asset has no supplied history in this research snapshot."
                )
        return result

    @app.post(f"{prefix}/imports", response_model=AssetSeries, status_code=201)
    async def import_history(payload: ImportRequest, request: Request) -> AssetSeries:
        try:
            series, observation = import_series(payload)
        except (ValueError, OverflowError) as exc:
            raise HTTPException(422, str(exc)) from None
        await request.app.state.store.put_observation(observation)
        await request.app.state.store.put_import(series)
        return series

    @app.get(f"{prefix}/observations", response_model=list[Observation])
    async def observations(request: Request, external_id: str | None = None) -> list[Observation]:
        return await request.app.state.store.observations(external_id)

    @app.get(f"{prefix}/evaluations", response_model=EvaluationReport)
    async def evaluations(request: Request) -> EvaluationReport:
        from .v3.evaluation import get_evaluation_report

        runs = await request.app.state.store.list_runs()
        bundles = []
        for key in {run.bundle_id for run in runs if run.bundle_id}:
            if value := await request.app.state.store.get_bundle(key):
                bundles.append(value)
        return get_evaluation_report(runs, bundles)

    @app.api_route(
        "/api/v1/{legacy_path:path}", methods=["GET", "POST", "PATCH"], include_in_schema=False
    )
    @app.api_route(
        "/v1/{legacy_path:path}", methods=["GET", "POST", "PATCH"], include_in_schema=False
    )
    async def legacy_retired(legacy_path: str):
        raise HTTPException(
            410, "V2 numerical-answer workflows are retired. Use /api/v3/events and /api/v3/cases."
        )

    @app.post("/mcp", include_in_schema=False)
    async def mcp(payload: dict[str, Any], request: Request):
        method, params, request_id = (
            payload.get("method"),
            payload.get("params", {}),
            payload.get("id"),
        )
        if method == "notifications/initialized":
            return Response(status_code=204)
        if method == "initialize":
            result = {
                "protocolVersion": "2025-03-26",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "polytrend-v3", "version": "3.0.0"},
            }
        elif method == "tools/list":
            result = {
                "tools": [
                    {
                        "name": "search_events",
                        "description": "Discover live or explicitly recorded economic event definitions.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "query": {"type": "string"},
                                "source_mode": {"type": "string", "enum": ["live", "recorded"]},
                            },
                        },
                    },
                    {
                        "name": "get_research_run",
                        "description": "Inspect source-linked research and immutable evidence.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {"run_id": {"type": "string"}},
                            "required": ["run_id"],
                        },
                    },
                ]
            }
        elif method == "tools/call":
            args = params.get("arguments", {})
            try:
                if params.get("name") == "search_events":
                    value = await events(
                        request,
                        query=str(args.get("query", ""))[:200],
                        source_mode=args.get("source_mode", "live"),
                        include_closed=False,
                    )
                elif params.get("name") == "get_research_run":
                    value = await run_detail(str(args["run_id"]), request)
                else:
                    return {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "error": {"code": -32601, "message": "Unknown tool"},
                    }
                result = {"content": [{"type": "text", "text": value.model_dump_json()}]}
            except Exception:
                result = {
                    "isError": True,
                    "content": [
                        {
                            "type": "text",
                            "text": "Research data unavailable. No result was substituted.",
                        }
                    ],
                }
        else:
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32601, "message": "Method not found"},
            }
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    return app


async def capture_watched(app: FastAPI) -> None:
    """Capture only analyst-watched live contracts; retain gap/reconciliation records."""
    from .v3.stream import MarketStreamCollector

    while True:
        try:
            cases = [
                case for case in await app.state.store.list_cases() if case.source_mode == "live"
            ]
            events = []
            for case in cases:
                event = await app.state.store.get_event(case.event_id, "live")
                if event:
                    events.append(event)
            if not events:
                await asyncio.sleep(30)
                continue
            collector = MarketStreamCollector(
                app.state.provider, app.state.store.put_observation, max_contracts=20
            )
            # Reconnect periodically to include newly watched events.
            try:
                async with asyncio.timeout(300):
                    await collector.collect(events)
            except TimeoutError:
                continue
        except asyncio.CancelledError:
            raise
        except Exception:
            await asyncio.sleep(5)


app = create_app()


def serve() -> None:
    import uvicorn

    settings = V3Settings()
    uvicorn.run("polytrend.api:app", host=settings.host, port=settings.port)
