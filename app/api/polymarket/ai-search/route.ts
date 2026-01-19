import { NextRequest, NextResponse } from "next/server";
import { getCachedMarkets } from "@/lib/market-cache";
import { findRelevantMarkets } from "@/lib/gemini";
import type { GammaMarket, MarketData } from "@/types/polymarket";
import { getBatchPrices, parseTokenIds, formatVolume, sortAndFilterMarkets } from "@/lib/polymarket";
import { smartSearch } from "@/lib/smart-search";
import { searchByTags } from "@/lib/tag-search";

/**
 * 将GammaMarket转换为MarketData
 */
async function convertToMarketData(markets: GammaMarket[]): Promise<MarketData[]> {
  if (markets.length === 0) {
    return [];
  }

  // 解析所有token IDs
  const tokenIdMap = new Map<string, string>(); // marketId -> yesTokenId
  const allTokenIds: string[] = [];

  markets.forEach((market) => {
    const tokenIds = parseTokenIds(market.clobTokenIds);
    if (tokenIds.length > 0) {
      const yesTokenId = tokenIds[0];
      tokenIdMap.set(market.id, yesTokenId);
      allTokenIds.push(yesTokenId);
    }
  });

  // 批量获取价格
  const prices = await getBatchPrices(allTokenIds);

  // 转换为MarketData格式
  return markets.map((market) => {
    const yesTokenId = tokenIdMap.get(market.id);
    const price = yesTokenId ? prices[yesTokenId] || 0 : 0;
    const probability = price * 100;

    // 确保volume是数字类型
    const volumeNum = typeof market.volume === 'string' ? parseFloat(market.volume) : (market.volume || 0);
    
    // 解析 outcomes
    let outcomes: string[] = ["Yes", "No"]; // 默认值
    if (market.outcomes) {
      try {
        const parsed = JSON.parse(market.outcomes);
        if (Array.isArray(parsed)) {
          outcomes = parsed;
        }
      } catch (e) {
        // 保持默认值
      }
    }
    
    return {
      id: market.id,
      title: market.question,
      outcome: outcomes[0] || "Yes",
      probability: Math.round(probability * 100) / 100,
      volume: formatVolume(volumeNum),
      chartData: [], // AI搜索不获取图表数据以加快速度
      image: market.image || undefined,
      slug: market.eventSlug || market.slug, // 优先使用 eventSlug
      outcomes: outcomes,
    };
  });
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
  
  // 确保目录存在
  try {
    await fs.mkdir(searchResultsDir, { recursive: true });
  } catch (e) {
    // 目录已存在
  }
  
  const filepath = path.join(searchResultsDir, filename);
  const data = {
    query,
    timestamp: new Date().toISOString(),
    totalResults: markets.length,
    markets,
  };
  
  await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`Search results saved to: ${filepath}`);
  
  return filepath;
}

/**
 * AI搜索路由 - 新策略
 * 1. Public search 直接结果至少 50 个
 * 2. Gemini 找 10 个强相关 tags
 * 3. 每个 tag 获取市场（自动fallback到下一个tag如果为空）
 * 4. 缓存所有tag的市场数据，点击时快速加载
 * 5. 合并展示并保存到本地
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query } = body;

    if (!query || typeof query !== "string" || query.trim() === "") {
      return NextResponse.json(
        { error: "Query is required" },
        { status: 400 }
      );
    }

    const searchQuery = query.trim();
    console.log(`\n🚀 ========== 开始新搜索策略 ==========`);
    console.log(`查询: "${searchQuery}"`);

    // 第一步：获取 public search 的直接结果（至少50个）
    let directSearchMarkets: GammaMarket[] = [];
    let directSearchTags: Array<{ id: string; label: string; slug?: string }> = [];
    
    try {
      const { searchMarkets } = await import("@/lib/polymarket");
      const { getCachedTags } = await import("@/lib/tag-cache");
      
      const directResults = await searchMarkets(searchQuery);
      directSearchMarkets = directResults.slice(0, 100); // 增加到前100个直接结果
      console.log(`📊 直接搜索找到 ${directSearchMarkets.length} 个市场`);
      
      // 为直接搜索结果匹配标签
      const allTags = await getCachedTags();
      const searchLower = searchQuery.toLowerCase();
      directSearchTags = allTags
        .filter(tag => 
          tag.label.toLowerCase().includes(searchLower) || 
          searchLower.includes(tag.label.toLowerCase())
        )
        .slice(0, 3);
      
      if (directSearchTags.length > 0) {
        console.log(`🏷️  为直接搜索结果匹配了 ${directSearchTags.length} 个标签:`, 
          directSearchTags.map(t => t.label).join(', '));
      }
    } catch (error) {
      console.warn("❌ 直接搜索失败:", error);
    }

    // 第二步：使用 Gemini 找 10 个强相关的 tags，并获取每个tag的市场（带fallback）
    let validTagsUsed: Array<{ id: string; label: string; slug?: string }> = [];
    let tagMarketsCache: Record<string, GammaMarket[]> = {};
    
    try {
      const { getCachedTags } = await import("@/lib/tag-cache");
      const { findRelevantTags } = await import("@/lib/gemini");
      const { getEventsByTag, sortAndFilterMarkets } = await import("@/lib/polymarket");
      
      console.log(`\n🔍 ========== 开始标签搜索流程 ==========`);
      const allTags = await getCachedTags();
      console.log(`✅ 成功获取 ${allTags.length} 个标签`);
      
      if (allTags.length > 0) {
        // 使用 Gemini 找到最相关的 tags（多找一些，以便fallback）
        console.log(`🤖 使用 Gemini AI 分析查询 "${searchQuery}" 并选择最相关的标签...`);
        const relevantTagIndices = await findRelevantTags(searchQuery, allTags, 25); // 找25个候选
        const candidateTags = relevantTagIndices.map(idx => allTags[idx]).filter(Boolean);
        console.log(`✅ Gemini 选择了 ${candidateTags.length} 个候选标签`);

        // 对每个候选 tag，尝试获取市场，直到找到12个有效的tag
        for (const tag of candidateTags) {
          if (validTagsUsed.length >= 12) {
            break; // 已经找到12个有效tag
          }
          
          try {
            console.log(`🔄 尝试获取标签 "${tag.label}" (${tag.id}) 的市场...`);
            const events = await getEventsByTag(tag.id, 100);
            
            // 从 events 中提取所有 markets
            const markets: GammaMarket[] = [];
            events.forEach(event => {
              if (event.markets && Array.isArray(event.markets)) {
                const filtered = event.markets
                  .filter(m => m.active && !m.closed && m.enableOrderBook)
                  .map(m => ({ ...m, eventSlug: event.slug }));
                markets.push(...filtered);
              }
            });

            if (markets.length === 0) {
              console.log(`   ⚠️  标签 "${tag.label}" 返回 0 个市场，跳过...`);
              continue; // 自动fallback到下一个tag
            }

            // 按 volume 排序并限制数量
            const sortedMarkets = sortAndFilterMarkets(markets, 100); // 每个标签也增加到100个市场
            
            // 缓存该标签的市场数据
            tagMarketsCache[tag.id] = sortedMarkets;
            validTagsUsed.push(tag);
            
            console.log(`   ✅ 标签 "${tag.label}" 有效，贡献了 ${sortedMarkets.length} 个市场`);
          } catch (error) {
            console.warn(`   ❌ 获取标签 "${tag.label}" 的市场失败，跳过:`, error);
            continue; // 自动fallback到下一个tag
          }
        }
        
        console.log(`✅ 标签搜索完成，找到 ${validTagsUsed.length} 个有效标签`);
        validTagsUsed.forEach((tag, idx) => {
          const count = tagMarketsCache[tag.id]?.length || 0;
          console.log(`   ${idx + 1}. [${tag.id}] ${tag.label} (${count} 个市场)`);
        });
      } else {
        console.warn(`⚠️  没有可用的标签进行搜索`);
      }
      console.log(`==========================================\n`);
    } catch (error) {
      console.warn("❌ 标签搜索失败:", error);
    }

    // 合并直接搜索结果（用于展示，不包含tag市场）
    console.log(`📦 最终结果: ${directSearchMarkets.length} 个直接搜索结果 + ${validTagsUsed.length} 个有效标签`);

    // 转换直接搜索结果为 MarketData 格式
    const marketData = await convertToMarketData(directSearchMarkets);

    // 转换标签市场缓存为 MarketData 格式
    const tagMarketsDataCache: Record<string, MarketData[]> = {};
    for (const [tagId, markets] of Object.entries(tagMarketsCache)) {
      tagMarketsDataCache[tagId] = await convertToMarketData(markets);
    }

    // 添加 "Smart Search" 虚拟标签，用于存放直接搜索结果
    const smartSearchTag = { id: 'smart-search', label: 'Smart Search' };
    tagMarketsDataCache['smart-search'] = marketData;
    
    // 将其加入有效标签列表的最前面
    validTagsUsed = [smartSearchTag, ...validTagsUsed];

    // 保存搜索结果到本地
    try {
      const filepath = await saveSearchResults(searchQuery, marketData);
      console.log(`💾 搜索结果已保存: ${filepath}`);
    } catch (error) {
      console.error("❌ 保存搜索结果失败:", error);
    }

    // 构建响应消息
    let message = `找到 ${directSearchMarkets.length} 个直接相关市场`;
    if (validTagsUsed.length > 0) {
      message += `，以及 ${validTagsUsed.length} 个相关标签分类`;
    }

    // 合并所有市场数据供 AI 分析使用（去重）
    const allUniqueMarketsMap = new Map<string, MarketData>();
    
    // 添加直接搜索的市场
    marketData.forEach(m => allUniqueMarketsMap.set(m.id, m));
    
    // 添加所有标签下的市场
    Object.values(tagMarketsDataCache).forEach(markets => {
      markets.forEach(m => {
        if (!allUniqueMarketsMap.has(m.id)) {
          allUniqueMarketsMap.set(m.id, m);
        }
      });
    });
    
    const allRelevantMarkets = Array.from(allUniqueMarketsMap.values());
    console.log(`📦 打包全量数据: ${allRelevantMarkets.length} 个市场 (去重后)`);

    return NextResponse.json({
      markets: marketData, // 默认展示直接结果
      allRelevantMarkets, // 全量打包结果供 AI 分析
      source: 'hybrid',
      message,
      suggestedQueries: validTagsUsed.map(t => t.label).slice(0, 3),
      tagsUsed: validTagsUsed,
      tagMarketsCache: tagMarketsDataCache,
      directSearchTags: directSearchTags.length > 0 ? directSearchTags : undefined,
    });
  } catch (error) {
    console.error("AI search API error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to perform AI search",
      },
      { status: 500 }
    );
  }
}

