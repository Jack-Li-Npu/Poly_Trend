/**
 * Polymarket API Service Layer
 * 核心服务函数，使用批量 API 优化性能
 */

import type { GammaEvent, GammaMarket, ClobPrice, MarketData, SparklineDataPoint } from "@/types/polymarket";
import fetch from "node-fetch";

const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
const CLOB_API_BASE = "https://clob.polymarket.com";

/**
 * 获取所有活跃市场（用于构建标题索引）
 * 使用 public-search API，按 volume 排序
 */
export async function getAllActiveMarkets(): Promise<GammaMarket[]> {
  try {
    // public-search 不需要 query 参数即可返回所有市场
    const response = await fetch(`${GAMMA_API_BASE}/public-search` as any);

    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.status}`);
    }

    const data = await response.json();
    
    // public-search 返回 { events: [...] } 结构
    const events: GammaEvent[] = data.events || [];

    // 从每个Event中提取Markets，并筛选活跃且未结束的市场
    const allMarkets: GammaMarket[] = [];
    events.forEach((event) => {
      if (event.markets && Array.isArray(event.markets)) {
        const filteredMarkets = event.markets
          .filter(
            (market) => market.active === true && market.closed === false && market.enableOrderBook === true
          )
          .map((market) => ({
            ...market,
            eventSlug: event.slug, // 保存父 event 的 slug 用于构建正确的 URL
          }));
        allMarkets.push(...filteredMarkets);
      }
    });

    // 按 volume 倒序排序
    allMarkets.sort((a, b) => {
      const volA = typeof a.volume === 'number' ? a.volume : parseFloat(String(a.volume)) || 0;
      const volB = typeof b.volume === 'number' ? b.volume : parseFloat(String(b.volume)) || 0;
      return volB - volA;
    });

    console.log(`Fetched and sorted ${allMarkets.length} active markets by volume`);

    return allMarkets;
  } catch (error) {
    console.error("Error fetching all active markets:", error);
    throw error;
  }
}

/**
 * 搜索市场 - 使用 public-search API
 * @param query 搜索查询词
 */
export async function searchMarkets(query: string): Promise<GammaMarket[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      events_status: 'active', // 只搜索 active 状态的市场
      keep_closed_markets: '0', // 不保留已关闭的市场
    });

    const response = await fetch(`${GAMMA_API_BASE}/public-search?${params.toString()}` as any);

    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.status}`);
    }

    const data = await response.json();
    
    // public-search 返回 { events: [...] } 结构
    const events: GammaEvent[] = data.events || [];

    // 从每个Event中提取Markets，并筛选活跃且未结束的市场
    const allMarkets: GammaMarket[] = [];
    events.forEach((event) => {
      if (event.markets && Array.isArray(event.markets)) {
        const filteredMarkets = event.markets
          .filter(
            (market) => market.active === true && market.closed === false && market.enableOrderBook === true
          )
          .map((market) => ({
            ...market,
            eventSlug: event.slug, // 保存父 event 的 slug 用于构建正确的 URL
          }));
        allMarkets.push(...filteredMarkets);
      }
    });

    // 按 volume 倒序排序
    allMarkets.sort((a, b) => {
      const volA = typeof a.volume === 'number' ? a.volume : parseFloat(String(a.volume)) || 0;
      const volB = typeof b.volume === 'number' ? b.volume : parseFloat(String(b.volume)) || 0;
      return volB - volA;
    });

    console.log(`🔍 Search results for "${query}": ${allMarkets.length} active markets`);

    return allMarkets;
  } catch (error) {
    console.error("Error searching markets:", error);
    throw error;
  }
}

/**
 * 根据标签ID获取活跃事件
 * @param tagId 标签ID
 * @param limit 返回的事件数量限制，默认100
 * @returns 事件数组（每个事件包含markets数组）
 */
export async function getEventsByTag(tagId: string, limit: number = 100): Promise<GammaEvent[]> {
  try {
    const params = new URLSearchParams({
      tag_id: tagId,
      active: "true",
      closed: "false",
      sort: "volume",
      limit: limit.toString(),
    });

    const response = await fetch(`${GAMMA_API_BASE}/events?${params.toString()}` as any);

    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.status}`);
    }

    const data = await response.json();
    let events: GammaEvent[] = [];
    if (Array.isArray(data)) {
      events = data;
    } else if (data.results && Array.isArray(data.results)) {
      events = data.results;
    }

    console.log(`Fetched ${events.length} events for tag ${tagId}`);
    return events;
  } catch (error) {
    console.error(`Error fetching events by tag ${tagId}:`, error);
    return [];
  }
}

/**
 * 根据标签ID获取市场列表（用于前端点击标签展示）
 * @param tagId 标签ID
 * @param limit 返回的市场数量限制，默认50
 * @returns 市场数组
 */
export async function getMarketsByTag(tagId: string, limit: number = 50): Promise<GammaMarket[]> {
  try {
    const events = await getEventsByTag(tagId, 100);
    
    // 从事件中提取所有活跃市场
    const allMarkets: GammaMarket[] = [];
    events.forEach((event) => {
      if (event.markets && Array.isArray(event.markets)) {
        const filteredMarkets = event.markets
          .filter(
            (market) => market.active === true && market.closed === false && market.enableOrderBook === true
          )
          .map((market) => ({
            ...market,
            eventSlug: event.slug, // 保存父 event 的 slug 用于构建正确的 URL
          }));
        allMarkets.push(...filteredMarkets);
      }
    });

    // 排序并限制数量
    const sortedMarkets = sortAndFilterMarkets(allMarkets, limit);
    
    console.log(`🏷️  Retrieved ${sortedMarkets.length} markets for tag ${tagId}`);
    
    return sortedMarkets;
  } catch (error) {
    console.error(`Error getting markets by tag ${tagId}:`, error);
    return [];
  }
}

/**
 * 根据标签ID搜索市场
 * 如果API不支持tag_id参数，会优雅降级到使用category作为查询词
 * @param tagId 标签ID
 * @param category 分类名称（作为降级方案）
 */
export async function searchMarketsByTag(tagId?: string, category?: string): Promise<GammaMarket[]> {
  try {
    // 优先尝试使用tag_id参数
    if (tagId) {
      try {
        const params = new URLSearchParams({
          tag_id: tagId,
          limit: "50",
          closed: "false",
          sort: "volume",
        });

        const response = await fetch(`${GAMMA_API_BASE}/events?${params.toString()}` as any);

        if (response.ok) {
          const data = await response.json();
          let events: GammaEvent[] = [];
          if (Array.isArray(data)) {
            events = data;
          } else if (data.results && Array.isArray(data.results)) {
            events = data.results;
          }

          const allMarkets: GammaMarket[] = [];
          events.forEach((event) => {
            if (event.markets && Array.isArray(event.markets)) {
              const filteredMarkets = event.markets.filter(
                (market) => market.active === true && market.closed === false && market.enableOrderBook === true
              );
              allMarkets.push(...filteredMarkets);
            }
          });

          if (allMarkets.length > 0) {
            return allMarkets;
          }
        }
      } catch (error) {
        console.warn("Tag ID search failed, falling back to category search:", error);
      }
    }

    // 降级：使用category作为查询词
    if (category) {
      return searchMarkets(category);
    }

    return [];
  } catch (error) {
    console.error("Error searching markets by tag:", error);
    return [];
  }
}

/**
 * 获取热门市场（按成交量排序）
 * 用作搜索的兜底方案
 * @param limit 返回的市场数量限制
 */
export async function getPopularMarkets(limit: number = 20): Promise<GammaMarket[]> {
  try {
    const params = new URLSearchParams({
      closed: "false",
      limit: limit.toString(),
      sort: "volume",
    });

    const response = await fetch(`${GAMMA_API_BASE}/events?${params.toString()}` as any);

    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.status}`);
    }

    const data = await response.json();
    let events: GammaEvent[] = [];
    if (Array.isArray(data)) {
      events = data;
    } else if (data.results && Array.isArray(data.results)) {
      events = data.results;
    }

    // 从每个Event中提取Markets，并筛选活跃且未结束的市场
    const allMarkets: GammaMarket[] = [];
    events.forEach((event) => {
      if (event.markets && Array.isArray(event.markets)) {
        const filteredMarkets = event.markets
          .filter(
            (market) => market.active === true && market.closed === false && market.enableOrderBook === true
          )
          .map((market) => ({
            ...market,
            eventSlug: event.slug, // 保存父 event 的 slug 用于构建正确的 URL
          }));
        allMarkets.push(...filteredMarkets);
      }
    });

    // 限制返回数量
    return allMarkets.slice(0, limit);
  } catch (error) {
    console.error("Error fetching popular markets:", error);
    return [];
  }
}

/**
 * 批量获取价格
 * 一次性获取多个 token 的当前价格
 */
export async function getBatchPrices(tokenIds: string[]): Promise<Record<string, number>> {
  if (tokenIds.length === 0) {
    return {};
  }

  try {
    // 构建请求体：为每个 token 请求 BUY 侧价格
    const requestBody = tokenIds.map((tokenId) => ({
      token_id: tokenId,
      side: "BUY",
    }));

    const response = await fetch(`${CLOB_API_BASE}/prices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    } as any);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`CLOB API error ${response.status}:`, errorText);
      throw new Error(`CLOB API error: ${response.status}`);
    }

    const data = await response.json();
    
    // 转换为字典格式 { tokenId: price }
    const priceMap: Record<string, number> = {};
    
    // CLOB API 返回格式: { "tokenId": { "BUY": "0.48" }, ... }
    if (data && typeof data === 'object') {
      Object.entries(data).forEach(([tokenId, priceData]: [string, any]) => {
        if (priceData && typeof priceData === 'object' && priceData.BUY) {
          const price = typeof priceData.BUY === 'string' ? parseFloat(priceData.BUY) : priceData.BUY;
          priceMap[tokenId] = price || 0;
        }
      });
    }

    console.log(`Fetched prices for ${Object.keys(priceMap).length} tokens`);
    return priceMap;
  } catch (error) {
    console.error("Error fetching batch prices:", error);
    throw error;
  }
}

/**
 * 获取 Sparkline 图表数据
 * 获取指定 token 的价格历史数据
 */
export async function getSparklineData(tokenId: string): Promise<SparklineDataPoint[]> {
  try {
    const params = new URLSearchParams({
      interval: "1h",
      market: tokenId,
    });

    const response = await fetch(`${CLOB_API_BASE}/prices-history?${params.toString()}` as any);

    if (!response.ok) {
      throw new Error(`CLOB History API error: ${response.status}`);
    }

    const data = await response.json();
    
    // 处理可能的响应格式
    // 如果返回数组，直接使用；如果是对象，尝试提取数据
    if (Array.isArray(data)) {
      return data.map((item: any) => ({
        date: item.date || item.timestamp || new Date().toISOString(),
        price: typeof item.price === "number" ? item.price : parseFloat(item.price) || 0,
      }));
    }
    
    // 如果返回对象，尝试提取数组字段
    if (data.data && Array.isArray(data.data)) {
      return data.data.map((item: any) => ({
        date: item.date || item.timestamp || new Date().toISOString(),
        price: typeof item.price === "number" ? item.price : parseFloat(item.price) || 0,
      }));
    }

    // 空响应，返回空数组
    return [];
  } catch (error) {
    console.error(`Error fetching sparkline data for ${tokenId}:`, error);
    // 优雅处理错误，返回空数组而不是抛出异常
    return [];
  }
}

/**
 * 格式化交易量
 * 将数字转换为易读的字符串格式，如 "$2.4M"
 */
export function formatVolume(volume: number): string {
  if (volume >= 1000000) {
    return `$${(volume / 1000000).toFixed(1)}M`;
  }
  if (volume >= 1000) {
    return `$${(volume / 1000).toFixed(1)}K`;
  }
  return `$${volume.toFixed(0)}`;
}

/**
 * 解析 clobTokenIds JSON 字符串
 * 提取 "Yes" token ID（通常是数组中的第一个）
 */
export function parseTokenIds(clobTokenIds: string): string[] {
  try {
    const parsed = JSON.parse(clobTokenIds);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Error parsing clobTokenIds:", error);
    return [];
  }
}

/**
 * 对市场进行排序和过滤
 * 1. 过滤未结束的市场（closed === false）
 * 2. 先按volume倒序排序，再按endDate倒序排序
 * 3. 限制为最多50个结果
 */
export function sortAndFilterMarkets(markets: GammaMarket[], limit: number = 50): GammaMarket[] {
  // 1. 过滤未结束的市场
  const activeMarkets = markets.filter(market => market.closed === false);
  
  // 2. 排序：先按volume倒序，再按endDate倒序
  const sorted = activeMarkets.sort((a, b) => {
    // 先按volume排序（降序）
    const volA = typeof a.volume === 'number' ? a.volume : parseFloat(String(a.volume)) || 0;
    const volB = typeof b.volume === 'number' ? b.volume : parseFloat(String(b.volume)) || 0;
    
    if (volB !== volA) {
      return volB - volA;
    }
    
    // volume相同则按endDate排序（降序，即日期越晚越靠前）
    const dateA = new Date(a.endDate).getTime();
    const dateB = new Date(b.endDate).getTime();
    return dateB - dateA;
  });
  
  // 3. 限制数量
  return sorted.slice(0, limit);
}

/**
 * 主编排函数
 * 整合所有 API 调用，转换为前端可用的 MarketData 格式
 */
export async function getPolyMacroData(query: string): Promise<MarketData[]> {
  try {
    // Step A: 搜索市场
    const markets = await searchMarkets(query);

    if (markets.length === 0) {
      return [];
    }

    // Step B: 解析 clobTokenIds，提取所有 token IDs
    const tokenIdMap = new Map<string, string>(); // marketId -> yesTokenId
    const allTokenIds: string[] = [];

    markets.forEach((market) => {
      const tokenIds = parseTokenIds(market.clobTokenIds);
      if (tokenIds.length > 0) {
        const yesTokenId = tokenIds[0]; // 假设第一个是 "Yes" token
        tokenIdMap.set(market.id, yesTokenId);
        allTokenIds.push(yesTokenId);
      }
    });

    // Step C: 批量获取所有 token 的价格
    const prices = await getBatchPrices(allTokenIds);

    // Step D: 为前 3 个市场获取 Sparkline 数据（可选/并行）
    const topMarkets = markets.slice(0, 3);
    const sparklinePromises = topMarkets.map((market) => {
      const tokenId = tokenIdMap.get(market.id);
      return tokenId ? getSparklineData(tokenId) : Promise.resolve([]);
    });

    const sparklineDataArray = await Promise.all(sparklinePromises);

    // Step E: 转换为 MarketData 格式
    const marketDataList: MarketData[] = markets.map((market, index) => {
      const yesTokenId = tokenIdMap.get(market.id);
      const price = yesTokenId ? prices[yesTokenId] : 0;
      const probability = price * 100; // 转换为百分比

      // 仅前 3 个市场有图表数据
      const chartData: SparklineDataPoint[] =
        index < 3 ? sparklineDataArray[index] : [];

      return {
        id: market.id,
        title: market.question,
        outcome: "Yes",
        probability: Math.round(probability * 100) / 100, // 保留两位小数
        volume: formatVolume(market.volume),
        chartData,
        image: market.image || undefined,
        slug: market.slug, // 添加slug用于跳转链接
      };
    });

    return marketDataList;
  } catch (error) {
    console.error("Error in getPolyMacroData:", error);
    throw error;
  }
}

