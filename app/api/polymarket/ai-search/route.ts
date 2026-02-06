import { NextRequest, NextResponse } from "next/server";
import { runHybridSearch } from "@/lib/hybrid-search";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, geminiKey, geminiBaseUrl } = body;

    if (!query || typeof query !== "string" || query.trim() === "") {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    if (geminiKey) process.env.GEMINI_API_KEY = geminiKey;
    if (geminiBaseUrl) process.env.GEMINI_BASE_URL = geminiBaseUrl;

    const result = await runHybridSearch(query.trim());

    return NextResponse.json({
      markets: result.hardMatch,
      allRelevantMarkets: result.allRelevantMarkets,
      source: "hybrid",
      message: `Found ${result.hardMatch.length} direct results and multi-dimensional selections`,
      suggestedQueries: result.consortium.tagsUsed.map((t) => t.label).slice(0, 3),
      tagsUsed: result.consortium.tagsUsed,
      tagMarketsCache: result.consortium.tagMarkets,
      semanticGroups: result.consortium.semanticGroups,
      directSearchTags: result.directSearchTags,
      hardMatch: result.hardMatch,
      consortium: result.consortium,
    });
  } catch (error) {
    console.error("AI search API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
