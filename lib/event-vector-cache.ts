/**
 * Event Vector Cache Service
 * 缓存事件 Embedding，并提供语义检索
 */

import type { GammaEvent } from "@/types/polymarket";
import { getCachedEvents } from "./event-cache";
import { embedText, batchEmbedText } from "./gemini";

interface EventVectorCache {
  eventId: string;
  title: string;
  vector: number[];
}

let vectorCache: EventVectorCache[] = [];
let lastUpdated = 0;
const CACHE_DURATION = 1000 * 60 * 10; // 10分钟向量缓存

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function getEventVectorCache(): Promise<EventVectorCache[]> {
  const now = Date.now();
  const { events } = await getCachedEvents();

  if (vectorCache.length > 0 && vectorCache.length === events.length && now - lastUpdated < CACHE_DURATION) {
    return vectorCache;
  }

  console.log(`🔄 更新事件向量缓存: 当前事件数量 ${events.length}`);

  const existingMap = new Map(vectorCache.map(v => [v.eventId, v]));
  const newVectorCache: EventVectorCache[] = [];
  const eventsToEmbed: GammaEvent[] = [];

  events.forEach(event => {
    const existing = existingMap.get(event.id);
    if (existing && existing.title === event.title) {
      newVectorCache.push(existing);
    } else {
      eventsToEmbed.push(event);
    }
  });

  if (eventsToEmbed.length > 0) {
    console.log(`🤖 为 ${eventsToEmbed.length} 个新事件生成 Embedding...`);
    const titles = eventsToEmbed.map(e => e.title);
    try {
      const embeddings = await batchEmbedText(titles);
      eventsToEmbed.forEach((event, i) => {
        newVectorCache.push({
          eventId: event.id,
          title: event.title,
          vector: embeddings[i],
        });
      });
    } catch (error) {
      console.error("❌ 事件 Embedding 生成失败:", error);
      return vectorCache;
    }
  }

  vectorCache = newVectorCache;
  lastUpdated = now;
  console.log(`✅ 事件向量缓存更新完成，共 ${vectorCache.length} 个事件`);

  return vectorCache;
}

export async function searchTopEventsByQuery(query: string, topN: number = 150): Promise<GammaEvent[]> {
  try {
    const queryVector = await embedText(query);
    const cache = await getEventVectorCache();
    const { events } = await getCachedEvents();
    const eventMap = new Map(events.map(e => [e.id, e]));

    const results = cache
      .map(item => ({
        eventId: item.eventId,
        similarity: cosineSimilarity(queryVector, item.vector),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topN);

    return results
      .map(r => eventMap.get(r.eventId))
      .filter((e): e is GammaEvent => !!e);
  } catch (error) {
    console.error("❌ 事件语义检索失败:", error);
    return [];
  }
}
