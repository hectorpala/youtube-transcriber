"use client";

import React, { useMemo, useCallback, memo } from "react";
import { useApi } from "@/hooks/use-api";
import type { ApiResponse } from "@/lib/data/api-helpers";
import type { Trade } from "@/lib/data/schemas";
import type { SummaryResponse } from "@/lib/data/summary-types";
import { usd, pnlColor } from "@/lib/format";
import { TRADES_POLL_INTERVAL } from "@/lib/constants";
import { STRATEGY_META, type StrategyMeta } from "@/lib/strategies";
import { useSummary } from "@/contexts/summary-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from "recharts";
import {
  AlertTriangle,
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  FlaskConical,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Per-strategy stats
// ---------------------------------------------------------------------------

interface StrategyStats {
  meta: StrategyMeta;
  trades: Trade[];
  total: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnl: number;
  avgPnl: number | null;
  bestTrade: number | null;
  worstTrade: number | null;
  profitFactor: number | null;
  avgBars: number | null;
  lowSample: boolean;
}

function computeStrategyStats(meta: StrategyMeta, trades: Trade[]): StrategyStats {
  const t = trades.filter((tr) => meta.match(tr.strategy));
  if (t.length === 0) {
    return {
      meta, trades: t, total: 0, wins: 0, losses: 0, winRate: null,
      totalPnl: 0, avgPnl: null, bestTrade: null, worstTrade: null,
      profitFactor: null, avgBars: null, lowSample: true,
    };
  }

  const wins = t.filter((x) => x.pnl > 0);
  const losses = t.filter((x) => x.pnl < 0);
  const totalPnl = t.reduce((s, x) => s + x.pnl, 0);
  const grossWin = wins.reduce((s, x) => s + x.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, x) => s + x.pnl, 0));
  const avgBars = t.reduce((s, x) => s + x.bars, 0) / t.length;

  return {
    meta, trades: t,
    total: t.length,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / t.length) * 100,
    totalPnl,
    avgPnl: totalPnl / t.length,
    bestTrade: Math.max(...t.map((x) => x.pnl)),
    worstTrade: Math.min(...t.map((x) => x.pnl)),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    avgBars: Math.round(avgBars * 10) / 10,
    lowSample: t.length < 5,
  };
}

// ---------------------------------------------------------------------------
// Build cumulative P&L series for chart
// ---------------------------------------------------------------------------

interface CumPoint {
  trade: number;
  [key: string]: number;
}

function buildCumulativeSeries(allStats: StrategyStats[]): CumPoint[] {
  const allTrades: { trade: Trade; stratKey: string }[] = [];
  for (const s of allStats) {
    for (const t of s.trades) {
      allTrades.push({ trade: t, stratKey: s.meta.key });
    }
  }
  allTrades.sort((a, b) => a.trade.datetime.localeCompare(b.trade.datetime));

  if (allTrades.length === 0) return [];

  const cumulative: Record<string, number> = {};
  for (const s of allStats) cumulative[s.meta.key] = 0;

  const points: CumPoint[] = [];
  for (let i = 0; i < allTrades.length; i++) {
    const { trade, stratKey } = allTrades[i];
    cumulative[stratKey] += trade.pnl;

    const point: CumPoint = { trade: i + 1 };
    for (const s of allStats) {
      point[s.meta.key] = Math.round(cumulative[s.meta.key] * 100) / 100;
    }
    points.push(point);
  }

  return points;
}

// ---------------------------------------------------------------------------
// Page-specific helpers
// ---------------------------------------------------------------------------

function regimeBadgeCls(r: string): string {
  switch (r) {
    case "TREND_UP": return "border-profit/40 bg-profit/10 text-profit";
    case "TREND_DOWN": return "border-loss/40 bg-loss/10 text-loss";
    case "RANGE": return "border-warning/40 bg-warning/10 text-warning";
    default: return "border-border text-muted-foreground";
  }
}

function rankIcon(rank: number) {
  if (rank === 0) return <Trophy className="h-4 w-4 text-warning" />;
  return null;
}

// ---------------------------------------------------------------------------
// Memoized sub-components (Issue #5)
// ---------------------------------------------------------------------------

const StatCell = memo(function StatCell({ label, value, color, small }: { label: string; value: string; color?: string; small?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`${small ? "text-xs" : "text-sm"} font-mono font-semibold ${color || "text-foreground"}`}>{value}</p>
    </div>
  );
});

const StrategyCard = memo(function StrategyCard({ stats, rank, isActive }: { stats: StrategyStats; rank: number; isActive: boolean }) {
  const { meta } = stats;
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: meta.color }} />
            <CardTitle className="text-base font-semibold">{meta.label}</CardTitle>
            {rankIcon(rank)}
          </div>
          <div className="flex items-center gap-1.5">
            {stats.lowSample && stats.total > 0 && (
              <Badge variant="outline" className="text-[10px] font-mono py-0 border-warning/40 text-warning">
                MUESTRA BAJA
              </Badge>
            )}
            <Badge
              variant="outline"
              className={`text-[10px] font-mono py-0 ${
                isActive
                  ? "border-profit/50 bg-profit/10 text-profit"
                  : "border-muted-foreground/30 text-muted-foreground"
              }`}
            >
              {isActive ? "ACTIVA" : "INACTIVA"}
            </Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{meta.description}</p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Regimes */}
        <div className="flex gap-1.5 flex-wrap">
          {meta.regimes.map((r) => (
            <Badge key={r} variant="outline" className={`font-mono text-[10px] py-0 ${regimeBadgeCls(r)}`}>
              {r}
            </Badge>
          ))}
        </div>

        {stats.total === 0 ? (
          <div className="flex flex-col items-center py-6 gap-2">
            <FlaskConical className="h-6 w-6 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">Sin trades cerrados</p>
          </div>
        ) : (
          <>
            {/* Big numbers */}
            <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border">
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Tasa Acierto</p>
                <p className={`text-xl font-bold font-mono ${pnlColor(stats.winRate !== null ? stats.winRate - 50 : null)}`}>
                  {stats.winRate !== null ? `${stats.winRate.toFixed(0)}%` : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground font-mono">
                  {stats.wins}W / {stats.losses}L
                </p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Total P&L</p>
                <p className={`text-xl font-bold font-mono ${pnlColor(stats.totalPnl)}`}>
                  {usd(stats.totalPnl)}
                </p>
                <p className="text-[10px] text-muted-foreground font-mono">
                  {stats.total} trade{stats.total !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">PF</p>
                <p className={`text-xl font-bold font-mono ${
                  stats.profitFactor !== null
                    ? stats.profitFactor > 1 ? "text-profit" : "text-loss"
                    : "text-muted-foreground"
                }`}>
                  {stats.profitFactor !== null
                    ? stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)
                    : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground font-mono">
                  factor de beneficio
                </p>
              </div>
            </div>

            {/* Detail grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-2 border-t border-border">
              <StatCell label="P&L Prom." value={usd(stats.avgPnl)} color={pnlColor(stats.avgPnl)} />
              <StatCell label="Barras Prom." value={stats.avgBars !== null ? String(stats.avgBars) : "—"} />
              <StatCell label="Mejor Trade" value={usd(stats.bestTrade)} color="text-profit" />
              <StatCell label="Peor Trade" value={usd(stats.worstTrade)} color="text-loss" />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
});

// ---------------------------------------------------------------------------
// Comparison table (memoized)
// ---------------------------------------------------------------------------

const ComparisonTable = memo(function ComparisonTable({ allStats }: { allStats: StrategyStats[] }) {
  const metrics: { label: string; get: (s: StrategyStats) => string; colorFn?: (s: StrategyStats) => string }[] = [
    { label: "Trades", get: (s) => String(s.total) },
    { label: "Ganados", get: (s) => String(s.wins) },
    { label: "Perdidos", get: (s) => String(s.losses) },
    { label: "Tasa Acierto", get: (s) => s.winRate !== null ? `${s.winRate.toFixed(1)}%` : "—", colorFn: (s) => pnlColor(s.winRate !== null ? s.winRate - 50 : null) },
    { label: "P&L Total", get: (s) => usd(s.totalPnl), colorFn: (s) => pnlColor(s.totalPnl) },
    { label: "P&L Prom.", get: (s) => usd(s.avgPnl), colorFn: (s) => pnlColor(s.avgPnl) },
    { label: "Mejor", get: (s) => usd(s.bestTrade), colorFn: () => "text-profit" },
    { label: "Peor", get: (s) => usd(s.worstTrade), colorFn: () => "text-loss" },
    { label: "PF", get: (s) => s.profitFactor !== null ? (s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2)) : "—", colorFn: (s) => pnlColor(s.profitFactor !== null ? s.profitFactor - 1 : null) },
    { label: "Barras Prom.", get: (s) => s.avgBars !== null ? String(s.avgBars) : "—" },
  ];

  function isBest(metric: typeof metrics[number], stat: StrategyStats): boolean {
    if (stat.total === 0) return false;
    const nonEmpty = allStats.filter((s) => s.total > 0);
    if (nonEmpty.length < 2) return false;
    const val = metric.get(stat);
    const vals = nonEmpty.map((s) => metric.get(s));
    const numVals = vals.map((v) => parseFloat(v.replace(/[^0-9.-]/g, "")));
    const myVal = parseFloat(val.replace(/[^0-9.-]/g, ""));
    if (isNaN(myVal)) return false;
    if (metric.label === "Peor") return false;
    return myVal === Math.max(...numVals.filter((n) => !isNaN(n)));
  }

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Comparativo</CardTitle>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="h-8 px-4 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider font-mono">
                Métrica
              </th>
              {allStats.map((s) => (
                <th key={s.meta.key} className="h-8 px-4 text-right text-[10px] font-medium uppercase tracking-wider font-mono">
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: s.meta.color }} />
                    <span style={{ color: s.meta.color }}>{s.meta.label}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.label} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                <td className="h-9 px-4 text-xs text-muted-foreground font-mono">{m.label}</td>
                {allStats.map((s) => {
                  const best = isBest(m, s);
                  return (
                    <td key={s.meta.key} className="h-9 px-4 text-right">
                      <span className={`text-xs font-mono font-semibold ${m.colorFn ? m.colorFn(s) : "text-foreground"} ${best ? "underline decoration-dotted underline-offset-2" : ""}`}>
                        {m.get(s)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
});

// ---------------------------------------------------------------------------
// Custom Recharts tooltip (memoized)
// ---------------------------------------------------------------------------

const ChartTooltip = memo(function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string }>; label?: number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 shadow-lg">
      <p className="text-[10px] text-muted-foreground font-mono mb-1">Trade #{label}</p>
      {payload.map((p) => {
        const meta = STRATEGY_META.find((m) => m.key === p.dataKey);
        return (
          <div key={p.dataKey} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="text-xs font-mono">{meta?.label ?? p.dataKey}</span>
            </div>
            <span className={`text-xs font-mono font-semibold ${pnlColor(p.value)}`}>
              {usd(p.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function StrategiesPage() {
  const { data: tradesResp, isLoading: tradesLoading } = useApi<ApiResponse<Trade[]>>("/api/trades", TRADES_POLL_INTERVAL);
  const { data: summaryResp } = useSummary();

  const { allStats, cumSeries, ranked } = useMemo(() => {
    const trades = tradesResp?.data ?? [];
    const stats = STRATEGY_META.map((m) => computeStrategyStats(m, trades));

    const sorted = [...stats].sort((a, b) => b.totalPnl - a.totalPnl);
    const rankMap = new Map<string, number>();
    sorted.forEach((s, i) => rankMap.set(s.meta.key, i));

    return {
      allStats: stats,
      cumSeries: buildCumulativeSeries(stats),
      ranked: rankMap,
    };
  }, [tradesResp?.data]);

  const currentRegime = summaryResp?.data?.regime ?? "";

  const isActive = useCallback((meta: StrategyMeta): boolean => {
    if (!currentRegime) return false;
    return meta.regimes.includes(currentRegime);
  }, [currentRegime]);

  if (tradesLoading && !tradesResp) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-[350px] rounded-xl" />)}
        </div>
        <Skeleton className="h-[300px] rounded-xl" />
      </div>
    );
  }

  const totalTrades = allStats.reduce((s, x) => s + x.total, 0);
  const hasChartData = cumSeries.length >= 2;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Estrategias</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Performance comparativa — {totalTrades} trade{totalTrades !== 1 ? "s" : ""} cerrado{totalTrades !== 1 ? "s" : ""}
          {currentRegime && (
            <span className="ml-2">
              Régimen actual: <span className="font-semibold">{currentRegime}</span>
            </span>
          )}
        </p>
      </div>

      {/* Strategy cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {allStats.map((stats) => (
          <StrategyCard
            key={stats.meta.key}
            stats={stats}
            rank={ranked.get(stats.meta.key) ?? 99}
            isActive={isActive(stats.meta)}
          />
        ))}
      </div>

      {/* Cumulative P&L chart */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">P&L Acumulado por Estrategia</CardTitle>
        </CardHeader>
        <CardContent>
          {hasChartData ? (
            <>
              <div role="img" aria-label="Gráfico de P&L acumulado por estrategia">
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={cumSeries} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                    <XAxis
                      dataKey="trade"
                      tick={{ fontSize: 10, fontFamily: "monospace", fill: "var(--chart-text)" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--chart-grid)" }}
                      label={{ value: "Trade N.°", position: "insideBottomRight", offset: -5, fontSize: 10, fill: "var(--chart-text)" }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fontFamily: "monospace", fill: "var(--chart-text)" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--chart-grid)" }}
                      tickFormatter={(v: number) => `$${v}`}
                    />
                    <RTooltip content={<ChartTooltip />} />
                    <Legend
                      formatter={(value: string) => {
                        const m = STRATEGY_META.find((x) => x.key === value);
                        return <span className="text-xs font-mono">{m?.label ?? value}</span>;
                      }}
                    />
                    <ReferenceLine
                      y={0}
                      stroke="var(--chart-grid)"
                      strokeDasharray="4 4"
                    />
                    {STRATEGY_META.map((m) => (
                      <Line
                        key={m.key}
                        type="monotone"
                        dataKey={m.key}
                        stroke={m.color}
                        strokeWidth={2}
                        dot={{ r: 3, fill: m.color }}
                        activeDot={{ r: 5 }}
                        name={m.key}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {/* Visually hidden summary table for screen readers */}
              <table className="sr-only">
                <caption>Resumen de P&L acumulado por estrategia</caption>
                <thead>
                  <tr>
                    <th scope="col">Estrategia</th>
                    <th scope="col">P&L Total</th>
                    <th scope="col">Trades</th>
                  </tr>
                </thead>
                <tbody>
                  {allStats.map((s) => (
                    <tr key={s.meta.key}>
                      <td>{s.meta.label}</td>
                      <td>{usd(s.totalPnl)}</td>
                      <td>{s.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-[220px] gap-3">
              <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-muted-foreground/40" />
              </div>
              <p className="text-sm text-muted-foreground">
                Se necesitan al menos 2 trades para mostrar la curva
              </p>
              <p className="text-xs text-muted-foreground/60 font-mono">
                {totalTrades} trade{totalTrades !== 1 ? "s" : ""} registrado{totalTrades !== 1 ? "s" : ""}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Comparison table */}
      <ComparisonTable allStats={allStats} />
    </div>
  );
}
