"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ArrowLeft, 
  Network, 
  TrendingUp, 
  Target, 
  Loader2,
  AlertTriangle,
  Info,
  CheckCircle2
} from "lucide-react";
import { BackgroundLines } from "@/components/ui/background-lines";
import { InsightGraph } from "@/components/ui/insight-graph";
import { MultiPriceChart } from "@/components/ui/multi-price-chart";
import { CircularProgress } from "@/components/ui/circular-progress";
import type { MarketData } from "@/types/polymarket";

function InsightsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = searchParams.get("q");
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!query) {
      router.push("/");
      return;
    }

    const fetchInsights = async () => {
      setIsLoading(true);
      try {
        // Try to get pre-filtered markets from sessionStorage
        let marketsToAnalyze: any[] | null = null;
        try {
          const saved = sessionStorage.getItem(`insights-data-${query}`);
          if (saved) {
            const insightsData = JSON.parse(saved);
            // Check if data is not too old (within 30 minutes)
            if (Date.now() - insightsData.timestamp < 30 * 60 * 1000) {
              marketsToAnalyze = insightsData.markets;
              if (marketsToAnalyze) {
                console.log(`♻️ Using ${marketsToAnalyze.length} pre-filtered markets from sessionStorage`);
              }
            } else {
              sessionStorage.removeItem(`insights-data-${query}`);
              console.log('⚠️ Insights data expired, will fetch fresh');
            }
          } else {
            console.log('⚠️ No pre-filtered insights data found in sessionStorage');
          }
        } catch (storageError) {
          console.error('Failed to read insights data from sessionStorage:', storageError);
        }

        const requestBody: any = { query };
        if (marketsToAnalyze && marketsToAnalyze.length > 0) {
          requestBody.markets = marketsToAnalyze;
        }

        const response = await fetch("/api/polymarket/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error("获取洞察分析失败");
        
        const result = await response.json();
        if (!result.success) throw new Error(result.error || "分析过程出错");
        
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "未知错误");
      } finally {
        setIsLoading(false);
      }
    };

    fetchInsights();
  }, [query, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black">
        <BackgroundLines className="flex flex-col items-center justify-center">
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex flex-col items-center gap-6"
          >
            <div className="relative">
              <Network className="w-16 h-16 text-blue-500 animate-pulse" />
              <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full animate-ping"></div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <h2 className="text-2xl font-black text-white">正在构建深度关联图谱...</h2>
              <p className="text-neutral-500 animate-bounce">正在聚合搜索、分析历史价格数据并计算相关性</p>
            </div>
            <div className="w-64 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ duration: 5, ease: "linear" }}
                className="h-full bg-blue-500"
              />
            </div>
          </motion.div>
        </BackgroundLines>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black p-4">
        <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">出错了</h2>
        <p className="text-neutral-400 mb-6">{error}</p>
        <button 
          onClick={() => router.push("/")}
          className="px-6 py-2 bg-neutral-800 text-white rounded-xl hover:bg-neutral-700 transition-colors"
        >
          返回首页
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-black pb-32">
      {/* 顶部导航 */}
      <div className="sticky top-0 z-50 bg-white/80 dark:bg-black/80 backdrop-blur-md border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => {
                if (window.history.length > 1) {
                  router.back();
                } else {
                  router.push(`/?q=${encodeURIComponent(query || "")}`);
                }
              }}
              className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-900 rounded-xl transition-colors flex items-center gap-2 group"
            >
              <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
              <span className="text-sm font-bold hidden sm:inline">返回结果</span>
            </button>
            <div className="h-8 w-px bg-neutral-200 dark:border-neutral-800 hidden sm:block"></div>
            <div>
              <h1 className="text-lg font-black leading-none">深度市场洞察</h1>
              <p className="text-[10px] text-neutral-500 uppercase font-bold tracking-widest mt-1">QUERY: {query}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 rounded-full border border-blue-500/20">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <span className="text-[10px] font-black text-blue-500 uppercase">AI 分析模式已开启</span>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 py-8 flex flex-col gap-12">
        
        {/* 第零层：同事件分组 */}
        {data.eventGroups && data.eventGroups.length > 0 && (
          <section className="flex flex-col gap-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              <h2 className="text-2xl font-black">📅 事件内部结果集</h2>
            </div>
            <div className="flex flex-col gap-6">
              {data.eventGroups.map((group: any, idx: number) => (
                <div key={idx} className="bg-white dark:bg-neutral-900/50 p-6 rounded-[2.5rem] border border-neutral-200 dark:border-neutral-800 shadow-sm">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="px-3 py-1 bg-neutral-100 dark:bg-neutral-800 rounded-full text-[10px] font-black uppercase tracking-tighter text-neutral-500">
                      EVENT
                    </div>
                    <h3 className="text-sm font-black truncate">{group.eventTitle}</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {group.markets.map((m: MarketData) => (
                      <div key={m.id} className="bg-neutral-50 dark:bg-neutral-800/50 p-4 rounded-3xl border border-neutral-100 dark:border-neutral-700/50 flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <div className="w-8 h-8 rounded-lg overflow-hidden bg-neutral-200 dark:bg-neutral-900">
                            {m.image ? <img src={m.image} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[8px] font-bold">PM</div>}
                          </div>
                          <span className="text-sm font-black text-blue-500">{m.probability}%</span>
                        </div>
                        <p className="text-[11px] font-bold leading-snug line-clamp-2 min-h-[2rem]">{m.title}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 第一层：核心市场 */}
        <section className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <Target className="w-6 h-6 text-amber-500" />
            <h2 className="text-2xl font-black">🎯 核心相关市场</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {data.coreMarkets.map((m: MarketData) => (
              <motion.div 
                key={m.id}
                whileHover={{ y: -5 }}
                className="bg-white dark:bg-neutral-900 p-4 rounded-3xl border border-neutral-200 dark:border-neutral-800 shadow-sm flex flex-col gap-4"
              >
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl overflow-hidden bg-neutral-100 dark:bg-neutral-800">
                    {m.image ? <img src={m.image} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[10px] font-bold">PM</div>}
                  </div>
                  <CircularProgress percentage={m.probability} size={40} strokeWidth={3} />
                </div>
                <h3 className="text-xs font-bold line-clamp-2 h-8 leading-tight">{m.title}</h3>
                <div className="flex items-center justify-between text-[10px] font-black uppercase text-neutral-400">
                  <span>{m.volume}</span>
                  <span className="text-blue-500">{m.probability}%</span>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* 第二层：关系网络图 */}
        <section className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Network className="w-6 h-6 text-purple-500" />
              <h2 className="text-2xl font-black">🕸️ 市场关联图谱</h2>
            </div>
            <div className="text-[10px] bg-neutral-100 dark:bg-neutral-900 px-3 py-1.5 rounded-full font-bold text-neutral-500 flex items-center gap-2 border border-neutral-200 dark:border-neutral-800">
              <Info className="w-3 h-3" />
              节点可拖拽互动
            </div>
          </div>
          <InsightGraph 
            markets={data.allMarkets} 
            highCorrelationPairs={data.highCorrelationPairs}
          />
        </section>

        {/* 价格联动趋势 */}
        <section className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-6 h-6 text-green-500" />
            <h2 className="text-2xl font-black">📊 价格相关性分析（基于历史数据）</h2>
          </div>
          {data.highCorrelationPairs.length > 0 ? (
            <div className="flex flex-col gap-6">
              <MultiPriceChart groups={data.highCorrelationPairs} />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.highCorrelationPairs.map((pair: any, idx: number) => (
                  <div 
                    key={idx}
                    className="p-4 bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className={`text-xs font-black px-2 py-1 rounded-full ${
                        pair.correlation > 0 
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}>
                        相关性: {(pair.correlation * 100).toFixed(0)}%
                      </span>
                      {pair.relationType === 'intra-event' && (
                        <span className="text-[8px] font-bold text-neutral-400 uppercase px-2 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded-full">
                          同事件
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="text-[10px] font-bold text-neutral-500 uppercase mb-1">市场 A</div>
                      <p className="text-xs font-bold leading-tight mb-3" title={pair.marketA.title}>
                        {pair.marketA.title}
                      </p>
                      <div className="text-[10px] font-bold text-neutral-500 uppercase mb-1">市场 B</div>
                      <p className="text-xs font-bold leading-tight" title={pair.marketB.title}>
                        {pair.marketB.title}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-12 flex flex-col items-center justify-center bg-neutral-100 dark:bg-neutral-900 rounded-3xl border border-dashed border-neutral-300 dark:border-neutral-800">
              <p className="text-neutral-400 text-sm">暂无具备显著相关性的市场对</p>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}

export default function InsightsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-black">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    }>
      <InsightsContent />
    </Suspense>
  );
}
