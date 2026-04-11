import fs from "node:fs/promises";
import { open } from "node:fs/promises";
import path from "node:path";
import { DATA_PATHS } from "./paths";
import {
  DirectorStateSchema,
  ShadowArraySchema,
  TradeSchema,
  ExecutionEventSchema,
  type DirectorState,
  type ShadowSignal,
  type Trade,
  type ExecutionEvent,
  type LogLine,
  type DataResult,
} from "./schemas";
import { parseTradesCsv, parseExecutionCsv } from "./csv";
import { parseLogLines } from "./log-parser";
import { CACHE_TTL_MS, FS_TIMEOUT_MS, LOG_TAIL_BYTES } from "../constants";

// ---------------------------------------------------------------------------
// Error sanitization (#18)
// ---------------------------------------------------------------------------

/** Strip full file paths from error messages, keeping only the filename. */
function sanitizeError(err: unknown): string {
  const msg = String(err instanceof Error ? err.message : err);
  // Replace any absolute path (unix or windows) with just the filename
  return msg.replace(/(?:\/[\w.\-/@ ]+\/|[A-Z]:\\[\w.\-\\@ ]+\\)([\w.\-]+)/g, "$1");
}

// ---------------------------------------------------------------------------
// In-memory cache (#13)
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/** Hard cap on cache entries to prevent unbounded memory growth. */
const MAX_CACHE_ENTRIES = 50;

function getCached<T>(key: string, ttlMs: number = CACHE_TTL_MS): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  // Evict expired entries if we're at the cap
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const now = Date.now();
    for (const [k, entry] of cache) {
      if (now - entry.timestamp > CACHE_TTL_MS) {
        cache.delete(k);
      }
    }
    // If still at cap after eviction, drop the oldest entry
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) cache.delete(firstKey);
    }
  }
  cache.set(key, { data, timestamp: Date.now() });
}

// ---------------------------------------------------------------------------
// File read timeout (#15)
// ---------------------------------------------------------------------------

/** Wrap a promise with a timeout. Rejects with an error if it takes too long. */
function withTimeout<T>(promise: Promise<T>, ms: number = FS_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`File operation timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function readFileIfExists(filePath: string): Promise<DataResult<string>> {
  try {
    const stat = await withTimeout(fs.stat(filePath));
    const content = await withTimeout(fs.readFile(filePath, "utf-8"));
    const staleMs = Date.now() - stat.mtimeMs;
    return { ok: true, data: content, staleMs };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { ok: false, error: `File not found: ${path.basename(filePath)}` };
    }
    return { ok: false, error: `Read error: ${sanitizeError(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Director State
// ---------------------------------------------------------------------------

export async function loadDirectorState(): Promise<DataResult<DirectorState>> {
  const cacheKey = "state:" + DATA_PATHS.directorState;
  const cached = getCached<DataResult<DirectorState>>(cacheKey);
  if (cached) return cached;

  const file = await readFileIfExists(DATA_PATHS.directorState);
  if (!file.ok) return file;

  try {
    const raw = JSON.parse(file.data);
    const parsed = DirectorStateSchema.parse(raw);
    const result: DataResult<DirectorState> = { ok: true, data: parsed, staleMs: file.staleMs };
    setCache(cacheKey, result);
    return result;
  } catch (err) {
    return { ok: false, error: `State parse error: ${sanitizeError(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Shadow Signals
// ---------------------------------------------------------------------------

export async function loadShadowSignals(): Promise<DataResult<ShadowSignal[]>> {
  const cacheKey = "shadow:" + DATA_PATHS.directorShadow;
  const cached = getCached<DataResult<ShadowSignal[]>>(cacheKey);
  if (cached) return cached;

  const file = await readFileIfExists(DATA_PATHS.directorShadow);
  if (!file.ok) return file;

  try {
    const raw = JSON.parse(file.data);
    // Parse each signal individually — skip malformed ones instead of failing all
    const signals: ShadowSignal[] = [];
    let skipped = 0;
    if (!Array.isArray(raw)) {
      return { ok: false, error: "Shadow file is not an array" };
    }
    for (const item of raw) {
      const result = ShadowArraySchema.element.safeParse(item);
      if (result.success) {
        signals.push(result.data);
      } else {
        skipped++;
      }
    }
    const out: DataResult<ShadowSignal[]> = { ok: true, data: signals, staleMs: file.staleMs, skipped };
    setCache(cacheKey, out);
    return out;
  } catch (err) {
    return { ok: false, error: `Shadow parse error: ${sanitizeError(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

export async function loadTrades(): Promise<DataResult<Trade[]>> {
  const cacheKey = "trades:" + DATA_PATHS.directorTrades;
  const cached = getCached<DataResult<Trade[]>>(cacheKey);
  if (cached) return cached;

  const file = await readFileIfExists(DATA_PATHS.directorTrades);
  if (!file.ok) return file;

  try {
    const rows = parseTradesCsv(file.data);
    const trades: Trade[] = [];
    let skipped = 0;
    for (const row of rows) {
      const result = TradeSchema.safeParse(row);
      if (result.success) {
        trades.push(result.data);
      } else {
        skipped++;
      }
    }
    const out: DataResult<Trade[]> = { ok: true, data: trades, staleMs: file.staleMs, skipped };
    setCache(cacheKey, out);
    return out;
  } catch (err) {
    return { ok: false, error: `Trades parse error: ${sanitizeError(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Execution Events
// ---------------------------------------------------------------------------

export async function loadExecution(): Promise<DataResult<ExecutionEvent[]>> {
  const cacheKey = "execution:" + DATA_PATHS.directorExecution;
  const cached = getCached<DataResult<ExecutionEvent[]>>(cacheKey);
  if (cached) return cached;

  const file = await readFileIfExists(DATA_PATHS.directorExecution);
  if (!file.ok) return file;

  try {
    const rows = parseExecutionCsv(file.data);
    const events: ExecutionEvent[] = [];
    let skipped = 0;
    for (const row of rows) {
      const result = ExecutionEventSchema.safeParse(row);
      if (result.success) {
        events.push(result.data);
      } else {
        skipped++;
      }
    }
    const out: DataResult<ExecutionEvent[]> = { ok: true, data: events, staleMs: file.staleMs, skipped };
    setCache(cacheKey, out);
    return out;
  } catch (err) {
    return { ok: false, error: `Execution parse error: ${sanitizeError(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Logs (#21: tail-read approach — read last N bytes instead of entire file)
// ---------------------------------------------------------------------------

async function tailRead(
  filePath: string,
  lastNBytes: number = LOG_TAIL_BYTES,
): Promise<DataResult<string>> {
  try {
    const stat = await withTimeout(fs.stat(filePath));
    const staleMs = Date.now() - stat.mtimeMs;
    const fileSize = stat.size;

    if (fileSize <= lastNBytes) {
      // Small file: just read the whole thing
      const content = await withTimeout(fs.readFile(filePath, "utf-8"));
      return { ok: true, data: content, staleMs };
    }

    // Large file: read only the tail
    const fh = await withTimeout(open(filePath, "r"));
    try {
      const buf = Buffer.alloc(lastNBytes);
      const offset = fileSize - lastNBytes;
      await withTimeout(fh.read(buf, 0, lastNBytes, offset));
      const raw = buf.toString("utf-8");
      // Drop the first (likely partial) line
      const firstNewline = raw.indexOf("\n");
      const content = firstNewline >= 0 ? raw.slice(firstNewline + 1) : raw;
      return { ok: true, data: content, staleMs };
    } finally {
      await fh.close();
    }
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { ok: false, error: `File not found: ${path.basename(filePath)}` };
    }
    return { ok: false, error: `Read error: ${sanitizeError(err)}` };
  }
}

export async function loadLogs(
  lastN: number = 200,
): Promise<DataResult<LogLine[]>> {
  const cacheKey = `logs:${DATA_PATHS.directorLog}:${lastN}`;
  const cached = getCached<DataResult<LogLine[]>>(cacheKey);
  if (cached) return cached;

  const file = await tailRead(DATA_PATHS.directorLog);
  if (!file.ok) return file;

  try {
    const lines = parseLogLines(file.data, lastN);
    const out: DataResult<LogLine[]> = { ok: true, data: lines, staleMs: file.staleMs };
    setCache(cacheKey, out);
    return out;
  } catch (err) {
    return { ok: false, error: `Log parse error: ${sanitizeError(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Convenience: load everything at once (for the main dashboard)
// ---------------------------------------------------------------------------

export interface DashboardSnapshot {
  state: DataResult<DirectorState>;
  trades: DataResult<Trade[]>;
  shadow: DataResult<ShadowSignal[]>;
  execution: DataResult<ExecutionEvent[]>;
  logs: DataResult<LogLine[]>;
}

export async function loadDashboardSnapshot(): Promise<DashboardSnapshot> {
  const [state, trades, shadow, execution, logs] = await Promise.all([
    loadDirectorState(),
    loadTrades(),
    loadShadowSignals(),
    loadExecution(),
    loadLogs(100),
  ]);

  return { state, trades, shadow, execution, logs };
}
