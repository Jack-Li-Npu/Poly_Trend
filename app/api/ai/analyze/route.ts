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
      console.log("📊 Calculating market statistics...");
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
      console.log("✅ Statistics calculation complete:", statistics);
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

    console.log(`🤖 Using model ${model} for AI analysis...`);

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
        throw new Error(`Unsupported model: ${model}`);
    }

    return NextResponse.json({
      success: true,
      analysis: analysisResult,
      model,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("AI Analysis Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "AI analysis failed",
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

  const prompt = `You are a professional market analyst. Please analyze the following Polymarket prediction market data.
The data includes direct results from the search query (Hard Match) and selected markets from multiple related fields (Tag Selection).

Query: ${query}
Total Markets Analyzed: ${markets.length}
Total Volume: $${statistics.totalVolume.toLocaleString()}
Average Probability: ${(statistics.averageProbability * 100).toFixed(1)}%
High Confidence Markets: ${statistics.highConfidenceMarkets}

Here is the integrated prediction market data (JSON format):
${JSON.stringify(markets.map((m: any) => ({
  title: m.title,
  probability: `${(m.probability).toFixed(1)}%`,
  volume: m.volume,
  category_context: m.reasoning || "Direct Search"
})), null, 2)}

Please provide a deep analysis report based on this multi-dimensional data:
1. **Macro Market Sentiment**: Analyze the overall trend by combining hard match and multi-dimensional tag data.
2. **Multi-dimensional Findings**: 
   - Identify connections between different tag areas (e.g., Crypto, Politics, Tech, etc.).
   - Highlight 3-5 most representative or unusual markets.
3. **Risks and Uncertainties**: Evaluate the credibility of the current data and potential volatility risks.
4. **Decision/Strategic Recommendations**: Integrated strategy recommendations based on the data.

Please answer in English, using professional Markdown format.`;

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
          content: `You are a professional market analyst. Please analyze the following Polymarket prediction market data:

Query: ${query}
Total Markets: ${markets.length}
Total Volume: $${statistics.totalVolume.toLocaleString()}
Average Probability: ${(statistics.averageProbability * 100).toFixed(1)}%
High Confidence Markets: ${statistics.highConfidenceMarkets}

Here is the complete prediction market data (JSON format):
${JSON.stringify(markets.map((m: any) => ({
  ...m,
  probability: `${(m.probability * 100).toFixed(1)}%` // 在 Prompt 中转回百分比方便 AI 阅读
})), null, 2)}

Please provide:
1. **Market Trend Analysis**: Overall market sentiment and trends
2. **Key Findings**: 3-5 most noteworthy markets and reasons
3. **Risk Disclosure**: Potential risks and uncertainties
4. **Investment Recommendations**: Data-driven strategic suggestions

Please answer in English, using Markdown format.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${error}`);
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
          content: "You are a professional market analyst, skilled in analyzing prediction market data and providing investment advice.",
        },
        {
          role: "user",
          content: `Please analyze the following Polymarket prediction market data:

Query: ${query}
Total Markets: ${markets.length}
Total Volume: $${statistics.totalVolume.toLocaleString()}
Average Probability: ${(statistics.averageProbability * 100).toFixed(1)}%
High Confidence Markets: ${statistics.highConfidenceMarkets}

Here is the complete prediction market data (JSON format):
${JSON.stringify(markets.map((m: any) => ({
  ...m,
  probability: `${(m.probability * 100).toFixed(1)}%` // 在 Prompt 中转回百分比方便 AI 阅读
})), null, 2)}

Please provide:
1. **Market Trend Analysis**: Overall market sentiment and trends
2. **Key Findings**: 3-5 most noteworthy markets and reasons
3. **Risk Disclosure**: Potential risks and uncertainties
4. **Investment Recommendations**: Data-driven strategic suggestions

Please answer in English, using Markdown format.`,
        },
      ],
      max_tokens: 2000,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}
