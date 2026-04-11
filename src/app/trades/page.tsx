"use client";

import React, { useState, useMemo, useCallback, memo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useApi } from "@/hooks/use-api";
import type { ApiResponse } from "@/lib/data/api-helpers";
import type { Trade } from "@/lib/data/schemas";
import { usd, pnlColor, resultBadge, dirBadge, strategyLabel, formatDate } from "@/lib/format";
import { BARS_MAX, TRADES_POLL_INTERVAL } from "@/lib/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  Filter,
  ScrollText,
} from "lucide-react";

// ---------------------------------------------------------------------------
// KPI computation
// ---------------------------------------------------------------------------

interface TradeKPIs {
  total: number;
  wins: number;
  losses: number;
  winRate: number | null;
  profitFactor: number | null;
  avgPnl: number | null;
  bestTrade: number | null;
  worstTrade: number | null;
  avgBars: number | null;
  streak: { type: "W" | "L" | "—"; count: number };
  totalPnl: number;
}

function computeKPIs(trades: Trade[]): TradeKPIs {
  if (trades.length === 0) {
    return {
      total: 0, wins: 0, losses: 0, winRate: null, profitFactor: null,
      avgPnl: null, bestTrade: null, worstTrade: null, avgBars: null,
      streak: { type: "—", count: 0 }, totalPnl: 0,
    };
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const avgBars = trades.reduce((s, t) => s + t.bars, 0) / trades.length;

  const sorted = [...trades].sort((a, b) => b.datetime.localeCompare(a.datetime));
  let streakType: "W" | "L" | "—" = "—";
  let streakCount = 0;
  for (const t of sorted) {
    const thisType = t.pnl > 0 ? "W" : t.pnl < 0 ? "L" : null;
    if (thisType === null) continue;
    if (streakCount === 0) {
      streakType = thisType;
      streakCount = 1;
    } else if (thisType === streakType) {
      streakCount++;
    } else {
      break;
    }
  }

  return {
    total: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: (wins.length / trades.length) * 100,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    avgPnl: totalPnl / trades.length,
    bestTrade: Math.max(...trades.map((t) => t.pnl)),
    worstTrade: Math.min(...trades.map((t) => t.pnl)),
    avgBars: Math.round(avgBars * 10) / 10,
    streak: { type: streakType, count: streakCount },
    totalPnl,
  };
}

// ---------------------------------------------------------------------------
// Table columns — defined outside component for stable reference (Issue #6)
// ---------------------------------------------------------------------------

const columns: ColumnDef<Trade>[] = [
  {
    accessorKey: "datetime",
    header: "Fecha",
    cell: ({ getValue }) => (
      <span className="text-xs font-mono whitespace-nowrap">{formatDate(getValue() as string)}</span>
    ),
    size: 110,
  },
  {
    accessorKey: "coin",
    header: "Moneda",
    cell: ({ getValue }) => (
      <span className="text-xs font-mono font-semibold">{(getValue() as string).replace("-USDT", "")}</span>
    ),
    size: 70,
  },
  {
    accessorKey: "direction",
    header: "Dir",
    cell: ({ getValue }) => {
      const v = getValue() as string;
      return (
        <Badge variant="outline" className={`${dirBadge(v)} text-[10px] font-mono py-0 px-1.5`}>
          {v}
        </Badge>
      );
    },
    size: 60,
    filterFn: "equals",
  },
  {
    accessorKey: "strategy",
    header: "Estrategia",
    cell: ({ getValue }) => (
      <span className="text-xs font-mono text-muted-foreground">{strategyLabel(getValue() as string)}</span>
    ),
    size: 60,
    filterFn: "equals",
  },
  {
    accessorKey: "entry",
    header: "Entrada",
    cell: ({ getValue }) => (
      <span className="text-xs font-mono">{(getValue() as number).toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
    ),
    size: 85,
  },
  {
    accessorKey: "exit",
    header: "Salida",
    cell: ({ getValue }) => (
      <span className="text-xs font-mono">{(getValue() as number).toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
    ),
    size: 85,
  },
  {
    accessorKey: "result",
    header: "Resultado",
    cell: ({ getValue }) => {
      const rb = resultBadge(getValue() as string);
      return (
        <Badge variant="outline" className={`${rb.cls} text-[10px] font-mono py-0 px-1.5`}>
          {rb.label}
        </Badge>
      );
    },
    size: 80,
    filterFn: "equals",
  },
  {
    accessorKey: "pnl",
    header: "P&L",
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return <span className={`text-xs font-mono font-semibold ${pnlColor(v)}`}>{usd(v)}</span>;
    },
    size: 80,
    sortingFn: "basic",
  },
  {
    accessorKey: "risk_used",
    header: "Riesgo",
    cell: ({ getValue }) => (
      <span className="text-xs font-mono">${(getValue() as number).toFixed(0)}</span>
    ),
    size: 55,
  },
  {
    accessorKey: "bars",
    header: "Barras",
    cell: ({ getValue }) => {
      const v = getValue() as number;
      const pctVal = (v / BARS_MAX) * 100;
      return (
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono">{v}</span>
          <div className="w-8 h-1 rounded-full bg-secondary overflow-hidden">
            <div
              className={`h-full rounded-full ${pctVal >= 90 ? "bg-loss" : pctVal >= 60 ? "bg-warning" : "bg-info/60"}`}
              style={{ width: `${pctVal}%` }}
            />
          </div>
        </div>
      );
    },
    size: 70,
  },
  {
    accessorKey: "regime",
    header: "Régimen",
    cell: ({ getValue }) => {
      const r = getValue() as string;
      const cls =
        r === "TREND_UP" ? "border-profit/40 bg-profit/10 text-profit" :
        r === "TREND_DOWN" ? "border-loss/40 bg-loss/10 text-loss" :
        r === "RANGE" ? "border-warning/40 bg-warning/10 text-warning" :
        "border-muted-foreground/30 text-muted-foreground";
      return (
        <Badge variant="outline" className={`${cls} text-[10px] font-mono py-0 px-1.5`}>
          {r || "—"}
        </Badge>
      );
    },
    size: 80,
    filterFn: "equals",
  },
  {
    accessorKey: "equity",
    header: "Equity",
    cell: ({ getValue }) => (
      <span className="text-xs font-mono">${(getValue() as number).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
    ),
    size: 80,
  },
];

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

interface Filters {
  search: string;
  strategy: string;
  result: string;
  direction: string;
  regime: string;
}

const EMPTY_FILTERS: Filters = { search: "", strategy: "", result: "", direction: "", regime: "" };

// ---------------------------------------------------------------------------
// Memoized sub-components (Issue #5)
// ---------------------------------------------------------------------------

const KPICard = memo(function KPICard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="pt-4 pb-3">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className={`text-lg font-bold font-mono mt-0.5 ${color || "text-foreground"}`}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
});

const SortIcon = memo(function SortIcon({ sorted }: { sorted: false | "asc" | "desc" }) {
  if (!sorted) return <ArrowUpDown className="h-3 w-3 text-muted-foreground/40" />;
  if (sorted === "asc") return <ArrowUp className="h-3 w-3 text-foreground" />;
  return <ArrowDown className="h-3 w-3 text-foreground" />;
});

const PagBtn = memo(function PagBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-9 w-9 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function TradesPage() {
  const { data: resp, error, isLoading } = useApi<ApiResponse<Trade[]>>("/api/trades", TRADES_POLL_INTERVAL);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Restore filters and page from URL (Issue #11)
  const initialFilters: Filters = {
    search: searchParams.get("search") ?? "",
    strategy: searchParams.get("strategy") ?? "",
    result: searchParams.get("result") ?? "",
    direction: searchParams.get("direction") ?? "",
    regime: searchParams.get("regime") ?? "",
  };

  const initialPageParam = searchParams.get("page");
  const parsedPage = initialPageParam ? parseInt(initialPageParam, 10) : NaN;
  const initialPage = Number.isFinite(parsedPage) ? Math.max(0, parsedPage - 1) : 0;

  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sorting, setSorting] = useState<SortingState>([{ id: "datetime", desc: true }]);

  // Persist filters/page to URL
  const updateUrl = useCallback(
    (newFilters: Filters, pageIndex?: number) => {
      const params = new URLSearchParams();
      if (newFilters.search) params.set("search", newFilters.search);
      if (newFilters.strategy) params.set("strategy", newFilters.strategy);
      if (newFilters.result) params.set("result", newFilters.result);
      if (newFilters.direction) params.set("direction", newFilters.direction);
      if (newFilters.regime) params.set("regime", newFilters.regime);
      if (pageIndex !== undefined && pageIndex > 0) params.set("page", String(pageIndex + 1));
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname]
  );

  const handleSetFilters = useCallback(
    (updater: Filters | ((f: Filters) => Filters)) => {
      setFilters((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        updateUrl(next);
        return next;
      });
    },
    [updateUrl]
  );

  // Filtered trades
  const { trades, filterOptions, kpis } = useMemo(() => {
    const all = resp?.data ?? [];

    const strategies = [...new Set(all.map((t) => t.strategy))].sort();
    const results = [...new Set(all.map((t) => t.result))].sort();
    const regimes = [...new Set(all.map((t) => t.regime).filter(Boolean))].sort();

    const filtered = all.filter((t) => {
      if (filters.strategy && t.strategy !== filters.strategy) return false;
      if (filters.result && t.result !== filters.result) return false;
      if (filters.direction && t.direction !== filters.direction) return false;
      if (filters.regime && t.regime !== filters.regime) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const hay = [t.coin, t.strategy, t.result, t.regime, t.direction, t.datetime]
          .join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return {
      trades: filtered,
      filterOptions: { strategies, results, regimes },
      kpis: computeKPIs(filtered),
    };
  }, [resp?.data, filters]);

  const table = useReactTable({
    data: trades,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize: 25, pageIndex: initialPage },
    },
  });

  if (isLoading && !resp) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-[400px] rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] gap-4">
        <AlertTriangle className="h-8 w-8 text-loss" />
        <p className="text-sm text-muted-foreground">{String(error)}</p>
      </div>
    );
  }

  const hasActive = Object.values(filters).some((v) => v !== "");

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Historial de Trades</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {trades.length} trade{trades.length !== 1 ? "s" : ""} cerrado{trades.length !== 1 ? "s" : ""}
          {hasActive && " (filtrado)"}
          {resp?.meta?.warnings && resp.meta.warnings.length > 0 && (
            <span className="text-warning ml-2">
              {resp.meta.warnings.join(" | ")}
            </span>
          )}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-8">
        <KPICard label="Total" value={String(kpis.total)} />
        <KPICard
          label="Tasa de Acierto"
          value={kpis.winRate !== null ? `${kpis.winRate.toFixed(1)}%` : "—"}
          sub={`${kpis.wins}G / ${kpis.losses}P`}
          color={kpis.winRate !== null ? (kpis.winRate >= 50 ? "text-profit" : "text-loss") : ""}
        />
        <KPICard
          label="Factor Beneficio"
          value={kpis.profitFactor !== null ? (kpis.profitFactor === Infinity ? "∞" : kpis.profitFactor.toFixed(2)) : "—"}
          color={kpis.profitFactor !== null && kpis.profitFactor > 1 ? "text-profit" : kpis.profitFactor !== null ? "text-loss" : ""}
        />
        <KPICard
          label="P&L Total"
          value={usd(kpis.totalPnl)}
          color={pnlColor(kpis.totalPnl)}
        />
        <KPICard
          label="P&L Promedio"
          value={kpis.avgPnl !== null ? usd(kpis.avgPnl) : "—"}
          color={pnlColor(kpis.avgPnl)}
        />
        <KPICard
          label="Mejor Trade"
          value={kpis.bestTrade !== null ? usd(kpis.bestTrade) : "—"}
          color="text-profit"
        />
        <KPICard
          label="Peor Trade"
          value={kpis.worstTrade !== null ? usd(kpis.worstTrade) : "—"}
          color="text-loss"
        />
        <KPICard
          label={kpis.streak.type !== "—" ? `Racha (${kpis.streak.type === "W" ? "Gan." : "Pérd."})` : "Racha"}
          value={kpis.streak.count > 0 ? String(kpis.streak.count) : "—"}
          sub={kpis.avgBars !== null ? `Prom. ${kpis.avgBars} barras` : undefined}
          color={kpis.streak.type === "W" ? "text-profit" : kpis.streak.type === "L" ? "text-loss" : ""}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar..."
            aria-label="Buscar trades"
            value={filters.search}
            onChange={(e) => handleSetFilters((f) => ({ ...f, search: e.target.value }))}
            className="h-9 w-36 rounded-md border border-border bg-secondary pl-6 pr-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <select
          value={filters.strategy}
          aria-label="Filtrar por estrategia"
          onChange={(e) => handleSetFilters((f) => ({ ...f, strategy: e.target.value }))}
          className="h-9 rounded-md border border-border bg-secondary px-2 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Todas las estrategias</option>
          {filterOptions.strategies.map((s) => <option key={s} value={s}>{strategyLabel(s)}</option>)}
        </select>

        <select
          value={filters.result}
          aria-label="Filtrar por resultado"
          onChange={(e) => handleSetFilters((f) => ({ ...f, result: e.target.value }))}
          className="h-9 rounded-md border border-border bg-secondary px-2 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Todos los resultados</option>
          {filterOptions.results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>

        <select
          value={filters.direction}
          aria-label="Filtrar por dirección"
          onChange={(e) => handleSetFilters((f) => ({ ...f, direction: e.target.value }))}
          className="h-9 rounded-md border border-border bg-secondary px-2 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Todas las dirs</option>
          <option value="LONG">LONG</option>
          <option value="SHORT">SHORT</option>
        </select>

        <select
          value={filters.regime}
          aria-label="Filtrar por régimen"
          onChange={(e) => handleSetFilters((f) => ({ ...f, regime: e.target.value }))}
          className="h-9 rounded-md border border-border bg-secondary px-2 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Todos los regímenes</option>
          {filterOptions.regimes.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>

        {hasActive && (
          <button
            onClick={() => handleSetFilters(EMPTY_FILTERS)}
            className="h-9 px-3 text-xs text-muted-foreground hover:text-foreground font-mono underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Table */}
      <Card className="bg-card border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-border">
                  {hg.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                        className="h-9 px-3 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider font-mono cursor-pointer select-none hover:text-foreground transition-colors"
                        style={{ width: header.getSize() }}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <div className="flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <SortIcon sorted={sorted} />
                        </div>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <ScrollText className="h-8 w-8 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">No hay trades que mostrar</p>
                      {hasActive && (
                        <button
                          onClick={() => handleSetFilters(EMPTY_FILTERS)}
                          className="h-9 px-3 text-xs text-muted-foreground hover:text-foreground font-mono underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
                        >
                          Limpiar filtros
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border/30 hover:bg-secondary/40 transition-colors"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="h-10 px-3">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {table.getPageCount() > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-xs text-muted-foreground font-mono">
              Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount()}
            </span>
            <nav aria-label="Paginación de trades" className="flex items-center gap-1">
              <PagBtn
                onClick={() => { table.setPageIndex(0); updateUrl(filters, 0); }}
                disabled={!table.getCanPreviousPage()}
              >
                <ChevronsLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">Primera página</span>
              </PagBtn>
              <PagBtn
                onClick={() => { table.previousPage(); updateUrl(filters, table.getState().pagination.pageIndex - 1); }}
                disabled={!table.getCanPreviousPage()}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">Página anterior</span>
              </PagBtn>
              <PagBtn
                onClick={() => { table.nextPage(); updateUrl(filters, table.getState().pagination.pageIndex + 1); }}
                disabled={!table.getCanNextPage()}
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">Página siguiente</span>
              </PagBtn>
              <PagBtn
                onClick={() => { table.setPageIndex(table.getPageCount() - 1); updateUrl(filters, table.getPageCount() - 1); }}
                disabled={!table.getCanNextPage()}
              >
                <ChevronsRight className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">Última página</span>
              </PagBtn>
            </nav>
          </div>
        )}
      </Card>
    </div>
  );
}
