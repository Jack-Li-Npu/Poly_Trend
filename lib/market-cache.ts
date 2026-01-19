/**
 * Market Cache Service
 * 缓存所有市场标题，用于AI搜索
 */

import type { GammaMarket } from "@/types/polymarket";
import { getAllActiveMarkets } from "./polymarket";

interface MarketCache {
  markets: GammaMarket[];
  titles: string[];
  lastUpdated: number;
}

const CACHE_DURATION = 1000 * 60 * 30; // 30分钟缓存
let cache: MarketCache | null = null;

/**
 * 获取所有市场并缓存
 */
export async function getCachedMarkets(): Promise<{
  markets: GammaMarket[];
  titles: string[];
}> {
  const now = Date.now();

  // 如果缓存存在且未过期，直接返回
  if (cache && now - cache.lastUpdated < CACHE_DURATION) {
    return {
      markets: cache.markets,
      titles: cache.titles,
    };
  }

  // 重新获取数据
  console.log("Fetching all active markets for cache...");
  const markets = await getAllActiveMarkets();
  const titles = markets.map((market) => market.question);

  // 更新缓存
  cache = {
    markets,
    titles,
    lastUpdated: now,
  };

  console.log(`Cached ${markets.length} active markets`);

  return {
    markets,
    titles,
  };
}

/**
 * 清除缓存
 */
export function clearCache(): void {
  cache = null;
}

