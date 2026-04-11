"use client";

import { COINS } from "@/lib/coins";
import { useBinancePrices } from "@/hooks/use-binance-prices";
import { CryptoCard } from "@/components/crypto-card";
import { Wifi, WifiOff, AlertTriangle } from "lucide-react";

const statusConfig = {
  connected: { icon: Wifi, label: "Live", className: "text-profit" },
  stale: { icon: AlertTriangle, label: "Stale", className: "text-warning" },
  disconnected: { icon: WifiOff, label: "Connecting...", className: "text-loss" },
} as const;

export default function DashboardPage() {
  const { prices, status } = useBinancePrices();
  const { icon: Icon, label, className } = statusConfig[status];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Markets</h1>
        <div className={`flex items-center gap-1.5 text-xs ${className}`}>
          <Icon className="h-3.5 w-3.5" />
          <span>{label}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {COINS.map((coin) => (
          <CryptoCard
            key={coin.symbol}
            coin={coin}
            ticker={prices[coin.symbol]}
          />
        ))}
      </div>
    </div>
  );
}
