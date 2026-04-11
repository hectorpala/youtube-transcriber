import { type NextRequest } from "next/server";
import {
  loadDirectorState,
  loadTrades,
  loadShadowSignals,
} from "@/lib/data/loaders";
import {
  freshnessStatus,
  freshnessLabel,
  type FreshnessStatus,
} from "@/lib/data/api-helpers";
import { NextResponse } from "next/server";
import type { Trade, ShadowSignal } from "@/lib/data/schemas";
import type {
  PositionSummary,
  TradeStats,
  SignalStats,
  SummaryData,
  SummaryResponse,
} from "@/lib/data/summary-types";
import { checkRateLimit } from "@/lib/rate-limit";
import { DAILY_STOP, WEEKLY_STOP, MONTHLY_STOP } from "@/lib/constants";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeTradeStats(trades: Trade[]): TradeStats {
  if (trades.length === 0) {
    return {
      total: 0,
      wins: 0,
      losses: 0,
      winRate: null,
      totalPnl: 0,
      avgWin: null,
      avgLoss: null,
      profitFactor: null,
      bestTrade: null,
      worstTrade: null,
    };
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  // Use reduce instead of Math.max(...arr) to avoid stack overflow on large arrays
  let bestTrade: number | null = null;
  let worstTrade: number | null = null;
  if (trades.length > 0) {
    bestTrade = trades.reduce((best, t) => (t.pnl > best ? t.pnl : best), trades[0].pnl);
    worstTrade = trades.reduce((worst, t) => (t.pnl < worst ? t.pnl : worst), trades[0].pnl);
  }

  return {
    total: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : null,
    totalPnl,
    avgWin: wins.length > 0 ? grossWin / wins.length : null,
    avgLoss: losses.length > 0 ? -grossLoss / losses.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    bestTrade,
    worstTrade,
  };
}

function computeSignalStats(signals: ShadowSignal[]): SignalStats {
  const stats: SignalStats = {
    total: signals.length,
    executed: 0,
    shadow: 0,
    rejectedRisk: 0,
    rejectedRegime: 0,
    rejectedCooldown: 0,
    other: 0,
  };

  for (const s of signals) {
    switch (s.action) {
      case "executed":
        stats.executed++;
        break;
      case "shadow":
        stats.shadow++;
        break;
      case "rejected_risk":
        stats.rejectedRisk++;
        break;
      case "rejected_regime":
        stats.rejectedRegime++;
        break;
      case "rejected_cooldown":
        stats.rejectedCooldown++;
        break;
      default:
        stats.other++;
        break;
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
): Promise<NextResponse<SummaryResponse>> {
  if (!checkRateLimit("summary")) {
    return NextResponse.json(
      {
        meta: {
          ok: false,
          updatedAt: new Date().toISOString(),
          freshnessMs: null,
          freshness: "unknown" as FreshnessStatus,
          warnings: ["Rate limit exceeded"],
          sources: {},
        },
        data: null,
      },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const warnings: string[] = [];
  const sources: Record<string, { ok: boolean; error?: string }> = {};

  const [stateResult, tradesResult, shadowResult] = await Promise.all([
    loadDirectorState(),
    loadTrades(),
    loadShadowSignals(),
  ]);

  sources.state = stateResult.ok
    ? { ok: true }
    : { ok: false, error: stateResult.error };
  sources.trades = tradesResult.ok
    ? { ok: true }
    : { ok: false, error: tradesResult.error };
  sources.shadow = shadowResult.ok
    ? { ok: true }
    : { ok: false, error: shadowResult.error };

  if (!stateResult.ok) {
    warnings.push(`State unavailable: ${stateResult.error}`);
    const isNotFound = stateResult.error.includes("not found");
    return NextResponse.json(
      {
        meta: {
          ok: false,
          updatedAt: new Date().toISOString(),
          freshnessMs: null,
          freshness: "unknown" as FreshnessStatus,
          warnings,
          sources,
        },
        data: null,
      },
      {
        status: isNotFound ? 404 : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const state = stateResult.data;
  const staleMs = stateResult.staleMs;
  const freshness = freshnessStatus(staleMs);

  if (freshness === "stale" || freshness === "offline") {
    warnings.push(freshnessLabel(freshness));
  }
  if (!tradesResult.ok) {
    warnings.push(`Trades unavailable: ${tradesResult.error}`);
  }
  if (!shadowResult.ok) {
    warnings.push(`Shadow unavailable: ${shadowResult.error}`);
  }

  const openPositions: PositionSummary[] = Object.entries(
    state.positions,
  ).map(([coin, pos]) => ({
    coin,
    direction: pos.direction,
    strategy: pos.strategy,
    entry: pos.entry,
    tp: pos.tp,
    sl: pos.sl,
    r1: pos.r1,
    bars: pos.bars,
    risk_used: pos.risk_used,
    mitad_cerrada: pos.mitad_cerrada,
    pnl_parcial: pos.pnl_parcial,
    regime: pos.regime,
    entry_ts: pos.entry_ts,
  }));

  const capitalAtRisk = openPositions.reduce((s, p) => s + p.risk_used, 0);
  const peak = state.peak;
  const equity = state.equity;
  const ddPct = peak > 0 ? ((equity - peak) / peak) * 100 : 0;

  const ed = state.execution_daily;

  const strategyDaily: SummaryData["strategyDaily"] = {};
  if (ed?.by_strategy) {
    for (const [name, stats] of Object.entries(ed.by_strategy)) {
      strategyDaily[name] = {
        signals: stats.signals,
        opens: stats.opens,
        wins: stats.wins,
        losses: stats.losses,
        pnl: stats.pnl,
      };
    }
  }

  const data: SummaryData = {
    botStatus: freshness,
    botStatusLabel: freshnessLabel(freshness),
    mode: Object.values(state.positions)[0]?.mode ?? "paper",

    equity,
    peak,
    drawdownPct: Math.round(ddPct * 100) / 100,
    drawdownUsd: Math.round((equity - peak) * 100) / 100,

    regime: state.current_regime,
    regimeConfidence: state.regime_confidence,

    dailyPnl: state.risk_daily_pnl,
    weeklyPnl: state.risk_weekly_pnl,
    monthlyPnl: state.risk_monthly_pnl,
    dailyStop: DAILY_STOP,
    weeklyStop: WEEKLY_STOP,
    monthlyStop: MONTHLY_STOP,

    openPositions,
    openCount: openPositions.length,
    pendingCount: Object.keys(state.pending_entries).length,

    killSwitch: state.risk_kill_switch,
    capitalAtRisk,

    tradeStats: computeTradeStats(tradesResult.ok ? tradesResult.data : []),
    signalStats: computeSignalStats(
      shadowResult.ok ? shadowResult.data : [],
    ),

    executionDaily: {
      opens: ed?.opens ?? 0,
      closes: ed?.closes ?? 0,
      rejectedDrift: ed?.rejected_drift ?? 0,
      slippageUsd: ed?.entry_slippage_usd ?? 0,
    },

    strategyDaily,
  };

  const fileTime =
    staleMs !== undefined ? new Date(Date.now() - staleMs) : new Date();

  return NextResponse.json(
    {
      meta: {
        ok: true,
        updatedAt: fileTime.toISOString(),
        freshnessMs: staleMs ?? null,
        freshness,
        warnings,
        sources,
      },
      data,
    },
    {
      headers: {
        "Cache-Control": "no-cache",
        "X-Bot-Freshness": freshness,
      },
    },
  );
}
