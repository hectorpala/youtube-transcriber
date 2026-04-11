"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useSummary } from "@/contexts/summary-context";
import { regimeColor } from "@/lib/format";

function statusDot(freshness: string): string {
  switch (freshness) {
    case "live": return "bg-profit animate-pulse";
    case "stale": return "bg-warning";
    case "offline": return "bg-loss";
    default: return "bg-muted-foreground";
  }
}

export function Topbar() {
  const { data: resp } = useSummary();
  const d = resp?.data;

  return (
    <header className="flex h-12 items-center gap-4 border-b border-border bg-card/80 backdrop-blur-sm px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="h-5" />

      {/* Regime badge */}
      {d ? (
        <>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-mono hidden sm:inline">REGIME</span>
            <span className="sr-only">Régimen de mercado: {d.regime}</span>
            <Badge
              variant="outline"
              className={`${regimeColor(d.regime)} font-mono text-xs`}
            >
              {d.regime}
            </Badge>
            <span className="text-[10px] text-muted-foreground font-mono">
              {d.regimeConfidence}
            </span>
          </div>

          <Separator orientation="vertical" className="h-5" />

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-mono hidden sm:inline">EQUITY</span>
            <span className="text-sm font-mono font-semibold text-foreground">
              ${d.equity.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
          </div>

          <Separator orientation="vertical" className="h-5 hidden sm:block" />

          <div className="hidden sm:flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-mono">DD</span>
            <span className={`text-xs font-mono font-semibold ${d.drawdownPct < 0 ? "text-loss" : "text-foreground"}`}>
              {d.drawdownPct.toFixed(2)}%
            </span>
          </div>
        </>
      ) : (
        <span className="text-xs text-muted-foreground font-mono">Cargando...</span>
      )}

      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className={`h-2 w-2 rounded-full ${d ? statusDot(d.botStatus) : "bg-muted-foreground"}`} />
          <span className="sr-only">Estado: {d?.botStatus ?? "desconocido"}</span>
          <span className="text-[10px] text-muted-foreground font-mono">
            DIRECTOR
          </span>
        </div>
        {d?.mode && (
          <Badge variant="outline" className="font-mono text-[10px] uppercase py-0 h-5">
            {d.mode}
          </Badge>
        )}
      </div>
    </header>
  );
}
