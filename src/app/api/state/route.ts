import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { loadDirectorState } from "@/lib/data/loaders";
import { apiResponse } from "@/lib/data/api-helpers";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!checkRateLimit("state")) {
    return NextResponse.json(
      { meta: { ok: false, warnings: ["Rate limit exceeded"] }, data: null },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const result = await loadDirectorState();
  const posCount = result.ok ? Object.keys(result.data.positions).length : 0;
  return apiResponse(result, "director_state.json", {
    recordCount: posCount,
    request,
  });
}
