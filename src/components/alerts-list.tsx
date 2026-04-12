"use client";

import type { Alert } from "@/lib/alerts";
import { removeAlert } from "@/lib/alerts";
import { COINS } from "@/lib/coins";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TrendingUp, TrendingDown, Trash2 } from "lucide-react";

const coinBases = Object.fromEntries(COINS.map((c) => [c.symbol, c.base]));

interface AlertsListProps {
  alerts: Alert[];
  open: boolean;
  onClose: () => void;
}

export function AlertsList({ alerts, open, onClose }: AlertsListProps) {
  const activeAlerts = alerts.filter((a) => a.active);
  const firedAlerts = alerts.filter((a) => !a.active);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Alertas de precio</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 space-y-4">
          {activeAlerts.length === 0 && firedAlerts.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No hay alertas configuradas.
            </p>
          )}

          {activeAlerts.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground mb-2">Activas</h3>
              <div className="space-y-1">
                {activeAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="flex items-center justify-between rounded-md border border-border p-2.5"
                  >
                    <div className="flex items-center gap-2">
                      {alert.direction === "above" ? (
                        <TrendingUp className="h-3.5 w-3.5 text-profit" />
                      ) : (
                        <TrendingDown className="h-3.5 w-3.5 text-loss" />
                      )}
                      <span className="text-sm font-medium">
                        {coinBases[alert.symbol] || alert.symbol}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {alert.direction === "above" ? "≥" : "≤"}
                      </span>
                      <span className="text-sm font-mono">
                        ${alert.targetPrice.toFixed(2)}
                      </span>
                    </div>
                    <button
                      onClick={() => removeAlert(alert.id)}
                      className="text-muted-foreground hover:text-loss transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {firedAlerts.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground mb-2">Disparadas</h3>
              <div className="space-y-1">
                {firedAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="flex items-center justify-between rounded-md border border-border/50 p-2.5 opacity-50"
                  >
                    <div className="flex items-center gap-2">
                      {alert.direction === "above" ? (
                        <TrendingUp className="h-3.5 w-3.5" />
                      ) : (
                        <TrendingDown className="h-3.5 w-3.5" />
                      )}
                      <span className="text-sm">
                        {coinBases[alert.symbol] || alert.symbol}
                      </span>
                      <span className="text-sm font-mono">
                        ${alert.targetPrice.toFixed(2)}
                      </span>
                    </div>
                    <button
                      onClick={() => removeAlert(alert.id)}
                      className="text-muted-foreground hover:text-loss transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
