"use client";

import React, { useState, useMemo, memo } from "react";
import { useApi } from "@/hooks/use-api";
import type { ApiResponse } from "@/lib/data/api-helpers";
import type { DirectorState, Position, PendingEntry } from "@/lib/data/schemas";
import { num, usd, pnlUsd, timeAgo, strategyLabel, regimeColor } from "@/lib/format";
import { BARS_MAX } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Crosshair,
  Clock,
  AlertTriangle,
  Timer,
  ArrowUpDown,
  Filter,
  Hourglass,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Page-specific helpers
// ---------------------------------------------------------------------------

function regimeBadge(regime: string | undefined): string {
  switch (regime) {
    case "TREND_UP": return "border-profit/50 bg-profit/10 text-profit";
    case "TREND_DOWN": return "border-loss/50 bg-loss/10 text-loss";
    case "RANGE": return "border-warning/50 bg-warning/10 text-warning";
    case "CHOP": return "border-muted-foreground/30 text-muted-foreground";
    default: return "border-border text-muted-foreground";
  }
}

function timeoutSeverity(bars: number): { color: string; label: string } {
  const pct = (bars / BARS_MAX) * 100;
  if (pct >= 90) return { color: "text-loss", label: "CRITICAL" };
  if (pct >= 70) return { color: "text-warning", label: "WARNING" };
  return { color: "text-muted-foreground", label: "" };
}

function timeoutBarColor(bars: number): string {
  const pct = (bars / BARS_MAX) * 100;
  if (pct >= 90) return "bg-loss";
  if (pct >= 70) return "bg-warning";
  return "bg-info/60";
}

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

type FilterField = "coin" | "strategy" | "direction" | "regime";

interface Filters {
  coin: string;
  strategy: string;
  direction: string;
  regime: string;
}

const EMPTY_FILTERS: Filters = { coin: "", strategy: "", direction: "", regime: "" };

// ---------------------------------------------------------------------------
// Sub-components (non-memoized simple ones)
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <Card className="bg-card border-border">
        <CardContent className="pt-6 space-y-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-[50vh] gap-4">
      <div className="h-16 w-16 rounded-full bg-loss/10 flex items-center justify-center">
        <AlertTriangle className="h-8 w-8 text-loss" />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function EmptyPositions() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="h-14 w-14 rounded-full bg-secondary flex items-center justify-center">
        <Crosshair className="h-7 w-7 text-muted-foreground/40" />
      </div>
      <p className="text-sm text-muted-foreground">Sin posiciones abiertas</p>
      <p className="text-xs text-muted-foreground/60 font-mono">
        El bot abrirá posiciones cuando detecte señales válidas
      </p>
    </div>
  );
}

function EmptyPending() {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2">
      <Hourglass className="h-6 w-6 text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground">Sin entradas pendientes</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memoized sub-components (Issue #5)
// ---------------------------------------------------------------------------

const FilterBar = memo(function FilterBar({
  filters,
  onChange,
  options,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  options: { coins: string[]; strategies: string[]; regimes: string[] };
}) {
  const hasActive = Object.values(filters).some((v) => v !== "");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filter className="h-3.5 w-3.5 text-muted-foreground" />

      <select
        value={filters.coin}
        aria-label="Filtrar por moneda"
        onChange={(e) => onChange({ ...filters, coin: e.target.value })}
        className="h-9 rounded-md border border-border bg-secondary px-2 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">Todas las monedas</option>
        {options.coins.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>

      <select
        value={filters.strategy}
        aria-label="Filtrar por estrategia"
        onChange={(e) => onChange({ ...filters, strategy: e.target.value })}
        className="h-9 rounded-md border border-border bg-secondary px-2 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">Todas las estrategias</option>
        {options.strategies.map((s) => <option key={s} value={s}>{strategyLabel(s)}</option>)}
      </select>

      <select
        value={filters.direction}
        aria-label="Filtrar por dirección"
        onChange={(e) => onChange({ ...filters, direction: e.target.value })}
        className="h-9 rounded-md border border-border bg-secondary px-2 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">Todas las dirs</option>
        <option value="LONG">LONG</option>
        <option value="SHORT">SHORT</option>
      </select>

      <select
        value={filters.regime}
        aria-label="Filtrar por régimen"
        onChange={(e) => onChange({ ...filters, regime: e.target.value })}
        className="h-9 rounded-md border border-border bg-secondary px-2 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">Todos los regímenes</option>
        {options.regimes.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>

      {hasActive && (
        <button
          onClick={() => onChange(EMPTY_FILTERS)}
          className="h-9 px-3 text-xs text-muted-foreground hover:text-foreground font-mono underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
        >
          Limpiar
        </button>
      )}
    </div>
  );
});

const PriceCell = memo(function PriceCell({
  label,
  value,
  className = "",
  muted = false,
}: {
  label: string;
  value: string;
  className?: string;
  muted?: boolean;
}) {
  return (
    <div>
      <span className="text-[10px] text-muted-foreground font-mono block">{label}</span>
      <span className={`text-sm font-mono ${muted ? "text-muted-foreground" : className || "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
});

const PositionCard = memo(function PositionCard({ coin, pos }: { coin: string; pos: Position }) {
  const isLong = pos.direction === "LONG";
  const totalRange = Math.abs(pos.tp - pos.sl);

  const entryProgress = totalRange > 0
    ? isLong
      ? ((pos.entry - pos.sl) / totalRange) * 100
      : ((pos.sl - pos.entry) / totalRange) * 100
    : 50;

  const barsPct = (pos.bars / BARS_MAX) * 100;
  const timeout = timeoutSeverity(pos.bars);
  const slipPct = pos.entry_slippage_pct;

  return (
    <div className="rounded-lg border border-border bg-card p-4 hover:border-border/80 transition-colors space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Badge
            variant="outline"
            className={`text-xs px-2 py-0.5 font-mono font-semibold ${
              isLong
                ? "border-profit/50 bg-profit/10 text-profit"
                : "border-loss/50 bg-loss/10 text-loss"
            }`}
          >
            {pos.direction}
          </Badge>
          <span className="font-bold text-base font-mono">{coin}</span>
          <Badge variant="outline" className="text-[10px] font-mono py-0">
            {strategyLabel(pos.strategy)}
          </Badge>
          {pos.regime && (
            <Badge variant="outline" className={`text-[10px] font-mono py-0 ${regimeBadge(pos.regime)}`}>
              {pos.regime}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {pos.mitad_cerrada && (
            <Badge variant="outline" className="border-profit/40 bg-profit/10 text-profit text-[10px] font-mono py-0">
              R1 HIT {pnlUsd(pos.pnl_parcial)}
            </Badge>
          )}
          {timeout.label && (
            <Badge variant="outline" className={`border-loss/30 text-[10px] font-mono py-0 ${timeout.color}`}>
              {timeout.label}
            </Badge>
          )}
        </div>
      </div>

      {/* Price grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <PriceCell label="ENTRY" value={num(pos.entry)} />
        <PriceCell label="SIGNAL" value={num(pos.signal_price)} muted />
        <PriceCell label="FILL" value={num(pos.fill_entry_price)} muted />
        <PriceCell label="TP" value={num(pos.tp)} className="text-profit" />
        <PriceCell label="SL" value={num(pos.sl)} className="text-loss" />
        <PriceCell
          label="R1"
          value={pos.r1 ? num(pos.r1) : "—"}
          className={pos.mitad_cerrada ? "text-profit" : ""}
          muted={!pos.mitad_cerrada}
        />
      </div>

      {/* SL -> TP progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
          <span>SL {num(pos.sl)}</span>
          <span>TP {num(pos.tp)}</span>
        </div>
        <div className="h-2 rounded-full bg-secondary relative overflow-hidden">
          <div
            className="absolute top-0 left-0 h-full bg-gradient-to-r from-loss via-warning to-profit rounded-full transition-all"
            style={{ width: `${Math.max(3, Math.min(97, entryProgress))}%` }}
          />
          <div
            className="absolute top-0 h-full w-0.5 bg-foreground"
            style={{ left: `${Math.max(1, Math.min(99, entryProgress))}%` }}
          />
        </div>
      </div>

      {/* Bottom: risk + bars + time + slippage */}
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">RISK</span>
            <span className="text-xs font-mono font-semibold">{usd(pos.risk_used, 0)}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Timer className="h-3 w-3 text-muted-foreground" />
            <span className={`text-xs font-mono font-semibold ${timeout.color}`}>
              {pos.bars}/{BARS_MAX}
            </span>
            <div
              className="w-16 h-1 rounded-full bg-secondary overflow-hidden"
              role="progressbar"
              aria-valuenow={Math.round(barsPct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Timeout: ${pos.bars} de ${BARS_MAX} barras`}
            >
              <div
                className={`h-full rounded-full ${timeoutBarColor(pos.bars)}`}
                style={{ width: `${barsPct}%` }}
              />
            </div>
          </div>

          {slipPct !== undefined && slipPct !== null && (
            <div className="flex items-center gap-1.5">
              <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-mono text-muted-foreground">
                slip {slipPct.toFixed(3)}%
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 text-[10px] font-mono text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>Abierta {timeAgo(pos.entry_ts)}</span>
          </div>
          {pos.last_checked_ts && (
            <span>Revisada {timeAgo(pos.last_checked_ts)}</span>
          )}
        </div>
      </div>

      {/* Ladder fills */}
      {pos.ladder_fills.length > 1 && (
        <div className="border-t border-border/40 pt-2">
          <span className="text-[10px] text-muted-foreground font-mono">LADDER FILLS</span>
          <div className="flex gap-3 mt-1">
            {pos.ladder_fills.map((fill) => (
              <div key={fill.label} className="text-[10px] font-mono">
                <span className="text-muted-foreground">{fill.label}:</span>{" "}
                <span>{num(fill.price)}</span>{" "}
                <span className="text-muted-foreground">({usd(fill.risk, 0)})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

const PendingCard = memo(function PendingCard({ coin, entry }: { coin: string; entry: PendingEntry }) {
  const isLong = entry.direction === "LONG";

  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 font-mono ${
              isLong
                ? "border-profit/30 bg-profit/5 text-profit"
                : "border-loss/30 bg-loss/5 text-loss"
            }`}
          >
            {entry.direction}
          </Badge>
          <span className="font-semibold text-sm font-mono">{coin}</span>
          <Badge variant="outline" className="text-[10px] font-mono py-0">
            {strategyLabel(entry.strategy)}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <Hourglass className="h-3 w-3 text-warning" />
          <span className="text-[10px] text-warning font-mono">
            Esperando {entry.bars_waiting}/{entry.max_bars ?? "?"} barras
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 text-xs font-mono">
        {entry.fill_zone_top !== undefined && entry.fill_zone_bottom !== undefined ? (
          <>
            <PriceCell label="ZONE TOP" value={num(entry.fill_zone_top)} />
            <PriceCell label="ZONE BOT" value={num(entry.fill_zone_bottom)} />
          </>
        ) : (
          <PriceCell label="SIGNAL" value={num(entry.signal_price ?? entry.price)} />
        )}
        <PriceCell label="TP" value={num(entry.tp)} className="text-profit" />
        <PriceCell label="SL" value={num(entry.sl)} className="text-loss" />
        {entry.risk_used !== undefined && (
          <PriceCell label="RISK" value={usd(entry.risk_used, 0)} />
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function PositionsPage() {
  const { data: resp, error, isLoading } = useApi<ApiResponse<DirectorState>>("/api/state");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  // Issue #8: Split useMemo into two — filterOptions depends only on data,
  // filtered positions depend on data + filters
  const { allPositions, allPending, filterOptions } = useMemo(() => {
    if (!resp?.data) {
      return {
        allPositions: [] as [string, Position][],
        allPending: [] as [string, PendingEntry][],
        filterOptions: { coins: [] as string[], strategies: [] as string[], regimes: [] as string[] },
      };
    }

    const allPos = Object.entries(resp.data.positions) as [string, Position][];
    const allPend = Object.entries(resp.data.pending_entries) as [string, PendingEntry][];

    const coins = [...new Set(allPos.map(([c]) => c))].sort();
    const strategies = [...new Set(allPos.map(([, p]) => p.strategy))].sort();
    const regimes = [...new Set(allPos.map(([, p]) => p.regime).filter(Boolean))] as string[];

    return {
      allPositions: allPos,
      allPending: allPend,
      filterOptions: { coins, strategies, regimes },
    };
  }, [resp?.data]);

  const { positions, pending, totalRisk } = useMemo(() => {
    const filtered = allPositions.filter(([coin, pos]) => {
      if (filters.coin && coin !== filters.coin) return false;
      if (filters.strategy && pos.strategy !== filters.strategy) return false;
      if (filters.direction && pos.direction !== filters.direction) return false;
      if (filters.regime && pos.regime !== filters.regime) return false;
      return true;
    });

    const risk = filtered.reduce((s, [, p]) => s + p.risk_used, 0);

    return {
      positions: filtered,
      pending: allPending,
      totalRisk: risk,
    };
  }, [allPositions, allPending, filters]);

  if (isLoading && !resp) return <LoadingSkeleton />;
  if (error) return <ErrorState message={String(error)} />;
  if (!resp?.meta?.ok) {
    return <ErrorState message={resp?.meta?.warnings?.join(", ") ?? "Estado no disponible"} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Posiciones</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Monitoreo en tiempo real de posiciones activas y entradas pendientes
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="font-mono text-xs">
            {positions.length} abierta{positions.length !== 1 ? "s" : ""}
          </Badge>
          {pending.length > 0 && (
            <Badge variant="outline" className="font-mono text-xs border-warning/50 text-warning">
              {pending.length} pendiente{pending.length !== 1 ? "s" : ""}
            </Badge>
          )}
          <span className="text-xs font-mono text-muted-foreground">
            {usd(totalRisk, 0)} en riesgo
          </span>
        </div>
      </div>

      {/* Filters */}
      {positions.length > 0 && (
        <FilterBar filters={filters} onChange={setFilters} options={filterOptions} />
      )}

      {/* Positions */}
      {positions.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <EmptyPositions />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {positions.map(([coin, pos]) => (
            <PositionCard key={coin} coin={coin} pos={pos} />
          ))}
        </div>
      )}

      {/* Pending Entries */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Hourglass className="h-4 w-4 text-muted-foreground" />
              Entradas Pendientes
            </CardTitle>
            <span className="text-[10px] text-muted-foreground font-mono">
              Órdenes límite esperando ejecución
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <EmptyPending />
          ) : (
            <div className="space-y-2">
              {pending.map(([coin, entry]) => (
                <PendingCard key={coin} coin={coin} entry={entry} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
