import { NextRequest, NextResponse } from "next/server";
import { getSparklineData } from "@/lib/polymarket";

export const dynamic = 'force-dynamic';

/**
 * 获取市场的历史价格数据
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tokenId = searchParams.get("tokenId");

    if (!tokenId) {
      return NextResponse.json(
        { success: false, error: "Token ID is required" },
        { status: 400 }
      );
    }

    const history = await getSparklineData(tokenId);

    return NextResponse.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error("Price history API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch price history",
      },
      { status: 500 }
    );
  }
}
