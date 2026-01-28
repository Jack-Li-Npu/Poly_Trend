/**
 * 标签优先搜索服务
 * 使用标签系统进行智能搜索：先选标签，再选事件，最后获取价格
 */

import type { GammaEvent, GammaMarket } from "@/types/polymarket";
import { getCachedTags, type PolymarketTag } from "./tag-cache";
import { findRelevantTags, findRelevantEvents } from "./gemini";
import { getEventsByTag, sortAndFilterMarkets } from "./polymarket";

export interface TagSearchResult {
  markets: GammaMarket[];
  tagsUsed: Array<{ id: string; label: string; slug?: string }>;
  source: 'tag-ai';
}

/**
 * 标签优先搜索主函数
 * 
 * 流程：
 * 1. 获取所有标签（从缓存）
 * 2. 使用Gemini找到最相关的5个标签
 * 3. 对每个标签，获取活跃事件
 * 4. 使用Gemini从每个标签的事件中找到最相关的20个
 * 5. 合并所有事件的市场，去重
 * 
 * @param userQuery 用户查询
 * @returns TagSearchResult 包含市场和使用的标签信息
 */
export async function searchByTags(userQuery: string): Promise<TagSearchResult | null> {
  try {
    // Step 1: 获取所有标签
    console.log("Fetching tags for tag-based search...");
    const allTags = await getCachedTags();
    
    if (allTags.length === 0) {
      console.warn("No tags available for tag-based search");
      return null;
    }

    // Step 2: 使用Gemini找到最相关的5个标签
    console.log(`Finding relevant tags from ${allTags.length} total tags...`);
    const relevantTagIndices = await findRelevantTags(
      userQuery,
      allTags.map(tag => ({ label: tag.label, slug: tag.slug })),
      10 // 最多5个标签
    );

    if (relevantTagIndices.length === 0) {
      console.warn("No relevant tags found by Gemini");
      return null;
    }

    const selectedTags = relevantTagIndices.map(idx => allTags[idx]);
    console.log(`Selected ${selectedTags.length} relevant tags:`, selectedTags.map(t => t.label).join(", "));

    // Step 3 & 4: 对每个标签，获取事件并使用Gemini筛选
    const allSelectedMarkets: GammaMarket[] = [];
    const tagsUsed: Array<{ id: string; label: string; slug?: string }> = [];

    for (const tag of selectedTags) {
      try {
        // 获取该标签的活跃事件
        console.log(`Fetching events for tag: ${tag.label} (${tag.id})`);
        const events = await getEventsByTag(tag.id, 100); // 最多获取100个事件

        if (events.length === 0) {
          console.warn(`No events found for tag ${tag.label}`);
          continue;
        }

        // 提取事件标题
        const eventTitles = events.map(event => event.title);

        // 使用Gemini找到最相关的20个事件
        console.log(`Finding relevant events from ${events.length} events for tag ${tag.label}...`);
        const relevantEventIndices = await findRelevantEvents(
          userQuery,
          eventTitles,
          20 // 每个标签最多20个事件
        );

        if (relevantEventIndices.length === 0) {
          console.warn(`No relevant events found for tag ${tag.label}`);
          continue;
        }

        // 提取选中的事件的市场
        const selectedEvents = relevantEventIndices.map(idx => events[idx]);
        selectedEvents.forEach(event => {
          if (event.markets && Array.isArray(event.markets)) {
            // 只包含活跃且未结束的市场
            const activeMarkets = event.markets.filter(
              (market) => market.active === true && market.closed === false && market.enableOrderBook === true
            );
            allSelectedMarkets.push(...activeMarkets);
          }
        });

        // 记录使用的标签
        tagsUsed.push({
          id: tag.id,
          label: tag.label,
          slug: tag.slug,
        });

        console.log(`Found ${relevantEventIndices.length} relevant events for tag ${tag.label}`);
      } catch (error) {
        console.error(`Error processing tag ${tag.label}:`, error);
        // 继续处理下一个标签
        continue;
      }
    }

    // Step 5: 去重、排序和过滤市场
    const uniqueMarkets = deduplicateMarkets(allSelectedMarkets);
    const sortedAndFilteredMarkets = sortAndFilterMarkets(uniqueMarkets, 50);

    console.log(`Tag-based search completed: ${sortedAndFilteredMarkets.length} unique markets from ${tagsUsed.length} tags`);

    if (sortedAndFilteredMarkets.length === 0) {
      return null;
    }

    return {
      markets: sortedAndFilteredMarkets,
      tagsUsed,
      source: 'tag-ai',
    };
  } catch (error) {
    console.error("Error in tag-based search:", error);
    return null;
  }
}

/**
 * 去重市场列表（基于market ID）
 */
function deduplicateMarkets(markets: GammaMarket[]): GammaMarket[] {
  const seen = new Set<string>();
  const unique: GammaMarket[] = [];

  for (const market of markets) {
    if (!seen.has(market.id)) {
      seen.add(market.id);
      unique.push(market);
    }
  }

  return unique;
}
