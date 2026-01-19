/**
 * 智能搜索服务
 * 实现三层搜索策略：AI语义匹配 → 同义词扩展 → 标签映射 → 热门市场兜底
 */

import type { GammaMarket } from "@/types/polymarket";
import { searchMarkets, searchMarketsByTag, getPopularMarkets, sortAndFilterMarkets } from "./polymarket";
import { findKeywordMapping, getSynonymsForQuery, KEYWORD_MAPPINGS } from "./search-config";

export interface SearchResult {
  markets: GammaMarket[];
  source: 'ai' | 'synonym' | 'tag' | 'popular';
  message?: string;  // 用于前端显示提示信息
  suggestedQueries?: string[];  // 推荐的搜索词
}

const MIN_AI_RESULTS_THRESHOLD = 5; // AI结果的最小阈值

/**
 * 智能搜索主函数
 * 实现三层降级策略
 * 
 * @param query 用户查询
 * @param aiResults AI语义匹配的结果
 * @returns SearchResult 包含市场数据和来源信息
 */
export async function smartSearch(
  query: string,
  aiResults: GammaMarket[]
): Promise<SearchResult> {
  
  // 第一层：如果AI结果足够多，直接返回
  if (aiResults.length >= MIN_AI_RESULTS_THRESHOLD) {
    return {
      markets: aiResults,
      source: 'ai',
    };
  }

  // 第二层：同义词扩展搜索
  try {
    const synonymResults = await searchWithSynonyms(query);
    if (synonymResults.length > 0) {
      // 合并AI结果和同义词结果，去重
      const combined = mergeAndDeduplicateMarkets([...aiResults, ...synonymResults]);
      return {
        markets: combined,
        source: 'synonym',
        message: `未找到与"${query}"完全匹配的市场，以下是相关主题的市场：`,
        suggestedQueries: getSynonymsForQuery(query),
      };
    }
  } catch (error) {
    console.warn("Synonym search failed:", error);
  }

  // 第三层：标签映射搜索
  try {
    const mapping = findKeywordMapping(query);
    if (mapping) {
      const tagResults = await searchMarketsByTag(mapping.tagId, mapping.category);
      if (tagResults.length > 0) {
        // 合并之前的结果
        const combined = mergeAndDeduplicateMarkets([...aiResults, ...tagResults]);
        return {
          markets: combined,
          source: 'tag',
          message: `未找到与"${query}"直接相关的市场，以下是${mapping.category || '相关主题'}的市场：`,
          suggestedQueries: mapping.synonyms.slice(0, 3),
        };
      }
    }
  } catch (error) {
    console.warn("Tag search failed:", error);
  }

  // 第四层：热门市场兜底
  try {
    const popularMarkets = await getPopularMarkets(20);
    return {
      markets: popularMarkets,
      source: 'popular',
      message: `暂未找到与"${query}"相关的市场，以下是当前最热门的预测市场：`,
      suggestedQueries: getSuggestedQueries(query),
    };
  } catch (error) {
    console.error("Popular markets fetch failed:", error);
    // 如果连热门市场都获取失败，至少返回AI结果（即使很少）
    return {
      markets: aiResults,
      source: 'ai',
      message: `仅找到${aiResults.length}个相关市场，请尝试其他搜索词。`,
    };
  }
}

/**
 * 使用同义词进行扩展搜索
 */
async function searchWithSynonyms(query: string): Promise<GammaMarket[]> {
  const synonyms = getSynonymsForQuery(query);
  if (synonyms.length === 0) {
    return [];
  }

  // 对每个同义词进行搜索，合并结果
  const allResults: GammaMarket[] = [];
  const searchPromises = synonyms.slice(0, 5).map(synonym => 
    searchMarkets(synonym).catch(() => [])
  );

  const results = await Promise.all(searchPromises);
  results.forEach(markets => {
    allResults.push(...markets);
  });

  return allResults;
}

/**
 * 合并并去重市场列表
 */
function mergeAndDeduplicateMarkets(markets: GammaMarket[]): GammaMarket[] {
  const seen = new Set<string>();
  const unique: GammaMarket[] = [];

  for (const market of markets) {
    if (!seen.has(market.id)) {
      seen.add(market.id);
      unique.push(market);
    }
  }

  // 使用统一的排序和过滤函数
  return sortAndFilterMarkets(unique, 50);
}

/**
 * 获取推荐的搜索词
 */
function getSuggestedQueries(originalQuery: string): string[] {
  const mapping = findKeywordMapping(originalQuery);
  if (mapping) {
    return mapping.synonyms.slice(0, 3);
  }

  // 如果没有映射，返回一些通用建议
  return ['bitcoin', 'election', 'inflation'];
}
