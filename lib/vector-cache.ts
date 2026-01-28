/**
 * Vector Cache Service
 * 缓存所有市场的 Embedding，并提供余弦相似度搜索
 */

import type { GammaMarket } from "@/types/polymarket";
import { getCachedMarkets } from "./market-cache";
import { embedText, batchEmbedText } from "./gemini";

interface VectorCache {
  marketId: string;
  title: string;
  vector: number[];
}

// 内存中的向量缓存
let vectorCache: VectorCache[] = [];
let lastUpdated = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1小时向量缓存

/**
 * 计算两个向量的余弦相似度
 */
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

/**
 * 获取并更新向量缓存
 */
export async function getMarketVectorCache(): Promise<VectorCache[]> {
  const now = Date.now();
  
  // 获取最新的市场列表
  const { markets } = await getCachedMarkets();
  
  // 如果缓存存在且市场数量一致，且未过期，直接返回
  if (vectorCache.length > 0 && vectorCache.length === markets.length && now - lastUpdated < CACHE_DURATION) {
    return vectorCache;
  }

  console.log(`🔄 更新向量缓存: 当前市场数量 ${markets.length}`);
  
  // 找出需要生成 Embedding 的市场（增量更新）
  const existingMap = new Map(vectorCache.map(v => [v.marketId, v]));
  const newVectorCache: VectorCache[] = [];
  const marketsToEmbed: GammaMarket[] = [];

  markets.forEach(market => {
    const existing = existingMap.get(market.id);
    if (existing && existing.title === market.question) {
      newVectorCache.push(existing);
    } else {
      marketsToEmbed.push(market);
    }
  });

  if (marketsToEmbed.length > 0) {
    console.log(`🤖 为 ${marketsToEmbed.length} 个新市场生成 Embedding...`);
    const titles = marketsToEmbed.map(m => m.question);
    try {
      const embeddings = await batchEmbedText(titles);
      marketsToEmbed.forEach((market, i) => {
        newVectorCache.push({
          marketId: market.id,
          title: market.question,
          vector: embeddings[i]
        });
      });
    } catch (error) {
      console.error("❌ 批量生成 Embedding 失败:", error);
      // 如果失败，至少返回已有的缓存
      return vectorCache;
    }
  }

  vectorCache = newVectorCache;
  lastUpdated = now;
  console.log(`✅ 向量缓存更新完成，共 ${vectorCache.length} 个市场`);
  
  return vectorCache;
}

/**
 * 全局语义搜索
 * @param query 用户查询词
 * @param topN 返回结果数量
 */
export async function searchSimilarMarkets(query: string, topN: number = 50): Promise<GammaMarket[]> {
  try {
    // 1. 获取查询词的 Embedding
    const queryVector = await embedText(query);
    
    // 2. 获取所有市场的向量缓存
    const cache = await getMarketVectorCache();
    const { markets } = await getCachedMarkets();
    const marketMap = new Map(markets.map(m => [m.id, m]));

    // 3. 计算相似度并排序
    const results = cache
      .map(item => ({
        marketId: item.marketId,
        similarity: cosineSimilarity(queryVector, item.vector)
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topN);

    // 4. 返回对应的 GammaMarket 对象
    return results
      .map(r => marketMap.get(r.marketId))
      .filter((m): m is GammaMarket => !!m);
      
  } catch (error) {
    console.error("❌ 语义搜索失败:", error);
    return [];
  }
}
