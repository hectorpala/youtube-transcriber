import type { FreshnessStatus } from "./api-helpers";

export interface PositionSummary {
  coin: string;
  direction: string;
  strategy: string;
  entry: number;
  tp: number;
  sl: number;
  r1: number | undefined;
  bars: number;
  risk_used: number;
  mitad_cerrada: boolean;
  pnl_parcial: number;
  regime: string | undefined;
  entry_ts: number;
}

export interface TradeStats {
  total: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnl: number;
  avgWin: number | null;
  avgLoss: number | null;
  profitFactor: number | null;
  bestTrade: number | null;
  worstTrade: number | null;
}

export interface SignalStats {
  total: number;
  executed: number;
  shadow: number;
  rejectedRisk: number;
  rejectedRegime: number;
  rejectedCooldown: number;
  other: number;
}

export interface SummaryData {
  botStatus: FreshnessStatus;
  botStatusLabel: string;
  mode: string;

  equity: number;
  peak: number;
  drawdownPct: number;
  drawdownUsd: number;

  regime: string;
  regimeConfidence: string;

  dailyPnl: number;
  weeklyPnl: number;
  monthlyPnl: number;
  dailyStop: number;
  weeklyStop: number;
  monthlyStop: number;

  openPositions: PositionSummary[];
  openCount: number;
  pendingCount: number;

  killSwitch: string;
  capitalAtRisk: number;

  tradeStats: TradeStats;
  signalStats: SignalStats;

  executionDaily: {
    opens: number;
    closes: number;
    rejectedDrift: number;
    slippageUsd: number;
  };

  strategyDaily: Record<string, {
    signals: number;
    opens: number;
    wins: number;
    losses: number;
    pnl: number;
  }>;
}

export interface SummaryResponse {
  meta: {
    ok: boolean;
    updatedAt: string;
    freshnessMs: number | null;
    freshness: FreshnessStatus;
    warnings: string[];
    sources: Record<string, { ok: boolean; error?: string }>;
  };
  data: SummaryData | null;
}
