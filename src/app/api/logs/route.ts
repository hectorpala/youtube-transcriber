import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { loadLogs } from "@/lib/data/loaders";
import { apiResponse } from "@/lib/data/api-helpers";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!checkRateLimit("logs")) {
    return NextResponse.json(
      { meta: { ok: false, warnings: ["Rate limit exceeded"] }, data: null },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const { searchParams } = request.nextUrl;
  const linesRaw = searchParams.get("lines");

  // Validate `lines` param is a positive integer (#25)
  if (linesRaw !== null) {
    const parsed = Number(linesRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return NextResponse.json(
        {
          meta: {
            ok: false,
            source: "director_log.csv",
            updatedAt: new Date().toISOString(),
            freshnessMs: null,
            freshness: "unknown",
            warnings: ["`lines` parameter must be a positive integer"],
          },
          data: null,
        },
        { status: 400 },
      );
    }
  }

  const lastN = Math.min(
    Number(linesRaw ?? 200),
    2000, // hard cap to prevent reading massive files
  );

  const result = await loadLogs(lastN);
  return apiResponse(result, "director_log.csv", {
    recordCount: result.ok ? result.data.length : undefined,
    request,
  });
}
