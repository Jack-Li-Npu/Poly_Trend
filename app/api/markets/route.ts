import { NextRequest, NextResponse } from "next/server";
import {
  getPolyMacroData,
  getMarketsByTag,
  gammaMarketsToMarketData,
} from "@/lib/polymarket";
import { getCachedTags } from "@/lib/tag-cache";
import { runHybridSearch } from "@/lib/hybrid-search";

export const dynamic = "force-dynamic";

type Params = {
  query?: string;
  tagId?: string;
  tags?: boolean;
  limit?: number;
  geminiKey?: string;
  full?: boolean;
  geminiBaseUrl?: string;
};

function parseGetParams(request: NextRequest): Params {
  const { searchParams } = new URL(request.url);
  const tagsParam = searchParams.get("tags");
  return {
    query: searchParams.get("q") ?? undefined,
    tagId: searchParams.get("tagId") ?? undefined,
    tags: tagsParam === "1" || tagsParam === "true",
    limit: parseInt(searchParams.get("limit") ?? "50", 10) || 50,
    geminiKey: undefined,
    full: false,
    geminiBaseUrl: undefined,
  };
}

async function parsePostParams(request: NextRequest): Promise<Params> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") return {};
    return {
      query: typeof body.query === "string" ? body.query.trim() : undefined,
      tagId: typeof body.tagId === "string" ? body.tagId.trim() : undefined,
      tags: body.tags === true || body.tags === 1,
      limit:
        typeof body.limit === "number"
          ? Math.min(100, Math.max(1, body.limit))
          : 50,
      geminiKey: typeof body.geminiKey === "string" ? body.geminiKey : undefined,
      full: body.full === true || body.full === 1,
      geminiBaseUrl:
        typeof body.geminiBaseUrl === "string" ? body.geminiBaseUrl : undefined,
    };
  } catch {
    return {};
  }
}

async function handleMarkets(params: Params) {
  const { query, tagId, tags, limit = 50, geminiKey, full, geminiBaseUrl } =
    params;

  // Consortium mode: hard match + semantic consortium (requires geminiKey)
  if (full && query && geminiKey) {
    try {
      if (geminiKey) process.env.GEMINI_API_KEY = geminiKey;
      if (geminiBaseUrl) process.env.GEMINI_BASE_URL = geminiBaseUrl;
      const result = await runHybridSearch(query);
      return NextResponse.json({
        success: true,
        source: "hybrid",
        hardMatch: result.hardMatch,
        consortium: result.consortium,
        allRelevantMarkets: result.allRelevantMarkets,
        directSearchTags: result.directSearchTags,
        message: `Found ${result.hardMatch.length} hard match and consortium results`,
      });
    } catch (error) {
      console.error("[api/markets] Hybrid search error:", error);
      return NextResponse.json(
        {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Hybrid search failed (check Gemini API key)",
        },
        { status: 500 }
      );
    }
  }

  if (tags) {
    const tagList = await getCachedTags();
    return NextResponse.json({
      success: true,
      source: "tags",
      tags: tagList,
      total: tagList.length,
      message: `Fetched ${tagList.length} tags`,
    });
  }

  if (tagId) {
    const gammaMarkets = await getMarketsByTag(tagId, limit);
    const markets = await gammaMarketsToMarketData(gammaMarkets);
    return NextResponse.json({
      success: true,
      source: "tag",
      markets,
      total: markets.length,
      tagId,
      message: `Found ${markets.length} markets for tag ${tagId}`,
    });
  }

  if (query) {
    const markets = await getPolyMacroData(query);
    const limited = markets.slice(0, limit);
    return NextResponse.json({
      success: true,
      source: "search",
      markets: limited,
      total: limited.length,
      query,
      message: `Found ${limited.length} markets for query "${query}"`,
    });
  }

  return NextResponse.json(
    {
      success: false,
      error: "Missing parameters. Provide one of: query (q), tagId, or tags=true",
    },
    { status: 400 }
  );
}

export async function GET(request: NextRequest) {
  try {
    const params = parseGetParams(request);
    return handleMarkets(params);
  } catch (error) {
    console.error("[api/markets] GET error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to fetch markets",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const params = await parsePostParams(request);
    return handleMarkets(params);
  } catch (error) {
    console.error("[api/markets] POST error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to fetch markets",
      },
      { status: 500 }
    );
  }
}
