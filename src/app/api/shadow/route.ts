import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { loadShadowSignals } from "@/lib/data/loaders";
import { paginatedApiResponse, parsePaginationParams } from "@/lib/data/api-helpers";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!checkRateLimit("shadow")) {
    return NextResponse.json(
      { meta: { ok: false, warnings: ["Rate limit exceeded"] }, data: null },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const { searchParams } = request.nextUrl;
  const pagination = parsePaginationParams(searchParams);

  const result = await loadShadowSignals();

  return paginatedApiResponse(result, "director_shadow.json", pagination, {
    request,
    skipped: result.ok ? result.skipped : undefined,
  });
}
