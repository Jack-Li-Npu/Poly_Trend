from __future__ import annotations

import json
from pathlib import Path
from typing import Any


DATASET_PATH = Path(__file__).with_name("queries.jsonl")


def load_dataset(path: Path = DATASET_PATH) -> list[dict[str, Any]]:
    records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    return records


def validate(records: list[dict[str, Any]]) -> None:
    if len(records) < 50:
        raise ValueError(f"retrieval benchmark needs at least 50 questions; found {len(records)}")
    identifiers: set[str] = set()
    queries: set[str] = set()
    for index, record in enumerate(records, start=1):
        missing = {"id", "query", "relevant_market_ids", "category"} - record.keys()
        if missing:
            raise ValueError(f"row {index} is missing {sorted(missing)}")
        if record["id"] in identifiers or record["query"].lower() in queries:
            raise ValueError(f"row {index} is not unique")
        if not isinstance(record["relevant_market_ids"], list) or not record["relevant_market_ids"]:
            raise ValueError(f"row {index} has no relevance labels")
        identifiers.add(record["id"])
        queries.add(record["query"].lower())


if __name__ == "__main__":
    dataset = load_dataset()
    validate(dataset)
    categories = sorted({item["category"] for item in dataset})
    print(f"Validated {len(dataset)} labelled questions across {len(categories)} categories.")
