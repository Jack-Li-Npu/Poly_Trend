"use client";

import React, { useMemo } from "react";
import { motion } from "framer-motion";

interface PriceChartProps {
  data: Array<{ date: string; price: number }>;
  height?: number;
  color?: string;
}

export function PriceChart({ data, height = 120, color = "#3b82f6" }: PriceChartProps) {
  const points = useMemo(() => {
    if (!data || data.length < 2) return "";

    const minPrice = Math.min(...data.map((d) => d.price));
    const maxPrice = Math.max(...data.map((d) => d.price));
    const range = maxPrice - minPrice || 0.1; // 避免除以零

    // 留出上下各 10% 的边距
    const padding = range * 0.1;
    const viewMin = minPrice - padding;
    const viewMax = maxPrice + padding;
    const viewRange = viewMax - viewMin;

    const width = 1000; // SVG viewBox 宽度
    const xStep = width / (data.length - 1);

    return data
      .map((d, i) => {
        const x = i * xStep;
        const y = height - ((d.price - viewMin) / viewRange) * height;
        return `${x},${y}`;
      })
      .join(" ");
  }, [data, height]);

  if (!data || data.length < 2) {
    return (
      <div className="flex items-center justify-center bg-neutral-50 dark:bg-neutral-900/50 rounded-xl border border-dashed border-neutral-200 dark:border-neutral-800" style={{ height }}>
        <p className="text-xs text-neutral-400">暂无充足价格历史数据</p>
      </div>
    );
  }

  return (
    <div className="relative w-full" style={{ height }}>
      <svg
        viewBox={`0 0 1000 ${height}`}
        className="w-full h-full overflow-visible"
        preserveAspectRatio="none"
      >
        {/* 渐变填充 */}
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        <motion.path
          d={`M 0,${height} L ${points} L 1000,${height} Z`}
          fill="url(#chartGradient)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1 }}
        />

        {/* 曲线路径 */}
        <motion.polyline
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.5, ease: "easeInOut" }}
        />
      </svg>
      
      {/* 价格范围提示 */}
      <div className="absolute top-0 right-0 flex flex-col items-end gap-1 pointer-events-none opacity-50">
        <span className="text-[10px] text-neutral-400">
          {(Math.max(...data.map(d => d.price)) * 100).toFixed(1)}%
        </span>
        <div className="flex-1"></div>
        <span className="text-[10px] text-neutral-400">
          {(Math.min(...data.map(d => d.price)) * 100).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
