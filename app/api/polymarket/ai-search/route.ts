import { NextRequest, NextResponse } from "next/server";
import { pickRelevantEvents } from "@/lib/gemini";
import type { GammaMarket, MarketData } from "@/types/polymarket";
import { getBatchPrices, parseTokenIds, formatVolume, sortAndFilterMarkets } from "@/lib/polymarket";
import fs from 'fs';
import path from 'path';

/**
 * 将精简格式转换为 MarketData，并获取最新概率
 */
async function inflateMarkets(liteMarkets: any[]): Promise<MarketData[]> {
  if (!liteMarkets || liteMarkets.length === 0) return [];

  const allTokenIds: string[] = [];
  liteMarkets.forEach(m => {
    const ids = parseTokenIds(m.clobTokenIds || '[]');
    if (ids.length > 0) allTokenIds.push(ids[0]);
  });

  const prices = await getBatchPrices(allTokenIds);

  return liteMarkets.map(m => {
    const ids = parseTokenIds(m.clobTokenIds || '[]');
    const price = ids.length > 0 ? prices[ids[0]] || 0 : 0;
    
    // 处理 outcomes，确保是数组
    let outcomes = m.outcomes;
    if (typeof outcomes === 'string') {
      try { outcomes = JSON.parse(outcomes); } catch(e) { outcomes = ["Yes", "No"]; }
    }
    if (!outcomes || !Array.isArray(outcomes)) outcomes = ["Yes", "No"];

    return {
      id: m.id,
      title: m.question || m.title,
      outcome: outcomes[0] || "Yes",
      probability: Math.round(price * 10000) / 100,
      volume: typeof m.volume === 'number' ? formatVolume(m.volume) : (m.volume || "$0"),
      chartData: [],
      image: m.image,
      slug: m.slug,
      outcomes: outcomes,
      clobTokenId: ids.length > 0 ? ids[0] : undefined,
      eventId: m.eventId,
      eventTitle: m.eventTitle,
      reasoning: m.reasoning
    };
  });
}

/**
 * 转换 GammaMarket 数组为 MarketData 数组（带实时价格）
 */
async function convertGammaToMarketData(markets: GammaMarket[]): Promise<MarketData[]> {
  return inflateMarkets(markets.map((m: any) => ({
    id: m.id,
    question: m.question,
    clobTokenIds: m.clobTokenIds,
    volume: m.volume,
    image: m.image,
    slug: m.eventSlug || m.slug,
    outcomes: m.outcomes,
    eventId: m.eventId,
    eventTitle: m.eventTitle
  })));
}

/**
 * 保存搜索结果到本地文件
 */
async function saveSearchResults(query: string, markets: MarketData[]) {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `search-${timestamp}.json`;
  const searchResultsDir = path.join(process.cwd(), 'search-results');
  
  try {
    await fs.mkdir(searchResultsDir, { recursive: true });
  } catch (e) {}
  
  const filepath = path.join(searchResultsDir, filename);
  const data = {
    query,
    timestamp: new Date().toISOString(),
    totalResults: markets.length,
    markets,
  };
  
  try {
    await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
    return filepath;
  } catch (error: any) {
    if (error.code === 'EROFS') {
      console.warn(`⚠️ Cannot save search results to filesystem on Vercel (EROFS). Skipping file save.`);
      return null;
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, geminiKey, geminiBaseUrl } = body;

    if (!query || typeof query !== "string" || query.trim() === "") {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    console.log(`[AI-SEARCH] Received geminiKey: ${geminiKey ? 'Present' : 'MISSING'}, geminiBaseUrl: ${geminiBaseUrl || 'Default'}`);

    const searchQuery = query.trim();
    
    // 设置 Gemini API 环境
    if (geminiKey) {
      process.env.GEMINI_API_KEY = geminiKey;
    }
    if (geminiBaseUrl) {
      process.env.GEMINI_BASE_URL = geminiBaseUrl;
    }
    console.log(`\n🚀 ========== Starting new search strategy (local selection) ==========`);
    console.log(`Query: "${searchQuery}"`);

    // 1. 获取直接搜索结果
    let directSearchMarkets: GammaMarket[] = [];
    let directSearchTags: any[] = [];
    try {
      const { searchMarkets } = await import("@/lib/polymarket");
      const { getCachedTags } = await import("@/lib/tag-cache");
      const directResults = await searchMarkets(searchQuery);
      directSearchMarkets = directResults.slice(0, 50);
      
      const allTags = await getCachedTags();
      const searchLower = searchQuery.toLowerCase();
      directSearchTags = allTags
        .filter(tag => tag.label.toLowerCase().includes(searchLower) || searchLower.includes(tag.label.toLowerCase()))
        .slice(0, 3);
    } catch (error) {
      console.warn("❌ Direct search failed:", error);
    }

    // 2. 获取相关 Tags 并缓存
    let validTagsUsed: any[] = [];
    let tagMarketsDataCache: Record<string, MarketData[]> = {};
    try {
      console.log(`\n🔍 ========== Starting original tag search flow ==========`);
      const { getCachedTags } = await import("@/lib/tag-cache");
      const { findRelevantTags } = await import("@/lib/gemini");
      const { getEventsByTag } = await import("@/lib/polymarket");
      const { filterDeadTags, markTagAsDead } = await import("@/lib/dead-tags");
      
      const allTags = await getCachedTags();
      // 过滤掉本地维护的无活跃市场标签
      const activeTagsOnly = filterDeadTags(allTags);
      
      console.log(`✅ Tag library loaded, total ${allTags.length} tags (${activeTagsOnly.length} remaining after filtering)`);
      
      if (activeTagsOnly.length > 0) {
        console.log(`🤖 Calling Gemini to match relevant tags...`);
        const relevantTagIndices = await findRelevantTags(searchQuery, activeTagsOnly, 15);
        const candidateTags = relevantTagIndices.map(idx => activeTagsOnly[idx]).filter(Boolean);
        console.log(`✅ Gemini matched ${candidateTags.length} candidate tags: ${candidateTags.map(t => t.label).join(', ')}`);

        for (const tag of candidateTags) {
          if (validTagsUsed.length >= 8) break;
          console.log(`🔄 Fetching markets for tag "${tag.label}" (${tag.id})...`);
          const events = await getEventsByTag(tag.id, 50);
          const markets: GammaMarket[] = [];
          events.forEach(event => {
            if (event.markets && Array.isArray(event.markets)) {
              markets.push(...event.markets.filter(m => m.active && !m.closed && m.enableOrderBook).map(m => ({ ...m, eventSlug: event.slug })));
            }
          });

          if (markets.length > 0) {
            tagMarketsDataCache[tag.id] = await convertGammaToMarketData(markets.slice(0, 30));
            validTagsUsed.push(tag);
            console.log(`   ✅ Tag "${tag.label}" is valid, contains ${tagMarketsDataCache[tag.id].length} markets`);
          } else {
            console.log(`   ⚠️ Tag "${tag.label}" has no active markets, marking as dead and skipping`);
            markTagAsDead(tag.id);
          }
        }
      } else {
        console.warn("⚠️ Warning: Tag library is empty or has no valid tags, unable to perform tag matching");
      }
      console.log(`✅ Original tag search complete, final selection: ${validTagsUsed.length} tags`);
      console.log(`==========================================\n`);
    } catch (error) {
      console.warn("❌ Tag search failed:", error);
    }

    // 3. 转换直接搜索结果
    const marketData = await convertGammaToMarketData(directSearchMarkets);

    // 4. 执行本地语义精选（三大类）
    let semanticGroupsData: Array<{ dimension: string; markets: MarketData[] }> = [];
    let semanticMatchMarkets: MarketData[] = [];
    try {
      console.log(`🧠 Executing local semantic selection...`);
      const dataPath = path.join(process.cwd(), 'data', 'categorized-events.json');
      if (fs.existsSync(dataPath)) {
        const allCategorized: any[] = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
        const categories = ['Live Crypto', 'politics', 'middle east', 'crypto', 'sports', 'pop culture', 'tech', 'ai'];
        
        const picksPromises = categories.map(async (cat) => {
          const pool = allCategorized.filter(e => e.category === cat);
          console.log(`   - Filtering markets for dimension [${cat}] (pool size: ${pool.length})...`);
          
          if (pool.length === 0) return { dimension: cat, markets: [] };
          
          const relevantPicks = await pickRelevantEvents(searchQuery, pool, 50, cat);
          console.log(`   - Dimension [${cat}] matched ${relevantPicks.length} relevant events`);
          
          const relevantIds = relevantPicks.map(p => p.id);
          const reasoningMap = new Map(relevantPicks.map(p => [p.id, p.reasoning]));
          
          // 获取这些事件的详细数据，包括 markets
          const { getEventsByIds } = await import("@/lib/polymarket");
          const fullEvents = await getEventsByIds(relevantIds);
          
          // 从每个事件中提取成交量最大的市场
          const liteMarkets = fullEvents.map(event => {
            if (!event.markets || !Array.isArray(event.markets)) return null;
            const validMarkets = event.markets.filter((m: any) => m.active && !m.closed && m.enableOrderBook);
            if (validMarkets.length === 0) return null;
            const topMarket = validMarkets.sort((a: any, b: any) => (b.volume || 0) - (a.volume || 0))[0];
            return {
              ...topMarket,
              eventSlug: event.slug,
              eventTitle: event.title,
              reasoning: reasoningMap.get(event.id)
            };
          }).filter(Boolean);

          const markets = await inflateMarkets(liteMarkets);
          
          return { dimension: cat, markets };
        });
        
        semanticGroupsData = await Promise.all(picksPromises);
        semanticMatchMarkets = semanticGroupsData.flatMap(g => g.markets);
        
        // 重新构建有效标签列表，确保顺序：硬匹配 -> 各大精选 -> 原始标签
        const hardMatchTag = { id: 'smart-search', label: 'Hard Match' };
        const pickTags = categories.map(cat => ({ id: `semantic-${cat}`, label: `${cat}` }));
        
        // 原始标签（Step 2 中找到的）
        const originalTags = validTagsUsed;
        
        validTagsUsed = [
          hardMatchTag,
          ...pickTags,
          ...originalTags
        ];
        
        // 缓存语义匹配总览 + 分类结果
        tagMarketsDataCache['smart-search'] = marketData;
        semanticGroupsData.forEach(g => {
          tagMarketsDataCache[`semantic-${g.dimension}`] = g.markets;
        });
      }
    } catch (error) {
      console.warn("❌ Local semantic filtering failed:", error);
    }

    // 构建全量相关数据供 AI 分析
    const allUniqueMarketsMap = new Map<string, MarketData>();
    marketData.forEach(m => allUniqueMarketsMap.set(m.id, m));
    semanticGroupsData.forEach(g => g.markets.forEach(m => allUniqueMarketsMap.set(m.id, m)));
    Object.values(tagMarketsDataCache).forEach(markets => markets.forEach(m => allUniqueMarketsMap.set(m.id, m)));
    const allRelevantMarkets = Array.from(allUniqueMarketsMap.values());

    return NextResponse.json({
      markets: marketData,
      allRelevantMarkets,
      source: 'hybrid',
      message: `Found ${marketData.length} direct results and multi-dimensional selections`,
      suggestedQueries: validTagsUsed.map(t => t.label).slice(0, 3),
      tagsUsed: validTagsUsed,
      tagMarketsCache: tagMarketsDataCache,
      semanticGroups: semanticGroupsData,
      directSearchTags: directSearchTags.length > 0 ? directSearchTags : undefined,
    });

  } catch (error) {
    console.error("AI search API error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, { status: 500 });
  }
}
