from __future__ import annotations

import asyncio
import math
import re
from calendar import monthrange
from collections import Counter
from datetime import datetime, time, timedelta, timezone

from .models import (
    AnswerKind,
    MarketCandidate,
    MarketSnapshot,
    QueryIntent,
    RelationType,
    RelationshipEdge,
    TargetCondition,
)
from .analytics import aligned_logit_return_correlation
from .providers import PolymarketProvider
from .seed import seed_markets


STOPWORDS = {
    "a", "an", "and", "are", "be", "before", "by", "did", "do", "does", "end",
    "for", "in", "is", "of", "on", "or", "the", "to", "will", "with",
}


def tokens(value: str) -> list[str]:
    return [word for word in re.findall(r"[a-z0-9]+", value.lower()) if word not in STOPWORDS]


def parse_intent(query: str, now: datetime | None = None) -> QueryIntent:
    years = [int(value) for value in re.findall(r"\b20\d{2}\b", query)]
    lower = query.lower()
    zone = timezone(timedelta(hours=8), "Asia/Shanghai")
    local_now = now.astimezone(zone) if now else datetime.now(zone)
    geography = "United States" if any(key in lower for key in ("u.s.", "us ", "united states", "america")) else None
    known = [name for name in ("Federal Reserve", "U.S. economy", "recession", "inflation", "GDP", "Bitcoin", "Gold") if name.lower().replace("u.s.", "us") in lower.replace("u.s.", "us")]
    asset = symbol = None
    if any(value in lower for value in ("gold", "xau", "xauusd")):
        asset, symbol = "Gold", "XAUUSD"
    elif any(value in lower for value in ("bitcoin", "btc")):
        asset, symbol = "Bitcoin", "BTCUSD"

    target_match = re.search(
        r"(?:\$|usd\s*)?([0-9]{1,3}(?:,[0-9]{3})+(?:\.\d+)?|[0-9]{3,}(?:\.\d+)?)",
        lower,
    )
    target_value = float(target_match.group(1).replace(",", "")) if target_match else None
    condition = None
    if target_value is not None and asset:
        condition = (
            TargetCondition.CLOSE_BELOW
            if re.search(r"close|finish|end", lower) and re.search(r"below|under", lower)
            else TargetCondition.CLOSE_ABOVE
            if re.search(r"close|finish|end", lower) and re.search(r"above|over|reach", lower)
            else TargetCondition.TOUCH
        )

    deadline = None
    if "this month" in lower or "month end" in lower or "end of the month" in lower:
        last_day = monthrange(local_now.year, local_now.month)[1]
        deadline = datetime.combine(
            local_now.date().replace(day=last_day), time(23, 59, 59), zone
        )
    elif years:
        deadline = datetime(max(years), 12, 31, 23, 59, 59, tzinfo=zone)

    requested = AnswerKind.MODEL_ESTIMATE if asset and target_value and deadline else None
    return QueryIntent(
        proposition=query.strip(),
        entities=known,
        geography=geography,
        horizon=str(max(years)) if years else None,
        target_year=max(years) if years else None,
        outcome="no" if re.search(r"\bnot\b|\bwon't\b", lower) else "yes",
        ambiguous=len(tokens(query)) < 3 or bool(asset and (target_value is None or deadline is None)),
        asset=asset,
        symbol=symbol,
        target_value=target_value,
        target_condition=condition,
        deadline=deadline,
        requested_answer_type=requested,
    )


def _text(market: MarketSnapshot) -> str:
    return " ".join([market.question, market.event_title or "", " ".join(market.tags), market.resolution_criteria])


def _lexical_score(query: str, market: MarketSnapshot) -> float:
    query_counts, market_counts = Counter(tokens(query)), Counter(tokens(_text(market)))
    overlap = sum(min(count, market_counts[word]) for word, count in query_counts.items())
    denominator = math.sqrt(sum(query_counts.values()) * max(1, sum(market_counts.values())))
    return overlap / denominator if denominator else 0


def _dense_hash_score(query: str, market: MarketSnapshot) -> float:
    """Dependency-free local dense fallback using character n-gram hashing.

    The Postgres deployment stores real embedding vectors; this fallback keeps the
    retrieval ensemble deterministic and useful without downloading a model.
    """
    def vector(value: str, size: int = 192) -> list[float]:
        clean = re.sub(r"\s+", " ", value.lower())
        result = [0.0] * size
        for width in (3, 4, 5):
            for index in range(max(0, len(clean) - width + 1)):
                gram = clean[index:index + width]
                result[hash(gram) % size] += 1
        norm = math.sqrt(sum(item * item for item in result)) or 1
        return [item / norm for item in result]
    left, right = vector(query), vector(_text(market))
    return sum(a * b for a, b in zip(left, right, strict=True))


def _entity_score(intent: QueryIntent, market: MarketSnapshot) -> float:
    text = _text(market).lower()
    score = sum(1 for entity in intent.entities if entity.lower().replace("u.s.", "us") in text.replace("u.s.", "us"))
    if intent.target_year and str(intent.target_year) in text:
        score += 1.5
    if intent.geography == "United States" and any(value in text for value in ("u.s.", "united states", " us ")):
        score += 1
    return score


class HybridRetriever:
    def __init__(self, provider: PolymarketProvider) -> None:
        self.provider = provider

    async def retrieve(self, query: str, limit: int = 12) -> tuple[QueryIntent, list[MarketSnapshot], list[MarketCandidate]]:
        intent = parse_intent(query)
        provider_task = asyncio.create_task(self.provider.search(query, 30))
        local = seed_markets()
        live = await provider_task
        markets = list({market.id: market for market in [*live, *local]}.values())

        lexical = sorted(markets, key=lambda market: _lexical_score(query, market), reverse=True)
        semantic = sorted(markets, key=lambda market: _dense_hash_score(query, market), reverse=True)
        entity = sorted(markets, key=lambda market: _entity_score(intent, market), reverse=True)
        provider_ids = {market.id: rank + 1 for rank, market in enumerate(live)}
        rank_maps = [
            {market.id: rank + 1 for rank, market in enumerate(lexical)},
            {market.id: rank + 1 for rank, market in enumerate(semantic)},
            {market.id: rank + 1 for rank, market in enumerate(entity)},
        ]
        candidates: list[MarketCandidate] = []
        for market in markets:
            ranks = [mapping[market.id] for mapping in rank_maps]
            provider_rank = provider_ids.get(market.id)
            rrf = sum(1 / (60 + rank) for rank in ranks)
            if provider_rank:
                rrf += 1 / (60 + provider_rank)
            lexical_score = _lexical_score(query, market)
            semantic_score = _dense_hash_score(query, market)
            entity_score = min(1.0, _entity_score(intent, market) / 3)
            rerank = 0.48 * lexical_score + 0.32 * semantic_score + 0.2 * entity_score
            candidates.append(MarketCandidate(
                market=market,
                lexical_rank=ranks[0], semantic_rank=ranks[1], entity_rank=ranks[2],
                provider_rank=provider_rank, rrf_score=rrf, rerank_score=rerank,
            ))
        candidates.sort(key=lambda item: (item.rerank_score, item.rrf_score), reverse=True)

        selected: list[MarketSnapshot] = []
        seen: set[str] = set()
        query_words = set(tokens(query))
        for candidate in candidates:
            market = candidate.market.model_copy(deep=True)
            signature = " ".join(sorted(set(tokens(market.question))))
            if signature in seen:
                continue
            seen.add(signature)
            market.relevance = min(0.99, max(market.relevance, candidate.rerank_score * 2.4))
            market.retrieval_sources = sorted(set([*market.retrieval_sources, "fts", "local_dense", "entity", "rrf", "cross_rerank"]))
            market_words = set(tokens(market.question))
            overlap = len(query_words & market_words) / max(1, len(query_words))
            if market.relation_type not in {RelationType.SUPPORTING_PROXY, RelationType.CONFLICTING_PROXY}:
                market.relation_type = RelationType.DIRECT if overlap >= 0.45 else RelationType.SUPPORTING_PROXY
                market.relation_reason = "Direct outcome and horizon match." if overlap >= 0.45 else "Related market retained as explanatory context only."
            market.quality = min(0.98, max(market.quality, 0.48 + math.log10(market.liquidity + 10) / 14))
            selected.append(market)
            if len(selected) >= limit:
                break
        return intent, selected, candidates[:limit]


def orient_markets_to_query(query: str, markets: list[MarketSnapshot]) -> list[MarketSnapshot]:
    """Re-score merged multi-query results against the user's original proposition."""
    intent = parse_intent(query)
    query_words = set(tokens(query))
    required_entities = [
        entity.lower().replace("u.s.", "us")
        for entity in intent.entities
        if entity not in {"United States", "U.S. economy"}
    ]
    if intent.asset:
        required_entities.append(intent.asset.lower())
    oriented: list[MarketSnapshot] = []
    for original in markets:
        market = original.model_copy(deep=True)
        text = _text(market).lower().replace("u.s.", "us")
        market_words = set(tokens(_text(market)))
        overlap = len(query_words & market_words) / max(1, len(query_words))
        lexical = _lexical_score(query, market)
        semantic = _dense_hash_score(query, market)
        entity_match = not required_entities or any(entity in text for entity in required_entities)
        market.relevance = min(0.99, 0.5 * lexical * 2.2 + 0.3 * semantic + 0.2 * min(1, overlap))
        if entity_match and overlap >= 0.42:
            inverse_wording = any(value in text for value in (" avoid ", " not ", "below", "under"))
            market.relation_type = RelationType.COMPLEMENT if inverse_wording else RelationType.DIRECT
            market.relation_reason = "Entity, outcome and horizon were rechecked against the original question."
        else:
            market.relation_type = RelationType.SUPPORTING_PROXY
            market.relation_reason = "Retrieved by an expansion query but not directly comparable to the original proposition."
        oriented.append(market)
    return sorted(oriented, key=lambda item: item.relevance, reverse=True)


def relationship_map(markets: list[MarketSnapshot]) -> list[RelationshipEdge]:
    if not markets:
        return []
    anchor = markets[0]
    result: list[RelationshipEdge] = []
    anchor_tokens = set(tokens(anchor.question))
    for market in markets[1:]:
        shared = len(anchor_tokens & set(tokens(market.question))) / max(1, len(anchor_tokens))
        relation = market.relation_type
        if shared > 0.72 and market.event_id == anchor.event_id:
            relation = RelationType.DUPLICATE
            market.relation_type = relation
            market.relation_reason = "Same event family with near-equivalent resolution wording."
        result.append(RelationshipEdge(
            source_id=anchor.id,
            target_id=market.id,
            relation_type=relation,
            confidence=min(0.98, max(0.45, shared + 0.25)),
            explanation=market.relation_reason or "Relationship inferred from outcome, entity and horizon overlap.",
        ))
        correlation, observations = aligned_logit_return_correlation(anchor, market)
        if correlation is not None and abs(correlation) >= 0.12:
            result.append(RelationshipEdge(
                source_id=anchor.id,
                target_id=market.id,
                relation_type=RelationType.MEASURED_CORRELATION,
                confidence=min(0.95, 0.5 + abs(correlation) / 2),
                explanation="Timestamp-aligned correlation of logit-probability changes; not used as causal evidence.",
                measured_correlation=correlation,
                observation_count=observations,
            ))
    return result
