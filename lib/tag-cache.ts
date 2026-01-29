/**
 * Tag Cache Service
 * 缓存 Polymarket 标签数据，用于标签优先搜索
 */

import fetch from "node-fetch";

const GAMMA_API_BASE = "https://gamma-api.polymarket.com";

export interface PolymarketTag {
  id: string;
  label: string;
  slug: string;
  publishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  requiresTranslation?: boolean;
}

interface TagCache {
  tags: PolymarketTag[];
  lastUpdated: number;
}

const CACHE_DURATION = 1000 * 60 * 30; // 30分钟缓存
let cache: TagCache | null = null;

/**
 * 从 API 获取所有标签
 */
async function fetchAllTags(): Promise<PolymarketTag[]> {
  try {
    const response = await fetch(`${GAMMA_API_BASE}/tags`, {
      timeout: 30000,
    } as any);

    if (!response.ok) {
      throw new Error(`Tags API error: ${response.status}`);
    }

    const data = await response.json();
    const tags: PolymarketTag[] = Array.isArray(data) ? data : [];

    console.log(`Fetched ${tags.length} tags from Polymarket API`);
    return tags;
  } catch (error) {
    console.error("Error fetching tags:", error);
    throw error;
  }
}

/**
 * 保存标签到本地文件
 */
async function saveTagsToFile(tags: PolymarketTag[]): Promise<void> {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `tags-${timestamp}.json`;
    const tagsDir = path.join(process.cwd(), 'search-results');
    
    // 确保目录存在
    try {
      await fs.mkdir(tagsDir, { recursive: true });
    } catch (e) {
      // 目录已存在
    }
    
    const filepath = path.join(tagsDir, filename);
    const data = {
      timestamp: new Date().toISOString(),
      totalTags: tags.length,
      tags: tags,
    };
    
    // Vercel 环境下文件系统是只读的
    try {
      await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`✅ Tags saved to: ${filepath}`);
    } catch (writeError: any) {
      if (writeError.code === 'EROFS') {
        console.warn(`⚠️ Cannot save tags to filesystem on Vercel (EROFS). Tags cached in-memory only.`);
      } else {
        throw writeError;
      }
    }
  } catch (error) {
    console.error("Failed to save tags to file:", error);
  }
}

/**
 * 获取缓存的标签
 * 如果缓存不存在或已过期，则重新获取
 */
export async function getCachedTags(): Promise<PolymarketTag[]> {
  const now = Date.now();

  // 如果缓存存在且未过期，直接返回
  if (cache && now - cache.lastUpdated < CACHE_DURATION) {
    console.log(`📋 Using cached tags (${cache.tags.length} tags, cached ${Math.round((now - cache.lastUpdated) / 1000)}s ago)`);
    return cache.tags;
  }

  // 重新获取数据
  console.log("🔄 Fetching tags from API (cache expired or missing)...");
  const tags = await fetchAllTags();

  // 输出详细的标签信息
  console.log(`\n📊 ========== 获取到的 Tags 详情 ==========`);
  console.log(`总数: ${tags.length} 个标签`);
  console.log(`\n前 20 个标签示例:`);
  tags.slice(0, 20).forEach((tag, index) => {
    console.log(`  ${index + 1}. [${tag.id}] ${tag.label} (slug: ${tag.slug})`);
  });
  if (tags.length > 20) {
    console.log(`  ... 还有 ${tags.length - 20} 个标签`);
  }
  console.log(`==========================================\n`);

  // 更新缓存
  cache = {
    tags,
    lastUpdated: now,
  };

  console.log(`💾 Cached ${tags.length} tags`);

  // 保存到本地文件
  await saveTagsToFile(tags);

  return tags;
}

/**
 * 清除标签缓存
 */
export function clearTagCache(): void {
  cache = null;
}

/**
 * 根据标签ID获取标签信息
 */
export function getTagById(tagId: string, tags: PolymarketTag[]): PolymarketTag | undefined {
  return tags.find(tag => tag.id === tagId);
}
