/**
 * Event Cache Service
 * 缓存所有事件标题，用于语义匹配
 */

import type { GammaEvent } from "@/types/polymarket";
import { getAllActiveEvents } from "./polymarket";

interface EventCache {
  events: GammaEvent[];
  titles: string[];
  lastUpdated: number;
}

const CACHE_DURATION = 1000 * 60 * 10; // 10分钟缓存
let cache: EventCache | null = null;

/**
 * 获取所有事件并缓存
 */
export async function getCachedEvents(): Promise<{
  events: GammaEvent[];
  titles: string[];
}> {
  const now = Date.now();

  if (cache && now - cache.lastUpdated < CACHE_DURATION) {
    return {
      events: cache.events,
      titles: cache.titles,
    };
  }

  console.log("Fetching all active events for cache...");
  const events = await getAllActiveEvents();
  const titles = events.map((event) => event.title);

  cache = {
    events,
    titles,
    lastUpdated: now,
  };

  console.log(`Cached ${events.length} active events`);

  return {
    events,
    titles,
  };
}

/**
 * 清除缓存
 */
export function clearEventCache(): void {
  cache = null;
}
