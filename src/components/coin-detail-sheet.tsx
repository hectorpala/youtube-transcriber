"use client";

import { useRouter } from "next/navigation";
import type { Coin } from "@/lib/coins";
import type { TickerData } from "@/hooks/use-binance-prices";
import { useBinanceOrderbook } from "@/hooks/use-binance-orderbook";
import { useBinanceTrades } from "@/hooks/use-binance-trades";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, Bell } from "lucide-react";

const INTERVALS = [
  { label: "1m", value: "1" },
  { label: "5m", value: "5" },
  { label: "15m", value: "15" },
  { label: "1h", value: "60" },
  { label: "4h", value: "240" },
  { label: "1D", value: "D" },
];

interface CoinDetailSheetProps {
  coin: Coin | null;
  ticker: TickerData | undefined;
  open: boolean;
  onClose: () => void;
  onSetAlert?: (coin: Coin) => void;
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return price.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function CoinDetailSheet({ coin, ticker, open, onClose, onSetAlert }: CoinDetailSheetProps) {
  const router = useRouter();
  const { orderbook, isLoading: obLoading } = useBinanceOrderbook(open && coin ? coin.symbol : null);
  const { trades, isLoading: trLoading } = useBinanceTrades(open && coin ? coin.symbol : null);

  if (!coin) return null;

  const isUp = ticker ? ticker.changePercent24h > 0 : false;
  const isDown = ticker ? ticker.changePercent24h < 0 : false;

  const navigateChart = (interval: string) => {
    router.push(`/chart?symbol=${coin.tradingViewSymbol}&interval=${interval}`);
    onClose();
  };

  // Find max qty for depth bar scaling
  const maxBidQty = orderbook?.bids.reduce((m, [, q]) => Math.max(m, parseFloat(q)), 0) ?? 1;
  const maxAskQty = orderbook?.asks.reduce((m, [, q]) => Math.max(m, parseFloat(q)), 0) ?? 1;
  const maxQty = Math.max(maxBidQty, maxAskQty);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="text-lg font-bold">{coin.base}</span>
            <span className="text-sm text-muted-foreground">/USDT</span>
            <span className="text-xs text-muted-foreground ml-auto">{coin.name}</span>
          </SheetTitle>

          {/* Price + change */}
          {ticker && (
            <div className="flex items-baseline gap-3 mt-1">
              <span className={`text-2xl font-mono font-bold ${isUp ? "text-profit" : isDown ? "text-loss" : "text-foreground"}`}>
                ${formatPrice(ticker.price)}
              </span>
              <span className={`text-sm font-medium ${isUp ? "text-profit" : isDown ? "text-loss" : "text-muted-foreground"}`}>
                {isUp && "+"}{ticker.changePercent24h.toFixed(2)}%
              </span>
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 space-y-4 px-4">
          {/* Timeframe buttons */}
          <div>
            <h3 className="text-xs font-medium text-muted-foreground mb-2">Timeframe</h3>
            <div className="flex gap-1.5">
              {INTERVALS.map((i) => (
                <button
                  key={i.value}
                  onClick={() => navigateChart(i.value)}
                  className="flex-1 h-8 rounded-md border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors"
                >
                  {i.label}
                </button>
              ))}
            </div>
          </div>

          {/* Orderbook */}
          <div>
            <h3 className="text-xs font-medium text-muted-foreground mb-2">Orderbook</h3>
            {obLoading ? (
              <div className="space-y-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-5 w-full" />
                ))}
              </div>
            ) : orderbook ? (
              <div className="space-y-0.5 font-mono text-[11px]">
                {/* Asks (reversed so best ask is at bottom) */}
                {[...orderbook.asks].reverse().map(([price, qty], i) => (
                  <div key={`a-${i}`} className="relative flex justify-between py-0.5 px-1">
                    <div
                      className="absolute inset-y-0 right-0 bg-loss/10"
                      style={{ width: `${(parseFloat(qty) / maxQty) * 100}%` }}
                    />
                    <span className="relative text-loss">{parseFloat(price).toFixed(price.includes(".") ? price.split(".")[1].length : 2)}</span>
                    <span className="relative text-muted-foreground">{parseFloat(qty).toFixed(4)}</span>
                  </div>
                ))}
                {/* Spread */}
                {ticker && (
                  <div className="flex justify-center py-1 text-xs text-foreground font-medium">
                    ${formatPrice(ticker.price)}
                  </div>
                )}
                {/* Bids */}
                {orderbook.bids.map(([price, qty], i) => (
                  <div key={`b-${i}`} className="relative flex justify-between py-0.5 px-1">
                    <div
                      className="absolute inset-y-0 right-0 bg-profit/10"
                      style={{ width: `${(parseFloat(qty) / maxQty) * 100}%` }}
                    />
                    <span className="relative text-profit">{parseFloat(price).toFixed(price.includes(".") ? price.split(".")[1].length : 2)}</span>
                    <span className="relative text-muted-foreground">{parseFloat(qty).toFixed(4)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Recent trades */}
          <div>
            <h3 className="text-xs font-medium text-muted-foreground mb-2">Trades recientes</h3>
            {trLoading ? (
              <div className="space-y-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-5 w-full" />
                ))}
              </div>
            ) : trades ? (
              <div className="space-y-0.5 font-mono text-[11px] max-h-48 overflow-y-auto">
                <div className="flex justify-between text-muted-foreground px-1 pb-1 sticky top-0 bg-background">
                  <span>Precio</span>
                  <span>Cantidad</span>
                  <span>Hora</span>
                </div>
                {[...trades].reverse().map((t) => (
                  <div key={t.id} className="flex justify-between py-0.5 px-1">
                    <span className={t.isBuyerMaker ? "text-loss" : "text-profit"}>
                      {parseFloat(t.price).toFixed(2)}
                    </span>
                    <span className="text-muted-foreground">{parseFloat(t.qty).toFixed(4)}</span>
                    <span className="text-muted-foreground">{formatTime(t.time)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <SheetFooter>
          {onSetAlert && (
            <Button
              variant="outline"
              onClick={() => onSetAlert(coin)}
              className="w-full gap-2"
            >
              <Bell className="h-4 w-4" />
              Crear Alerta
            </Button>
          )}
          <Button onClick={() => navigateChart("60")} className="w-full gap-2">
            <ExternalLink className="h-4 w-4" />
            Abrir Chart
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
