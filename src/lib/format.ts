// ---------------------------------------------------------------------------
// Shared formatting helpers — consolidated from all pages
// ---------------------------------------------------------------------------

/** Format a number as USD with sign: +$1,234.56 or -$1,234.56 */
export function usd(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  })}`;
}

/** Format as plain USD (preserves sign): $1,234.56 or -$1,234.56 */
export function usdPlain(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined) return "N/A";
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  })}`;
}

/** Format a number as percentage: 12.34% or +12.34% */
export function pct(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined) return "N/A";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${Math.abs(v).toFixed(dec)}%`;
}

/** Tailwind text color class based on P&L sign */
export function pnlColor(v: number | null | undefined): string {
  if (v === null || v === undefined) return "text-muted-foreground";
  if (v > 0) return "text-profit";
  if (v < 0) return "text-loss";
  return "text-foreground";
}

/** Tailwind classes for regime badge */
export function regimeColor(regime: string): string {
  switch (regime) {
    case "TREND_UP":
      return "border-profit/50 bg-profit/10 text-profit";
    case "TREND_DOWN":
      return "border-loss/50 bg-loss/10 text-loss";
    case "RANGE":
      return "border-warning/50 bg-warning/10 text-warning";
    case "CHOP":
      return "border-muted-foreground/50 bg-muted/50 text-muted-foreground";
    default:
      return "border-border";
  }
}

/** Short strategy label from raw name */
export function strategyLabel(s: string): string {
  if (s.includes("trendline")) return "TOV";
  if (s === "mean_reversion") return "MR";
  if (s === "smc") return "SMC";
  return s;
}

/** Relative time from ISO string: "5s ago", "3m ago", "2h ago" */
export function timeAgo(isoOrMs: string | number | undefined): string {
  if (isoOrMs === undefined || isoOrMs === null) return "—";
  const ts =
    typeof isoOrMs === "string" ? new Date(isoOrMs).getTime() : isoOrMs;
  if (Number.isNaN(ts)) return "—";
  const diff = Date.now() - ts;
  if (diff < 0) return "now";
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Result badge classes + label for trade result column */
export function resultBadge(result: string): { cls: string; label: string } {
  switch (result) {
    case "TP":
      return {
        cls: "border-profit/50 bg-profit/10 text-profit",
        label: "TP",
      };
    case "SL":
      return { cls: "border-loss/50 bg-loss/10 text-loss", label: "SL" };
    case "SL_PARCIAL":
      return {
        cls: "border-warning/50 bg-warning/10 text-warning",
        label: "SL PARCIAL",
      };
    case "TIMEOUT":
      return {
        cls: "border-muted-foreground/40 bg-muted/40 text-muted-foreground",
        label: "TIMEOUT",
      };
    default:
      return { cls: "border-border", label: result };
  }
}

/** Direction badge classes */
export function dirBadge(dir: string): string {
  return dir === "LONG"
    ? "border-profit/40 bg-profit/10 text-profit"
    : "border-loss/40 bg-loss/10 text-loss";
}

/** Percentage of stop consumed */
export function stopPct(current: number, limit: number): number {
  if (limit === 0) return 0;
  return Math.min(Math.abs(current / limit) * 100, 100);
}

/** Stop bar color based on percentage consumed */
export function stopBarColor(p: number): string {
  if (p > 75) return "bg-loss";
  if (p > 40) return "bg-warning";
  return "bg-profit";
}

/** Format a number with locale and configurable decimal places */
export function num(v: number | null | undefined, maxDec = 6): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: maxDec });
}

/** P&L with sign: +$12.34 or -$12.34 (fixed 2 dec, no locale) */
export function pnlUsd(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

/** Staleness label for DataResult.staleMs */
export function staleness(ms: number | undefined): string {
  if (ms === undefined) return "";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

/** Format bars as "58 / 96" */
export function barsLabel(bars: number, max = 96): string {
  return `${bars} / ${max}`;
}

/** Drawdown percentage from equity and peak */
export function drawdownPct(equity: number, peak: number): number {
  if (peak <= 0) return 0;
  return ((equity - peak) / peak) * 100;
}

/** Format a datetime string as "Mar 11 20:48" */
export function formatDate(dt: string): string {
  try {
    const d = new Date(dt);
    return (
      d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
      " " +
      d.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    );
  } catch {
    return dt;
  }
}
