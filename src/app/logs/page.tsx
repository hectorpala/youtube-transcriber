import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollText } from "lucide-react";

export default function LogsPage() {
  return (
    <>
      <PageHeader
        title="Logs"
        description="Visor de logs en tiempo real estilo terminal"
      />

      <div className="mb-4">
        <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning font-mono text-xs">
          Próximamente
        </Badge>
      </div>

      {/* Tab-like header */}
      <div className="flex gap-2 mb-4">
        {[
          { label: "Director", active: true },
          { label: "TOV", active: false },
          { label: "Errors", active: false },
        ].map((tab) => (
          <button
            key={tab.label}
            aria-pressed={tab.active}
            className={`inline-flex items-center justify-center h-9 min-w-[36px] px-3 rounded-md font-mono text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              tab.active
                ? "bg-primary text-primary-foreground"
                : "border border-border hover:bg-secondary text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">
              director_log.csv
            </CardTitle>
            <span className="text-[10px] text-muted-foreground font-mono">
              AUTO-SCROLL ACTIVO
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[500px] rounded-md bg-background border border-border p-4 font-mono text-xs overflow-auto flex flex-col">
            {/* Sample log lines */}
            <p className="text-profit">[2026-03-11 20:48:39] Cycle #1847 | RANGE (LOW) | 3 pos | eq=$4,913.30 | dd=-1.99%</p>
            <p className="text-muted-foreground">[2026-03-11 20:48:40] Scanning 25 coins...</p>
            <p className="text-warning">[2026-03-11 20:48:41] SOL-USDT LONG scored 3 &rarr; rejected (drift 0.34%)</p>
            <p className="text-loss">[2026-03-11 20:48:42] SOL-USDT LONG SL hit @ 84.664 &rarr; P&L -$100.00</p>
            <p className="text-muted-foreground">[2026-03-11 20:48:43] State saved.</p>
            {/* Skeleton placeholders */}
            <div className="flex-1 flex flex-col items-center justify-center gap-4 mt-8">
              <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center">
                <ScrollText className="h-6 w-6 text-muted-foreground/40" />
              </div>
              <p className="text-muted-foreground/50 text-center">
                Logs en vivo desde filesystem — próxima fase
              </p>
              <div className="w-full max-w-lg space-y-1.5">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full rounded-sm" />
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
