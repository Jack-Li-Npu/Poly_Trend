---
name: polytrend-research
description: Investigate measurable questions with Poly Trend prediction-market evidence. Use when a user asks to search markets, inspect a market, run or revisit an investigation, compare market-implied probabilities, or explain which evidence entered an estimate.
---

# Poly Trend Research

Use the project MCP server configured in `.mcp.json`. It exposes the production research service; do not duplicate retrieval or aggregation logic in the skill.

## Workflow

1. Call `search_markets` to check whether the question has direct, resolvable market coverage.
2. Call `run_investigation` for a complete answer. Preserve the returned investigation and run identifiers.
3. Use `get_market` when resolution wording, spread, liquidity, freshness, or inclusion needs explanation.
4. Use `get_investigation` to revisit saved work.

## Evidence rules

- Describe the output as a market-implied estimate, never objective truth or financial advice.
- Only direct, duplicate, and logically complementary markets may enter the numerical estimate.
- State when an inverse outcome was re-oriented.
- Keep proxy and external context separate; they may explain disagreement but may not silently move the estimate.
- If coverage is insufficient, report that state without inventing a probability.
- Include the as-of time, market range, coverage, methodology, caveats, and evidence IDs when presenting a number.
- Never expose hidden model reasoning, provider keys, or secrets. Structured trace metadata is allowed.

## Output shape

Lead with the market-implied answer and its coverage state. Then give up to three takeaways, followed by included evidence and the most important caveat. Keep the response analytical and concise.
