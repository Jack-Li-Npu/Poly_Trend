"use client";

import React, { useState, useTransition, useEffect } from "react";
import { BackgroundLines } from "@/components/ui/background-lines";
import { CardBody, CardContainer, CardItem } from "@/components/ui/3d-card";
import { FloatingDock } from "@/components/ui/floating-dock";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home,
  Search,
  Sparkles,
  Settings,
  Github,
  Loader2,
  Brain,
  ArrowLeft,
  CheckCircle2,
  Network,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import type { MarketData, SearchResponse } from "@/types/polymarket";
import { AIAnalysisModal } from "@/components/ui/ai-analysis-modal";
import { CircularProgress } from "@/components/ui/circular-progress";
import { ModelSelector, type AIModel } from "@/components/ui/model-selector";
import { PriceChart } from "@/components/ui/price-chart";

// Client-side search handler - 使用AI搜索
async function searchMarkets(query: string): Promise<SearchResponse> {
  const response = await fetch("/api/polymarket/ai-search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to search markets");
  }

  const data = await response.json();
  
  // 兼容旧格式（如果返回的是数组）
  if (Array.isArray(data)) {
    return {
      markets: data,
      source: 'ai',
    };
  }
  
  return data;
}

// 市场卡片组件
function MarketCard({ market }: { market: MarketData }) {
  const [priceHistory, setPriceHistory] = useState<Array<{ date: string; price: number }>>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const yesProbability = market.probability;
  const noProbability = 100 - yesProbability;
  const yesColor = yesProbability > 50
    ? "text-green-500 dark:text-green-400"
    : yesProbability > 30
    ? "text-yellow-500 dark:text-yellow-400"
    : "text-gray-500 dark:text-gray-400";
  const noColor = noProbability > 50
    ? "text-red-500 dark:text-red-400"
    : noProbability > 30
    ? "text-orange-500 dark:text-orange-400"
    : "text-gray-500 dark:text-gray-400";
  const marketUrl = `https://polymarket.com/event/${market.slug}`;

  // 延迟加载历史价格数据
  React.useEffect(() => {
    if (market.clobTokenId && priceHistory.length === 0) {
      const fetchHistory = async () => {
        setIsLoadingHistory(true);
        try {
          const params = new URLSearchParams({
            market: market.clobTokenId!,
            interval: "max",
            fidelity: "1440"
          });
          const response = await fetch(`https://clob.polymarket.com/prices-history?${params.toString()}`);
          if (response.ok) {
            const data = await response.json();
            if (data && data.history && Array.isArray(data.history)) {
              setPriceHistory(data.history.map((item: any) => ({
                date: new Date(item.t * 1000).toISOString(),
                price: typeof item.p === "number" ? item.p : parseFloat(item.p) || 0,
              })));
            }
          }
        } catch (error) {
          console.error("Error fetching history:", error);
        } finally {
          setIsLoadingHistory(false);
        }
      };
      fetchHistory();
    }
  }, [market.clobTokenId]);

  return (
    <CardContainer className="inter-var w-full">
      <a
        href={marketUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full"
      >
        <CardBody className="w-full h-[520px] bg-gray-50 relative group/card dark:hover:shadow-2xl dark:hover:shadow-emerald-500/[0.1] dark:bg-black dark:border-white/[0.2] border-black/[0.1] rounded-xl p-6 border cursor-pointer flex flex-col">
          {/* 圆环概率显示 - 右上角 */}
          <div className="absolute top-4 right-4 z-10">
            <CircularProgress 
              percentage={yesProbability} 
              size={56}
              strokeWidth={4}
            />
          </div>
          
          {/* 标题和图片区域 */}
          <div className="flex items-start gap-3 mb-3 pr-14">
            {/* 市场图片 - 小图标 */}
            {market.image && (
              <div className="w-16 h-16 flex-shrink-0 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800 shadow-inner border border-neutral-200 dark:border-neutral-700">
                <img
                  src={market.image}
                  alt={market.title}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const parent = (e.target as HTMLImageElement).parentElement;
                    if (parent) parent.style.display = 'none';
                  }}
                />
              </div>
            )}
            
            {/* 标题 */}
            <CardItem
              translateZ="50"
              className="flex-1 text-sm font-bold text-neutral-600 dark:text-white leading-tight"
            >
              {market.title}
            </CardItem>
          </div>

          {/* 价格历史曲线图 */}
          <CardItem
            translateZ="40"
            className="w-full mt-4 mb-4 flex-1 min-h-[140px]"
          >
            {isLoadingHistory ? (
              <div className="w-full h-[140px] flex items-center justify-center bg-neutral-100 dark:bg-neutral-900 rounded-xl animate-pulse">
                <Loader2 className="w-5 h-5 text-neutral-400 animate-spin" />
              </div>
            ) : (
              <PriceChart 
                data={priceHistory} 
                height={140} 
                color={yesProbability > 50 ? "#10b981" : yesProbability > 30 ? "#f59e0b" : "#3b82f6"} 
              />
            )}
          </CardItem>

          {/* 预测信息 */}
          <CardItem
            as="div"
            translateZ="60"
            className="mt-2"
          >
            {/* 显示选项标签 */}
            {market.outcomes && market.outcomes.length === 2 && (
              <div className="mb-2 text-xs text-neutral-500 dark:text-neutral-400 truncate">
                预测: {market.outcomes[0]} vs {market.outcomes[1]}
              </div>
            )}
            <div className="flex items-baseline gap-2">
              <span
                className={`text-2xl font-bold ${yesColor}`}
              >
                {yesProbability.toFixed(1)}%
              </span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                {market.outcomes?.[0] || "Yes"}
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className={`text-lg font-semibold ${noColor}`}>
                {noProbability.toFixed(1)}%
              </span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                {market.outcomes?.[1] || "No"}
              </span>
            </div>
          </CardItem>

          {/* 交易量 */}
          <CardItem
            translateZ="70"
            className="text-xs text-neutral-500 dark:text-neutral-400 mt-3 flex items-center justify-between"
          >
            <span>交易量: {market.volume}</span>
            {priceHistory.length > 0 && (
              <span className="text-[10px] text-neutral-400">历史跨度: {priceHistory.length} 天</span>
            )}
          </CardItem>

          {/* 查看详情 */}
          <CardItem
            translateZ={20}
            className="text-xs text-neutral-400 dark:text-neutral-500 mt-auto pt-4 flex items-center gap-1"
          >
            <span>查看详情</span>
            <span>→</span>
          </CardItem>
        </CardBody>
      </a>
    </CardContainer>
  );
}

// Skeleton 加载组件
function MarketCardSkeleton() {
  return (
    <CardContainer className="inter-var w-full">
      <CardBody className="w-full h-[520px] bg-gray-50 relative group/card dark:hover:shadow-2xl dark:hover:shadow-emerald-500/[0.1] dark:bg-black dark:border-white/[0.2] border-black/[0.1] rounded-xl p-6 border animate-pulse flex flex-col">
        {/* 圆环骨架 */}
        <div className="absolute top-4 right-4 w-14 h-14 rounded-full bg-neutral-200 dark:bg-neutral-800"></div>
        
        {/* 标题和图片区域骨架 */}
        <div className="flex items-start gap-3 mb-3 pr-14">
          <div className="w-16 h-16 bg-neutral-200 dark:bg-neutral-800 rounded-lg flex-shrink-0"></div>
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded w-full"></div>
            <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded w-3/4"></div>
          </div>
        </div>

        {/* 图表骨架 */}
        <div className="w-full h-[140px] bg-neutral-200 dark:bg-neutral-800 rounded-xl mt-4 mb-4"></div>

        {/* 预测信息骨架 */}
        <div className="h-3 bg-neutral-200 dark:bg-neutral-800 rounded w-1/2 mb-2"></div>
        <div className="h-8 bg-neutral-200 dark:bg-neutral-800 rounded w-2/3 mb-2"></div>
        <div className="h-6 bg-neutral-200 dark:bg-neutral-800 rounded w-1/2 mb-3"></div>
        {/* 交易量骨架 */}
        <div className="h-3 bg-neutral-200 dark:bg-neutral-800 rounded w-1/3 mt-3"></div>
        {/* 查看详情骨架 */}
        <div className="h-3 bg-neutral-200 dark:bg-neutral-800 rounded w-20 mt-auto"></div>
      </CardBody>
    </CardContainer>
  );
}

// 历史记录接口
interface SearchHistory {
  query: string;
  markets: MarketData[];
  tagMarkets: MarketData[]; // 新增：保存软匹配结果
  searchMessage: string | null;
  searchSource: 'ai' | 'synonym' | 'tag' | 'popular' | 'tag-ai' | 'hybrid' | 'tag-direct' | null;
  tagsUsed: Array<{ id: string; label: string; slug?: string }>;
  directSearchTags: Array<{ id: string; label: string; slug?: string }>;
  semanticGroups: Array<{ dimension: string; markets: MarketData[] }>;
  activeTagId: string | null;
}

export default function HomePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [marketData, setMarketData] = useState<MarketData[]>([]); // 硬匹配结果 (market search)
  const [tagMarkets, setTagMarkets] = useState<MarketData[]>([]); // 软匹配结果 (tag search)
  const [searchQuery, setSearchQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [suggestedQueries, setSuggestedQueries] = useState<string[]>([]);
  const [searchSource, setSearchSource] = useState<'ai' | 'synonym' | 'tag' | 'popular' | 'tag-ai' | 'hybrid' | 'tag-direct' | null>(null);
  const [tagsUsed, setTagsUsed] = useState<Array<{ id: string; label: string; slug?: string }>>([]);
  const [directSearchTags, setDirectSearchTags] = useState<Array<{ id: string; label: string; slug?: string }>>([]);
  const [semanticGroups, setSemanticGroups] = useState<Array<{ dimension: string; markets: MarketData[] }>>([]);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  
  // 标签市场缓存
  const [tagMarketsCache, setTagMarketsCache] = useState<Record<string, MarketData[]>>({});
  
  // 语义子标签显示状态
  const [showSemanticSubTags, setShowSemanticSubTags] = useState(false);
  
  // 历史记录（用于回退功能）
  const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
  
  // AI 分析状态
  const [showAIAnalysis, setShowAIAnalysis] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(false); // 分析完成状态
  const [latestSearchData, setLatestSearchData] = useState<{
    query: string;
    markets: MarketData[];
    timestamp: string;
    allRelevantMarkets?: MarketData[]; // 保存所有搜索到的市场
  } | null>(null);
  
  // 模型选择状态
  const [selectedModel, setSelectedModel] = useState<AIModel>("mirothinker");
  const [selectedApiKey, setSelectedApiKey] = useState<string>("");

  // 保存搜索上下文到 sessionStorage
  const saveSearchContext = (query: string) => {
    try {
      const context = {
        marketData,
        tagMarkets,
        tagMarketsCache,
        semanticGroups,
        tagsUsed,
        directSearchTags,
        activeTagId,
        searchQuery: query,
        searchMessage,
        searchSource,
        showSemanticSubTags,
        timestamp: Date.now()
      };
      sessionStorage.setItem(`search-context-${query}`, JSON.stringify(context));
      console.log(`💾 Saved search context for: ${query}`);
    } catch (error) {
      console.error('Failed to save search context:', error);
    }
  };

  // 恢复搜索上下文从 sessionStorage
  const restoreSearchContext = (query: string): boolean => {
    try {
      const saved = sessionStorage.getItem(`search-context-${query}`);
      if (saved) {
        const context = JSON.parse(saved);
        // Check if data is not too old (within 30 minutes)
        if (Date.now() - context.timestamp < 30 * 60 * 1000) {
          setMarketData(context.marketData || []);
          setTagMarkets(context.tagMarkets || []);
          setTagMarketsCache(context.tagMarketsCache || {});
          setSemanticGroups(context.semanticGroups || []);
          setTagsUsed(context.tagsUsed || []);
          setDirectSearchTags(context.directSearchTags || []);
          setActiveTagId(context.activeTagId || null);
          setSearchMessage(context.searchMessage || null);
          setSearchSource(context.searchSource || null);
          setShowSemanticSubTags(context.showSemanticSubTags || false);
          setSearchQuery(query);
          console.log(`♻️ Restored search context for: ${query}`);
          return true;
        } else {
          // Data too old, clear it
          sessionStorage.removeItem(`search-context-${query}`);
        }
      }
    } catch (error) {
      console.error('Failed to restore search context:', error);
    }
    return false;
  };

  // 初始化：处理 URL 中的搜索参数
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && q !== searchQuery) {
      setSearchQuery(q);
      // Try to restore from sessionStorage first
      if (!restoreSearchContext(q)) {
        // If no cached data, perform fresh search
        executeSearch(q);
      }
    }
  }, []); // 仅在挂载时运行一次

  // 封装搜索执行逻辑
  const executeSearch = (query: string) => {
    setError(null);
    startTransition(async () => {
      try {
        const results = await searchMarkets(query);
        
        // 更新状态
        setMarketData(results.markets); 
        
        const economicTag = (results.tagsUsed || []).find(t => t.id === 'semantic-经济');
        const semanticOverviewTag = (results.tagsUsed || []).find(t => t.id === 'semantic-match');
        
        if (economicTag && results.tagMarketsCache && results.tagMarketsCache[economicTag.id]) {
          setTagMarkets(results.tagMarketsCache[economicTag.id]);
          setActiveTagId(economicTag.id);
          setShowSemanticSubTags(true);
        } else if (semanticOverviewTag && results.tagMarketsCache && results.tagMarketsCache[semanticOverviewTag.id]) {
          setTagMarkets(results.tagMarketsCache[semanticOverviewTag.id]);
          setActiveTagId(semanticOverviewTag.id);
        } else if (results.tagsUsed && results.tagsUsed.length > 0) {
          const firstTag = results.tagsUsed[0];
          setTagMarkets(results.tagMarketsCache ? (results.tagMarketsCache[firstTag.id] || []) : []);
          setActiveTagId(firstTag.id);
        }

        setSearchMessage(results.message || null);
        setSuggestedQueries(results.suggestedQueries || []);
        setSearchSource(results.source);
        setTagsUsed(results.tagsUsed || []);
        setDirectSearchTags(results.directSearchTags || []);
        setSemanticGroups(results.semanticGroups || []);
        
        if (results.tagMarketsCache) {
          setTagMarketsCache(results.tagMarketsCache);
        }
        
        const searchData = {
          query: query,
          markets: results.markets,
          allRelevantMarkets: results.allRelevantMarkets || results.markets,
          timestamp: new Date().toISOString(),
        };
        setLatestSearchData(searchData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to search markets");
      }
    });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    // 保存当前状态到历史记录
    if (marketData.length > 0) {
      setSearchHistory(prev => [...prev, {
        query: searchQuery,
        markets: marketData,
        tagMarkets: tagMarkets,
        searchMessage,
        searchSource,
        tagsUsed,
        directSearchTags,
        semanticGroups,
        activeTagId,
      }]);
    }

    // 更新 URL，但不刷新页面
    const newUrl = `${window.location.pathname}?q=${encodeURIComponent(searchQuery.trim())}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
    
    executeSearch(searchQuery.trim());
  };

  // 处理 tag 点击事件（使用缓存，快速加载）
  const handleTagClick = (tag: { id: string; label: string; slug?: string }) => {
    setError(null);
    
    // 如果点击的是语义总览，切换子菜单显示
    if (tag.id === 'semantic-match') {
      setShowSemanticSubTags(!showSemanticSubTags);
    } else if (!tag.id.startsWith('semantic-')) {
      // 点击非语义类标签，关闭子菜单
      setShowSemanticSubTags(false);
    }
    
    // 保存当前状态到历史记录（在更新状态之前）
    if (marketData.length > 0) {
      setSearchHistory(prev => [...prev, {
        query: searchQuery,
        markets: marketData,
        tagMarkets: tagMarkets,
        searchMessage,
        searchSource,
        tagsUsed,
        directSearchTags,
        semanticGroups,
        activeTagId,
      }]);
    }
    
    // 检查缓存
    if (tagMarketsCache[tag.id]) {
      // 使用缓存数据，瞬间加载
      console.log(`⚡ 使用缓存数据加载标签 "${tag.label}"`);
      const cachedMarkets = tagMarketsCache[tag.id];
      setTagMarkets(cachedMarkets); // 只更新软匹配结果
      setActiveTagId(tag.id);
      
      const message = tag.id === 'smart-search'
        ? `显示 "${searchQuery}" 的直接搜索结果（共 ${cachedMarkets.length} 个市场）`
        : `标签 "${tag.label}" 下共有 ${cachedMarkets.length} 个活跃市场（来自缓存）`;
        
      setSearchMessage(message);
      setSearchSource('tag-direct');
      
      // 保存最新搜索数据供 AI 分析使用（保持原始查询词）
      const searchData = {
        query: searchQuery, // 保持原始查询词
        markets: cachedMarkets,
        allRelevantMarkets: latestSearchData?.allRelevantMarkets || cachedMarkets, // 保持全量数据
        timestamp: new Date().toISOString(),
      };
      setLatestSearchData(searchData);
      
      return; // 直接返回，不需要网络请求
    }
    
    // 如果没有缓存，则请求API
    startTransition(async () => {
      try {
        console.log(`🔄 标签 "${tag.label}" 无缓存，请求API...`);
        const response = await fetch(`/api/polymarket/tag-markets?tagId=${tag.id}&tagLabel=${encodeURIComponent(tag.label)}`);
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to fetch tag markets");
        }

        const results = await response.json();
        setTagMarkets(results.markets); // 只更新软匹配结果
        setActiveTagId(tag.id);
        setSearchMessage(results.message || null);
        setSearchSource(results.source);
        setSuggestedQueries([]);
        
        // 缓存该标签的市场数据
        setTagMarketsCache(prev => ({
          ...prev,
          [tag.id]: results.markets
        }));

        // 保存最新搜索数据供 AI 分析使用（保持原始查询词）
        const searchData = {
          query: searchQuery, // 保持原始查询词
          markets: results.markets,
          allRelevantMarkets: latestSearchData?.allRelevantMarkets || results.markets, // 保持全量数据
          timestamp: new Date().toISOString(),
        };
        setLatestSearchData(searchData);
        
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch tag markets"
        );
        setMarketData([]);
        setSearchMessage(null);
        setSuggestedQueries([]);
        setSearchSource(null);
      }
    });
  };

  // 回退功能
  const handleGoBack = () => {
    if (searchHistory.length === 0) {
      return;
    }
    
    // 取出最后一个历史记录
    const lastHistory = searchHistory[searchHistory.length - 1];
    
    // 恢复状态
    setSearchQuery(lastHistory.query);
    setMarketData(lastHistory.markets);
    setTagMarkets(lastHistory.tagMarkets);
    setSearchMessage(lastHistory.searchMessage);
    setSearchSource(lastHistory.searchSource);
    setTagsUsed(lastHistory.tagsUsed);
    setDirectSearchTags(lastHistory.directSearchTags);
    setSemanticGroups(lastHistory.semanticGroups);
    setActiveTagId(lastHistory.activeTagId);
    
    // 同步 URL
    const newUrl = `${window.location.pathname}?q=${encodeURIComponent(lastHistory.query)}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
    
    // 移除最后一个历史记录
    setSearchHistory(prev => prev.slice(0, -1));
    
    console.log(`⬅️  回退到: "${lastHistory.query}"`);
  };

  // 模型选择处理
  const handleModelChange = (model: AIModel, apiKey?: string) => {
    setSelectedModel(model);
    setSelectedApiKey(apiKey || "");
    console.log(`🤖 切换到模型: ${model}`);
  };

  // AI 分析函数
  const handleAIAnalysis = async () => {
    let marketsToAnalyze = latestSearchData?.allRelevantMarkets || latestSearchData?.markets || marketData;
    let queryToAnalyze = latestSearchData?.query || searchQuery || "当前展示的市场";
    
    if (marketsToAnalyze.length === 0) {
      alert("请先进行搜索以获得分析数据");
      return;
    }

    setIsAnalyzing(true);
    setAnalysisComplete(false);
    setAiAnalysis(null);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 分钟超时

      const analysisData = {
        query: queryToAnalyze,
        markets: marketsToAnalyze.map(m => ({
          ...m,
          probability: m.probability / 100 
        })),
        timestamp: latestSearchData?.timestamp || new Date().toISOString(),
        totalResults: marketsToAnalyze.length,
        tagsUsed: tagsUsed.map(tag => ({
          id: tag.id,
          label: tag.label,
          slug: tag.slug,
        })),
        searchSource: searchSource,
        statistics: {
          totalVolume: marketsToAnalyze.reduce((sum, m) => {
            const vol = typeof m.volume === 'string' 
              ? parseFloat(m.volume.replace(/[$,KM]/g, '')) 
              : m.volume;
            const multiplier = typeof m.volume === 'string' && m.volume.includes('M') ? 1000000 : (typeof m.volume === 'string' && m.volume.includes('K') ? 1000 : 1);
            return sum + (vol || 0) * multiplier;
          }, 0),
          averageProbability: (marketsToAnalyze.reduce((sum, m) => sum + m.probability, 0) / marketsToAnalyze.length) / 100, 
          highConfidenceMarkets: marketsToAnalyze.filter(m => m.probability > 70 || m.probability < 30).length,
        },
        model: selectedModel,
        apiKey: selectedApiKey,
      };

      const apiEndpoint = selectedModel === "mirothinker" 
        ? "/api/miroflow/analyze" 
        : "/api/ai/analyze";

      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(analysisData),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `服务器错误: ${response.status}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || "AI 分析失败");
      }

      const rawAnalysis = result.analysis || result.data;
      
      let normalizedAnalysis;
      if (typeof rawAnalysis === 'string') {
        normalizedAnalysis = {
          answer: rawAnalysis,
          boxed_answer: "AI 快速分析结果已生成",
        };
      } else {
        normalizedAnalysis = rawAnalysis;
      }

      setAiAnalysis(normalizedAnalysis);
      setAnalysisComplete(true); 
      setShowAIAnalysis(true);
    } catch (error) {
      console.error("AI analysis failed:", error);
      let errorMessage = "AI 分析失败。";
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          errorMessage = "分析超时（超过10分钟），请稍后重试。";
        } else {
          errorMessage = error.message;
        }
      }
      if (selectedModel === "mirothinker") {
        errorMessage += "\n\n提示：请确保 MiroFlow API Server 正在运行 (http://localhost:8000)";
      } else {
        errorMessage += `\n\n提示：请检查您的 ${selectedModel.toUpperCase()} API Key 是否正确`;
      }
      alert(errorMessage);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const dockItems = [
    {
      title: "Home",
      icon: (
        <Home className="h-full w-full text-neutral-500 dark:text-neutral-300" />
      ),
      href: "/",
    },
    {
      title: "Market Search",
      icon: (
        <Search className="h-full w-full text-neutral-500 dark:text-neutral-300" />
      ),
      href: "/search",
    },
    {
      title: "Insights",
      icon: (
        <Network className="h-full w-full text-neutral-500 dark:text-neutral-300" />
      ),
      href: searchQuery ? `/insights?q=${encodeURIComponent(searchQuery)}` : "/insights",
    },
    {
      title: "AI Analysis",
      icon: (
        <Sparkles className="h-full w-full text-neutral-500 dark:text-neutral-300" />
      ),
      href: "/ai",
    },
    {
      title: "Settings",
      icon: (
        <Settings className="h-full w-full text-neutral-500 dark:text-neutral-300" />
      ),
      href: "/settings",
    },
    {
      title: "Github",
      icon: (
        <Github className="h-full w-full text-neutral-500 dark:text-neutral-300" />
      ),
      href: "https://github.com",
    },
  ];

  const isSemanticActive = activeTagId === 'semantic-match' || activeTagId?.startsWith('semantic-');
  const semanticTotal = semanticGroups.reduce((sum, group) => sum + group.markets.length, 0);

  return (
    <div className="min-h-screen w-full flex">
      {/* 主内容区域 */}
      <div className="flex-1 flex flex-col relative">
        <BackgroundLines className="flex-1 flex flex-col items-center justify-center">
          {/* Loading Overlay */}
          {isPending && (
            <div className="fixed inset-0 bg-black/50 dark:bg-black/70 z-[60] flex items-center justify-center">
              <div className="bg-white dark:bg-neutral-900 rounded-lg p-6 flex flex-col items-center gap-4 shadow-xl">
                <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  正在搜索市场...
                </p>
              </div>
            </div>
          )}

          {/* Content Container */}
          <div className="relative z-20 w-full flex flex-col items-center justify-start px-4 pt-12 pb-32 min-h-screen">
            {/* Title */}
            <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold text-center bg-clip-text text-transparent bg-gradient-to-b from-neutral-200 to-neutral-600 dark:from-neutral-600 dark:to-neutral-400 mb-8 py-4 leading-tight">
              PolyMacro Insight
            </h1>

            {/* Search Bar with Back Button */}
            <div className="w-full max-w-[1600px] mb-8 flex items-center gap-2 px-4">
              {searchHistory.length > 0 && (
                <button
                  onClick={handleGoBack}
                  disabled={isPending}
                  className="flex-shrink-0 p-2 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="回退到上一个搜索"
                >
                  <ArrowLeft className="h-5 w-5 text-neutral-600 dark:text-neutral-300" />
                </button>
              )}
              
              <form onSubmit={handleSubmit} className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-neutral-400" />
                  <input
                    type="text"
                    placeholder="搜索市场..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-10 py-3 text-sm rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-400 dark:focus:ring-neutral-600 text-neutral-900 dark:text-neutral-100 shadow-md"
                    disabled={isPending}
                  />
                  {isPending && (
                    <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-neutral-400 animate-spin" />
                  )}
                </div>
                {error && (
                  <p className="mt-2 text-sm text-red-500 text-center">{error}</p>
                )}
              </form>
            </div>

            {/* Search Message and AI Analysis Button */}
            {(searchMessage || latestSearchData) && (
              <div className="w-full max-w-[1600px] mx-auto mb-4 px-4">
                <div className="bg-white/40 dark:bg-neutral-900/40 backdrop-blur-md rounded-2xl p-4 border border-neutral-200/50 dark:border-neutral-800/50 shadow-sm">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm text-blue-800 dark:text-blue-200 font-medium">
                      {searchMessage || (isPending ? "正在加载市场..." : "分析已就绪")}
                    </p>
                {latestSearchData && (
                  <div className="flex items-center gap-2">
                    {/* 深度洞察入口 */}
                    <button
                      onClick={() => {
                        // Save current search context
                        saveSearchContext(latestSearchData.query);
                        
                        // Prepare insights data: only semantic/smart search results from different events
                        const prepareInsightsData = () => {
                          // Collect all semantic search markets
                          let allSemanticMarkets: MarketData[] = [];
                          
                          // Get from semantic-match tag if available
                          if (tagMarketsCache['semantic-match']) {
                            allSemanticMarkets = [...tagMarketsCache['semantic-match']];
                          } else if (semanticGroups.length > 0) {
                            // Or collect from all semantic groups
                            semanticGroups.forEach(group => {
                              allSemanticMarkets = allSemanticMarkets.concat(group.markets);
                            });
                          }
                          
                          // Filter to only include markets from different events
                          const seenEvents = new Set<string>();
                          const uniqueEventMarkets = allSemanticMarkets.filter(m => {
                            if (!m.eventId) return true; // Include markets without eventId
                            if (seenEvents.has(m.eventId)) return false;
                            seenEvents.add(m.eventId);
                            return true;
                          });
                          
                          return uniqueEventMarkets;
                        };
                        
                        const insightsData = prepareInsightsData();
                        
                        // Save insights data to sessionStorage
                        try {
                          sessionStorage.setItem(
                            `insights-data-${latestSearchData.query}`,
                            JSON.stringify({
                              markets: insightsData,
                              timestamp: Date.now()
                            })
                          );
                          console.log(`💾 Saved ${insightsData.length} markets for insights analysis`);
                        } catch (error) {
                          console.error('Failed to save insights data:', error);
                        }
                        
                        router.push(`/insights?q=${encodeURIComponent(latestSearchData.query)}`);
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-all transform hover:scale-105 shadow-lg whitespace-nowrap"
                    >
                      <Network className="w-4 h-4" />
                      <span className="text-sm">关联图谱洞察</span>
                    </button>

                    <ModelSelector
                      selectedModel={selectedModel}
                      onModelChange={handleModelChange}
                      onAnalyze={handleAIAnalysis}
                      isAnalyzing={isAnalyzing}
                      analysisComplete={analysisComplete}
                      disabled={!latestSearchData}
                    />
                        
                        {analysisComplete && aiAnalysis && (
                          <button
                            onClick={() => setShowAIAnalysis(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-all transform hover:scale-105 shadow-lg whitespace-nowrap animate-pulse"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span className="text-sm">查看分析结果</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Unified Tag Navigation System */}
            {tagsUsed.length > 0 && (
              <div className="w-full max-w-[1600px] mx-auto mb-8 px-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mr-2">
                    探索维度
                  </span>
                  {tagsUsed
                    .filter(t => !t.id.startsWith('semantic-') || t.id === 'semantic-match')
                    .map((tag) => {
                      const isSmart = tag.id === 'smart-search';
                      const isSemantic = tag.id === 'semantic-match';
                      const isActive = activeTagId === tag.id || (isSemantic && activeTagId?.startsWith('semantic-'));
                      
                      return (
                        <button
                          key={tag.id}
                          onClick={(e) => {
                            e.preventDefault();
                            handleTagClick(tag);
                          }}
                          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border ${
                            isActive
                              ? isSmart 
                                ? "bg-amber-500 text-white border-amber-600 shadow-md scale-105"
                                : "bg-purple-600 text-white border-purple-700 shadow-md scale-105"
                              : isSmart
                                ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-neutral-800 hover:bg-amber-100"
                                : isSemantic
                                ? "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-neutral-800 hover:bg-purple-100"
                                : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-800 hover:border-blue-400"
                          }`}
                        >
                          {isSmart ? "🔍" : isSemantic ? "🧠" : "🏷️"}
                          {isSemantic ? "语义搜索" : tag.label}
                          {isSemantic && (
                            <motion.span
                              animate={{ rotate: showSemanticSubTags ? 180 : 0 }}
                              className="text-[10px]"
                            >
                              ▼
                            </motion.span>
                          )}
                        </button>
                      );
                    })}
                </div>

                <AnimatePresence>
                  {showSemanticSubTags && (
                    <motion.div
                      initial={{ opacity: 0, y: -10, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: "auto" }}
                      exit={{ opacity: 0, y: -10, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-wrap items-center gap-2 p-3 bg-purple-50/50 dark:bg-purple-900/10 rounded-2xl border border-purple-100 dark:border-purple-900/30">
                        <span className="text-[10px] font-bold text-purple-400 uppercase tracking-tight mr-2">
                          精选维度:
                        </span>
                        {tagsUsed
                          .filter(t => t.id.startsWith('semantic-') && t.id !== 'semantic-match')
                          .map((tag) => {
                            const isActive = activeTagId === tag.id;
                            return (
                              <button
                                key={tag.id}
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleTagClick(tag);
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs transition-all border ${
                                  isActive
                                    ? "bg-purple-500 text-white border-purple-600"
                                    : "bg-white dark:bg-neutral-900 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800 hover:bg-purple-50"
                                }`}
                              >
                                ✨ {tag.label}
                              </button>
                            );
                          })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Market Cards Grid Container */}
            {(isPending || marketData.length > 0 || tagMarkets.length > 0) && (
              <div className="w-full max-w-[1900px] mx-auto pb-24 px-4 flex flex-col lg:flex-row gap-0 items-start border border-neutral-200 dark:border-neutral-800 rounded-3xl bg-white/30 dark:bg-black/20 backdrop-blur-sm overflow-hidden shadow-2xl">
                
                {/* Left Side: Hard Match */}
                <div className="flex-1 flex flex-col gap-4 p-8 bg-white/40 dark:bg-neutral-950/20 self-stretch">
                  <div className="flex items-center justify-between mb-4 pb-4 border-b border-neutral-200 dark:border-neutral-800">
                    <h2 className="text-2xl font-black text-neutral-800 dark:text-neutral-100 flex items-center gap-3">
                      <span className="p-2 bg-amber-500 rounded-2xl text-white shadow-lg shadow-amber-500/20">🔍</span>
                      智能硬匹配
                    </h2>
                    <div className="flex flex-col items-end">
                      <span className="text-xl font-black text-amber-500">{marketData.length}</span>
                      <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-widest">精准结果</span>
                    </div>
                  </div>
                  
                  {isPending ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {[...Array(4)].map((_, i) => (
                        <MarketCardSkeleton key={`hard-skeleton-${i}`} />
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {marketData.map((market) => (
                        <MarketCard key={`hard-${market.id}`} market={market} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Vertical Divider */}
                <div className="hidden lg:block w-px self-stretch bg-gradient-to-b from-transparent via-neutral-200 dark:via-neutral-800 to-transparent"></div>

                {/* Right Side: Soft Match */}
                <div className="flex-1 flex flex-col gap-4 p-8 bg-neutral-50/30 dark:bg-neutral-900/10 self-stretch">
                  <div className="flex items-center justify-between mb-4 pb-4 border-b border-neutral-200 dark:border-neutral-800">
                    <h2 className="text-2xl font-black text-neutral-800 dark:text-neutral-100 flex items-center gap-3">
                      <span className="p-2 bg-purple-600 rounded-2xl text-white shadow-lg shadow-purple-600/20">🧩</span>
                      关联软匹配
                    </h2>
                    <div className="flex flex-col items-end">
                      <span className="text-xl font-black text-purple-500">
                        {isSemanticActive ? semanticTotal : tagMarkets.length}
                      </span>
                      <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-widest">
                        {activeTagId?.startsWith('semantic-') ? "语义发现" : "标签关联"}
                      </span>
                    </div>
                  </div>

                  <div className="mb-4">
                    <p className="text-sm text-neutral-500 dark:text-neutral-400 font-medium italic">
                      正在查看: <span className="text-purple-600 dark:text-purple-400 font-bold not-italic">
                        {activeTagId === 'smart-search' ? "智能搜索结果" : tagsUsed.find(t => t.id === activeTagId)?.label || "全量关联"}
                      </span>
                    </p>
                  </div>

                  {isPending ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {[...Array(4)].map((_, i) => (
                        <MarketCardSkeleton key={`soft-skeleton-${i}`} />
                      ))}
                    </div>
              ) : isSemanticActive ? (
                <div className="flex flex-col gap-10">
                  {semanticGroups
                    .filter(group => {
                      // 如果是“语义总览”，显示所有组
                      if (activeTagId === 'semantic-match') return group.markets.length > 0;
                      // 如果是具体子标签，只显示匹配的那一组
                      return `semantic-${group.dimension}` === activeTagId;
                    })
                    .map((group, idx) => (
                      <div key={`semantic-group-${idx}`} className="flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                          <h3 className="text-lg font-black text-purple-700 dark:text-purple-300 px-3 py-1 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                            {group.dimension}
                          </h3>
                          <div className="flex-1 h-px bg-purple-200 dark:bg-purple-800/50"></div>
                          <span className="text-xs font-bold text-neutral-400">
                            {group.markets.length} Markets
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {group.markets.map((market) => (
                            <MarketCard key={`semantic-${group.dimension}-${market.id}`} market={market} />
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {tagMarkets.map((market) => (
                        <MarketCard key={`soft-${market.id}`} market={market} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {searchQuery && !isPending && marketData.length === 0 && tagMarkets.length === 0 && (
              <div className="text-center text-neutral-500 dark:text-neutral-400 py-12">
                {error || "No markets found. Try a different search query."}
              </div>
            )}
          </div>

          {/* Floating Dock - Fixed at bottom */}
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
            <FloatingDock items={dockItems} desktopClassName="!static" />
          </div>

          {/* AI Analysis Modal */}
          <AIAnalysisModal
            isOpen={showAIAnalysis}
            onClose={() => setShowAIAnalysis(false)}
            query={latestSearchData?.query || ""}
            analysis={aiAnalysis}
            isLoading={isAnalyzing}
          />
        </BackgroundLines>
      </div>
    </div>
  );
}
