import { NextRequest, NextResponse } from "next/server";
import {
  getPolyMacroData,
  getMarketsByTag,
  gammaMarketsToMarketData,
} from "@/lib/polymarket";
import { getCachedTags } from "@/lib/tag-cache";

export const dynamic = "force-dynamic";

type Params = {
  query?: string;
  tagId?: string;
  tags?: boolean;
  limit?: number;
};

function parseGetParams(request: NextRequest): Params {
  const { searchParams } = new URL(request.url);
  const tagsParam = searchParams.get("tags");
  return {
    query: searchParams.get("q") ?? undefined,
    tagId: searchParams.get("tagId") ?? undefined,
    tags: tagsParam === "1" || tagsParam === "true",
    limit: parseInt(searchParams.get("limit") ?? "50", 10) || 50,
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
    };
  } catch {
    return {};
  }
}

async function handleMarkets(params: Params) {
  const { query, tagId, tags, limit = 50 } = params;

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
