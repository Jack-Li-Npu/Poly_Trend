import { NextRequest, NextResponse } from "next/server";
import { getMarketsByTag, getBatchPrices, parseTokenIds, formatVolume } from "@/lib/polymarket";
import type { GammaMarket, MarketData } from "@/types/polymarket";

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
      chartData: [], // 不获取图表数据以加快速度
      image: market.image || undefined,
      slug: market.eventSlug || market.slug,
      outcomes: outcomes,
    };
  });
}

/**
 * 根据标签ID获取市场列表
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tagId = searchParams.get("tagId");
    const tagLabel = searchParams.get("tagLabel");

    if (!tagId) {
      return NextResponse.json(
        { error: "Tag ID is required" },
        { status: 400 }
      );
    }

    console.log(`\n🏷️  ========== 标签市场搜索 ==========`);
    console.log(`标签ID: ${tagId}`);
    console.log(`标签名称: ${tagLabel || 'N/A'}`);

    // 获取该标签的市场
    const markets = await getMarketsByTag(tagId, 50);

    if (markets.length === 0) {
      return NextResponse.json({
        markets: [],
        source: 'tag-direct',
        message: `标签 "${tagLabel || tagId}" 下没有找到活跃市场`,
        tagId,
        tagLabel,
      });
    }

    // 转换为 MarketData 格式
    const marketData = await convertToMarketData(markets);

    console.log(`✅ 找到 ${marketData.length} 个市场`);
    console.log(`==========================================\n`);

    return NextResponse.json({
      markets: marketData,
      source: 'tag-direct',
      message: `标签 "${tagLabel || tagId}" 下共有 ${marketData.length} 个活跃市场`,
      tagId,
      tagLabel,
    });
  } catch (error) {
    console.error("Tag markets API error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch tag markets",
      },
      { status: 500 }
    );
  }
}
