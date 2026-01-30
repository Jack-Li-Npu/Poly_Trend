import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60; // Vercel Hobby 计划上限为 60 秒
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { model, apiKey, query, markets, timestamp, tagsUsed, searchSource, geminiBaseUrl } = body;
    let { statistics } = body;

    // 如果前端没有传递统计信息，则在此处计算
    if (!statistics) {
      console.log("📊 计算市场统计信息...");
      const totalVolume = markets.reduce((sum: number, m: any) => {
        // 解析 volume 字符串，例如 "$1.2M", "$500K", "$100"
        let val = 0;
        if (typeof m.volume === 'number') {
          val = m.volume;
        } else if (typeof m.volume === 'string') {
          const clean = m.volume.replace('$', '').replace(/,/g, '');
          if (clean.endsWith('M')) {
            val = parseFloat(clean) * 1000000;
          } else if (clean.endsWith('K')) {
            val = parseFloat(clean) * 1000;
          } else {
            val = parseFloat(clean) || 0;
          }
        }
        return sum + val;
      }, 0);

      const averageProbability = markets.length > 0
        ? markets.reduce((sum: number, m: any) => sum + (m.probability || 0), 0) / markets.length / 100
        : 0;

      const highConfidenceMarkets = markets.filter((m: any) => (m.probability || 0) > 80 || (m.probability || 0) < 20).length;

      statistics = {
        totalVolume,
        averageProbability,
        highConfidenceMarkets
      };
      console.log("✅ 统计信息计算完成:", statistics);
    }

    console.log("📦 [PACKAGED DATA FOR AI ANALYSIS]");
    console.log(JSON.stringify({
      query,
      model,
      marketCount: markets.length,
      statistics,
      markets: markets.map((m: any) => ({
        title: m.title,
        probability: m.probability,
        outcome: m.outcome,
        volume: m.volume,
        outcomes: m.outcomes
      }))
    }, null, 2));

    console.log(`🤖 使用模型 ${model} 进行AI分析...`);

    // 根据不同模型调用不同的API
    let analysisResult;
    
    switch (model) {
      case "gemini":
        analysisResult = await analyzeWithGemini(apiKey, query, markets, statistics, geminiBaseUrl);
        break;
      
      case "claude":
        analysisResult = await analyzeWithClaude(apiKey, query, markets, statistics);
        break;
      
      case "chatgpt":
        analysisResult = await analyzeWithChatGPT(apiKey, query, markets, statistics);
        break;
      
      default:
        throw new Error(`不支持的模型: ${model}`);
    }

    return NextResponse.json({
      success: true,
      analysis: analysisResult,
      model,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("AI分析错误:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "AI分析失败",
      },
      { status: 500 }
    );
  }
}

// Gemini API 分析
async function analyzeWithGemini(apiKey: string, query: string, markets: any[], statistics: any, baseUrl?: string) {
  // 设置环境变量以供 callGeminiAPI 使用
  if (apiKey) process.env.GEMINI_API_KEY = apiKey;
  if (baseUrl) process.env.GEMINI_BASE_URL = baseUrl;

  const { callGeminiAPI } = await import("@/lib/gemini");

  const prompt = `你是一个专业的市场分析师。请分析以下Polymarket预测市场数据。
数据包含搜索查询的直接结果（硬匹配）以及多个相关领域的精选市场（标签精选）。

查询: ${query}
分析市场总数: ${markets.length}
总交易量: $${statistics.totalVolume.toLocaleString()}
平均概率: ${(statistics.averageProbability * 100).toFixed(1)}%
高置信度市场: ${statistics.highConfidenceMarkets}

以下是完整的预测市场整合数据 (JSON 格式):
${JSON.stringify(markets.map((m: any) => ({
  title: m.title,
  probability: `${(m.probability).toFixed(1)}%`,
  volume: m.volume,
  category_context: m.reasoning || "搜索直达"
})), null, 2)}

请根据上述整合了多维标签的数据提供一份深度分析报告：
1. **宏观市场情绪**: 结合硬匹配与多维标签数据，分析整体趋势。
2. **多维度发现**: 
   - 识别不同标签领域（如 Crypto, Politics, Tech 等）之间的关联。
   - 挑选 3-5 个最具代表性或异常的市场。
3. **风险与不确定性**: 评估当前数据的可信度及潜在波动风险。
4. **决策/策略建议**: 基于数据的一体化策略建议。

请用中文回答，使用专业的 Markdown 格式。`;

  return await callGeminiAPI(prompt);
}

// Claude API 分析
async function analyzeWithClaude(apiKey: string, query: string, markets: any[], statistics: any) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `你是一个专业的市场分析师。请分析以下Polymarket预测市场数据：

查询: ${query}
市场数量: ${markets.length}
总交易量: $${statistics.totalVolume.toLocaleString()}
平均概率: ${(statistics.averageProbability * 100).toFixed(1)}%
高置信度市场: ${statistics.highConfidenceMarkets}

以下是完整的预测市场数据 (JSON 格式):
${JSON.stringify(markets.map((m: any) => ({
  ...m,
  probability: `${(m.probability * 100).toFixed(1)}%` // 在 Prompt 中转回百分比方便 AI 阅读
})), null, 2)}

请根据上述完整数据提供：
1. **市场趋势分析**: 整体市场情绪和趋势
2. **关键发现**: 最值得关注的3-5个市场及原因
3. **风险提示**: 潜在风险和不确定因素
4. **投资建议**: 基于数据的策略建议

请用中文回答，使用Markdown格式。`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API错误: ${error}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

// ChatGPT API 分析
async function analyzeWithChatGPT(apiKey: string, query: string, markets: any[], statistics: any) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4-turbo-preview",
      messages: [
        {
          role: "system",
          content: "你是一个专业的市场分析师，擅长分析预测市场数据并提供投资建议。",
        },
        {
          role: "user",
          content: `请分析以下Polymarket预测市场数据：

查询: ${query}
市场数量: ${markets.length}
总交易量: $${statistics.totalVolume.toLocaleString()}
平均概率: ${(statistics.averageProbability * 100).toFixed(1)}%
高置信度市场: ${statistics.highConfidenceMarkets}

以下是完整的预测市场数据 (JSON 格式):
${JSON.stringify(markets.map((m: any) => ({
  ...m,
  probability: `${(m.probability * 100).toFixed(1)}%` // 在 Prompt 中转回百分比方便 AI 阅读
})), null, 2)}

请根据上述完整数据提供：
1. **市场趋势分析**: 整体市场情绪和趋势
2. **关键发现**: 最值得关注的3-5个市场及原因
3. **风险提示**: 潜在风险和不确定因素
4. **投资建议**: 基于数据的策略建议

请用中文回答，使用Markdown格式。`,
        },
      ],
      max_tokens: 2000,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API错误: ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}
