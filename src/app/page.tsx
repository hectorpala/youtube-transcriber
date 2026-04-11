"use client";

import React, { memo } from "react";
import { useSummary } from "@/contexts/summary-context";
import type { PositionSummary } from "@/lib/data/summary-types";
import { usd, usdPlain, pct, pnlColor, regimeColor, strategyLabel, timeAgo, stopPct, stopBarColor } from "@/lib/format";
import { BARS_MAX } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign,
  TrendingDown,
  Crosshair,
  Activity,
  ShieldAlert,
  Radio,
  Target,
  Clock,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import dynamic from "next/dynamic";

const TradingViewChart = dynamic(() => import("@/components/tradingview-chart"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[220px]">
      <Activity className="h-6 w-6 text-muted-foreground animate-pulse" />
    </div>
  ),
});
import Link from "next/link";

// ---------------------------------------------------------------------------
// Helpers (page-specific, not shared)
// ---------------------------------------------------------------------------

function freshnessIndicator(status: string): { color: string; label: string } {
  switch (status) {
    case "live": return { color: "bg-profit", label: "LIVE" };
    case "stale": return { color: "bg-warning", label: "STALE" };
    case "offline": return { color: "bg-loss", label: "OFFLINE" };
    default: return { color: "bg-muted-foreground", label: "UNKNOWN" };
  }
}

// ---------------------------------------------------------------------------
// Memoized sub-components
// ---------------------------------------------------------------------------

const LoadingSkeleton = memo(function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="bg-card border-border">
            <CardContent className="pt-6">
              <Skeleton className="h-3 w-16 mb-3" />
              <Skeleton className="h-7 w-28 mb-2" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-7">
        <Skeleton className="h-[250px] lg:col-span-3 rounded-xl" />
        <Skeleton className="h-[250px] lg:col-span-2 rounded-xl" />
        <Skeleton className="h-[250px] lg:col-span-2 rounded-xl" />
      </div>
    </div>
  );
});

const ErrorState = memo(function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
      <div className="h-16 w-16 rounded-full bg-loss/10 flex items-center justify-center">
        <AlertTriangle className="h-8 w-8 text-loss" />
      </div>
      <h2 className="text-lg font-semibold">No se puede conectar al bot</h2>
      <p className="text-sm text-muted-foreground max-w-md text-center">{message}</p>
      <p className="text-xs text-muted-foreground font-mono mt-2">
        Verifica que director_state.json existe y el bot está corriendo
      </p>
    </div>
  );
});

const PositionRow = memo(function PositionRow({ pos }: { pos: PositionSummary }) {
  const isLong = pos.direction === "LONG";
  const totalRange = Math.abs(pos.tp - pos.sl);
  const entryProgress = totalRange > 0
    ? isLong
      ? ((pos.entry - pos.sl) / totalRange) * 100
      : ((pos.sl - pos.entry) / totalRange) * 100
    : 50;
  const barsPct = (pos.bars / BARS_MAX) * 100;

  return (
    <div className="flex flex-col gap-2 py-3 border-b border-border/40 last:border-0">
      {/* Top line: coin + direction + strategy + risk */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 font-mono ${
              isLong
                ? "border-profit/50 bg-profit/10 text-profit"
                : "border-loss/50 bg-loss/10 text-loss"
            }`}
          >
            {pos.direction}
          </Badge>
          <span className="font-semibold text-sm font-mono">{pos.coin.replace("-USDT", "")}</span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {strategyLabel(pos.strategy)}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono">
          {pos.mitad_cerrada && (
            <Badge variant="outline" className="border-profit/40 bg-profit/10 text-profit text-[10px] px-1.5 py-0">
              R1 {usd(pos.pnl_parcial)}
            </Badge>
          )}
          <span className="text-muted-foreground">{usdPlain(pos.risk_used, 0)} riesgo</span>
        </div>
      </div>

      {/* Middle: prices */}
      <div className="flex gap-4 text-xs font-mono">
        <div>
          <span className="text-muted-foreground text-[10px]">ENTRY </span>
          <span>{pos.entry.toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
        </div>
        <div>
          <span className="text-muted-foreground text-[10px]">TP </span>
          <span className="text-profit">{pos.tp.toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
        </div>
        <div>
          <span className="text-muted-foreground text-[10px]">SL </span>
          <span className="text-loss">{pos.sl.toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
        </div>
      </div>

      {/* Bottom: progress bars */}
      <div className="flex items-center gap-3">
        {/* SL -> TP bar */}
        <div className="flex-1">
          <div
            className="h-1.5 rounded-full bg-secondary relative overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(entryProgress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progreso SL a TP: ${Math.round(entryProgress)}%`}
          >
            <div
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-loss via-warning to-profit rounded-full"
              style={{ width: `${Math.max(5, Math.min(95, entryProgress))}%` }}
            />
          </div>
        </div>

        {/* Timeout */}
        <div className="flex items-center gap-1.5 min-w-[80px]">
          <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
            <div
              className={`h-full rounded-full ${
                barsPct > 85 ? "bg-loss" : barsPct > 60 ? "bg-warning" : "bg-info/60"
              }`}
              style={{ width: `${barsPct}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
            {pos.bars}/{BARS_MAX}
          </span>
          <Clock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { data: resp, error, isLoading } = useSummary();

  if (isLoading && !resp) return <LoadingSkeleton />;
  if (error || !resp?.meta?.ok || !resp?.data) {
    const msg = error ? String(error) : (resp?.meta?.warnings?.join(", ") ?? "Datos no disponibles");
    return (
      <div className="space-y-6">
        <ErrorState message={msg} />
        <Card className="bg-card border-border overflow-hidden">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium">ETH/USDT</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TradingViewChart symbol="BINANCE:ETHUSDT" height={400} />
          </CardContent>
        </Card>
      </div>
    );
  }

  const d = resp.data;
  const fresh = freshnessIndicator(d.botStatus);

  return (
    <div className="space-y-6">
      {/* -- Header row -- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <div className="flex items-center gap-1.5">
            <div className={`h-2 w-2 rounded-full ${fresh.color} ${d.botStatus === "live" ? "animate-pulse" : ""}`} />
            <span className="sr-only">Estado: {d.botStatus}</span>
            <span className="text-xs font-mono text-muted-foreground">{fresh.label}</span>
          </div>
          <Badge variant="outline" className="font-mono text-[10px] uppercase">
            {d.mode}
          </Badge>
          {d.killSwitch && (
            <Badge variant="destructive" className="font-mono text-[10px]">
              KILL SWITCH: {d.killSwitch}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono">
          <span>Actualizado {timeAgo(resp.meta.updatedAt)}</span>
          {(resp.meta.warnings?.length ?? 0) > 0 && (
            <Badge variant="outline" className="border-warning/50 text-warning text-[10px]">
              {resp.meta.warnings.length} advertencia{resp.meta.warnings.length > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </div>

      {/* -- KPI Cards Row 1: Core metrics -- */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {/* Equity */}
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Equity</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{usdPlain(d.equity)}</div>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              Máximo: {usdPlain(d.peak)}
            </p>
          </CardContent>
        </Card>

        {/* Drawdown */}
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Drawdown</CardTitle>
            <TrendingDown className="h-4 w-4 text-loss" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold font-mono ${pnlColor(d.drawdownPct)}`}>
              {pct(d.drawdownPct)}
            </div>
            <p className={`text-xs mt-1 font-mono ${pnlColor(d.drawdownUsd)}`}>
              {usd(d.drawdownUsd)}
            </p>
          </CardContent>
        </Card>

        {/* Regime */}
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Regime</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Badge variant="outline" className={`${regimeColor(d.regime)} font-mono text-base px-3 py-0.5`}>
              {d.regime}
            </Badge>
            <p className="text-xs text-muted-foreground mt-2 font-mono">
              Confianza: {d.regimeConfidence}
            </p>
          </CardContent>
        </Card>

        {/* Positions */}
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Posiciones</CardTitle>
            <Crosshair className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{d.openCount}</div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-muted-foreground font-mono">
                {d.pendingCount} pendiente{d.pendingCount !== 1 ? "s" : ""}
              </span>
              <span className="text-xs text-muted-foreground font-mono">
                {usdPlain(d.capitalAtRisk, 0)} en riesgo
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* -- Row 2: P&L + Trade Stats + Signal Stats -- */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
        {/* P&L and Risk Stops */}
        <Card className="bg-card border-border lg:col-span-3">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">P&L vs Stops</CardTitle>
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: "Diario", pnl: d.dailyPnl, stop: d.dailyStop },
              { label: "Semanal", pnl: d.weeklyPnl, stop: d.weeklyStop },
              { label: "Mensual", pnl: d.monthlyPnl, stop: d.monthlyStop },
            ].map((row) => {
              const p = stopPct(row.pnl, row.stop);
              return (
                <div key={row.label} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{row.label}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-mono font-semibold ${pnlColor(row.pnl)}`}>
                        {usd(row.pnl)}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        / {usd(row.stop)}
                      </span>
                    </div>
                  </div>
                  <div
                    className="h-1.5 rounded-full bg-secondary overflow-hidden"
                    role="progressbar"
                    aria-valuenow={Math.round(p)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Stop ${row.label}: ${Math.round(p)}%`}
                  >
                    <div
                      className={`h-full rounded-full transition-all ${stopBarColor(p)}`}
                      style={{ width: `${Math.max(1, p)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Trade Stats */}
        <Card className="bg-card border-border lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Estadísticas de Trades</CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {[
                { label: "Total", value: String(d.tradeStats.total), color: "" },
                { label: "Tasa Acierto", value: d.tradeStats.winRate !== null ? `${d.tradeStats.winRate.toFixed(0)}%` : "N/A", color: pnlColor(d.tradeStats.winRate !== null ? d.tradeStats.winRate - 50 : null) },
                { label: "P&L Total", value: usd(d.tradeStats.totalPnl), color: pnlColor(d.tradeStats.totalPnl) },
                { label: "Factor Benef.", value: d.tradeStats.profitFactor?.toFixed(2) ?? "N/A", color: "" },
                { label: "Prom. Ganancia", value: usd(d.tradeStats.avgWin), color: "text-profit" },
                { label: "Prom. Pérdida", value: usd(d.tradeStats.avgLoss), color: "text-loss" },
                { label: "Mejor", value: usd(d.tradeStats.bestTrade), color: "text-profit" },
                { label: "Peor", value: usd(d.tradeStats.worstTrade), color: "text-loss" },
              ].map((item) => (
                <div key={item.label}>
                  <p className="text-[10px] text-muted-foreground">{item.label}</p>
                  <p className={`text-sm font-mono font-semibold ${item.color || "text-foreground"}`}>
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Signal Stats */}
        <Card className="bg-card border-border lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Señales ({d.signalStats.total})</CardTitle>
              <Radio className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5">
              {[
                { label: "Ejecutadas", count: d.signalStats.executed, color: "bg-profit", textColor: "text-profit" },
                { label: "Shadow", count: d.signalStats.shadow, color: "bg-info", textColor: "text-info" },
                { label: "Rechazadas (Riesgo)", count: d.signalStats.rejectedRisk, color: "bg-loss", textColor: "text-loss" },
                { label: "Rechazadas (Régimen)", count: d.signalStats.rejectedRegime, color: "bg-warning", textColor: "text-warning" },
              ].map((item) => {
                const width = d.signalStats.total > 0
                  ? (item.count / d.signalStats.total) * 100
                  : 0;
                return (
                  <div key={item.label} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{item.label}</span>
                      <span className={`text-xs font-mono font-semibold ${item.textColor}`}>
                        {item.count}
                      </span>
                    </div>
                    <div className="h-1 rounded-full bg-secondary overflow-hidden">
                      <div
                        className={`h-full rounded-full ${item.color}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* -- Row 3: Equity chart placeholder + Positions -- */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* TradingView ETH chart */}
        <Card className="bg-card border-border lg:col-span-2 overflow-hidden">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium">ETH/USDT</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TradingViewChart symbol="BINANCE:ETHUSDT" height={240} />
          </CardContent>
        </Card>

        {/* Open Positions */}
        <Card className="bg-card border-border lg:col-span-3">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">
                Posiciones Abiertas
              </CardTitle>
              <Link
                href="/positions"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                aria-label="Ver todas las posiciones"
              >
                Ver todas <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {d.openPositions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[220px] gap-2">
                <Crosshair className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Sin posiciones abiertas</p>
              </div>
            ) : (
              <div className="space-y-0">
                {d.openPositions.map((pos) => (
                  <PositionRow key={pos.coin} pos={pos} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* -- Row 4: Strategy daily breakdown -- */}
      {Object.keys(d.strategyDaily).length > 0 && (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
          {Object.entries(d.strategyDaily).map(([name, stats]) => {
            const isActive =
              (d.regime === "TREND_UP" || d.regime === "TREND_DOWN")
                ? name === "smc" || name.includes("trendline")
                : d.regime === "RANGE"
                  ? name === "mean_reversion" || name.includes("trendline")
                  : false;
            return (
              <Card key={name} className="bg-card border-border">
                <CardContent className="pt-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{strategyLabel(name)}</span>
                      <span className="text-[10px] text-muted-foreground/60 font-mono truncate max-w-[120px]">{name}</span>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-mono ${
                        isActive
                          ? "border-profit/50 bg-profit/10 text-profit"
                          : "border-muted-foreground/30 text-muted-foreground"
                      }`}
                    >
                      {isActive ? "ACTIVA" : "INACTIVA"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {[
                      { label: "Señales", value: String(stats.signals), color: "" },
                      { label: "Aperturas", value: String(stats.opens), color: "" },
                      { label: "Ganados", value: String(stats.wins), color: stats.wins > 0 ? "text-profit" : "" },
                      { label: "Perdidos", value: String(stats.losses), color: stats.losses > 0 ? "text-loss" : "" },
                      { label: "P&L", value: usd(stats.pnl), color: pnlColor(stats.pnl) },
                    ].map((item) => (
                      <div key={item.label} className="text-center">
                        <p className="text-[10px] text-muted-foreground">{item.label}</p>
                        <p className={`text-sm font-mono font-semibold ${item.color || "text-foreground"}`}>
                          {item.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* -- Warnings footer -- */}
      {(resp.meta.warnings?.length ?? 0) > 0 && (
        <Card className="bg-card border-warning/20">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
              <div className="space-y-0.5">
                {resp.meta.warnings.map((w) => (
                  <p key={w} className="text-xs text-warning/80 font-mono">{w}</p>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
