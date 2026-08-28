from __future__ import annotations

import asyncio
import json
import math
import os
import sys
from pathlib import Path
from statistics import fmean
from time import perf_counter

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "research" / "src"))
os.environ.setdefault("POLYTREND_LIVE_MARKET_DATA", "false")

from polytrend.config import settings  # noqa: E402
from polytrend.providers import PolymarketProvider  # noqa: E402
from polytrend.retrieval import HybridRetriever, _lexical_score  # noqa: E402
from polytrend.seed import seed_markets  # noqa: E402
from validate_dataset import load_dataset, validate  # noqa: E402


def recall_at_k(ranked: list[str], relevant: set[str], k: int = 10) -> float:
    return len(set(ranked[:k]) & relevant) / len(relevant)


def ndcg_at_k(ranked: list[str], relevant: set[str], k: int = 10) -> float:
    dcg = sum(1 / math.log2(index + 2) for index, item in enumerate(ranked[:k]) if item in relevant)
    ideal = sum(1 / math.log2(index + 2) for index in range(min(k, len(relevant))))
    return dcg / ideal if ideal else 0


async def evaluate() -> dict[str, float | int | str]:
    records = load_dataset()
    validate(records)
    retriever = HybridRetriever(PolymarketProvider(settings))
    baseline_recall: list[float] = []
    baseline_ndcg: list[float] = []
    reranked_recall: list[float] = []
    reranked_ndcg: list[float] = []
    latency_ms: list[float] = []

    for record in records:
        query = record["query"]
        relevant = set(record["relevant_market_ids"])
        baseline = [market.id for market in sorted(seed_markets(), key=lambda item: _lexical_score(query, item), reverse=True)]
        started = perf_counter()
        _, markets, _ = await retriever.retrieve(query, limit=10)
        latency_ms.append((perf_counter() - started) * 1000)
        reranked = [market.id for market in markets]
        baseline_recall.append(recall_at_k(baseline, relevant))
        baseline_ndcg.append(ndcg_at_k(baseline, relevant))
        reranked_recall.append(recall_at_k(reranked, relevant))
        reranked_ndcg.append(ndcg_at_k(reranked, relevant))

    baseline_score = fmean(baseline_ndcg)
    reranker_score = fmean(reranked_ndcg)
    return {
        "questions": len(records),
        "baseline": "legacy lexical/Gamma-style discovery",
        "baseline_recall_at_10": round(fmean(baseline_recall), 4),
        "baseline_ndcg_at_10": round(baseline_score, 4),
        "hybrid_recall_at_10": round(fmean(reranked_recall), 4),
        "hybrid_ndcg_at_10": round(reranker_score, 4),
        "reranker_ndcg_lift": round(reranker_score - baseline_score, 4),
        "mean_latency_ms": round(fmean(latency_ms), 2),
        "model_cost_usd": 0.0,
    }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(evaluate()), indent=2))
