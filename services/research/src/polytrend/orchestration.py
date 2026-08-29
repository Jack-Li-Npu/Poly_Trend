from __future__ import annotations

from .models import InvestigationMode, QueryIntent, ResearchPlan, ResearchTask, RunBudget


def _task(
    task_id: str,
    worker_type: str,
    agent_name: str,
    objective: str,
    tools: list[str],
    *,
    wave: int = 1,
    query_variant: str | None = None,
    depends_on: list[str] | None = None,
    deliver_to: str = "evidence_desk",
    criteria: list[str] | None = None,
    parameters: dict | None = None,
) -> ResearchTask:
    return ResearchTask(
        id=task_id,
        worker_type=worker_type,
        agent_name=agent_name,
        objective=objective,
        tools=tools,
        wave=wave,
        query_variant=query_variant,
        depends_on=depends_on or [],
        deliver_to=deliver_to,
        success_criteria=criteria or ["Return source-linked evidence or a visible provider error."],
        parameters=parameters or {},
    )


def _market_variants(query: str, intent: QueryIntent) -> list[tuple[str, str, str]]:
    if not intent.asset:
        deadline = intent.deadline.date().isoformat() if intent.deadline else (intent.horizon or "requested horizon")
        return [
            ("market-exact", "Exact-market scout", query),
            ("market-family", "Same-event scout", f"{query} same event related markets"),
            ("market-horizon", "Time-horizon scout", f"{query} nearby deadline {deadline}"),
            ("market-inverse", "Inverse-outcome scout", f"opposite or complement outcome of {query}"),
            ("market-resolution", "Resolution-family scout", f"resolution criteria for {query}"),
        ]
    asset = intent.asset or intent.symbol or "the event"
    target = f" {intent.target_value:g}" if intent.target_value else ""
    deadline = intent.deadline.date().isoformat() if intent.deadline else (intent.horizon or "requested horizon")
    return [
        ("market-exact", "Exact-market scout", query),
        ("market-threshold", "Threshold-ladder scout", f"{asset}{target} price threshold {deadline}"),
        ("market-horizon", "Time-horizon scout", f"{asset} before {deadline} related markets"),
        ("market-inverse", "Inverse-outcome scout", f"{asset} below not reach{target} {deadline}"),
        ("market-resolution", "Resolution-family scout", f"{asset} market resolution criteria event family {deadline}"),
    ]


def build_research_plan(
    query: str,
    intent: QueryIntent,
    mode: InvestigationMode,
    budget: RunBudget,
    manager_provider: str,
    manager_model: str,
) -> ResearchPlan:
    """Build a mode-guaranteed plan; the model prioritizes, policy guarantees rigor."""
    variants = _market_variants(query, intent)
    tasks: list[ResearchTask] = []

    # Wave 1: context-isolated source researchers.
    market_count = {InvestigationMode.FAST: 1, InvestigationMode.STANDARD: 3, InvestigationMode.DEEP: 5}[mode]
    for task_id, name, variant in variants[:market_count]:
        tasks.append(_task(
            task_id, "prediction_market", name,
            f"Search Polymarket independently for: {variant}",
            ["search_prediction_markets"], query_variant=variant,
            criteria=["Return ranked candidates.", "Preserve market URL and resolution wording."],
            parameters={"limit": 12 if mode != InvestigationMode.DEEP else 18},
        ))

    if intent.symbol:
        tasks.append(_task(
            "asset-history", "asset_market_data", "Spot & history researcher",
            "Retrieve current spot and enough daily observations for a reproducible barrier forecast.",
            ["get_spot_price", "get_price_history"],
            criteria=["Fresh spot timestamp.", "At least 60 valid observations or a visible failure."],
        ))

    if mode != InvestigationMode.FAST:
        tasks.append(_task(
            "macro-primary", "macro", "Macro rates researcher",
            "Retrieve an official macro series relevant to the requested outcome.",
            ["get_macro_series"], parameters={"series_id": "DGS10"},
        ))
        tasks.append(_task(
            "news-primary", "news", "News context researcher",
            "Find recent linkable reporting and keep it separate from numerical estimation.",
            ["search_news"], query_variant=query,
        ))
    elif not intent.symbol:
        tasks.extend([
            _task("macro-primary", "macro", "Macro researcher", "Retrieve one official macro cross-check.", ["get_macro_series"], parameters={"series_id": "DGS10"}),
            _task("news-primary", "news", "Context researcher", "Retrieve one recent context set.", ["search_news"], query_variant=query),
        ])
    else:
        tasks.append(_task(
            "news-primary", "news", "Context researcher",
            "Retrieve one recent context set and keep it outside the numerical estimate.",
            ["search_news"], query_variant=query,
        ))

    if mode == InvestigationMode.DEEP:
        tasks.extend([
            _task("macro-secondary", "macro", "Dollar/liquidity researcher", "Retrieve an independent official macro series.", ["get_macro_series"], parameters={"series_id": "DTWEXBGS"}),
            _task("news-official", "news", "Official-source context researcher", "Search for official releases and primary-source reporting relevant to the deadline.", ["search_news"], query_variant=f"{query} official source release"),
        ])

    source_ids = [task.id for task in tasks]
    if mode != InvestigationMode.FAST:
        # Wave 2: deterministic analysts consume the merged source packet, not the raw prompt alone.
        tasks.extend([
            _task("analysis-relations", "relationship_mapper", "Relationship mapper", "Classify direct, duplicate, complement and proxy markets after deduplication.", ["map_market_relationships"], wave=2, depends_on=source_ids, deliver_to="review_desk"),
            _task("analysis-provenance", "source_verifier", "Provenance verifier", "Audit evidence identifiers, URLs, freshness and numeric-support flags.", ["verify_citations"], wave=2, depends_on=source_ids, deliver_to="review_desk"),
            _task("analysis-quant", "quantitative_analyst", "Quantitative analyst", "Check forecast inputs or comparable-market aggregation without allowing contextual sources to alter the number.", ["calculate_barrier_forecast"], wave=2, depends_on=source_ids, deliver_to="review_desk"),
        ])
    if mode == InvestigationMode.DEEP:
        tasks.extend([
            _task("analysis-resolution", "resolution_auditor", "Resolution-rules auditor", "Inspect resolution wording and time-window comparability before any market contributes.", ["audit_resolution_rules"], wave=2, depends_on=source_ids, deliver_to="review_desk"),
            _task("analysis-contradiction", "contradiction_reviewer", "Contradiction researcher", "Search the merged packet for conflicting signals and unsupported agreement.", ["find_contradictions"], wave=2, depends_on=source_ids, deliver_to="review_desk"),
            _task("review-evidence", "reviewer", "Independent evidence reviewer", "Independently challenge source sufficiency and citation support.", ["review_answer"], wave=3, depends_on=["analysis-provenance", "analysis-resolution"], deliver_to="manager"),
            _task("review-calibration", "reviewer", "Independent calibration reviewer", "Challenge probability calibration, uncertainty and verdict wording.", ["review_answer"], wave=3, depends_on=["analysis-quant", "analysis-contradiction"], deliver_to="manager"),
        ])
    elif mode == InvestigationMode.STANDARD:
        tasks.append(_task(
            "review-skeptic", "reviewer", "Skeptical reviewer",
            "Check that the answer is supported, calibrated and correctly labelled.",
            ["review_answer"], wave=3,
            depends_on=["analysis-relations", "analysis-provenance", "analysis-quant"], deliver_to="manager",
        ))

    return ResearchPlan(
        mode=mode,
        tasks=tasks[:budget.max_workers],
        budget=budget,
        stopping_conditions=[
            "All required workers completed or returned a visible error.",
            "Every numerical claim resolves to stored evidence.",
            "One bounded correction cycle completed.",
            "Tool, concurrency or runtime budget reached.",
        ],
        manager_provider=manager_provider,
        manager_model=manager_model,
    )
