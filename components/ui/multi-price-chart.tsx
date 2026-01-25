"use client";

import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";

interface MultiPriceChartProps {
  groups: Array<{
    marketA: { title: string; chartData: any[] };
    marketB: { title: string; chartData: any[] };
    correlation: number;
  }>;
}

export function MultiPriceChart({ groups }: MultiPriceChartProps) {
  const [activeIndex, setActiveSetIndex] = useState(0);
  const currentGroup = groups[activeIndex];

  const height = 200;
  const width = 1000;

  const renderPath = (data: any[], color: string) => {
    if (!data || data.length < 2) return null;

    const minPrice = 0;
    const maxPrice = 1; // 概率 0-1
    const range = 1;

    const xStep = width / (data.length - 1);

    const points = data
      .map((d, i) => {
        const x = i * xStep;
        const y = height - (d.price / range) * height;
        return `${x},${y}`;
      })
      .join(" ");

    return (
      <motion.polyline
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1 }}
      />
    );
  };

  if (!groups || groups.length === 0) return null;

  return (
    <div className="w-full bg-white dark:bg-neutral-900 rounded-3xl border border-neutral-200 dark:border-neutral-800 p-6 shadow-sm">
      <div className="flex flex-col md:flex-row gap-6">
        {/* 左侧选择列表 */}
        <div className="w-full md:w-1/3 flex flex-col gap-2">
          <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2">高相关性市场对</h4>
          {groups.map((group, idx) => (
            <button
              key={`set-${idx}`}
              onClick={() => setActiveSetIndex(idx)}
              className={`p-3 rounded-2xl text-left text-xs transition-all border ${
                activeIndex === idx 
                  ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800" 
                  : "bg-white dark:bg-neutral-900 border-transparent hover:bg-neutral-50 dark:hover:bg-neutral-800"
              }`}
            >
              <div className="font-bold line-clamp-1 mb-1">{group.marketA.title}</div>
              <div className="text-neutral-400 mb-2">vs {group.marketB.title}</div>
              <div className={`text-[10px] font-black ${group.correlation > 0 ? "text-green-500" : "text-red-500"}`}>
                相关系数: {group.correlation.toFixed(2)}
              </div>
            </button>
          ))}
        </div>

        {/* 右侧图表 */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                <span className="text-[10px] font-bold">市场 A</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                <span className="text-[10px] font-bold">市场 B</span>
              </div>
            </div>
            <span className="text-[10px] text-neutral-400 font-medium italic">叠加趋势分析</span>
          </div>

          <div className="relative w-full h-[200px] bg-neutral-50 dark:bg-neutral-950/50 rounded-2xl border border-neutral-100 dark:border-neutral-800 p-4">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
              {/* 网格线 */}
              {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                <line 
                  key={v} 
                  x1="0" y1={height - v * height} 
                  x2={width} y2={height - v * height} 
                  stroke="currentColor" 
                  strokeOpacity="0.05" 
                />
              ))}
              
              {currentGroup && (
                <>
                  {renderPath(currentGroup.marketA.chartData, "#3b82f6")}
                  {renderPath(currentGroup.marketB.chartData, "#a855f7")}
                </>
              )}
            </svg>
            
            {/* 刻度 */}
            <div className="absolute left-2 top-2 bottom-2 flex flex-col justify-between text-[8px] text-neutral-400 font-bold pointer-events-none">
              <span>100%</span>
              <span>50%</span>
              <span>0%</span>
            </div>
          </div>
          
          <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-900/10 rounded-xl border border-amber-100 dark:border-amber-900/30">
            <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed italic">
              提示：强正相关（相关系数 &gt; 0.7）意味着两个市场往往同涨同跌；强负相关（相关系数 &lt; -0.7）意味着它们具有明显的替代或互斥关系。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
