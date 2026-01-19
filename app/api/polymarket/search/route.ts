import { NextRequest, NextResponse } from "next/server";
import { getPolyMacroData } from "@/lib/polymarket";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query } = body;

    if (!query || typeof query !== "string" || query.trim() === "") {
      return NextResponse.json(
        { error: "Query is required" },
        { status: 400 }
      );
    }

    const markets = await getPolyMacroData(query.trim());
    return NextResponse.json(markets);
  } catch (error) {
    console.error("Search API error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to search markets",
      },
      { status: 500 }
    );
  }
}

