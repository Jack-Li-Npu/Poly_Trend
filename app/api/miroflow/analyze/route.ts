import { NextRequest, NextResponse } from "next/server";

/**
 * MiroFlow API 分析路由
 * 将搜索结果发送到本地 MiroFlow API Server 进行分析
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, markets, timestamp, totalResults } = body;

    console.log("📦 [PACKAGED DATA FOR MIROTHINKER]");
    console.log(JSON.stringify({
      query,
      timestamp,
      totalResults,
      marketCount: markets?.length || 0,
      markets: (markets || []).map((m: any) => ({
        title: m.title,
        probability: m.probability,
        outcome: m.outcome,
        volume: m.volume,
        outcomes: m.outcomes
      }))
    }, null, 2));

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Query is required" },
        { status: 400 }
      );
    }

    // 调用本地 MiroFlow API Server
    const miroflowUrl = process.env.MIROFLOW_API_URL || "http://localhost:8000/analyze";
    
    console.log(`Calling MiroFlow API for query: ${query}`);
    console.log(`Sending ${markets?.length || 0} markets to MiroFlow`);
    console.log(`MiroFlow URL: ${miroflowUrl}`);

    // 使用 AbortController 来设置超时（10 分钟）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 分钟

    try {
      const miroflowResponse = await fetch(miroflowUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          timestamp: timestamp || new Date().toISOString(),
          totalResults: totalResults || markets?.length || 0,
          markets: markets || [],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!miroflowResponse.ok) {
        const errorText = await miroflowResponse.text();
        console.error(`MiroFlow API error: ${miroflowResponse.status} - ${errorText}`);
        throw new Error(`MiroFlow API error: ${miroflowResponse.status}`);
      }

      const result = await miroflowResponse.json();
      console.log(`MiroFlow analysis completed. Task ID: ${result.task_id}`);

      return NextResponse.json({
        success: true,
        data: result,
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    console.error("MiroFlow API call failed:", error);
    
    // 判断错误类型
    let errorMessage = "Failed to analyze with MiroFlow";
    let suggestion = "请确保 MiroFlow API Server 正在运行 (http://localhost:8000)";
    
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        errorMessage = "分析超时（超过10分钟）";
        suggestion = "MiroFlow 分析时间过长，请检查服务器状态或稍后重试";
      } else {
        errorMessage = error.message;
      }
    }
    
    // 返回友好的错误信息
    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        suggestion: suggestion,
      },
      { status: 500 }
    );
  }
}

// 配置路由段选项以增加超时时间
export const maxDuration = 60; // Vercel Hobby 计划上限为 60 秒
export const dynamic = 'force-dynamic';
