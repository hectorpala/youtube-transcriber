import { z } from "zod";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Coerce a value that might be string, number, or empty to number | null. Ensures finite. */
const numish = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isNaN(n) || !Number.isFinite(n) ? null : n;
  });

/** Same but defaults to 0 instead of null — for fields that must be numeric. */
const numOrZero = numish.transform((v) => v ?? 0);

/** PnL field with reasonable range: -1M to +1M */
const pnlField = numOrZero.pipe(z.number().min(-1_000_000).max(1_000_000));

// ---------------------------------------------------------------------------
// Enums for validated fields
// ---------------------------------------------------------------------------

export const TradeResultEnum = z.enum(["TP", "SL", "SL_PARCIAL", "TIMEOUT"]);
export const TradeDirectionEnum = z.enum(["LONG", "SHORT"]);
export const TradeActionEnum = z.enum(["LONG", "SHORT", "SKIP"]);

// ---------------------------------------------------------------------------
// Position (inside director_state.json -> positions)
// ---------------------------------------------------------------------------

export const LadderFillSchema = z.object({
  label: z.string().max(50),
  price: z.number().finite(),
  risk: z.number().finite(),
});

export const PositionSchema = z.object({
  direction: z.enum(["LONG", "SHORT"]),
  entry: z.number().finite(),
  signal_price: z.number().finite().optional(),
  live_entry_price: z.number().finite().optional(),
  fill_entry_price: z.number().finite().optional(),
  entry_slippage_pct: z.number().finite().optional(),
  entry_slippage_usd: z.number().finite().optional(),
  mode: z.string().max(20).default("paper"),
  tp: z.number().finite(),
  sl: z.number().finite(),
  sl_original: z.number().finite().optional(),
  r1: z.number().finite().optional(),
  risk_used: z.number().finite().min(0).max(100_000),
  mitad_cerrada: z.boolean().default(false),
  pnl_parcial: z.number().finite().default(0),
  bars: z.number().finite().int().min(0).max(10_000).default(0),
  strategy: z.string().max(50),
  entry_ts: z.number().finite(),
  last_checked_ts: z.number().finite().optional(),
  regime: z.string().max(20).optional(),
  ladder_fills: z.array(LadderFillSchema).default([]),
});

export type Position = z.infer<typeof PositionSchema>;

// ---------------------------------------------------------------------------
// Pending Entry
// ---------------------------------------------------------------------------

export const PendingEntrySchema = z
  .object({
    direction: z.enum(["LONG", "SHORT"]),
    price: z.number().finite().optional(),
    signal_price: z.number().finite().optional(),
    entry_zone_top: z.number().finite().optional(),
    entry_zone_bottom: z.number().finite().optional(),
    fill_zone_top: z.number().finite().optional(),
    fill_zone_bottom: z.number().finite().optional(),
    tp: z.number().finite().optional(),
    sl: z.number().finite().optional(),
    r1: z.number().finite().optional(),
    risk_used: z.number().finite().optional(),
    strategy: z.string().max(50),
    entry_ts: z.number().finite().optional(),
    bars_waiting: z.number().finite().int().min(0).default(0),
    max_bars: z.number().finite().int().optional(),
    regime: z.string().max(20).optional(),
    ladder_fills: z.array(LadderFillSchema).default([]),
  })
  .strip();

export type PendingEntry = z.infer<typeof PendingEntrySchema>;

// ---------------------------------------------------------------------------
// Strategy Daily Stats (inside execution_daily.by_strategy)
// ---------------------------------------------------------------------------

export const StrategyDailyStatsSchema = z.object({
  signals: z.number().finite().int().min(0).default(0),
  opens: z.number().finite().int().min(0).default(0),
  closes: z.number().finite().int().min(0).default(0),
  wins: z.number().finite().int().min(0).default(0),
  losses: z.number().finite().int().min(0).default(0),
  saved: z.number().finite().int().min(0).default(0),
  pnl: z.number().finite().default(0),
});

export type StrategyDailyStats = z.infer<typeof StrategyDailyStatsSchema>;

// ---------------------------------------------------------------------------
// Execution Daily
// ---------------------------------------------------------------------------

export const ExecutionDailySchema = z.object({
  opens: z.number().finite().int().min(0).default(0),
  closes: z.number().finite().int().min(0).default(0),
  entry_slippage_usd: z.number().finite().default(0),
  entry_slippage_pct_sum: z.number().finite().default(0),
  funding_estimate: z.number().finite().default(0),
  rejected_drift: z.number().finite().int().min(0).default(0),
  by_strategy: z.record(z.string(), StrategyDailyStatsSchema).default({}),
});

export type ExecutionDaily = z.infer<typeof ExecutionDailySchema>;

// ---------------------------------------------------------------------------
// Director State (the full director_state.json)
// ---------------------------------------------------------------------------

export const DirectorStateSchema = z.object({
  equity: z.number().finite().min(0).max(100_000_000),
  peak: z.number().finite().min(0).max(100_000_000),
  risk_daily_pnl: z.number().finite().default(0),
  risk_weekly_pnl: z.number().finite().default(0),
  risk_monthly_pnl: z.number().finite().default(0),
  risk_current_day: z.string().max(30).optional(),
  risk_current_week: z.string().max(30).optional(),
  risk_current_month: z.string().max(30).optional(),
  risk_open_positions: z.record(z.string(), z.string()).default({}),
  risk_regime_trades: z.record(z.string(), z.array(z.number())).default({}),
  risk_blocked_regimes: z.record(z.string(), z.unknown()).default({}),
  risk_kill_switch: z.string().max(500).default(""),
  positions: z.record(z.string().max(20), PositionSchema).default({}),
  pending_entries: z.record(z.string().max(20), PendingEntrySchema).default({}),
  signal_cooldown_until: z.record(z.string().max(100), z.number()).default({}),
  mr_cooldown_until: z.record(z.string().max(20), z.number()).default({}),
  strategy_daily_pnl: z.record(z.string().max(50), z.number()).default({}),
  strategy_daily_date: z.string().max(30).optional(),
  execution_daily: ExecutionDailySchema.optional(),
  execution_daily_date: z.string().max(30).optional(),
  current_regime: z.string().max(20).default("UNKNOWN"),
  regime_confidence: z.string().max(20).default("UNKNOWN"),
});

export type DirectorState = z.infer<typeof DirectorStateSchema>;

// ---------------------------------------------------------------------------
// Shadow Signal (items inside director_shadow.json array)
// ---------------------------------------------------------------------------

export const ShadowSignalSchema = z.object({
  timestamp: z.number().finite(),
  coin: z.string().max(20),
  direction: z.enum(["LONG", "SHORT"]),
  strategy: z.string().max(50),
  score: z.number().finite().min(-100).max(100),
  price: z.number().finite().min(0),
  sl: z.number().finite().min(0),
  tp: z.number().finite().min(0),
  regime: z.string().max(20),
  action: z.string().max(30), // Values: "executed" | "shadow" | "rejected_risk" | "rejected_regime" | "rejected_cooldown" — kept as string to avoid data loss from unknown bot actions
  reason: z.string().max(500).default(""),
});

export type ShadowSignal = z.infer<typeof ShadowSignalSchema>;

export const ShadowArraySchema = z.array(ShadowSignalSchema);

// ---------------------------------------------------------------------------
// Trade (from director_trades.csv)
// Header: datetime,coin,direction,strategy,entry,exit,result,pnl,risk_used,bars,regime,equity
// Rows may have extra trailing columns (schema drift):
//   mode, signal_price, live_entry_price, fill_entry_price,
//   entry_slippage_pct, entry_slippage_usd, funding_estimate
// ---------------------------------------------------------------------------

export const TradeSchema = z.object({
  // Core columns (always present)
  datetime: z.string().max(30),
  coin: z.string().max(20),
  direction: TradeDirectionEnum,
  strategy: z.string().max(50),
  entry: numOrZero,
  exit: numOrZero,
  result: TradeResultEnum,
  pnl: pnlField,
  risk_used: numOrZero,
  bars: numOrZero,
  regime: z.string().max(20).default(""),
  equity: numOrZero,
  // Extended columns (may or may not be present -- schema drift)
  mode: z.string().max(20).optional(),
  signal_price: numish.optional(),
  live_entry_price: numish.optional(),
  fill_entry_price: numish.optional(),
  entry_slippage_pct: numish.optional(),
  entry_slippage_usd: numish.optional(),
  funding_estimate: numish.optional(),
});

export type Trade = z.infer<typeof TradeSchema>;

// ---------------------------------------------------------------------------
// Execution Event (from director_execution.csv)
// ---------------------------------------------------------------------------

export const ExecutionEventSchema = z.object({
  datetime: z.string().max(30),
  coin: z.string().max(20),
  action: z.string().max(20), // open | close | scale_in
  mode: z.string().max(20).default("paper"),
  strategy: z.string().max(50),
  direction: z.string().max(20),
  signal_price: numOrZero,
  live_price: numOrZero,
  fill_price: numOrZero,
  slippage_pct: numOrZero,
  slippage_usd: numOrZero,
  funding_estimate: numOrZero,
  result: z.string().max(20).default(""),
  pnl: pnlField,
});

export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;

// ---------------------------------------------------------------------------
// Log line (from director_log.csv -- actually plain text, not CSV)
// Format: [YYYY-MM-DD HH:MM:SS] message
// ---------------------------------------------------------------------------

export const LogLineSchema = z.object({
  timestamp: z.string().max(30),
  message: z.string().max(1000),
  level: z
    .enum(["info", "trade", "regime", "warning", "error"])
    .default("info"),
});

export type LogLine = z.infer<typeof LogLineSchema>;

// ---------------------------------------------------------------------------
// Wrapper: result type for all loaders
// ---------------------------------------------------------------------------

export type DataResult<T> =
  | {
      ok: true;
      data: T;
      staleMs?: number; // how old the file is
      skipped?: number; // number of malformed rows skipped during parsing
    }
  | {
      ok: false;
      error: string;
      data?: undefined;
    };
