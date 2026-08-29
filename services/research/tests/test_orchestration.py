from polytrend.adaptive_graph import BUDGETS
from polytrend.models import InvestigationMode
from polytrend.orchestration import build_research_plan
from polytrend.retrieval import parse_intent


QUERY = "Will gold reach 5000 this month?"


def plan(mode: InvestigationMode):
    return build_research_plan(
        QUERY, parse_intent(QUERY), mode, BUDGETS[mode], "deterministic", "manager-policy-v1"
    )


def test_modes_execute_distinct_amounts_of_real_work() -> None:
    fast, standard, deep = plan(InvestigationMode.FAST), plan(InvestigationMode.STANDARD), plan(InvestigationMode.DEEP)
    assert len(fast.tasks) == 3
    assert len(standard.tasks) >= 9
    assert len(deep.tasks) >= 17
    assert len(fast.tasks) < len(standard.tasks) < len(deep.tasks)
    assert not any(task.wave == 2 for task in fast.tasks)
    assert any(task.wave == 2 for task in standard.tasks)
    assert sum(task.wave == 3 for task in standard.tasks) == 1
    assert sum(task.wave == 3 for task in deep.tasks) == 2


def test_deep_mode_uses_independent_market_queries_and_audits() -> None:
    deep = plan(InvestigationMode.DEEP)
    market_queries = [task.query_variant for task in deep.tasks if task.worker_type == "prediction_market"]
    assert len(market_queries) == 5
    assert len(set(market_queries)) == 5
    assert {"resolution_auditor", "contradiction_reviewer", "source_verifier"}.issubset(
        {task.worker_type for task in deep.tasks}
    )
    assert all(task.agent_name and task.success_criteria for task in deep.tasks)
