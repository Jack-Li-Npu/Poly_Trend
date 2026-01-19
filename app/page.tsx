"use client";

import React, { useState, useTransition } from "react";
import { BackgroundLines } from "@/components/ui/background-lines";
import { CardBody, CardContainer, CardItem } from "@/components/ui/3d-card";
import { FloatingDock } from "@/components/ui/floating-dock";
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
} from "lucide-react";
import type { MarketData, SearchResponse } from "@/types/polymarket";
import { AIAnalysisModal } from "@/components/ui/ai-analysis-modal";
import { CircularProgress } from "@/components/ui/circular-progress";
import { ModelSelector, type AIModel } from "@/components/ui/model-selector";

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

  return (
    <CardContainer className="inter-var w-full">
      <a
        href={marketUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full"
      >
        <CardBody className="w-full h-[360px] bg-gray-50 relative group/card dark:hover:shadow-2xl dark:hover:shadow-emerald-500/[0.1] dark:bg-black dark:border-white/[0.2] border-black/[0.1] rounded-xl p-6 border cursor-pointer flex flex-col">
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
              <div className="w-16 h-16 flex-shrink-0 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800 shadow-inner">
                <img
                  src={market.image}
                  alt={market.title}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    // 图片加载失败时隐藏父容器
                    const parent = (e.target as HTMLImageElement).parentElement;
                    if (parent) parent.style.display = 'none';
                  }}
                />
              </div>
            )}
            
            {/* 标题 */}
            <CardItem
              translateZ="50"
              className="flex-1 text-base font-bold text-neutral-600 dark:text-white line-clamp-3 min-h-[3rem] leading-tight"
            >
              {market.title}
            </CardItem>
          </div>

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
            className="text-xs text-neutral-500 dark:text-neutral-400 mt-3"
          >
            交易量: {market.volume}
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
      <CardBody className="w-full h-[360px] bg-gray-50 relative group/card dark:hover:shadow-2xl dark:hover:shadow-emerald-500/[0.1] dark:bg-black dark:border-white/[0.2] border-black/[0.1] rounded-xl p-6 border animate-pulse flex flex-col">
        {/* 圆环骨架 */}
        <div className="absolute top-4 right-4 w-14 h-14 rounded-full bg-neutral-200 dark:bg-neutral-800"></div>
        
        {/* 标题和图片区域骨架 */}
        <div className="flex items-start gap-3 mb-3 pr-14">
          {/* 小图标骨架 */}
          <div className="w-16 h-16 bg-neutral-200 dark:bg-neutral-800 rounded-lg flex-shrink-0"></div>
          {/* 标题骨架 */}
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded w-full"></div>
            <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded w-3/4"></div>
          </div>
        </div>
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
}

export default function HomePage() {
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
  
  // 标签市场缓存
  const [tagMarketsCache, setTagMarketsCache] = useState<Record<string, MarketData[]>>({});
  
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

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!searchQuery.trim()) {
      setError("Please enter a search query");
      return;
    }

    setError(null);
    
    startTransition(async () => {
      try {
        const results = await searchMarkets(searchQuery.trim());
        
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
          }]);
        }
        
        // 更新状态
        setMarketData(results.markets); // 硬匹配结果锁死在左侧
        
        // 初始软匹配（右侧）显示第一个真实标签的结果，如果没有则显示空
        const realTags = (results.tagsUsed || []).filter(t => t.id !== 'smart-search');
        if (realTags.length > 0 && results.tagMarketsCache && results.tagMarketsCache[realTags[0].id]) {
          setTagMarkets(results.tagMarketsCache[realTags[0].id]);
        } else {
          setTagMarkets([]);
        }

        setSearchMessage(results.message || null);
        setSuggestedQueries(results.suggestedQueries || []);
        setSearchSource(results.source);
        setTagsUsed(results.tagsUsed || []);
        setDirectSearchTags(results.directSearchTags || []);
        
        // 缓存所有标签的市场数据
        if (results.tagMarketsCache) {
          setTagMarketsCache(results.tagMarketsCache);
          console.log(`📦 已缓存 ${Object.keys(results.tagMarketsCache).length} 个标签的市场数据`);
        }
        
        // 保存最新搜索数据供 AI 分析使用（包含所有相关标签下的市场）
        const searchData = {
          query: searchQuery.trim(),
          markets: results.markets,
          allRelevantMarkets: results.allRelevantMarkets || results.markets,
          timestamp: new Date().toISOString(),
        };
        setLatestSearchData(searchData);
        
        console.log(`🚀 AI 分析就绪: 已打包 ${searchData.allRelevantMarkets.length} 个相关市场`);
        
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to search markets"
        );
        setMarketData([]);
        setSearchMessage(null);
        setSuggestedQueries([]);
        setSearchSource(null);
        setTagsUsed([]);
        setDirectSearchTags([]);
      }
    });
  };

  // 处理 tag 点击事件（使用缓存，快速加载）
  const handleTagClick = (tag: { id: string; label: string; slug?: string }) => {
    setError(null);
    // 不再更新 searchQuery，保持原始查询词不变
    
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
      }]);
    }
    
    // 检查缓存
    if (tagMarketsCache[tag.id]) {
      // 使用缓存数据，瞬间加载
      console.log(`⚡ 使用缓存数据加载标签 "${tag.label}"`);
      const cachedMarkets = tagMarketsCache[tag.id];
      setTagMarkets(cachedMarkets); // 只更新软匹配结果
      
      const message = tag.id === 'smart-search'
        ? `显示 "${searchQuery}" 的直接搜索结果（共 ${cachedMarkets.length} 个市场）`
        : `标签 "${tag.label}" 下共有 ${cachedMarkets.length} 个活跃市场（来自缓存）`;
        
      setSearchMessage(message);
      setSearchSource('tag-direct');
      // 保持标签显示，不清空
      
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
        setSearchMessage(results.message || null);
        setSearchSource(results.source);
        // 保持标签显示，不清空
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
  // 手动触发AI分析
  const handleAIAnalysis = async () => {
    // 优先使用全量相关市场数据进行分析
    let marketsToAnalyze = latestSearchData?.allRelevantMarkets || latestSearchData?.markets || marketData;
    let queryToAnalyze = latestSearchData?.query || searchQuery || "当前展示的市场";
    
    if (marketsToAnalyze.length === 0) {
      alert("请先进行搜索以获得分析数据");
      return;
    }

    // 后台运行，不立即显示modal
    setIsAnalyzing(true);
    setAnalysisComplete(false);
    setAiAnalysis(null);

    console.log(`🧠 开始深度分析 ${marketsToAnalyze.length} 个市场...`);

    try {
      // 创建 AbortController 用于超时控制
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 分钟超时

      // 打包所有相关数据
      const analysisData = {
        query: queryToAnalyze,
        // 发送给模型的数据，将概率转换为 0-1 小数以避免模型误解
        markets: marketsToAnalyze.map(m => ({
          ...m,
          probability: m.probability / 100 // 转换为 0-1
        })),
        timestamp: latestSearchData?.timestamp || new Date().toISOString(),
        totalResults: marketsToAnalyze.length,
        // 添加标签信息
        tagsUsed: tagsUsed.map(tag => ({
          id: tag.id,
          label: tag.label,
          slug: tag.slug,
        })),
        // 添加搜索源信息
        searchSource: searchSource,
        // 添加汇总统计
        statistics: {
          totalVolume: marketsToAnalyze.reduce((sum, m) => {
            const vol = typeof m.volume === 'string' 
              ? parseFloat(m.volume.replace(/[$,KM]/g, '')) 
              : m.volume;
            const multiplier = typeof m.volume === 'string' && m.volume.includes('M') ? 1000000 : (typeof m.volume === 'string' && m.volume.includes('K') ? 1000 : 1);
            return sum + (vol || 0) * multiplier;
          }, 0),
          averageProbability: (marketsToAnalyze.reduce((sum, m) => sum + m.probability, 0) / marketsToAnalyze.length) / 100, // 0-1 小数
          highConfidenceMarkets: marketsToAnalyze.filter(m => m.probability > 70 || m.probability < 30).length,
        },
        // 添加模型和API key信息
        model: selectedModel,
        apiKey: selectedApiKey,
      };

      // 根据选择的模型调用不同的API端点
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

      // 处理不同 API 返回的数据结构
      const rawAnalysis = result.analysis || result.data;
      
      // 统一化数据结构，确保 MarkdownRenderer 接收到 string
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
      setAnalysisComplete(true); // 标记分析完成
      
      // 分析完成后自动弹出界面
      setShowAIAnalysis(true);
      console.log("✅ AI 分析完成，已显示结果");
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
      
      // 根据模型显示不同的提示
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

  return (
    <div className="min-h-screen w-full flex">
      {/* 主内容区域 */}
      <div className="flex-1 flex flex-col relative">
        <BackgroundLines className="flex-1 flex flex-col items-center justify-center">
          {/* Loading Overlay */}
          {isPending && (
            <div className="fixed inset-0 bg-black/50 dark:bg-black/70 z-40 flex items-center justify-center">
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
          {/* Back Button */}
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
          
          {/* Search Form */}
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

        {/* Search Message, Suggestions and AI Analysis Button */}
        {(searchMessage || tagsUsed.length > 0 || directSearchTags.length > 0) && (
          <div className="w-full max-w-[1600px] mx-auto mb-4 px-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4 mb-2">
                <p className="text-sm text-blue-800 dark:text-blue-200 flex-1">
                  {searchMessage || (isPending ? "正在加载市场..." : "请选择分类浏览")}
                </p>
                {latestSearchData && (
                  <div className="flex items-center gap-2">
                    <ModelSelector
                      selectedModel={selectedModel}
                      onModelChange={handleModelChange}
                      onAnalyze={handleAIAnalysis}
                      isAnalyzing={isAnalyzing}
                      analysisComplete={analysisComplete}
                      disabled={!latestSearchData}
                    />
                    
                    {/* 分析完成通知按钮 */}
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
              
              {/* 直接搜索结果的标签 */}
              {directSearchTags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2 mb-2">
                  <span className="text-xs text-green-700 dark:text-green-300">
                    相关标签：
                  </span>
                  {directSearchTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={(e) => {
                        e.preventDefault();
                        handleTagClick(tag);
                      }}
                      className="text-xs px-2 py-1 bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 rounded hover:bg-green-300 dark:hover:bg-green-700 transition-colors cursor-pointer"
                    >
                      🏷️ {tag.label}
                    </button>
                  ))}
                </div>
              )}
              
              {/* 使用的标签（AI匹配的标签，排除 Smart Search） */}
              {tagsUsed.filter(tag => tag.id !== 'smart-search').length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2 mb-2">
                  <span className="text-xs text-blue-700 dark:text-blue-300">
                    软匹配分类（点击更新右侧）：
                  </span>
                  {tagsUsed.filter(tag => tag.id !== 'smart-search').map((tag) => {
                    return (
                      <button
                        key={tag.id}
                        onClick={(e) => {
                          e.preventDefault();
                          handleTagClick(tag);
                        }}
                        className="bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 hover:bg-blue-300 dark:hover:bg-blue-700 text-xs px-2 py-1 rounded transition-colors cursor-pointer flex items-center gap-1"
                      >
                        🏷️ {tag.label}
                      </button>
                    );
                  })}
                </div>
              )}
              
              {suggestedQueries.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="text-xs text-blue-700 dark:text-blue-300">
                    试试搜索：
                  </span>
                  {suggestedQueries.map((query, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setSearchQuery(query);
                        const form = document.querySelector('form');
                        form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                      }}
                      className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-700 transition-colors"
                    >
                      {query}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Market Cards Grid Container - 分为左右两栏 */}
        {(isPending || marketData.length > 0 || tagMarkets.length > 0) && (
          <div className="w-full max-w-[1900px] mx-auto pb-24 px-4 grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            
            {/* 左侧：硬匹配结果 (Market Search) */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-bold text-neutral-800 dark:text-neutral-200 flex items-center gap-2">
                  <span className="p-1.5 bg-amber-100 dark:bg-amber-900/30 rounded-lg text-amber-600 dark:text-amber-400">✨</span>
                  硬匹配结果 (Market Search)
                </h2>
                <span className="text-xs text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-2 py-1 rounded-full border border-neutral-200 dark:border-neutral-700">
                  {marketData.length} 个结果
                </span>
              </div>
              
              {isPending ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[...Array(6)].map((_, i) => (
                    <MarketCardSkeleton key={`hard-skeleton-${i}`} />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {marketData.map((market) => (
                    <MarketCard key={`hard-${market.id}`} market={market} />
                  ))}
                </div>
              )}
            </div>

            {/* 右侧：软匹配结果 (Tag Search) */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-bold text-neutral-800 dark:text-neutral-200 flex items-center gap-2">
                  <span className="p-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">🏷️</span>
                  软匹配结果 (Tag Search)
                </h2>
                <span className="text-xs text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-2 py-1 rounded-full border border-neutral-200 dark:border-neutral-700">
                  {tagMarkets.length} 个结果
                </span>
              </div>

              {isPending ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[...Array(6)].map((_, i) => (
                    <MarketCardSkeleton key={`soft-skeleton-${i}`} />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

          {/* AI 分析 Modal */}
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
