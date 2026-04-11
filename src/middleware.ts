import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const origin = request.headers.get("origin") ?? "";
  const host = request.headers.get("host") ?? "";
  let allowedOrigin = "";
  try {
    allowedOrigin = origin && new URL(origin).host === host ? origin : "";
  } catch {
    // Malformed origin header — treat as disallowed
    allowedOrigin = "";
  }

  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const response = NextResponse.next();
  if (allowedOrigin) {
    response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
  }
  // Security headers for API responses
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = { matcher: "/api/:path*" };
