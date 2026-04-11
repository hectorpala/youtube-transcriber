// ---------------------------------------------------------------------------
// Shared configuration constants (mirrored from bot config.py)
// ---------------------------------------------------------------------------

/** Daily stop-loss limit (negative USD) */
export const DAILY_STOP = -600;

/** Weekly stop-loss limit (negative USD) */
export const WEEKLY_STOP = -1200;

/** Monthly stop-loss limit (negative USD) */
export const MONTHLY_STOP = -2400;

/** Initial bankroll for drawdown calculations */
export const BANKROLL = 7000;

/** Maximum simultaneous open positions */
export const MAX_OPEN = 10;

/** Maximum correlated positions (BTC/ETH/SOL) */
export const MAX_CORRELATED = 3;

/** Correlated asset group */
export const CORR_GROUP = new Set(["BTC-USDT", "ETH-USDT", "SOL-USDT"]);

/** Maximum bars before timeout */
export const BARS_MAX = 96;

/** DD_THROTTLE: [(dd_pct_threshold, acceptance_rate)] — sorted most severe first */
export const DD_THROTTLE: [number, number][] = [
  [-30, 0.0],
  [-20, 0.25],
  [-10, 0.50],
];

// ---------------------------------------------------------------------------
// Polling / freshness thresholds
// ---------------------------------------------------------------------------

/** Default polling interval in ms */
export const POLL_INTERVAL = 12_000;

/** Polling interval for summary endpoint (alias for POLL_INTERVAL) */
export const POLL_SUMMARY = 12_000;

/** Polling interval for trades endpoint */
export const TRADES_POLL_INTERVAL = 30_000;

/** Polling interval for trades endpoint (alias) */
export const POLL_TRADES = 30_000;

/** Deduping interval for SWR */
export const DEDUP_INTERVAL = 5_000;

/** Threshold in ms after which data is considered "stale" (5 minutes) */
export const STALE_THRESHOLD_MS = 5 * 60 * 1000;

/** Threshold in ms after which the bot is considered "offline" (30 minutes) */
export const OFFLINE_THRESHOLD_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Backend / API constants
// ---------------------------------------------------------------------------

/** Cache TTL in milliseconds for in-memory data caching. */
export const CACHE_TTL_MS = 5_000;

/** Default timeout for file system operations (ms). */
export const FS_TIMEOUT_MS = 10_000;

/** Pagination defaults. */
export const PAGINATION = {
  defaultLimit: 100,
  maxCap: 5000,
} as const;

/** Rate limiting: token-bucket settings. */
export const RATE_LIMIT = {
  maxRequests: 60,
  windowMs: 60_000, // 1 minute
} as const;

/** Tail-read buffer size for log files. */
export const LOG_TAIL_BYTES = 64 * 1024; // 64KB
