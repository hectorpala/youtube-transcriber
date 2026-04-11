// ---------------------------------------------------------------------------
// Shared strategy metadata — importable from multiple pages
// ---------------------------------------------------------------------------

export interface StrategyMeta {
  key: string;
  label: string;
  fullName: string;
  description: string;
  regimes: string[];
  color: string;
  /** Matches a raw strategy field from trades CSV */
  match: (raw: string) => boolean;
}

export const STRATEGY_META: StrategyMeta[] = [
  {
    key: "smc",
    label: "SMC",
    fullName: "Smart Money Concepts",
    description: "Order blocks, CHoCH, BOS — opera en tendencias",
    regimes: ["TREND_UP", "TREND_DOWN"],
    color: "#3b82f6",
    match: (r) => r.toLowerCase() === "smc",
  },
  {
    key: "mean_reversion",
    label: "Mean Reversion",
    fullName: "Mean Reversion",
    description: "RSI + Stochastic + Bollinger Bands — opera en rangos",
    regimes: ["RANGE"],
    color: "#eab308",
    match: (r) => r.toLowerCase() === "mean_reversion",
  },
  {
    key: "tov",
    label: "TOV",
    fullName: "Trendline Opera Video",
    description: "Trendlines + CHoCH + FVG — multi-régimen",
    regimes: ["TREND_UP", "TREND_DOWN", "RANGE"],
    color: "#22c55e",
    match: (r) => r.toLowerCase() === "trendline" || r.toLowerCase().startsWith("trendline_") || r.toLowerCase() === "tov",
  },
];

export function resolveStrategy(raw: string): StrategyMeta | undefined {
  return STRATEGY_META.find((m) => m.match(raw));
}
