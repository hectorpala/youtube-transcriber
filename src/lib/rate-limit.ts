import { RATE_LIMIT } from "./constants";

// ---------------------------------------------------------------------------
// Simple in-memory token-bucket rate limiter (per route)
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

/** Maximum number of distinct route keys allowed to prevent unbounded memory growth. */
const MAX_BUCKETS = 100;

/** Evict stale buckets that haven't been used in over 5 minutes. */
function evictStaleBuckets(windowMs: number): void {
  if (buckets.size <= MAX_BUCKETS) return;
  const now = Date.now();
  const staleThreshold = windowMs * 5; // 5x the window
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefill > staleThreshold) {
      buckets.delete(key);
    }
  }
}

/**
 * Check whether a request to `routeKey` is allowed.
 * Returns `true` if the request is within limits, `false` if it should be rejected (429).
 *
 * Uses a token-bucket algorithm: each route gets `maxRequests` tokens that refill
 * linearly over `windowMs`.
 */
export function checkRateLimit(
  routeKey: string,
  maxRequests: number = RATE_LIMIT.maxRequests,
  windowMs: number = RATE_LIMIT.windowMs,
): boolean {
  const now = Date.now();
  evictStaleBuckets(windowMs);
  let bucket = buckets.get(routeKey);

  if (!bucket) {
    // Reject unknown route keys if we've hit the bucket cap (DoS protection)
    if (buckets.size >= MAX_BUCKETS) {
      return false;
    }
    bucket = { tokens: maxRequests - 1, lastRefill: now };
    buckets.set(routeKey, bucket);
    return true;
  }

  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  const refill = (elapsed / windowMs) * maxRequests;
  bucket.tokens = Math.min(maxRequests, bucket.tokens + refill);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }

  return false;
}
