import { NextRequest, NextResponse } from "next/server";
import { getSparklineData } from "@/lib/polymarket";
import { buildMarketInsights } from "@/lib/market-analytics";
import type { MarketData } from "@/types/polymarket";

export const maxDuration = 60; // 增加超时时间以处理 AI 推理

export async function POST(request: NextRequest) {
  try {
    const { query, markets: preFilteredMarkets } = await request.json();

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    console.log(`\n🕸️  ========== 开始深度洞察分析: "${query}" ==========`);

    let markets: MarketData[];

    // Check if pre-filtered markets were provided
    if (preFilteredMarkets && Array.isArray(preFilteredMarkets) && preFilteredMarkets.length > 0) {
      console.log(`✅ 使用预过滤的 ${preFilteredMarkets.length} 个市场（智能搜索结果）`);
      markets = preFilteredMarkets;
    } else {
      console.log(`⚠️ 未提供预过滤市场，将使用直接搜索结果（不推荐）`);
      
      // Fallback: 获取所有相关市场 (调用内部搜索逻辑)
      // 动态导入以避免循环依赖
      const { searchMarkets } = await import("@/lib/polymarket");
      
      // 获取基础搜索结果
      const rawMarkets = await searchMarkets(query);
      
      // 转换为基础 MarketData (带 clobTokenId)
      const { getBatchPrices, parseTokenIds, formatVolume } = await import("@/lib/polymarket");
      
      const allTokenIds: string[] = [];
      const liteMarkets = rawMarkets.slice(0, 30).map(m => {
        const ids = parseTokenIds(m.clobTokenIds || '[]');
        if (ids.length > 0) allTokenIds.push(ids[0]);
        return { ...m, tokenIds: ids };
      });

      const prices = await getBatchPrices(allTokenIds);
      
      markets = liteMarkets.map(m => {
        const price = m.tokenIds.length > 0 ? prices[m.tokenIds[0]] || 0 : 0;
        let outcomes = ["Yes", "No"];
        try { if (m.outcomes) outcomes = JSON.parse(m.outcomes); } catch(e) {}
        
        return {
          id: m.id,
          title: m.question,
          outcome: outcomes[0],
          probability: Math.round(price * 10000) / 100,
          volume: formatVolume(m.volume),
          chartData: [],
          image: m.image,
          slug: m.slug,
          outcomes: outcomes,
          clobTokenId: m.tokenIds.length > 0 ? m.tokenIds[0] : undefined,
          eventId: m.eventId,
          eventTitle: m.eventTitle
        };
      });
    }

    console.log(`✅ 已找到 ${markets.length} 个候选市场，正在拉取历史价格...`);

    // 2. 批量拉取历史价格 (前 20 个市场)
    const analyticsCandidates = markets.filter(m => m.clobTokenId).slice(0, 20);
    
    const historyPromises = analyticsCandidates.map(async (m) => {
      const history = await getSparklineData(m.clobTokenId!);
      return { id: m.id, history };
    });

    const histories = await Promise.all(historyPromises);
    const historyMap = new Map(histories.map(h => [h.id, h.history]));

    // 更新市场数据
    const marketsWithHistory = markets.map(m => ({
      ...m,
      chartData: historyMap.get(m.id) || []
    }));

    // 3. 执行分析引擎（基于历史价格数据）
    console.log(`🧠 正在执行相关性分析（基于历史价格数据）...`);
    const insights = await buildMarketInsights(query, marketsWithHistory);

    console.log(`✅ 洞察分析完成: 核心市场 ${insights.coreMarkets.length}, 相关性关联对 ${insights.highCorrelationPairs.length}`);

    return NextResponse.json({
      success: true,
      query,
      ...insights,
      allMarkets: marketsWithHistory
    });

  } catch (error) {
    console.error("Insights API error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Internal Server Error" 
    }, { status: 500 });
  }
}
