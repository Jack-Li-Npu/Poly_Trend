/**
 * Polymarket API Type Definitions
 */

/**
 * Gamma API Event 响应接口（/events 端点）
 * 一个 Event 包含多个 Markets
 */
export interface GammaEvent {
  id: string;
  title: string; // 事件标题
  slug: string;
  volume: number;
  endDate: string;
  image?: string;
  active: boolean;
  closed: boolean;
  enableOrderBook: boolean;
  markets: GammaMarket[]; // 包含的市场数组
}

/**
 * Gamma API Market 响应接口（嵌套在 Event 中）
 */
export interface GammaMarket {
  id: string;
  question: string; // 市场问题
  conditionId: string;
  slug: string;
  clobTokenIds: string; // JSON 字符串，格式如 '["id1", "id2"]'，需要解析
  volume: number;
  endDate: string;
  image: string;
  active: boolean;
  closed: boolean;
  enableOrderBook: boolean;
  // 添加可选的 parent event 信息
  eventSlug?: string; // 父事件的 slug，用于构建正确的 URL
  outcomes?: string; // 结果选项，如 '["Yes", "No"]' 或其他自定义选项
}

/**
 * CLOB API 价格响应接口
 * 来自 POST https://clob.polymarket.com/prices
 */
export interface ClobPrice {
  token_id: string;
  price: number;
  side: string;
}

/**
 * 前端 UI 数据模型
 * 用于在组件中展示市场数据
 */
export interface MarketData {
  id: string;
  title: string; // 来自 question
  outcome: string; // 如 "Yes"
  probability: number; // 0-100
  volume: string; // 格式化，如 "$2.4M"
  chartData: Array<{ date: string; price: number }>; // Sparkline 数据
  image?: string; // 可选图片
  slug: string; // 用于构建跳转链接（应该是 event slug）
  outcomes?: string[]; // 可能的结果选项，如 ["Yes", "No"]
}

/**
 * Sparkline 数据点接口
 */
export interface SparklineDataPoint {
  date: string;
  price: number;
}

/**
 * Polymarket 标签接口
 */
export interface Tag {
  id: string;
  label: string;
  slug?: string;
}

/**
 * 搜索响应接口
 * 包含市场数据和搜索来源信息
 */
export interface SearchResponse {
  markets: MarketData[];
  allRelevantMarkets?: MarketData[]; // 全量打包市场数据供 AI 分析
  source: 'ai' | 'synonym' | 'tag' | 'popular' | 'tag-ai' | 'hybrid' | 'tag-direct';
  message?: string;
  suggestedQueries?: string[];
  tagsUsed?: Tag[];  // 使用的标签信息（用于标签搜索）
  tagMarketsCache?: Record<string, MarketData[]>; // 标签ID到市场列表的缓存映射
  directSearchTags?: Tag[]; // 直接搜索结果关联的标签
}
