/**
 * 搜索配置：关键词到标签/同义词的映射
 * 用于处理弱语义相关的市场搜索
 */

export interface KeywordMapping {
  keywords: string[];      // 用户输入的常见词
  synonyms: string[];      // 同义词/近义词
  tagId?: string;          // Polymarket标签ID（如果API支持）
  category?: string;       // 分类名称
}

/**
 * 关键词映射配置表
 * 用于将用户查询映射到相关的标签和同义词
 */
export const KEYWORD_MAPPINGS: KeywordMapping[] = [
  {
    keywords: ['黄金', '金', '金价', 'gold', 'gold price'],
    synonyms: ['贵金属', '金属', '大宗商品', 'commodity', 'metal', 'XAU', 'precious metal'],
    category: 'commodities'
  },
  {
    keywords: ['原油', '油价', 'oil', 'crude oil', 'petroleum'],
    synonyms: ['石油', '能源', 'energy', 'crude', 'gasoline', 'fuel'],
    category: 'commodities'
  },
  {
    keywords: ['通胀', 'inflation', '物价', 'price level'],
    synonyms: ['CPI', 'consumer price', '物价指数', 'macro', 'macroeconomic'],
    category: 'macro'
  },
  {
    keywords: ['美联储', 'fed', 'federal reserve', '加息', '降息', 'interest rate'],
    synonyms: ['central bank', 'monetary policy', 'rate hike', 'rate cut', 'FOMC'],
    category: 'macro'
  },
  {
    keywords: ['比特币', 'bitcoin', 'btc', '加密货币', 'crypto'],
    synonyms: ['cryptocurrency', 'digital currency', 'blockchain', 'ethereum', 'ETH'],
    category: 'crypto'
  },
  {
    keywords: ['股票', 'stock', '股市', 'equity'],
    synonyms: ['S&P 500', 'SPX', 'NASDAQ', 'market', 'equities'],
    category: 'stocks'
  },
  {
    keywords: ['选举', 'election', '总统', 'president'],
    synonyms: ['politics', 'political', 'vote', 'candidate', 'campaign'],
    category: 'politics'
  },
  {
    keywords: ['战争', 'war', '冲突', 'conflict'],
    synonyms: ['military', 'geopolitical', 'geopolitics', 'tension'],
    category: 'geopolitics'
  },
  {
    keywords: ['天气', 'weather', '气候', 'climate'],
    synonyms: ['temperature', 'hurricane', 'storm', 'natural disaster'],
    category: 'weather'
  },
  {
    keywords: ['科技', 'tech', 'technology', 'AI', '人工智能'],
    synonyms: ['artificial intelligence', 'machine learning', 'software', 'hardware'],
    category: 'technology'
  }
];

/**
 * 根据用户查询找到匹配的关键词映射
 */
export function findKeywordMapping(query: string): KeywordMapping | null {
  const normalizedQuery = query.toLowerCase().trim();
  
  for (const mapping of KEYWORD_MAPPINGS) {
    // 检查keywords中是否有匹配
    const matched = mapping.keywords.some(keyword => 
      normalizedQuery.includes(keyword.toLowerCase()) || 
      keyword.toLowerCase().includes(normalizedQuery)
    );
    
    if (matched) {
      return mapping;
    }
  }
  
  return null;
}

/**
 * 获取所有同义词（用于扩展搜索）
 */
export function getSynonymsForQuery(query: string): string[] {
  const mapping = findKeywordMapping(query);
  if (mapping) {
    return mapping.synonyms;
  }
  return [];
}
