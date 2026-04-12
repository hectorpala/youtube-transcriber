"use client";

import { useState } from "react";
import type { Coin } from "@/lib/coins";
import type { TickerData } from "@/hooks/use-binance-prices";
import { addAlert } from "@/lib/alerts";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrendingUp, TrendingDown } from "lucide-react";

interface AlertDialogProps {
  coin: Coin | null;
  ticker: TickerData | undefined;
  open: boolean;
  onClose: () => void;
}

export function AlertDialog({ coin, ticker, open, onClose }: AlertDialogProps) {
  const [targetPrice, setTargetPrice] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");

  if (!coin) return null;

  const handleSubmit = () => {
    const price = parseFloat(targetPrice);
    if (isNaN(price) || price <= 0) return;
    addAlert(coin.symbol, price, direction);
    setTargetPrice("");
    onClose();
  };

  const handleOpen = (o: boolean) => {
    if (!o) onClose();
    else if (ticker) {
      setTargetPrice(ticker.price.toFixed(2));
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpen}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>
            Alerta para {coin.base}/USDT
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4">
          {ticker && (
            <div className="text-sm text-muted-foreground">
              Precio actual: <span className="text-foreground font-mono">${ticker.price.toFixed(2)}</span>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Dirección
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setDirection("above")}
                className={`flex-1 flex items-center justify-center gap-1.5 h-9 rounded-md border text-sm font-medium transition-colors ${
                  direction === "above"
                    ? "border-profit bg-profit/10 text-profit"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <TrendingUp className="h-3.5 w-3.5" />
                Sube a
              </button>
              <button
                onClick={() => setDirection("below")}
                className={`flex-1 flex items-center justify-center gap-1.5 h-9 rounded-md border text-sm font-medium transition-colors ${
                  direction === "below"
                    ? "border-loss bg-loss/10 text-loss"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <TrendingDown className="h-3.5 w-3.5" />
                Baja a
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Precio objetivo (USD)
            </label>
            <Input
              type="number"
              step="any"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              placeholder="0.00"
              className="font-mono"
            />
          </div>
        </div>

        <SheetFooter>
          <Button onClick={handleSubmit} className="w-full">
            Crear alerta
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
