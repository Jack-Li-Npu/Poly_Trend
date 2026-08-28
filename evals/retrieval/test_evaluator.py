from __future__ import annotations

import importlib.util
from pathlib import Path


HERE = Path(__file__).parent


def _module(name: str):
    spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_dataset_has_fifty_unique_labelled_questions() -> None:
    validator = _module("validate_dataset")
    records = validator.load_dataset()
    validator.validate(records)
    assert len(records) == 50


def test_ranking_metrics() -> None:
    evaluator = _module("evaluate")
    ranked = ["a", "x", "b", "c"]
    relevant = {"a", "b"}
    assert evaluator.recall_at_k(ranked, relevant, 3) == 1
    assert 0 < evaluator.ndcg_at_k(ranked, relevant, 3) <= 1
