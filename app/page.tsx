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
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { searchMarkets } from "@/lib/polymarket";
import type { MarketData } from "@/types/polymarket";
import type { AIModel } from "@/components/ui/model-selector";
import { PriceChart } from "@/components/ui/price-chart";
import { CircularProgress } from "@/components/ui/circular-progress";
import { AIAnalysisModal } from "@/components/ui/ai-analysis-modal";

// --- Components ---

function MarketCard({ market, variant = 'hard' }: { market: MarketData, variant?: 'hard' | 'semantic' }) {
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
  
  // 颜色配置
  const themes = {
    hard: {
      title: "text-blue-900 dark:text-blue-100",
      chart: "#3b82f6", // blue-500
      yes: "text-blue-600",
      no: "text-blue-400"
    },
    semantic: {
      title: "text-emerald-900 dark:text-emerald-100",
      chart: "#10b981", // emerald-500
      yes: "text-emerald-600",
      no: "text-emerald-400"
    }
  };

  const theme = themes[variant];

  return (
    <CardContainer className="inter-var w-full">
      <a 
        href={`https://polymarket.com/event/${market.slug}`} 
        target="_blank" 
        rel="noopener noreferrer"
        className="block w-full"
      >
        <CardBody className="w-full h-[350px] bg-gray-50 relative group/card dark:hover:shadow-2xl dark:hover:shadow-emerald-500/[0.1] dark:bg-black dark:border-white/[0.2] border-black/[0.1] rounded-lg p-3 border cursor-pointer flex flex-col">
          <div className="absolute top-2 right-2 z-10 flex">
            <CircularProgress percentage={yesProbability} size={36} strokeWidth={2.5} />
          </div>
          <div className="flex items-start gap-1.5 mb-1.5 pr-9">
            {market.image && (
              <div className="w-8 h-8 flex-shrink-0 overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-800 shadow-inner border border-neutral-200 dark:border-neutral-700">
                <img src={market.image} alt={market.title} className="w-full h-full object-cover" />
              </div>
            )}
            <CardItem translateZ="50" className={`flex-1 text-[9px] font-bold leading-[1.3] ${theme.title}`}>
              {market.title}
            </CardItem>
          </div>
          <CardItem translateZ="40" className="w-full mt-auto h-[120px]">
            {isLoadingHistory ? (
              <div className="w-full h-full flex items-center justify-center bg-neutral-100 dark:bg-neutral-900 rounded-lg animate-pulse">
                <Loader2 className="w-3 h-3 text-neutral-400 animate-spin" />
              </div>
            ) : (
              <PriceChart data={priceHistory} height={120} color={theme.chart} />
            )}
          </CardItem>
          
          {/* 底部信息区域容器 */}
          <div className="flex flex-col gap-1 w-full">
            <CardItem as="div" translateZ="60" className="w-full">
              <div className="flex items-baseline gap-1">
                <span className={`text-sm font-bold ${theme.yes}`}>{yesProbability.toFixed(1)}%</span>
                <span className="text-[8px] text-neutral-600 dark:text-neutral-400 truncate max-w-[50px]">{market.outcomes?.[0] || "Yes"}</span>
              </div>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className={`text-xs font-semibold ${theme.no}`}>{noProbability.toFixed(1)}%</span>
                <span className="text-[8px] text-neutral-600 dark:text-neutral-400 truncate max-w-[50px]">{market.outcomes?.[1] || "No"}</span>
              </div>
            </CardItem>
            <CardItem translateZ="70" className="text-[8px] text-neutral-600 dark:text-neutral-400 mt-1 flex flex-col gap-1 w-full">
              <span>Vol: {market.volume}</span>
              {market.reasoning && (
                <div className="text-[7px] italic text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 p-1 rounded border border-purple-100 dark:border-purple-500/10 line-clamp-2">
                  {market.reasoning}
                </div>
              )}
            </CardItem>
            <CardItem translateZ={20} className="text-[8px] text-neutral-600 dark:text-neutral-500 pt-1 flex items-center gap-0.5 group-hover/card:text-blue-600 transition-colors w-full border-t border-neutral-100 dark:border-white/5">
              <span>Details</span><span>→</span>
            </CardItem>
          </div>
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
  const [geminiApiKey, setGeminiApiKey] = useState<string>("");
  const [geminiBaseUrl, setGeminiBaseUrl] = useState<string>("https://generativelanguage.googleapis.com");
  const [configMode, setConfigMode] = useState<'official' | 'proxy'>('official');
  
  // 新增：配置面板状态
  const [showConfig, setShowConfig] = useState(false);

  // 初始化：加载保存的配置
  useEffect(() => {
    const savedKey = localStorage.getItem("poly_trend_gemini_key");
    const savedBaseUrl = localStorage.getItem("poly_trend_gemini_base_url");
    const savedMode = localStorage.getItem("poly_trend_config_mode") as 'official' | 'proxy';
    
    if (savedKey) setGeminiApiKey(savedKey);
    if (savedBaseUrl) setGeminiBaseUrl(savedBaseUrl);
    if (savedMode) setConfigMode(savedMode);
    
    if (!savedKey) {
      setShowConfig(true);
    }
  }, []);

  const handleSaveConfig = (key: string, baseUrl: string, mode: 'official' | 'proxy') => {
    setGeminiApiKey(key);
    // 如果是官方模式，保存时强制使用默认 URL
    const finalBaseUrl = mode === 'official' ? "https://generativelanguage.googleapis.com" : baseUrl;
    setGeminiBaseUrl(finalBaseUrl);
    setConfigMode(mode);
    
    localStorage.setItem("poly_trend_gemini_key", key);
    localStorage.setItem("poly_trend_gemini_base_url", finalBaseUrl);
    localStorage.setItem("poly_trend_config_mode", mode);
    if (key.trim()) setError(null);
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
    // 优先从 state 获取， mount 时可能 state 还没同步，则尝试从 localStorage 直接读取
    const currentKey = geminiApiKey.trim() || localStorage.getItem("poly_trend_gemini_key") || "";
    
    if (!currentKey.toString().trim()) {
      setError("Please set Gemini API Key to enable semantic search.");
      setShowConfig(true);
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
            geminiKey: currentKey, // 传递获取到的 Key
            geminiBaseUrl: geminiBaseUrl // 传递 Base URL
          }),
        });
        const results = await response.json();
        if (results.error) throw new Error(results.error);

        setMarketData(results.markets);
        const liveCryptoTag = (results.tagsUsed || []).find((t:any) => t.id === 'semantic-Live Crypto');
        if (liveCryptoTag && results.tagMarketsCache?.[liveCryptoTag.id]) {
          setTagMarkets(results.tagMarketsCache[liveCryptoTag.id]); setActiveTagId(liveCryptoTag.id); setShowSemanticSubTags(true);
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
    
    const currentKey = geminiApiKey.trim() || localStorage.getItem("poly_trend_gemini_key") || "";
    if (!currentKey.toString().trim()) {
      setError("Please set Gemini API Key to enable semantic search.");
      setShowConfig(true);
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
    // 1. 处理语义子标签的展示逻辑
    if (tag.id === 'semantic-match') {
      setShowSemanticSubTags(!showSemanticSubTags);
    } else if (!tag.id.startsWith('semantic-')) {
      setShowSemanticSubTags(false);
    }

    // 2. 只有当点击的是非当前激活 Tag 时才执行更新
    if (tag.id !== activeTagId) {
      // 3. 强制刷新：先清空当前显示的内容
      setTagMarkets([]); 
      
      // 4. 延迟一帧设置新数据，确保触发 React 的完整渲染周期
      setTimeout(() => {
        if (tagMarketsCache[tag.id]) {
          setTagMarkets(tagMarketsCache[tag.id]);
          setActiveTagId(tag.id);
        }
      }, 0);
    }
  };

  const handleAIAnalysis = async () => {
    if (!latestSearchData) return;
    if (!geminiApiKey.trim()) {
      alert("Please set Gemini API Key first");
      setShowConfig(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setIsAnalyzing(true); setAnalysisComplete(false); setAiAnalysis(null);
    try {
      // 收集每个展示的 tag 下前 10 个成交量的市场
      const marketsToAnalyze: MarketData[] = [];
      const seenMarketIds = new Set<string>();

      // 1. 添加硬匹配市场 (前 10)
      marketData.slice(0, 10).forEach(m => {
        if (!seenMarketIds.has(m.id)) {
          marketsToAnalyze.push(m);
          seenMarketIds.add(m.id);
        }
      });

      // 2. 遍历所有展示的标签，每个标签取前 10 个成交量最高的市场
      tagsUsed.forEach(tag => {
        const cachedMarkets = tagMarketsCache[tag.id] || [];
        // 按成交量排序并取前 10
        const top10 = [...cachedMarkets]
          .sort((a, b) => {
            const volA = parseFloat(a.volume.replace(/[$,KMB]/g, '')) * (a.volume.includes('M') ? 1000000 : a.volume.includes('K') ? 1000 : 1);
            const volB = parseFloat(b.volume.replace(/[$,KMB]/g, '')) * (b.volume.includes('M') ? 1000000 : b.volume.includes('K') ? 1000 : 1);
            return volB - volA;
          })
          .slice(0, 10);

        top10.forEach(m => {
          if (!seenMarketIds.has(m.id)) {
            marketsToAnalyze.push({
              ...m,
              reasoning: `Selected market for ${tag.label} tag` // 补充背景信息
            });
            seenMarketIds.add(m.id);
          }
        });
      });

      const response = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          query: latestSearchData.query, 
          markets: marketsToAnalyze, // 传输整合后的多维数据
          model: 'gemini', 
          apiKey: geminiApiKey,
          geminiBaseUrl: geminiBaseUrl
        }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      
      // 检查返回结果格式，适配 Modal 的要求
      const finalAnalysis = typeof result.analysis === 'string' 
        ? { answer: result.analysis, boxed_answer: "" } 
        : (result.analysis || result.data);
        
      setAiAnalysis(finalAnalysis); 
      setAnalysisComplete(true); 
      setShowAIAnalysis(true);
    } catch (error: any) { 
      alert(`AI Analysis failed: ${error.message}`); 
    } finally { setIsAnalyzing(false); }
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
        <BackgroundLines className="flex-1 flex flex-col items-center justify-start overflow-y-auto">
          {isPending && (
            <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center">
              <div className="bg-white dark:bg-neutral-900 rounded-lg p-6 flex flex-col items-center gap-4 shadow-2xl">
                <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
                <p className="font-bold">Analyzing market semantics...</p>
              </div>
            </div>
          )}

          <div className="relative z-20 w-full flex flex-col items-center justify-start px-4 pt-8 pb-20 min-h-screen">
            <h1 className="text-4xl font-black mb-6 tracking-tighter bg-gradient-to-b from-neutral-900 to-neutral-600 bg-clip-text text-transparent">PolyMacro Trend</h1>
            
            {/* AI 配置区域 */}
            <div className="w-full max-w-2xl">
              <div className={`transition-all duration-500 ease-in-out ${showConfig || !geminiApiKey ? 'max-h-[1000px] opacity-100 mb-8' : 'max-h-0 opacity-0 mb-0 overflow-hidden'}`}>
                <div className="bg-white/90 dark:bg-black/60 backdrop-blur-2xl border border-neutral-200 dark:border-white/10 rounded-3xl p-6 shadow-2xl flex flex-col gap-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-purple-600 dark:text-purple-500 text-xs font-black uppercase tracking-widest">
                      <Settings className="w-3.5 h-3.5" />
                      <span>Gemini AI Configuration</span>
                    </div>
                    {geminiApiKey && (
                      <button onClick={() => setShowConfig(false)} className="p-1 hover:bg-neutral-100 dark:hover:bg-white/10 rounded-full transition-colors">
                        <X className="w-4 h-4 text-neutral-400" />
                      </button>
                    )}
                  </div>

                  {/* 模式切换 */}
                  <div className="flex p-1 bg-neutral-100 dark:bg-white/5 rounded-xl border border-neutral-200 dark:border-white/5">
                    <button 
                      onClick={() => setConfigMode('official')}
                      className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${configMode === 'official' ? 'bg-white dark:bg-neutral-800 shadow-sm text-purple-600' : 'text-neutral-500 hover:text-neutral-700'}`}
                    >
                      Official API
                    </button>
                    <button 
                      onClick={() => setConfigMode('proxy')}
                      className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${configMode === 'proxy' ? 'bg-white dark:bg-neutral-800 shadow-sm text-purple-600' : 'text-neutral-500 hover:text-neutral-700'}`}
                    >
                      Proxy Mode
                    </button>
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-2 p-3 bg-purple-50/50 dark:bg-white/5 rounded-2xl border border-purple-100 dark:border-white/5 transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">✨</span>
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-neutral-900 dark:text-white">
                            {configMode === 'official' ? 'Gemini API Key' : 'Proxy API Key'}
                          </span>
                        </div>
                      </div>
                      <input 
                        type="password" 
                        value={geminiApiKey} 
                        onChange={(e) => setGeminiApiKey(e.target.value)} 
                        placeholder={configMode === 'official' ? "Enter official API Key..." : "Enter proxy API Key..."} 
                        className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/10 text-sm focus:outline-none focus:border-purple-500 transition-all text-neutral-900 dark:text-white shadow-inner"
                      />
                    </div>

                    {configMode === 'proxy' && (
                      <div className="flex flex-col gap-2 p-3 bg-blue-50/50 dark:bg-white/5 rounded-2xl border border-blue-100 dark:border-white/5 transition-colors">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">🔗</span>
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-neutral-900 dark:text-white">Proxy Base URL</span>
                          </div>
                        </div>
                        <input 
                          type="text" 
                          value={geminiBaseUrl} 
                          onChange={(e) => setGeminiBaseUrl(e.target.value)} 
                          placeholder="Enter proxy address (Base URL)..." 
                          className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/10 text-sm focus:outline-none focus:border-blue-500 transition-all text-neutral-900 dark:text-white shadow-inner"
                        />
                      </div>
                    )}
                  </div>

                  <button 
                    onClick={() => {
                      if (!geminiApiKey.trim()) {
                        alert("Please enter an API Key");
                        return;
                      }
                      handleSaveConfig(geminiApiKey, geminiBaseUrl, configMode);
                      setError(null);
                      setShowConfig(false);
                    }}
                    className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:shadow-xl hover:shadow-purple-500/20 transition-all active:scale-[0.95] shadow-lg"
                  >
                    Save Configuration
                  </button>
                </div>
              </div>
              
              {!showConfig && geminiApiKey && (
                <div className="flex justify-end mb-2">
                  <button 
                    onClick={() => setShowConfig(true)}
                    className="group flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/50 hover:bg-white/80 dark:bg-white/5 dark:hover:bg-white/10 border border-neutral-200 dark:border-white/5 transition-all shadow-sm"
                  >
                    <span className="text-[9px] uppercase font-black text-neutral-500 group-hover:text-neutral-900 dark:group-hover:text-white transition-colors">Edit Config</span>
                    <Settings className="w-2.5 h-2.5 text-neutral-400 group-hover:rotate-90 transition-transform duration-500" />
                  </button>
                </div>
              )}
            </div>

            <div className="w-full max-w-2xl mb-6 flex gap-2">
              <form onSubmit={handleSubmit} className="flex-1 relative group">
                <div className="absolute inset-0 bg-blue-500/20 rounded-xl blur-lg group-hover:bg-blue-500/30 transition-all duration-500 opacity-0 group-hover:opacity-100" />
                <input 
                  type="text" 
                  value={searchQuery} 
                  onChange={(e) => setSearchQuery(e.target.value)} 
                  placeholder="Search market trends..." 
                  className="relative w-full px-10 py-3 rounded-xl bg-white dark:bg-neutral-900 border-2 border-neutral-300 dark:border-neutral-800 focus:border-blue-500 outline-none text-base font-medium transition-all text-neutral-900 dark:text-white shadow-lg" 
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                <button 
                  type="submit"
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-md"
                >
                  Search
                </button>
              </form>
            </div>

            {error && (
              <div className="w-full max-w-2xl mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-xl text-red-600 dark:text-red-400 text-xs font-bold text-center shadow-sm">
                {error}
              </div>
            )}

            {(searchMessage || latestSearchData) && (
              <div className="w-full max-w-[1900px] mb-6 bg-white/40 dark:bg-neutral-900/40 backdrop-blur-md p-3 rounded-2xl border border-white/10 flex justify-between items-center shadow-lg">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                  <p className="text-xs font-bold text-neutral-800 dark:text-neutral-300">{searchMessage || "Analysis Ready"}</p>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={handleAIAnalysis}
                    disabled={!latestSearchData || isAnalyzing}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg font-bold text-[10px] shadow-md shadow-purple-500/20 transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Analyzing...</span>
                      </>
                    ) : (
                      <>
                        <Brain className="w-3 h-3" />
                        <span>AI Deep Analysis</span>
                      </>
                    )}
                  </button>
                  {analysisComplete && (
                    <button 
                      onClick={() => setShowAIAnalysis(true)} 
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold rounded-lg shadow-md shadow-emerald-500/20 transition-all transform hover:scale-105"
                    >
                      View Report
                    </button>
                  )}
                </div>
              </div>
            )}

            {(marketData.length > 0 || tagMarkets.length > 0) && (
              <div className="w-full max-w-[1900px] flex flex-col gap-4">
                {/* 顶部标签栏 */}
                <div className="flex justify-center items-center gap-1.5 pb-2 border-b border-neutral-200 dark:border-white/10">
                  {tagsUsed.filter(t => t.id !== 'smart-search').map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => handleTagClick(tag)}
                      className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                        activeTagId === tag.id
                          ? "bg-purple-600 text-white shadow-md shadow-purple-500/20"
                          : "bg-white/60 dark:bg-neutral-900/40 hover:bg-white dark:hover:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400 border border-neutral-300 dark:border-white/10"
                      }`}
                    >
                      {tag.label}
                    </button>
                  ))}
                </div>

                {/* 左右对称布局 */}
                <div className="flex gap-4 items-start">
                  {/* 左侧：硬匹配结果 */}
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex items-center gap-2 px-1">
                      <span className="p-1 bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-500 rounded-md text-xs">🔍</span>
                      <h2 className="text-xs font-black text-neutral-900 dark:text-white uppercase tracking-tight">Hard Match Results</h2>
                      <div className="h-px flex-1 bg-gradient-to-r from-blue-500/20 to-transparent" />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {marketData.map(m => <MarketCard key={m.id} market={m} variant="hard" />)}
                    </div>
                  </div>

                  {/* 右侧：标签结果 */}
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex items-center gap-2 px-1">
                      <span className="p-1 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-500 rounded-md text-xs">🏷️</span>
                      <h2 className="text-xs font-black text-neutral-900 dark:text-white uppercase tracking-tight">
                        {tagsUsed.find(t => t.id === activeTagId)?.label || "Semantic Results"}
                      </h2>
                      <div className="h-px flex-1 bg-gradient-to-r from-emerald-500/20 to-transparent" />
                    </div>
                    <div className="grid grid-cols-3 gap-2" key={`tag-grid-${activeTagId}`}>
                      {tagMarkets.map(m => <MarketCard key={`${activeTagId}-${m.id}`} market={m} variant="semantic" />)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
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
