from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "research" / "src"))

from polytrend.analytics import aggregate_markets  # noqa: E402
from polytrend.retrieval import parse_intent, relationship_map, tokens  # noqa: E402
from polytrend.seed import seed_markets  # noqa: E402

QUERIES = [
    "Will gold reach $5,000 this month?",
    "Will the U.S. enter a recession before the end of 2027?",
    "Will Bitcoin exceed $200,000 by the end of 2026?",
    "Will inflation fall below 2.5% by the end of 2026?",
]


async def run_benchmark(task_count: int, concurrency: int, inject_failure_every: int) -> dict[str, Any]:
    semaphore = asyncio.Semaphore(concurrency)
    cache: dict[str, Any] = {}
    cache_lock = asyncio.Lock()
    durations: list[float] = []
    failures = cache_hits = quality_passes = 0

    async def worker(index: int) -> None:
        nonlocal failures, cache_hits, quality_passes
        started = time.perf_counter()
        async with semaphore:
            if inject_failure_every and (index + 1) % inject_failure_every == 0:
                failures += 1
                durations.append((time.perf_counter() - started) * 1000)
                return
            query = QUERIES[index % len(QUERIES)]
            operation = index % 4
            key = f"{operation}:{query}"
            async with cache_lock:
                result = cache.get(key)
                cache_hits += int(result is not None)
            if result is None:
                if operation == 0:
                    result = parse_intent(query).model_dump(mode="json")
                elif operation == 1:
                    result = tokens(query)
                elif operation == 2:
                    result = [edge.model_dump(mode="json") for edge in relationship_map(seed_markets())]
                else:
                    result = aggregate_markets(seed_markets()).model_dump(mode="json")
                async with cache_lock:
                    cache[key] = result
            quality_passes += int(bool(result))
            durations.append((time.perf_counter() - started) * 1000)

    wall_started = time.perf_counter()
    await asyncio.gather(*(worker(index) for index in range(task_count)))
    wall_seconds = max(1e-9, time.perf_counter() - wall_started)
    completed = task_count - failures
    ordered = sorted(durations)
    return {
        "benchmark": "bounded-logical-worker-pool", "task_count": task_count,
        "max_concurrency": concurrency, "completed": completed, "failures": failures,
        "cache_hits": cache_hits, "throughput_tasks_per_second": round(task_count / wall_seconds, 2),
        "wall_time_ms": round(wall_seconds * 1000, 2),
        "latency_ms_p50": round(statistics.median(durations), 3),
        "latency_ms_p95": round(ordered[max(0, int(len(ordered) * 0.95) - 1)], 3),
        "quality_gate_pass_rate": round(quality_passes / max(1, completed), 4),
        "estimated_model_cost_usd": 0,
        "note": "Exercises real deterministic project operators; model calls and provider spend are disabled.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Poly Trend bounded worker-pool benchmark")
    parser.add_argument("--tasks", type=int, choices=[20, 40, 90], default=90)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--inject-failure-every", type=int, default=0)
    args = parser.parse_args()
    if not 1 <= args.concurrency <= 8:
        parser.error("--concurrency must be between 1 and 8")
    print(json.dumps(asyncio.run(run_benchmark(args.tasks, args.concurrency, args.inject_failure_every)), indent=2))


if __name__ == "__main__":
    main()
