/**
 * Hybrid Search - combines Hard Match (direct Polymarket search) + Consortium (semantic AI results)
 * Requires GEMINI_API_KEY in process.env
 */

import fs from "fs";
import path from "path";
import { pickRelevantEvents } from "@/lib/gemini";
import type { GammaMarket, MarketData } from "@/types/polymarket";
import {
  searchMarkets,
  getEventsByTag,
  getEventsByIds,
} from "@/lib/polymarket";
import { getCachedTags } from "@/lib/tag-cache";
import { filterDeadTags, markTagAsDead } from "@/lib/dead-tags";

async function inflateMarkets(liteMarkets: any[]): Promise<MarketData[]> {
  if (!liteMarkets || liteMarkets.length === 0) return [];
  const { parseTokenIds, getBatchPrices, formatVolume } = await import(
    "@/lib/polymarket"
  );
  const allTokenIds: string[] = [];
  liteMarkets.forEach((m) => {
    const ids = parseTokenIds(m.clobTokenIds || "[]");
    if (ids.length > 0) allTokenIds.push(ids[0]);
  });
  const prices = await getBatchPrices(allTokenIds);

  return liteMarkets.map((m) => {
    const ids = parseTokenIds(m.clobTokenIds || "[]");
    const price = ids.length > 0 ? prices[ids[0]] || 0 : 0;
    let outcomes = m.outcomes;
    if (typeof outcomes === "string") {
      try {
        outcomes = JSON.parse(outcomes);
      } catch {
        outcomes = ["Yes", "No"];
      }
    }
    if (!outcomes || !Array.isArray(outcomes)) outcomes = ["Yes", "No"];
    return {
      id: m.id,
      title: m.question || m.title,
      outcome: outcomes[0] || "Yes",
      probability: Math.round(price * 10000) / 100,
      volume:
        typeof m.volume === "number" ? formatVolume(m.volume) : (m.volume || "$0"),
      chartData: [],
      image: m.image,
      slug: m.eventSlug || m.slug,
      outcomes,
      clobTokenId: ids.length > 0 ? ids[0] : undefined,
      eventId: m.eventId,
      eventTitle: m.eventTitle,
      reasoning: m.reasoning,
    };
  });
}

async function convertGammaToMarketData(
  markets: GammaMarket[]
): Promise<MarketData[]> {
  return inflateMarkets(
    markets.map((m: any) => ({
      id: m.id,
      question: m.question,
      clobTokenIds: m.clobTokenIds,
      volume: m.volume,
      image: m.image,
      slug: m.eventSlug || m.slug,
      outcomes: m.outcomes,
      eventId: m.eventId,
      eventTitle: m.eventTitle,
    }))
  );
}

export interface HybridSearchResult {
  hardMatch: MarketData[];
  consortium: {
    semanticGroups: Array<{ dimension: string; markets: MarketData[] }>;
    tagMarkets: Record<string, MarketData[]>;
    tagsUsed: Array<{ id: string; label: string }>;
  };
  allRelevantMarkets: MarketData[];
  directSearchTags?: Array<{ id: string; label: string }>;
}

export async function runHybridSearch(
  query: string
): Promise<HybridSearchResult> {
  const searchQuery = query.trim();

  // 1. Hard match - direct Polymarket search
  let directSearchMarkets: GammaMarket[] = [];
  let directSearchTags: Array<{ id: string; label: string }> = [];
  try {
    const directResults = await searchMarkets(searchQuery);
    directSearchMarkets = directResults.slice(0, 50);
    const allTags = await getCachedTags();
    const searchLower = searchQuery.toLowerCase();
    directSearchTags = allTags
      .filter(
        (tag) =>
          tag.label.toLowerCase().includes(searchLower) ||
          searchLower.includes(tag.label.toLowerCase())
      )
      .slice(0, 3)
      .map((t) => ({ id: t.id, label: t.label }));
  } catch (error) {
    console.warn("HybridSearch: Direct search failed", error);
  }

  const hardMatch = await convertGammaToMarketData(directSearchMarkets);

  // 2. Tag-based consortium
  let validTagsUsed: Array<{ id: string; label: string }> = [];
  const tagMarketsDataCache: Record<string, MarketData[]> = {};
  try {
    const { findRelevantTags } = await import("@/lib/gemini");
    const allTags = await getCachedTags();
    const activeTagsOnly = filterDeadTags(allTags);

    if (activeTagsOnly.length > 0) {
      const relevantTagIndices = await findRelevantTags(
        searchQuery,
        activeTagsOnly,
        15
      );
      const candidateTags = relevantTagIndices
        .map((idx) => activeTagsOnly[idx])
        .filter(Boolean);

      for (const tag of candidateTags) {
        if (validTagsUsed.length >= 8) break;
        const events = await getEventsByTag(tag.id, 50);
        const markets: GammaMarket[] = [];
        events.forEach((event) => {
          if (event.markets && Array.isArray(event.markets)) {
            markets.push(
              ...event.markets
                .filter((m) => m.active && !m.closed && m.enableOrderBook)
                .map((m) => ({ ...m, eventSlug: event.slug }))
            );
          }
        });

        if (markets.length > 0) {
          tagMarketsDataCache[tag.id] = await convertGammaToMarketData(
            markets.slice(0, 30)
          );
          validTagsUsed.push({ id: tag.id, label: tag.label });
        } else {
          markTagAsDead(tag.id);
        }
      }
    }
  } catch (error) {
    console.warn("HybridSearch: Tag search failed", error);
  }

  // 3. Semantic consortium (categorized-events.json)
  let semanticGroupsData: Array<{
    dimension: string;
    markets: MarketData[];
  }> = [];
  const categories = [
    "Live Crypto",
    "politics",
    "middle east",
    "crypto",
    "sports",
    "pop culture",
    "tech",
    "ai",
  ];

  try {
    const dataPath = path.join(process.cwd(), "data", "categorized-events.json");
    if (fs.existsSync(dataPath)) {
      const allCategorized: any[] = JSON.parse(
        fs.readFileSync(dataPath, "utf-8")
      );

      const picksPromises = categories.map(async (cat) => {
        const pool = allCategorized.filter((e) => e.category === cat);
        if (pool.length === 0) return { dimension: cat, markets: [] };

        const relevantPicks = await pickRelevantEvents(
          searchQuery,
          pool,
          50,
          cat
        );
        const relevantIds = relevantPicks.map((p) => p.id);
        const reasoningMap = new Map(
          relevantPicks.map((p) => [p.id, p.reasoning])
        );

        const fullEvents = await getEventsByIds(relevantIds);
        const liteMarkets = fullEvents
          .map((event) => {
            if (!event.markets || !Array.isArray(event.markets)) return null;
            const validMarkets = event.markets.filter(
              (m: any) => m.active && !m.closed && m.enableOrderBook
            );
            if (validMarkets.length === 0) return null;
            const topMarket = validMarkets.sort(
              (a: any, b: any) => (b.volume || 0) - (a.volume || 0)
            )[0];
            return {
              ...topMarket,
              eventSlug: event.slug,
              eventTitle: event.title,
              reasoning: reasoningMap.get(event.id),
            };
          })
          .filter(Boolean);

        const markets = await inflateMarkets(liteMarkets);
        return { dimension: cat, markets };
      });

      semanticGroupsData = await Promise.all(picksPromises);

      // Merge into tagMarketsDataCache
      tagMarketsDataCache["smart-search"] = hardMatch;
      semanticGroupsData.forEach((g) => {
        tagMarketsDataCache[`semantic-${g.dimension}`] = g.markets;
      });

      validTagsUsed = [
        { id: "smart-search", label: "Hard Match" },
        ...categories.map((cat) => ({
          id: `semantic-${cat}`,
          label: cat,
        })),
        ...validTagsUsed,
      ];
    }
  } catch (error) {
    console.warn("HybridSearch: Semantic selection failed", error);
  }

  const allUniqueMarketsMap = new Map<string, MarketData>();
  hardMatch.forEach((m) => allUniqueMarketsMap.set(m.id, m));
  semanticGroupsData.forEach((g) =>
    g.markets.forEach((m) => allUniqueMarketsMap.set(m.id, m))
  );
  Object.values(tagMarketsDataCache).forEach((markets) =>
    markets.forEach((m) => allUniqueMarketsMap.set(m.id, m))
  );
  const allRelevantMarkets = Array.from(allUniqueMarketsMap.values());

  return {
    hardMatch,
    consortium: {
      semanticGroups: semanticGroupsData,
      tagMarkets: tagMarketsDataCache,
      tagsUsed: validTagsUsed,
    },
    allRelevantMarkets,
    directSearchTags:
      directSearchTags.length > 0 ? directSearchTags : undefined,
  };
}
