import fs from 'fs';
import path from 'path';

const DEAD_TAGS_FILE = path.join(process.cwd(), 'data', 'dead-tags.json');

/**
 * 获取不活跃标签列表
 */
export function getDeadTags(): string[] {
  try {
    if (!fs.existsSync(DEAD_TAGS_FILE)) {
      // Vercel 环境下不尝试创建文件
      return [];
    }
    const content = fs.readFileSync(DEAD_TAGS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error("Failed to read dead tags:", error);
    return [];
  }
}

/**
 * 记录不活跃标签
 */
export function markTagAsDead(tagId: string): void {
  try {
    const deadTags = getDeadTags();
    if (!deadTags.includes(tagId)) {
      deadTags.push(tagId);
      
      // Vercel 环境下文件系统是只读的，除了 /tmp
      // 我们尝试写入，但如果失败（如 EROFS）则优雅跳过
      try {
        fs.writeFileSync(DEAD_TAGS_FILE, JSON.stringify(deadTags, null, 2));
        console.log(`💀 Tag ${tagId} marked as dead (no active markets)`);
      } catch (writeError: any) {
        if (writeError.code === 'EROFS') {
          console.warn(`⚠️ Cannot write to filesystem on Vercel (EROFS). Tag ${tagId} marked as dead in-memory only.`);
        } else {
          throw writeError;
        }
      }
    }
  } catch (error) {
    console.error("Failed to mark tag as dead:", error);
  }
}

/**
 * 从标签列表中过滤掉不活跃标签
 */
export function filterDeadTags<T extends { id: string }>(tags: T[]): T[] {
  const deadTags = getDeadTags();
  if (deadTags.length === 0) return tags;
  
  const filtered = tags.filter(tag => !deadTags.includes(tag.id));
  if (filtered.length < tags.length) {
    console.log(`✂️  Filtered out ${tags.length - filtered.length} dead tags`);
  }
  return filtered;
}
