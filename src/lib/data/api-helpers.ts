import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import type { DataResult } from "./schemas";
import { STALE_THRESHOLD_MS, OFFLINE_THRESHOLD_MS } from "@/lib/constants";

export type FreshnessStatus = "live" | "stale" | "offline" | "unknown";

export function freshnessStatus(staleMs: number | undefined): FreshnessStatus {
  if (staleMs === undefined) return "unknown";
  if (staleMs < STALE_THRESHOLD_MS) return "live";
  if (staleMs < OFFLINE_THRESHOLD_MS) return "stale";
  return "offline";
}

export function freshnessLabel(status: FreshnessStatus): string {
  switch (status) {
    case "live":
      return "Bot is running normally";
    case "stale":
      return "Data is stale — bot may be lagging or paused";
    case "offline":
      return "Bot appears offline — no updates for 30+ min";
    case "unknown":
      return "Could not determine freshness";
  }
}

// ---------------------------------------------------------------------------
// ETag helpers (#23)
// ---------------------------------------------------------------------------

function generateETag(data: unknown): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex")
    .slice(0, 32); // truncate for reasonable ETag length
  return `"${hash}"`;
}

/**
 * Check if the client's If-None-Match header matches the generated ETag.
 * Returns a 304 response if it matches, or null if the full response should be sent.
 */
export function checkETag(
  request: NextRequest | undefined,
  etag: string,
): NextResponse | null {
  if (!request) return null;
  const ifNoneMatch = request.headers.get("if-none-match");
  // Support multiple ETags in If-None-Match header (comma-separated per RFC 7232)
  if (ifNoneMatch && ifNoneMatch.split(",").some((t) => t.trim() === etag)) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "no-cache",
      },
    });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Standard API envelope
// ---------------------------------------------------------------------------

export interface ApiMeta {
  ok: boolean;
  source: string;
  updatedAt: string; // ISO timestamp of file mtime
  freshnessMs: number | null;
  freshness: FreshnessStatus;
  recordCount?: number;
  warnings: string[];
}

export interface ApiResponse<T> {
  meta: ApiMeta;
  data: T | null;
}

// ---------------------------------------------------------------------------
// Pagination types
// ---------------------------------------------------------------------------

export interface PaginatedApiResponse<T> {
  meta: ApiMeta;
  data: T[] | null;
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface PaginationParams {
  page: number | null; // null means "return all"
  limit: number;
}

/**
 * Parse pagination query params from a request.
 * - If no `page` param is given, returns page=null (backward compat: return all, capped)
 * - If `page` is given, validates it as a positive integer.
 */
export function parsePaginationParams(
  searchParams: URLSearchParams,
  defaultLimit: number = 100,
  maxCap: number = 5000,
): PaginationParams {
  const pageRaw = searchParams.get("page");
  const limitRaw = searchParams.get("limit");

  const parsedLimit = limitRaw ? parseInt(limitRaw, 10) : NaN;
  const limit = Number.isFinite(parsedLimit) && parsedLimit >= 1
    ? Math.min(parsedLimit, maxCap)
    : defaultLimit;

  const parsedPage = pageRaw ? parseInt(pageRaw, 10) : NaN;
  const page = pageRaw !== null
    ? (Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.min(parsedPage, 10_000) : 1)
    : null;

  return { page, limit };
}

// ---------------------------------------------------------------------------
// safeJsonResponse: success = 200, file-not-found = 404, errors = 500 (#17)
// ---------------------------------------------------------------------------

export function safeJsonResponse<T>(
  body: { meta: { ok: boolean; warnings: string[]; [key: string]: unknown }; data: T | null; [key: string]: unknown },
  opts?: { etag?: string; freshness?: FreshnessStatus; httpStatus?: number },
): NextResponse {
  const status = body.meta.ok ? 200 : (opts?.httpStatus ?? 500);
  const headers: Record<string, string> = {
    "Cache-Control": body.meta.ok ? "no-cache" : "no-store",
  };
  if (opts?.freshness) {
    headers["X-Bot-Freshness"] = opts.freshness;
  }
  if (opts?.etag) {
    headers["ETag"] = opts.etag;
  }

  return NextResponse.json(body, { status, headers });
}

/**
 * Build a standard JSON response from a DataResult.
 *
 * - If the DataResult is ok -> 200 with data
 * - If the DataResult failed with ENOENT -> 404
 * - If the DataResult failed otherwise -> 500
 * The `ok` field is kept for frontend compatibility.
 */
export function apiResponse<T>(
  result: DataResult<T>,
  source: string,
  opts?: {
    recordCount?: number;
    warnings?: string[];
    request?: NextRequest;
    skipped?: number;
  },
): NextResponse {
  const warnings = opts?.warnings ? [...opts.warnings] : [];
  const staleMs = result.ok ? result.staleMs : undefined;
  const status = freshnessStatus(staleMs);

  if (status === "stale" || status === "offline") {
    warnings.push(freshnessLabel(status));
  }

  // Include skipped-row warnings (#16)
  const skipped = opts?.skipped ?? (result.ok ? result.skipped : undefined);
  if (skipped && skipped > 0) {
    warnings.push(`${skipped} row(s) skipped due to parse errors`);
  }

  if (!result.ok) {
    const isNotFound = result.error.includes("not found");
    const httpStatus = isNotFound ? 404 : 500;

    const body: ApiResponse<T> = {
      meta: {
        ok: false,
        source,
        updatedAt: new Date().toISOString(),
        freshnessMs: null,
        freshness: "unknown",
        warnings,
      },
      data: null,
    };

    return NextResponse.json(body, {
      status: httpStatus,
      headers: {
        "Cache-Control": "no-store",
        "X-Bot-Freshness": "unknown",
      },
    });
  }

  const now = new Date();
  const fileTime =
    staleMs !== undefined ? new Date(now.getTime() - staleMs) : now;

  const body: ApiResponse<T> = {
    meta: {
      ok: true,
      source,
      updatedAt: fileTime.toISOString(),
      freshnessMs: staleMs ?? null,
      freshness: status,
      recordCount: opts?.recordCount,
      warnings,
    },
    data: result.data,
  };

  // ETag support (#23)
  const etag = generateETag(body);
  const notModified = checkETag(opts?.request, etag);
  if (notModified) return notModified;

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-cache",
      "X-Bot-Freshness": status,
      ETag: etag,
    },
  });
}

/**
 * Build a paginated JSON response from a DataResult containing an array.
 */
export function paginatedApiResponse<T>(
  result: DataResult<T[]>,
  source: string,
  pagination: PaginationParams,
  opts?: {
    warnings?: string[];
    request?: NextRequest;
    skipped?: number;
    maxCap?: number;
  },
): NextResponse {
  if (!result.ok) {
    return apiResponse(result, source, { warnings: opts?.warnings, request: opts?.request, skipped: opts?.skipped });
  }

  const warnings = opts?.warnings ? [...opts.warnings] : [];
  const staleMs = result.staleMs;
  const status = freshnessStatus(staleMs);

  if (status === "stale" || status === "offline") {
    warnings.push(freshnessLabel(status));
  }

  const skipped = opts?.skipped ?? result.skipped;
  if (skipped && skipped > 0) {
    warnings.push(`${skipped} row(s) skipped due to parse errors`);
  }

  const allData = result.data;
  const total = allData.length;
  const maxCap = opts?.maxCap ?? 5000;

  let pageData: T[];
  let page: number;
  let limit: number;
  let pages: number;

  if (pagination.page === null) {
    // Backward compat: return all, but capped
    pageData = allData.slice(0, maxCap);
    page = 1;
    limit = pageData.length;
    pages = 1;
  } else {
    page = pagination.page;
    limit = pagination.limit;
    pages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    pageData = allData.slice(start, start + limit);
  }

  const now = new Date();
  const fileTime =
    staleMs !== undefined ? new Date(now.getTime() - staleMs) : now;

  const body: PaginatedApiResponse<T> = {
    meta: {
      ok: true,
      source,
      updatedAt: fileTime.toISOString(),
      freshnessMs: staleMs ?? null,
      freshness: status,
      recordCount: pageData.length,
      warnings,
    },
    data: pageData,
    total,
    page,
    limit,
    pages,
  };

  const etag = generateETag(body);
  const notModified = checkETag(opts?.request, etag);
  if (notModified) return notModified;

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-cache",
      "X-Bot-Freshness": status,
      ETag: etag,
    },
  });
}
