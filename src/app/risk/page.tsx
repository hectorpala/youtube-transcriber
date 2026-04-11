"use client";

import { useMemo } from "react";
import { useApi } from "@/hooks/use-api";
import type { ApiResponse } from "@/lib/data/api-helpers";
import type { DirectorState } from "@/lib/data/schemas";
import { usd, pnlColor, stopPct, strategyLabel } from "@/lib/format";
import {
  DAILY_STOP,
  WEEKLY_STOP,
  MONTHLY_STOP,
  BANKROLL,
  MAX_OPEN,
  MAX_CORRELATED,
  CORR_GROUP,
  DD_THROTTLE,
} from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  AlertTriangle,
  Clock,
  Zap,
  TrendingDown,
  DollarSign,
  Pause,
  Timer,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Page-specific helpers
// ---------------------------------------------------------------------------

function stopSeverity(pct: number): { bar: string; border: string; label: string } {
  if (pct >= 90) return { bar: "bg-loss", border: "border-loss/50", label: "CRITICAL" };
  if (pct >= 70) return { bar: "bg-loss/80", border: "border-loss/30", label: "DANGER" };
  if (pct >= 50) return { bar: "bg-warning", border: "border-warning/30", label: "WARNING" };
  if (pct >= 25) return { bar: "bg-warning/60", border: "border-border", label: "" };
  return { bar: "bg-profit/60", border: "border-border", label: "" };
}

function computeThrottle(ddPct: number): { rate: number; active: boolean; label: string } {
  for (const [threshold, rate] of DD_THROTTLE) {
    if (ddPct <= threshold) {
      return {
        rate: rate * 100,
        active: true,
        label: rate === 0
          ? `Throttle PARADA TOTAL — DD ${ddPct.toFixed(1)}% pasó ${threshold}%`
          : `Throttle ${(rate * 100).toFixed(0)}% — DD ${ddPct.toFixed(1)}% pasó ${threshold}%`,
      };
    }
  }
  return { rate: 100, active: false, label: "Sin throttle — drawdown dentro de límites" };
}

function parseCooldownKey(key: string): { coin: string; strategy: string; raw: string } {
  const parts = key.split(":");
  return {
    raw: key,
    coin: parts[0] ?? "unknown",
    strategy: parts[1] ?? "unknown",
  };
}

function timeUntil(tsMs: number): string {
  const diff = tsMs - Date.now();
  if (diff <= 0) return "expirado";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

// ---------------------------------------------------------------------------
// Overall risk verdict
// ---------------------------------------------------------------------------

interface RiskVerdict {
  icon: typeof ShieldCheck;
  color: string;
  bgColor: string;
  title: string;
  details: string[];
}

function computeVerdict(state: DirectorState, ddPct: number, throttle: ReturnType<typeof computeThrottle>): RiskVerdict {
  const details: string[] = [];
  let severity = 0;

  const dailyP = stopPct(state.risk_daily_pnl, DAILY_STOP);
  const weeklyP = stopPct(state.risk_weekly_pnl, WEEKLY_STOP);
  const monthlyP = stopPct(state.risk_monthly_pnl, MONTHLY_STOP);

  if (dailyP >= 90) { severity = 3; details.push("Muy cerca del stop diario"); }
  else if (dailyP >= 70) { severity = Math.max(severity, 2); details.push("Cerca del stop diario"); }
  else if (dailyP >= 50) { severity = Math.max(severity, 1); details.push("Stop diario al " + dailyP.toFixed(0) + "%"); }

  if (weeklyP >= 70) { severity = Math.max(severity, 2); details.push("Cerca del stop semanal"); }
  if (monthlyP >= 70) { severity = Math.max(severity, 2); details.push("Cerca del stop mensual"); }

  if (throttle.active) {
    severity = Math.max(severity, throttle.rate === 0 ? 3 : 2);
    details.push(`Throttle activo al ${throttle.rate.toFixed(0)}%`);
  }

  if (state.risk_kill_switch) {
    severity = 3;
    details.push(`Kill switch: ${state.risk_kill_switch}`);
  }

  if (ddPct <= -20) { severity = Math.max(severity, 3); details.push(`Drawdown severo: ${ddPct.toFixed(1)}%`); }
  else if (ddPct <= -10) { severity = Math.max(severity, 2); details.push(`Drawdown elevado: ${ddPct.toFixed(1)}%`); }

  if (details.length === 0) details.push("Todos los límites dentro de rango");

  switch (severity) {
    case 0: return { icon: ShieldCheck, color: "text-profit", bgColor: "bg-profit/10", title: "Riesgo controlado", details };
    case 1: return { icon: ShieldAlert, color: "text-warning", bgColor: "bg-warning/10", title: "Precaución", details };
    case 2: return { icon: ShieldAlert, color: "text-warning", bgColor: "bg-warning/10", title: "Riesgo elevado", details };
    default: return { icon: ShieldX, color: "text-loss", bgColor: "bg-loss/10", title: "Riesgo crítico", details };
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StopGauge({ label, pnl, limit }: { label: string; pnl: number; limit: number }) {
  const pctVal = stopPct(pnl, limit);
  const sev = stopSeverity(pctVal);

  return (
    <Card className={`bg-card ${sev.border}`}>
      <CardContent className="pt-5 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground font-medium">{label}</span>
          {sev.label && (
            <Badge variant="outline" className={`text-[10px] font-mono py-0 ${
              sev.label === "CRITICAL" ? "border-loss/50 text-loss" :
              sev.label === "DANGER" ? "border-loss/30 text-loss" :
              "border-warning/50 text-warning"
            }`}>
              <span className="sr-only">Severidad: </span>
              {sev.label}
            </Badge>
          )}
        </div>
        <div className="flex items-baseline justify-between">
          <span className={`text-2xl font-bold font-mono ${pnlColor(pnl)}`}>{usd(pnl)}</span>
          <span className="text-xs text-muted-foreground font-mono">/ {usd(limit)}</span>
        </div>
        <div
          className="h-2.5 rounded-full bg-secondary overflow-hidden"
          role="progressbar"
          aria-valuenow={Math.round(pctVal)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label}: ${pctVal.toFixed(1)}% usado`}
        >
          <div
            className={`h-full rounded-full transition-all ${sev.bar}`}
            style={{ width: `${Math.max(1, pctVal)}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
          <span>0%</span>
          <span>{pctVal.toFixed(1)}% usado</span>
          <span>100%</span>
        </div>
      </CardContent>
    </Card>
  );
}

function CooldownRow({ coin, strategy, direction, expiresMs }: {
  coin: string; strategy: string; direction: string; expiresMs: number;
}) {
  const remaining = timeUntil(expiresMs);
  const isExpired = expiresMs <= Date.now();

  if (isExpired) return null;

  return (
    <div className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={`text-[10px] font-mono py-0 ${
          direction === "LONG" ? "border-profit/40 text-profit" : "border-loss/40 text-loss"
        }`}>
          {direction}
        </Badge>
        <span className="text-sm font-mono font-semibold">{coin.replace("-USDT", "")}</span>
        <span className="text-[10px] text-muted-foreground font-mono">{strategyLabel(strategy)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Timer className="h-3 w-3 text-warning" />
        <span className="text-xs font-mono text-warning">{remaining}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function RiskPage() {
  const { data: resp, isLoading } = useApi<ApiResponse<DirectorState>>("/api/state");

  const analysis = useMemo(() => {
    if (!resp?.data) return null;
    const state = resp.data;
    const equity = state.equity;
    const peak = state.peak;
    const ddPct = peak > 0 ? ((equity - peak) / peak) * 100 : 0;
    const ddFromBankroll = ((equity - BANKROLL) / BANKROLL) * 100;
    const throttle = computeThrottle(ddFromBankroll);
    const verdict = computeVerdict(state, ddFromBankroll, throttle);

    const positions = Object.entries(state.positions).map(([coin, pos]) => ({
      coin,
      direction: pos.direction,
      strategy: pos.strategy,
      risk_used: pos.risk_used,
      bars: pos.bars,
      mitad_cerrada: pos.mitad_cerrada,
      isCorrelated: CORR_GROUP.has(coin),
    }));
    const totalRisk = positions.reduce((s, p) => s + p.risk_used, 0);
    const correlatedCount = positions.filter((p) => p.isCorrelated).length;

    const signalCooldowns = Object.entries(state.signal_cooldown_until)
      .map(([key, ts]) => {
        const parsed = parseCooldownKey(key);
        const direction = key.split(":")[2] ?? "";
        return { key: parsed.raw, coin: parsed.coin, strategy: parsed.strategy, direction, expiresMs: ts };
      })
      .filter((c) => c.expiresMs > Date.now());

    const mrCooldowns = Object.entries(state.mr_cooldown_until)
      .map(([coin, ts]) => ({
        key: `mr:${coin}`, coin, strategy: "mean_reversion", direction: "ALL", expiresMs: ts,
      }))
      .filter((c) => c.expiresMs > Date.now());

    const pendingRisk = Object.entries(state.pending_entries).reduce(
      (s, [, e]) => s + (e.risk_used ?? 0), 0
    );

    return {
      state, equity, peak, ddPct, ddFromBankroll, throttle, verdict,
      positions, totalRisk, correlatedCount, pendingRisk,
      signalCooldowns, mrCooldowns,
    };
  }, [resp?.data]);

  if (isLoading && !resp) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 rounded-xl" />
        <div className="grid gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!resp?.meta?.ok || !analysis) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] gap-4">
        <AlertTriangle className="h-8 w-8 text-loss" />
        <p className="text-sm text-muted-foreground">{resp?.meta?.warnings?.join(", ") ?? "Estado no disponible"}</p>
      </div>
    );
  }

  const { state, equity, peak, ddPct, ddFromBankroll, throttle, verdict, positions, totalRisk, correlatedCount, pendingRisk, signalCooldowns, mrCooldowns } = analysis;
  const VerdictIcon = verdict.icon;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Análisis de Riesgo</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Panel operativo — drawdown, stops, cooldowns y exposición
        </p>
      </div>

      {/* Verdict banner */}
      <Card className={`${verdict.bgColor} border-border`}>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-start gap-3">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${verdict.bgColor}`}>
              <VerdictIcon className={`h-5 w-5 ${verdict.color}`} />
            </div>
            <div>
              <h2 className={`text-base font-semibold ${verdict.color}`}>{verdict.title}</h2>
              <div className="space-y-0.5 mt-1">
                {verdict.details.map((d) => (
                  <p key={d} className="text-xs text-muted-foreground font-mono">{d}</p>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stop gauges */}
      <div className="grid gap-4 md:grid-cols-3">
        <StopGauge label="Stop Diario (3R)" pnl={state.risk_daily_pnl} limit={DAILY_STOP} />
        <StopGauge label="Stop Semanal (6R)" pnl={state.risk_weekly_pnl} limit={WEEKLY_STOP} />
        <StopGauge label="Stop Mensual (12R)" pnl={state.risk_monthly_pnl} limit={MONTHLY_STOP} />
      </div>

      {/* Drawdown + Throttle + Kill Switch */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Drawdown */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium">Drawdown</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-muted-foreground">Desde Máximo</p>
                <p className={`text-xl font-bold font-mono ${pnlColor(ddPct)}`}>
                  {ddPct.toFixed(2)}%
                </p>
                <p className="text-[10px] text-muted-foreground font-mono">{usd(equity - peak)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Desde Bankroll</p>
                <p className={`text-xl font-bold font-mono ${pnlColor(ddFromBankroll)}`}>
                  {ddFromBankroll.toFixed(2)}%
                </p>
                <p className="text-[10px] text-muted-foreground font-mono">{usd(equity - BANKROLL)}</p>
              </div>
            </div>
            <div className="border-t border-border pt-2 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-muted-foreground">Equity</p>
                <p className="text-sm font-mono font-semibold">${equity.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Máximo</p>
                <p className="text-sm font-mono font-semibold">${peak.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Throttle */}
        <Card className={`bg-card ${throttle.active ? "border-warning/40" : "border-border"}`}>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Pause className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium">Drawdown Throttle</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-center py-2">
              <p className={`text-3xl font-bold font-mono ${
                throttle.rate === 100 ? "text-profit" :
                throttle.rate === 0 ? "text-loss" : "text-warning"
              }`}>
                {throttle.rate.toFixed(0)}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">señales aceptadas</p>
            </div>

            <div className="space-y-1.5">
              {[
                { label: "< -10% DD", rate: "50%", active: ddFromBankroll <= -10 && ddFromBankroll > -20 },
                { label: "< -20% DD", rate: "25%", active: ddFromBankroll <= -20 && ddFromBankroll > -30 },
                { label: "< -30% DD", rate: "0%", active: ddFromBankroll <= -30 },
              ].map((tier) => (
                <div key={tier.label} className={`flex items-center justify-between px-2 py-1 rounded text-xs font-mono ${
                  tier.active ? "bg-warning/10 text-warning" : "text-muted-foreground"
                }`}>
                  <span>{tier.label}</span>
                  <span className="font-semibold">{tier.rate}</span>
                </div>
              ))}
            </div>

            <p className="text-[10px] text-muted-foreground font-mono text-center">{throttle.label}</p>
          </CardContent>
        </Card>

        {/* Kill Switch */}
        <Card className={`bg-card ${state.risk_kill_switch ? "border-loss/50" : "border-border"}`}>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium">Kill Switch</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {state.risk_kill_switch ? (
              <div className="flex flex-col items-center py-4 gap-2">
                <div className="h-12 w-12 rounded-full bg-loss/10 flex items-center justify-center">
                  <ShieldX className="h-6 w-6 text-loss" />
                </div>
                <Badge variant="destructive" className="font-mono text-xs">
                  {state.risk_kill_switch}
                </Badge>
                <p className="text-xs text-loss/80">Trading detenido</p>
              </div>
            ) : (
              <div className="flex flex-col items-center py-4 gap-2">
                <div className="h-12 w-12 rounded-full bg-profit/10 flex items-center justify-center">
                  <ShieldCheck className="h-6 w-6 text-profit" />
                </div>
                <p className="text-sm font-semibold text-profit">Inactivo</p>
                <p className="text-[10px] text-muted-foreground">Trading habilitado</p>
              </div>
            )}

            {Object.keys(state.risk_blocked_regimes).length > 0 && (
              <div className="mt-3 pt-2 border-t border-border">
                <p className="text-[10px] text-muted-foreground mb-1">Regímenes bloqueados</p>
                <div className="flex gap-1.5 flex-wrap">
                  {Object.keys(state.risk_blocked_regimes).map((r) => (
                    <Badge key={r} variant="outline" className="text-[10px] font-mono py-0 border-loss/40 text-loss">
                      {r}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Exposure: open positions + pending */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Position risk breakdown */}
        <Card className="bg-card border-border lg:col-span-3">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                Riesgo Abierto
              </CardTitle>
              <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                <span>${totalRisk.toFixed(0)} abierto</span>
                {pendingRisk > 0 && <span>+ ${pendingRisk.toFixed(0)} pendiente</span>}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {positions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Sin posiciones abiertas</p>
            ) : (
              <div className="space-y-2">
                {positions.map((pos) => {
                  const riskPct = totalRisk > 0 ? (pos.risk_used / totalRisk) * 100 : 0;
                  return (
                    <div key={pos.coin} className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 min-w-[100px]">
                        <Badge variant="outline" className={`text-[10px] font-mono py-0 px-1 ${
                          pos.direction === "LONG" ? "border-profit/40 text-profit" : "border-loss/40 text-loss"
                        }`}>
                          {pos.direction.charAt(0)}
                        </Badge>
                        <span className="text-sm font-mono font-semibold">{pos.coin.replace("-USDT", "")}</span>
                        {pos.isCorrelated && (
                          <span className="text-[8px] text-info font-mono" title="Grupo correlacionado">C</span>
                        )}
                      </div>

                      <div className="flex-1 h-4 rounded bg-secondary overflow-hidden relative">
                        <div
                          className={`h-full rounded ${
                            pos.direction === "LONG" ? "bg-profit/40" : "bg-loss/40"
                          }`}
                          style={{ width: `${riskPct}%` }}
                        />
                        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-foreground/80">
                          ${pos.risk_used.toFixed(0)}{pos.mitad_cerrada ? " (½)" : ""}
                        </span>
                      </div>

                      <span className="text-[10px] text-muted-foreground font-mono min-w-[30px]">
                        {strategyLabel(pos.strategy)}
                      </span>
                    </div>
                  );
                })}

                <div className="border-t border-border pt-2 mt-2 flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">
                    Correlación BTC/ETH/SOL: {correlatedCount}/{MAX_CORRELATED} max
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Posiciones: {positions.length}/{MAX_OPEN} max
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cooldowns */}
        <Card className="bg-card border-border lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Cooldowns Activos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {signalCooldowns.length === 0 && mrCooldowns.length === 0 ? (
              <div className="flex flex-col items-center py-8 gap-2">
                <Clock className="h-6 w-6 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">Sin cooldowns activos</p>
              </div>
            ) : (
              <div className="space-y-0">
                {mrCooldowns.map((c) => (
                  <div key={c.key} className="flex items-center justify-between py-2 border-b border-border/30">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] font-mono py-0 border-warning/40 text-warning">
                        MR LOCK
                      </Badge>
                      <span className="text-sm font-mono font-semibold">{c.coin.replace("-USDT", "")}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Timer className="h-3 w-3 text-warning" />
                      <span className="text-xs font-mono text-warning">{timeUntil(c.expiresMs)}</span>
                    </div>
                  </div>
                ))}

                {signalCooldowns.map((c) => (
                  <CooldownRow
                    key={c.key}
                    coin={c.coin}
                    strategy={c.strategy}
                    direction={c.direction}
                    expiresMs={c.expiresMs}
                  />
                ))}

                <p className="text-[10px] text-muted-foreground font-mono mt-2 pt-1 border-t border-border/30">
                  {signalCooldowns.length} signal + {mrCooldowns.length} MR cooldown{mrCooldowns.length !== 1 ? "s" : ""}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
