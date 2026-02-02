"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, Brain, TrendingUp, Activity, Calendar } from "lucide-react";
import { MarkdownRenderer } from "./markdown-renderer";

interface AIAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  query: string;
  analysis: {
    answer: string;
    boxed_answer: string;
    market_sentiment?: {
      total_markets: number;
      avg_probability: number;
      top_markets: Array<{
        title: string;
        probability: number;
        outcome: string;
        volume: string;
      }>;
    };
    task_id?: string;
    timestamp?: string;
  } | null;
  isLoading: boolean;
}

export function AIAnalysisModal({
  isOpen,
  onClose,
  query,
  analysis,
  isLoading,
}: AIAnalysisModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
          />

          {/* Modal 内容 - 居中定位 */}
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", duration: 0.5 }}
              className="w-full max-w-4xl max-h-[90vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col pointer-events-auto"
            >
            {/* 头部 */}
            <div className="relative bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 p-6">
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
              >
                <X className="w-5 h-5 text-white" />
              </button>
              <div className="flex items-center gap-3 text-white">
                <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                  <Brain className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold">AI Deep Analysis Report</h2>
                  <p className="text-white/80 text-sm mt-1">
                    Deep market insights powered by Gemini AI
                  </p>
                </div>
              </div>
            </div>

            {/* 内容区域 */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* 问题 */}
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                  Analysis Query
                </p>
                <p className="text-lg font-medium text-gray-900 dark:text-white">
                  {query}
                </p>
              </div>

              {/* 加载状态 */}
              {isLoading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center py-12 px-6"
                >
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full"
                  />
                  <p className="mt-4 text-gray-600 dark:text-gray-400 text-center font-bold">
                    Gemini is analyzing market data and sentiment...
                  </p>
                  <p className="mt-2 text-[10px] text-gray-500 dark:text-gray-500 text-center">
                    Integrating multi-dimensional data and generating a professional report, please wait
                  </p>
                  <div className="mt-6 w-full max-w-md bg-gray-100 dark:bg-gray-800 rounded-lg p-4">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                      Analysis Tasks:
                    </p>
                    <ul className="text-xs text-gray-500 dark:text-gray-500 space-y-1">
                      <li>✓ Extracting core prediction market metrics</li>
                      <li>⏳ Analyzing historical price trends</li>
                      <li>⏳ Evaluating market sentiment and confidence</li>
                      <li>⏳ Generating professional investment strategies</li>
                    </ul>
                  </div>
                  <p className="mt-4 text-xs text-gray-400 dark:text-gray-600 text-center">
                    Please keep this window open
                  </p>
                </motion.div>
              )}

              {/* 分析结果 */}
              {!isLoading && analysis && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="space-y-6"
                >
                  {/* Boxed Answer (简短摘要) */}
                  {analysis.boxed_answer && (
                    <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-2 border-green-200 dark:border-green-700 rounded-xl p-6">
                      <div className="flex items-center gap-2 mb-3">
                        <TrendingUp className="w-5 h-5 text-green-600 dark:text-green-400" />
                        <h3 className="text-lg font-bold text-green-900 dark:text-green-100">
                          Core Conclusion
                        </h3>
                      </div>
                      <div className="text-green-800 dark:text-green-200 leading-relaxed">
                        <MarkdownRenderer content={analysis.boxed_answer.replace(/\\boxed\{|\}/g, "")} />
                      </div>
                    </div>
                  )}

                  {/* 详细分析 */}
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Activity className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                        Detailed Analysis
                      </h3>
                    </div>
                    <div className="text-gray-700 dark:text-gray-300">
                      <MarkdownRenderer content={analysis.answer} />
                    </div>
                  </div>

                  {/* 市场情绪摘要 */}
                  {analysis.market_sentiment && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-6">
                      <h3 className="text-lg font-bold text-blue-900 dark:text-blue-100 mb-4">
                        Market Sentiment Summary
                      </h3>
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="bg-white dark:bg-gray-800 rounded-lg p-4">
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            Markets Analyzed
                          </p>
                          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                            {analysis.market_sentiment.total_markets}
                          </p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 rounded-lg p-4">
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            Avg Probability
                          </p>
                          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                            {(analysis.market_sentiment.avg_probability * 100).toFixed(1)}%
                          </p>
                        </div>
                      </div>

                      {/* 顶级市场 */}
                      {analysis.market_sentiment.top_markets && analysis.market_sentiment.top_markets.length > 0 && (
                        <div className="mt-4">
                          <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-3">
                            Key Market Indicators
                          </p>
                          <div className="space-y-2">
                            {analysis.market_sentiment.top_markets.map((market, idx) => (
                              <div
                                key={idx}
                                className="bg-white dark:bg-gray-800 rounded-lg p-3"
                              >
                                <p className="text-sm font-medium text-gray-900 dark:text-white line-clamp-2 mb-2">
                                  {market.title}
                                </p>
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    {market.outcome}
                                  </span>
                                  <div className="flex items-center gap-3">
                                    <span className="text-sm font-bold text-green-600 dark:text-green-400">
                                      {(market.probability * 100).toFixed(1)}%
                                    </span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                      {market.volume}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 元数据 */}
                  {analysis.task_id && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                          <span>
                          {analysis.timestamp
                            ? new Date(analysis.timestamp).toLocaleString("en-US")
                            : ""}
                        </span>
                      </div>
                      <div>Task ID: {analysis.task_id}</div>
                    </div>
                  )}
                </motion.div>
              )}

              {/* 错误状态 */}
              {!isLoading && !analysis && (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4">🤔</div>
                  <p className="text-gray-600 dark:text-gray-400">
                    No analysis results
                  </p>
                </div>
              )}
            </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
