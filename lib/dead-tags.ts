import fs from 'fs';
import path from 'path';

const DEAD_TAGS_FILE = path.join(process.cwd(), 'data', 'dead-tags.json');

/**
 * 获取不活跃标签列表
 */
export function getDeadTags(): string[] {
  try {
    if (!fs.existsSync(DEAD_TAGS_FILE)) {
      // 确保目录存在
      const dir = path.dirname(DEAD_TAGS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(DEAD_TAGS_FILE, JSON.stringify([], null, 2));
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
      fs.writeFileSync(DEAD_TAGS_FILE, JSON.stringify(deadTags, null, 2));
      console.log(`💀 Tag ${tagId} marked as dead (no active markets)`);
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
