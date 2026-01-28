"use client";

import React, { useState, useTransition, useEffect, Suspense } from "react";
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
  TrendingUp,
  Key,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { searchMarkets } from "@/lib/polymarket";
import type { MarketData } from "@/types/polymarket";
import type { AIModel } from "@/components/ui/model-selector";
import { PriceChart } from "@/components/ui/price-chart";
import { CircularProgress } from "@/components/ui/circular-progress";
import { AIAnalysisModal } from "@/components/ui/ai-analysis-modal";
import { ModelSelector } from "@/components/ui/model-selector";

// --- Components ---

function MarketCard({ market }: { market: MarketData }) {
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  useEffect(() => {
    async function fetchHistory() {
      if (!market.clobTokenId) return;
      setIsLoadingHistory(true);
      try {
        const response = await fetch(`/api/polymarket/prices-history?tokenId=${market.clobTokenId}`);
        const data = await response.json();
        if (data.success) setPriceHistory(data.history);
      } catch (error) {
        console.error("Failed to fetch price history:", error);
      } finally {
        setIsLoadingHistory(false);
      }
    }
    fetchHistory();
  }, [market.clobTokenId]);

  const yesProbability = market.probability;
  const noProbability = 100 - yesProbability;
  const yesColor = yesProbability > 50 ? "text-emerald-500" : yesProbability > 30 ? "text-amber-500" : "text-blue-500";
  const noColor = noProbability > 50 ? "text-emerald-500" : noProbability > 30 ? "text-amber-500" : "text-blue-500";

  return (
    <CardContainer className="inter-var w-full">
      <a 
        href={`https://polymarket.com/event/${market.slug}`} 
        target="_blank" 
        rel="noopener noreferrer"
        className="block w-full"
      >
        <CardBody className="w-full h-[520px] bg-gray-50 relative group/card dark:hover:shadow-2xl dark:hover:shadow-emerald-500/[0.1] dark:bg-black dark:border-white/[0.2] border-black/[0.1] rounded-xl p-6 border cursor-pointer flex flex-col">
          <div className="absolute top-4 right-4 z-10">
            <CircularProgress percentage={yesProbability} size={56} strokeWidth={4} />
          </div>
          <div className="flex items-start gap-3 mb-3 pr-14">
            {market.image && (
              <div className="w-16 h-16 flex-shrink-0 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800 shadow-inner border border-neutral-200 dark:border-neutral-700">
                <img src={market.image} alt={market.title} className="w-full h-full object-cover" />
              </div>
            )}
            <CardItem translateZ="50" className="flex-1 text-sm font-bold text-neutral-600 dark:text-white leading-tight">
              {market.title}
            </CardItem>
          </div>
          <CardItem translateZ="40" className="w-full mt-4 mb-4 flex-1 min-h-[140px]">
            {isLoadingHistory ? (
              <div className="w-full h-[140px] flex items-center justify-center bg-neutral-100 dark:bg-neutral-900 rounded-xl animate-pulse">
                <Loader2 className="w-5 h-5 text-neutral-400 animate-spin" />
              </div>
            ) : (
              <PriceChart data={priceHistory} height={140} color={yesProbability > 50 ? "#10b981" : yesProbability > 30 ? "#f59e0b" : "#3b82f6"} />
            )}
          </CardItem>
          <CardItem as="div" translateZ="60" className="mt-2">
            {market.outcomes && market.outcomes.length === 2 && (
              <div className="mb-2 text-xs text-neutral-500 dark:text-neutral-400 truncate">预测: {market.outcomes[0]} vs {market.outcomes[1]}</div>
            )}
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold ${yesColor}`}>{yesProbability.toFixed(1)}%</span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{market.outcomes?.[0] || "Yes"}</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className={`text-lg font-semibold ${noColor}`}>{noProbability.toFixed(1)}%</span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{market.outcomes?.[1] || "No"}</span>
            </div>
          </CardItem>
          <CardItem translateZ="70" className="text-xs text-neutral-500 dark:text-neutral-400 mt-3 flex items-center justify-between">
            <span>交易量: {market.volume}</span>
            {priceHistory.length > 0 && <span className="text-[10px] text-neutral-400">历史跨度: {priceHistory.length} 天</span>}
          </CardItem>
          <CardItem translateZ={20} className="text-xs text-neutral-400 dark:text-neutral-500 mt-auto pt-4 flex items-center gap-1">
            <span>查看详情</span><span>→</span>
          </CardItem>
        </CardBody>
      </a>
    </CardContainer>
  );
}

interface SearchHistory {
  query: string;
  markets: MarketData[];
  tagMarkets: MarketData[];
  searchMessage: string | null;
  searchSource: 'ai' | 'synonym' | 'tag' | 'popular' | 'tag-ai' | 'hybrid' | 'tag-direct' | null;
  tagsUsed: Array<{ id: string; label: string; slug?: string }>;
  directSearchTags: Array<{ id: string; label: string; slug?: string }>;
  semanticGroups: Array<{ dimension: string; markets: MarketData[] }>;
  activeTagId: string | null;
}

// --- Main Content ---

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [marketData, setMarketData] = useState<MarketData[]>([]);
  const [tagMarkets, setTagMarkets] = useState<MarketData[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [suggestedQueries, setSuggestedQueries] = useState<string[]>([]);
  const [searchSource, setSearchSource] = useState<any>(null);
  const [tagsUsed, setTagsUsed] = useState<any[]>([]);
  const [directSearchTags, setDirectSearchTags] = useState<any[]>([]);
  const [semanticGroups, setSemanticGroups] = useState<any[]>([]);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [tagMarketsCache, setTagMarketsCache] = useState<Record<string, MarketData[]>>({});
  const [showSemanticSubTags, setShowSemanticSubTags] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
  const [showAIAnalysis, setShowAIAnalysis] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [latestSearchData, setLatestSearchData] = useState<any>(null);
  const [selectedModel, setSelectedModel] = useState<AIModel>("mirothinker");
  const [selectedApiKey, setSelectedApiKey] = useState<string>("");
  
  // 新增：Gemini API Key 状态
  const [geminiApiKey, setGeminiApiKey] = useState<string>("");
  const [showKeyInput, setShowKeyInput] = useState(false);

  // 初始化：加载保存的 Key
  useEffect(() => {
    const savedKey = localStorage.getItem("poly_trend_gemini_key");
    if (savedKey) {
      setGeminiApiKey(savedKey);
    } else {
      setShowKeyInput(true);
    }
  }, []);

  const handleSaveKey = (key: string) => {
    setGeminiApiKey(key);
    localStorage.setItem("poly_trend_gemini_key", key);
    if (key.trim()) setShowKeyInput(false);
  };

  const saveSearchContext = (query: string) => {
    try {
      const context = { marketData, tagMarkets, tagMarketsCache, semanticGroups, tagsUsed, directSearchTags, activeTagId, searchQuery: query, searchMessage, searchSource, showSemanticSubTags, timestamp: Date.now() };
      sessionStorage.setItem(`search-context-${query}`, JSON.stringify(context));
    } catch (error) { console.error('Failed to save search context:', error); }
  };

  const restoreSearchContext = (query: string): boolean => {
    try {
      const saved = sessionStorage.getItem(`search-context-${query}`);
      if (saved) {
        const context = JSON.parse(saved);
        if (Date.now() - context.timestamp < 30 * 60 * 1000) {
          setMarketData(context.marketData || []); setTagMarkets(context.tagMarkets || []); setTagMarketsCache(context.tagMarketsCache || {});
          setSemanticGroups(context.semanticGroups || []); setTagsUsed(context.tagsUsed || []); setDirectSearchTags(context.directSearchTags || []);
          setActiveTagId(context.activeTagId || null); setSearchMessage(context.searchMessage || null); setSearchSource(context.searchSource || null);
          setShowSemanticSubTags(context.showSemanticSubTags || false); setSearchQuery(query); return true;
        }
      }
    } catch (error) { console.error('Failed to restore search context:', error); }
    return false;
  };

  useEffect(() => {
    const q = searchParams.get("q");
    if (q && q !== searchQuery) {
      setSearchQuery(q);
      if (!restoreSearchContext(q)) executeSearch(q);
    }
  }, [searchParams]);

  const executeSearch = (query: string) => {
    // 检查 Key
    if (!geminiApiKey.trim()) {
      setError("请先设置 Gemini API Key 以启用语义搜索功能");
      setShowKeyInput(true);
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/polymarket/ai-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            query,
            geminiKey: geminiApiKey // 传递 Key 到后端
          }),
        });
        const results = await response.json();
        if (results.error) throw new Error(results.error);

        setMarketData(results.markets);
        const economicTag = (results.tagsUsed || []).find((t:any) => t.id === 'semantic-经济');
        const semanticOverviewTag = (results.tagsUsed || []).find((t:any) => t.id === 'semantic-match');
        if (economicTag && results.tagMarketsCache?.[economicTag.id]) {
          setTagMarkets(results.tagMarketsCache[economicTag.id]); setActiveTagId(economicTag.id); setShowSemanticSubTags(true);
        } else if (semanticOverviewTag && results.tagMarketsCache?.[semanticOverviewTag.id]) {
          setTagMarkets(results.tagMarketsCache[semanticOverviewTag.id]); setActiveTagId(semanticOverviewTag.id);
        } else if (results.tagsUsed?.length > 0) {
          const firstTag = results.tagsUsed[0]; setTagMarkets(results.tagMarketsCache?.[firstTag.id] || []); setActiveTagId(firstTag.id);
        }
        setSearchMessage(results.message || null); setSuggestedQueries(results.suggestedQueries || []); setSearchSource(results.source);
        setTagsUsed(results.tagsUsed || []); setDirectSearchTags(results.directSearchTags || []); setSemanticGroups(results.semanticGroups || []);
        if (results.tagMarketsCache) setTagMarketsCache(results.tagMarketsCache);
        setLatestSearchData({ query, markets: results.markets, timestamp: new Date().toISOString() });
      } catch (err: any) { 
        setError(err.message || "Failed to search markets"); 
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault(); 
    if (!searchQuery.trim()) return;
    if (!geminiApiKey.trim()) {
      setShowKeyInput(true);
      return;
    }
    const newUrl = `${window.location.pathname}?q=${encodeURIComponent(searchQuery.trim())}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
    executeSearch(searchQuery.trim());
  };

  const handleGoBack = () => {
    if (searchHistory.length > 0) {
      const lastHistory = searchHistory[searchHistory.length - 1];
      setSearchHistory(prev => prev.slice(0, -1));
      setSearchQuery(lastHistory.query); setMarketData(lastHistory.markets); setTagMarkets(lastHistory.tagMarkets);
      setSearchMessage(lastHistory.searchMessage); setSearchSource(lastHistory.searchSource);
      setTagsUsed(lastHistory.tagsUsed); setDirectSearchTags(lastHistory.directSearchTags);
      setSemanticGroups(lastHistory.semanticGroups); setActiveTagId(lastHistory.activeTagId);
    }
  };

  const handleTagClick = (tag: any) => {
    if (tag.id === 'semantic-match') setShowSemanticSubTags(!showSemanticSubTags);
    else if (!tag.id.startsWith('semantic-')) setShowSemanticSubTags(false);
    if (tagMarketsCache[tag.id]) {
      setTagMarkets(tagMarketsCache[tag.id]); setActiveTagId(tag.id);
    }
  };

  const handleModelChange = (model: AIModel, apiKey?: string) => { 
    setSelectedModel(model); 
    if (apiKey) setSelectedApiKey(apiKey); 
  };

  const handleAIAnalysis = async () => {
    if (!latestSearchData) return;
    setIsAnalyzing(true); setAnalysisComplete(false); setAiAnalysis(null);
    try {
      const response = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: latestSearchData.query, markets: marketData, model: selectedModel, apiKey: selectedApiKey }),
      });
      const result = await response.json();
      setAiAnalysis(result.analysis || result.data); setAnalysisComplete(true); setShowAIAnalysis(true);
    } catch (error) { alert("AI 分析失败"); } finally { setIsAnalyzing(false); }
  };

  const dockItems = [
    { title: "Home", icon: <Home className="h-full w-full" />, href: "/" },
    { title: "Search", icon: <Search className="h-full w-full" />, href: "/search" },
    { title: "AI Analysis", icon: <Sparkles className="h-full w-full" />, href: "/ai" },
    { title: "Settings", icon: <Settings className="h-full w-full" />, href: "/settings" },
    { title: "Github", icon: <Github className="h-full w-full" />, href: "https://github.com" },
  ];

  const isSemanticActive = activeTagId === 'semantic-match' || activeTagId?.startsWith('semantic-');
  const semanticTotal = semanticGroups.reduce((sum, group) => sum + group.markets.length, 0);

  return (
    <div className="min-h-screen w-full flex">
      <div className="flex-1 flex flex-col relative">
        <BackgroundLines className="flex-1 flex flex-col items-center justify-center">
          {isPending && (
            <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center">
              <div className="bg-white dark:bg-neutral-900 rounded-lg p-6 flex flex-col items-center gap-4 shadow-2xl">
                <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
                <p className="font-bold">深度分析市场语义中...</p>
              </div>
            </div>
          )}

          <div className="relative z-20 w-full flex flex-col items-center justify-start px-4 pt-12 pb-32 min-h-screen">
            <h1 className="text-5xl font-black mb-8 tracking-tighter bg-gradient-to-b from-white to-neutral-400 bg-clip-text text-transparent">PolyMacro Trend</h1>
            
            {/* API Key 设置区域 */}
            <div className="w-full max-w-2xl mb-4">
              <div className={`overflow-hidden transition-all duration-500 ${showKeyInput ? 'max-h-40' : 'max-h-0'}`}>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 mb-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-amber-500 text-sm font-bold">
                    <Key className="w-4 h-4" />
                    <span>需要设置 Gemini API Key 以启用语义搜索功能</span>
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="password" 
                      value={geminiApiKey} 
                      onChange={(e) => setGeminiApiKey(e.target.value)} 
                      placeholder="输入您的 Gemini API Key..." 
                      className="flex-1 px-4 py-2 rounded-xl bg-black/20 border border-amber-500/30 text-sm focus:outline-none focus:border-amber-500"
                    />
                    <button 
                      onClick={() => handleSaveKey(geminiApiKey)}
                      className="px-4 py-2 bg-amber-500 text-black text-xs font-bold rounded-xl hover:bg-amber-400 transition-colors"
                    >
                      保存并应用
                    </button>
                  </div>
                </div>
              </div>
              {!showKeyInput && (
                <div className="flex justify-end">
                  <button 
                    onClick={() => setShowKeyInput(true)}
                    className="text-[10px] uppercase font-black text-neutral-500 hover:text-amber-500 flex items-center gap-1 transition-colors"
                  >
                    <Key className="w-3 h-3" />
                    修改 API Key
                  </button>
                </div>
              )}
            </div>

            <div className="w-full max-w-2xl mb-12 flex gap-2">
              <form onSubmit={handleSubmit} className="flex-1 relative group">
                <div className="absolute inset-0 bg-blue-500/20 rounded-2xl blur-xl group-hover:bg-blue-500/30 transition-all duration-500 opacity-0 group-hover:opacity-100" />
                <input 
                  type="text" 
                  value={searchQuery} 
                  onChange={(e) => setSearchQuery(e.target.value)} 
                  placeholder="搜索市场趋势..." 
                  className="relative w-full px-12 py-4 rounded-2xl bg-white dark:bg-neutral-900 border-2 border-neutral-200 dark:border-neutral-800 focus:border-blue-500 outline-none text-lg font-medium transition-all" 
                />
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-neutral-400" />
                <button 
                  type="submit"
                  className="absolute right-3 top-1/2 -translate-y-1/2 px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-lg"
                >
                  搜索
                </button>
              </form>
            </div>

            {error && (
              <div className="w-full max-w-2xl mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 text-sm font-medium text-center">
                {error}
              </div>
            )}

            {(searchMessage || latestSearchData) && (
              <div className="w-full max-w-[1600px] mb-8 bg-white/40 dark:bg-neutral-900/40 backdrop-blur-md p-4 rounded-3xl border border-white/10 flex justify-between items-center shadow-xl">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <p className="text-sm font-bold text-neutral-600 dark:text-neutral-300">{searchMessage || "分析就绪"}</p>
                </div>
                <div className="flex gap-2">
                  <ModelSelector selectedModel={selectedModel} onModelChange={handleModelChange} onAnalyze={handleAIAnalysis} isAnalyzing={isAnalyzing} analysisComplete={analysisComplete} disabled={!latestSearchData} />
                  {analysisComplete && (
                    <button 
                      onClick={() => setShowAIAnalysis(true)} 
                      className="px-4 py-2 bg-green-500 text-white text-sm font-bold rounded-xl hover:bg-green-600 transition-all transform hover:scale-105 shadow-lg shadow-green-500/20"
                    >
                      查看分析报告
                    </button>
                  )}
                </div>
              </div>
            )}

            {(marketData.length > 0 || tagMarkets.length > 0) && (
              <div className="w-full max-w-[1600px] grid grid-cols-1 lg:grid-cols-2 gap-12">
                <div className="flex flex-col gap-6">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="p-2 bg-amber-500/20 text-amber-500 rounded-xl">🔍</span>
                    <h2 className="text-2xl font-black">直接匹配结果</h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {marketData.map(m => <MarketCard key={m.id} market={m} />)}
                  </div>
                </div>
                <div className="flex flex-col gap-6">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="p-2 bg-purple-500/20 text-purple-500 rounded-xl">🧠</span>
                    <h2 className="text-2xl font-black">AI 语义发现</h2>
                  </div>
                  {isSemanticActive ? (
                    semanticGroups.map(g => (
                      <div key={g.dimension} className="flex flex-col gap-4 mb-4">
                        <div className="flex items-center gap-2">
                          <h3 className="text-xs font-black uppercase tracking-widest text-purple-500 px-3 py-1 bg-purple-500/10 rounded-full">{g.dimension}</h3>
                          <div className="h-px flex-1 bg-purple-500/10" />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {g.markets.map((m:any) => <MarketCard key={m.id} market={m} />)}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {tagMarkets.map(m => <MarketCard key={m.id} market={m} />)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
            <FloatingDock items={dockItems} desktopClassName="!static" />
          </div>
        </BackgroundLines>
      </div>

      <AIAnalysisModal
        isOpen={showAIAnalysis}
        onClose={() => setShowAIAnalysis(false)}
        query={latestSearchData?.query || ""}
        analysis={aiAnalysis}
        isLoading={isAnalyzing}
      />
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black flex items-center justify-center text-white">Loading...</div>}>
      <HomeContent />
    </Suspense>
  );
}
