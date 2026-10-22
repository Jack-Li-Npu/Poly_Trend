import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
const methods = new Set(["GET", "POST", "PATCH"]);

async function forward(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  if (!methods.has(request.method))
    return Response.json({ detail: "Method not allowed" }, { status: 405 });
  const { path } = await context.params;
  if (
    path.some(
      (segment) =>
        segment === "." || segment === ".." || /[\\/?#]/.test(segment),
    )
  )
    return Response.json({ detail: "Invalid API path" }, { status: 400 });
  const base = (
    process.env.INTERNAL_API_URL ?? "http://localhost:8000"
  ).replace(/\/$/, "");
  const target = `${base}/api/v3/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  try {
    const response = await fetch(target, {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        Accept: request.headers.get("accept") ?? "application/json",
        ...(request.headers.get("last-event-id")
          ? { "Last-Event-ID": request.headers.get("last-event-id")! }
          : {}),
      },
      body: request.method === "GET" ? undefined : await request.text(),
      cache: "no-store",
      signal: request.signal,
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return Response.json(
      {
        detail:
          "The research API is unavailable. The saved case and run have not been replaced.",
      },
      { status: 503 },
    );
  }
}
export const GET = forward;
export const POST = forward;
export const PATCH = forward;
