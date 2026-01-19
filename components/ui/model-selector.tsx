"use client";

import React, { useState, useEffect } from "react";
import { Brain, Sparkles, X, Settings } from "lucide-react";

export type AIModel = "gemini" | "claude" | "chatgpt" | "mirothinker";

interface ModelConfig {
  name: string;
  displayName: string;
  icon: string;
  requiresApiKey: boolean;
  placeholder: string;
}

const MODEL_CONFIGS: Record<AIModel, ModelConfig> = {
  gemini: {
    name: "gemini",
    displayName: "Gemini",
    icon: "✨",
    requiresApiKey: true,
    placeholder: "输入 Gemini API Key",
  },
  claude: {
    name: "claude",
    displayName: "Claude",
    icon: "🧠",
    requiresApiKey: true,
    placeholder: "输入 Claude API Key",
  },
  chatgpt: {
    name: "chatgpt",
    displayName: "ChatGPT",
    icon: "🤖",
    requiresApiKey: true,
    placeholder: "输入 OpenAI API Key",
  },
  mirothinker: {
    name: "mirothinker",
    displayName: "MiroThinker (本地)",
    icon: "🔮",
    requiresApiKey: false,
    placeholder: "使用本地模型",
  },
};

interface ModelSelectorProps {
  selectedModel: AIModel;
  onModelChange: (model: AIModel, apiKey?: string) => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  analysisComplete: boolean;
  disabled?: boolean;
}

export function ModelSelector({
  selectedModel,
  onModelChange,
  onAnalyze,
  isAnalyzing,
  analysisComplete,
  disabled = false,
}: ModelSelectorProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [tempModel, setTempModel] = useState<AIModel>(selectedModel);

  // 从 localStorage 加载 API keys
  useEffect(() => {
    const savedKeys = localStorage.getItem("ai_api_keys");
    if (savedKeys) {
      try {
        setApiKeys(JSON.parse(savedKeys));
      } catch (e) {
        console.error("Failed to load API keys:", e);
      }
    }
  }, []);

  // 保存 API keys 到 localStorage
  const saveApiKey = (model: AIModel, key: string) => {
    const newKeys = { ...apiKeys, [model]: key };
    setApiKeys(newKeys);
    localStorage.setItem("ai_api_keys", JSON.stringify(newKeys));
  };

  const handleModelSelect = () => {
    const config = MODEL_CONFIGS[tempModel];
    if (config.requiresApiKey && !apiKeys[tempModel]) {
      alert(`请先输入 ${config.displayName} 的 API Key`);
      return;
    }
    onModelChange(tempModel, apiKeys[tempModel]);
    setShowSettings(false);
  };

  const currentConfig = MODEL_CONFIGS[selectedModel];

  return (
    <div className="relative">
      {/* 主按钮 */}
      <button
        onClick={onAnalyze}
        disabled={disabled || isAnalyzing}
        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white rounded-lg font-medium transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 shadow-lg whitespace-nowrap"
      >
        {isAnalyzing ? (
          <>
            <Brain className="w-4 h-4 animate-spin" />
            <span className="text-sm">
              {selectedModel === "mirothinker" ? "后台深度分析中(3-10min)..." : "AI 分析中..."}
            </span>
          </>
        ) : (
          <>
            <span className="text-lg">{currentConfig.icon}</span>
            <span className="text-sm">AI 深度分析</span>
          </>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowSettings(!showSettings);
          }}
          className="ml-1 p-1 hover:bg-white/20 rounded transition-colors"
          disabled={isAnalyzing}
        >
          <Settings className="w-3 h-3" />
        </button>
      </button>

      {/* 设置面板 */}
      {showSettings && (
        <div className="absolute top-full mt-2 right-0 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
              选择 AI 模型
            </h3>
            <button
              onClick={() => setShowSettings(false)}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
            >
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          {/* 模型选择 */}
          <div className="space-y-2 mb-4">
            {(Object.keys(MODEL_CONFIGS) as AIModel[]).map((model) => {
              const config = MODEL_CONFIGS[model];
              return (
                <button
                  key={model}
                  onClick={() => setTempModel(model)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all ${
                    tempModel === model
                      ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                      : "border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700"
                  }`}
                >
                  <span className="text-2xl">{config.icon}</span>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      {config.displayName}
                    </div>
                    {config.requiresApiKey && !apiKeys[model] && (
                      <div className="text-xs text-red-500">需要 API Key</div>
                    )}
                    {config.requiresApiKey && apiKeys[model] && (
                      <div className="text-xs text-green-500">已配置</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* API Key 输入 */}
          {MODEL_CONFIGS[tempModel].requiresApiKey && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                API Key
              </label>
              <input
                type="password"
                value={apiKeys[tempModel] || ""}
                onChange={(e) => saveApiKey(tempModel, e.target.value)}
                placeholder={MODEL_CONFIGS[tempModel].placeholder}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                API Key 将安全保存在本地浏览器
              </p>
            </div>
          )}

          {/* 确认按钮 */}
          <button
            onClick={handleModelSelect}
            className="w-full px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-medium transition-colors"
          >
            确认选择
          </button>
        </div>
      )}
    </div>
  );
}
