"use client";

import React, { useState, useEffect } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

interface MarketPrice {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  lastUpdated: string;
}

interface MarketSidebarProps {
  compact?: boolean;
}

export function MarketSidebar({ compact = false }: MarketSidebarProps) {
  const [cryptoPrices, setCryptoPrices] = useState<MarketPrice[]>([]);
  const [stockPrices, setStockPrices] = useState<MarketPrice[]>([]);
  const [chinaPrices, setChinaPrices] = useState<MarketPrice[]>([]);
  const [metalPrices, setMetalPrices] = useState<MarketPrice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 获取价格数据（这里使用模拟数据，实际应该调用真实API）
    const fetchPrices = async () => {
      // 模拟加密货币数据
      const mockCrypto: MarketPrice[] = [
        { symbol: "BTC", name: "Bitcoin", price: 97234.56, change24h: 2.34, lastUpdated: new Date().toISOString() },
        { symbol: "ETH", name: "Ethereum", price: 3456.78, change24h: -1.23, lastUpdated: new Date().toISOString() },
        { symbol: "SOL", name: "Solana", price: 145.23, change24h: 5.67, lastUpdated: new Date().toISOString() },
        { symbol: "BNB", name: "BNB", price: 612.34, change24h: 1.89, lastUpdated: new Date().toISOString() },
      ];
      
      // 模拟美股数据
      const mockStocks: MarketPrice[] = [
        { symbol: "NVDA", name: "NVIDIA", price: 124.56, change24h: 1.45, lastUpdated: new Date().toISOString() },
        { symbol: "AAPL", name: "Apple", price: 228.34, change24h: -0.56, lastUpdated: new Date().toISOString() },
        { symbol: "TSLA", name: "Tesla", price: 254.12, change24h: 3.21, lastUpdated: new Date().toISOString() },
      ];

      // 模拟 A 股数据
      const mockChina: MarketPrice[] = [
        { symbol: "000001.SH", name: "上证指数", price: 3124.56, change24h: 0.85, lastUpdated: new Date().toISOString() },
        { symbol: "399001.SZ", name: "深证成指", price: 10456.78, change24h: 1.12, lastUpdated: new Date().toISOString() },
        { symbol: "300059.SZ", name: "东方财富", price: 24.35, change24h: 2.45, lastUpdated: new Date().toISOString() },
      ];

      // 模拟贵金属数据
      const mockMetals: MarketPrice[] = [
        { symbol: "GOLD", name: "黄金 (Gold)", price: 2745.60, change24h: 0.23, lastUpdated: new Date().toISOString() },
        { symbol: "SILV", name: "白银 (Silver)", price: 32.45, change24h: -1.12, lastUpdated: new Date().toISOString() },
        { symbol: "OIL", name: "原油 (WTI)", price: 72.34, change24h: 0.45, lastUpdated: new Date().toISOString() },
      ];
      
      setCryptoPrices(mockCrypto);
      setStockPrices(mockStocks);
      setChinaPrices(mockChina);
      setMetalPrices(mockMetals);
      setLoading(false);
    };

    fetchPrices();
    
    // 每30秒更新一次价格
    const interval = setInterval(fetchPrices, 30000);
    
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className={`${compact ? 'w-full' : 'w-80'} bg-white dark:bg-gray-900 ${compact ? 'border' : 'border-l'} border-gray-200 dark:border-gray-800 rounded-xl p-4 overflow-y-auto`}>
        <div className="animate-pulse space-y-4">
          {[...Array(9)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-200 dark:bg-gray-800 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  const renderMarketItem = (market: MarketPrice) => (
    <div
      key={market.symbol}
      className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 rounded-lg p-3 hover:shadow-md transition-all border border-gray-200 dark:border-gray-700"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-900 dark:text-white">
            {market.symbol}
          </span>
          <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate max-w-[80px]">
            {market.name}
          </span>
        </div>
        {market.change24h >= 0 ? (
          <TrendingUp className="w-4 h-4 text-green-500" />
        ) : (
          <TrendingDown className="w-4 h-4 text-red-500" />
        )}
      </div>
      
      <div className="flex items-end justify-between">
        <span className="text-base font-bold text-gray-900 dark:text-white">
          ${market.price.toLocaleString(undefined, { 
            minimumFractionDigits: 2, 
            maximumFractionDigits: 2 
          })}
        </span>
        <span
          className={`text-xs font-semibold ${
            market.change24h >= 0
              ? "text-green-500"
              : "text-red-500"
          }`}
        >
          {market.change24h >= 0 ? "+" : ""}
          {market.change24h.toFixed(2)}%
        </span>
      </div>
    </div>
  );

  return (
    <div className="w-full bg-white/50 dark:bg-gray-900/50 backdrop-blur-md border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
      <div className="bg-gradient-to-r from-blue-600/10 via-indigo-600/10 to-purple-600/10 p-3 border-b border-gray-200/50 dark:border-gray-800/50 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 flex items-center gap-2">
            📊 全球指数
          </h2>
        </div>
        <div className="flex items-center gap-1.5 text-[9px] font-medium px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full">
          <span className="w-1 h-1 bg-blue-500 rounded-full animate-pulse"></span>
          LIVE
        </div>
      </div>
      
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 加密货币部分 */}
        <section className="space-y-2">
          <div className="flex items-center gap-2 pb-1 border-b border-blue-500/20">
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-500">Crypto</span>
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {cryptoPrices.map(renderMarketItem)}
          </div>
        </section>

        {/* A 股部分 */}
        <section className="space-y-2">
          <div className="flex items-center gap-2 pb-1 border-b border-red-500/20">
            <span className="text-[10px] font-black uppercase tracking-widest text-red-500">China A-Shares</span>
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {chinaPrices.map(renderMarketItem)}
          </div>
        </section>

        {/* 美股部分 */}
        <section className="space-y-2">
          <div className="flex items-center gap-2 pb-1 border-b border-purple-500/20">
            <span className="text-[10px] font-black uppercase tracking-widest text-purple-500">US Stocks</span>
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {stockPrices.map(renderMarketItem)}
          </div>
        </section>

        {/* 贵金属部分 */}
        <section className="space-y-2">
          <div className="flex items-center gap-2 pb-1 border-b border-yellow-600/20">
            <span className="text-[10px] font-black uppercase tracking-widest text-yellow-600">Metals & Oil</span>
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {metalPrices.map(renderMarketItem)}
          </div>
        </section>
      </div>
    </div>
  );
}
