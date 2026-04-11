import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { loadTrades } from "@/lib/data/loaders";
import { paginatedApiResponse, parsePaginationParams } from "@/lib/data/api-helpers";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!checkRateLimit("trades")) {
    return NextResponse.json(
      { meta: { ok: false, warnings: ["Rate limit exceeded"] }, data: null },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const { searchParams } = request.nextUrl;
  const pagination = parsePaginationParams(searchParams);

  const result = await loadTrades();
  const warnings: string[] = [];

  if (result.ok) {
    // Detect trades with old schema (no mode field)
    const oldSchema = result.data.filter((t) => !t.mode);
    if (oldSchema.length > 0) {
      warnings.push(
        `${oldSchema.length} trade(s) use old CSV schema (no execution columns)`,
      );
    }
  }

  return paginatedApiResponse(result, "director_trades.csv", pagination, {
    warnings,
    request,
    skipped: result.ok ? result.skipped : undefined,
  });
}
