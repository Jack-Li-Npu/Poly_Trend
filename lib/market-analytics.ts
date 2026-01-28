/**
 * Market Analytics Engine
 * 处理市场去重、基于历史价格数据的相关性计算
 */

import type { MarketData } from "@/types/polymarket";

/**
 * 市场去重聚合
 */
export function deduplicateMarkets(markets: MarketData[]): MarketData[] {
  const seen = new Set<string>();
  return markets.filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

/**
 * 计算两个价格序列的皮尔逊相关系数
 */
export function calculateCorrelation(seriesA: number[], seriesB: number[]): number {
  const n = Math.min(seriesA.length, seriesB.length);
  if (n < 2) return 0;

  // 确保长度一致（对齐末尾数据）
  const a = seriesA.slice(-n);
  const b = seriesB.slice(-n);

  const sumA = a.reduce((s, x) => s + x, 0);
  const sumB = b.reduce((s, x) => s + x, 0);
  const sumASq = a.reduce((s, x) => s + x * x, 0);
  const sumBSq = b.reduce((s, x) => s + x * x, 0);
  const sumAB = a.map((x, i) => x * b[i]).reduce((s, x) => s + x, 0);

  const num = n * sumAB - sumA * sumB;
  const den = Math.sqrt((n * sumASq - sumA * sumA) * (n * sumBSq - sumB * sumB));

  if (den === 0) return 0;
  return num / den;
}

/**
 * 识别相关性市场对，区分同事件和跨事件关系
 */
export function findMarketPairs(
  markets: MarketData[], 
  threshold: number = 0.7
): Array<{ 
  a: number; 
  b: number; 
  correlation: number; 
  relationType: 'intra-event' | 'inter-event' 
}> {
  const pairs: Array<{ a: number; b: number; correlation: number; relationType: 'intra-event' | 'inter-event' }> = [];

  for (let i = 0; i < markets.length; i++) {
    for (let j = i + 1; j < markets.length; j++) {
      const marketA = markets[i];
      const marketB = markets[j];
      
      // 1. 同事件判断 (如果 eventId 相同)
      const isIntraEvent = !!(marketA.eventId && marketB.eventId && marketA.eventId === marketB.eventId);
      
      if (!marketA.chartData || marketA.chartData.length < 2 || !marketB.chartData || marketB.chartData.length < 2) {
        // 如果没有图表数据，但属于同一个事件，仍然记录关系（但 correlation 为 0）
        if (isIntraEvent) {
          pairs.push({ a: i, b: j, correlation: 0, relationType: 'intra-event' });
        }
        continue;
      }
      
      const pricesA = marketA.chartData.map(d => d.price);
      const pricesB = marketB.chartData.map(d => d.price);
      
      const corr = calculateCorrelation(pricesA, pricesB);
      
      // 2. 只有满足阈值或是同事件关系时才记录
      if (Math.abs(corr) >= threshold || isIntraEvent) {
        pairs.push({ 
          a: i, 
          b: j, 
          correlation: corr, 
          relationType: isIntraEvent ? 'intra-event' : 'inter-event' 
        });
      }
    }
  }

  return pairs;
}

/**
 * 构建深度洞察分析结果（基于历史价格数据）
 */
export async function buildMarketInsights(
  query: string,
  markets: MarketData[]
): Promise<{
  coreMarkets: MarketData[];
  highCorrelationPairs: any[];
  eventGroups: Array<{ eventId: string; eventTitle: string; markets: MarketData[] }>;
}> {
  // 1. 去重
  const uniqueMarkets = deduplicateMarkets(markets);
  
  // 2. 识别核心市场 (前 5 个作为核心)
  const coreMarkets = uniqueMarkets.slice(0, 5);
  
  // 3. 基于历史价格数据寻找相关性对 (计算前 20 个市场)
  const candidates = uniqueMarkets.slice(0, 20); 
  const pairs = findMarketPairs(candidates, 0.7);
  
  // 4. 按事件分组
  const eventMap = new Map<string, { eventId: string; eventTitle: string; markets: MarketData[] }>();
  uniqueMarkets.forEach(m => {
    if (m.eventId && m.eventTitle) {
      if (!eventMap.has(m.eventId)) {
        eventMap.set(m.eventId, { eventId: m.eventId, eventTitle: m.eventTitle, markets: [] });
      }
      eventMap.get(m.eventId)!.markets.push(m);
    }
  });
  
  return {
    coreMarkets,
    highCorrelationPairs: pairs.map(p => ({
      marketA: candidates[p.a],
      marketB: candidates[p.b],
      correlation: p.correlation,
      relationType: p.relationType
    })),
    eventGroups: Array.from(eventMap.values()).filter(g => g.markets.length > 1)
  };
}
