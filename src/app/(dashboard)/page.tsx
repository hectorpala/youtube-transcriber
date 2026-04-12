"use client";

import { useMemo, useState, useCallback } from "react";
import { COINS, type Coin } from "@/lib/coins";
import { useBinancePrices } from "@/hooks/use-binance-prices";
import { usePreferences } from "@/hooks/use-preferences";
import { useAlerts } from "@/hooks/use-alerts";
import { useAlertMonitor } from "@/hooks/use-alert-monitor";
import { CryptoCard } from "@/components/crypto-card";
import { CoinDetailSheet } from "@/components/coin-detail-sheet";
import { AlertDialog } from "@/components/alert-dialog";
import { AlertsList } from "@/components/alerts-list";
import { GridToolbar, type SortKey } from "@/components/grid-toolbar";
import { Wifi, WifiOff, AlertTriangle, Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const statusConfig = {
  connected: { icon: Wifi, label: "Live", className: "text-profit" },
  stale: { icon: AlertTriangle, label: "Stale", className: "text-warning" },
  disconnected: { icon: WifiOff, label: "Connecting...", className: "text-loss" },
} as const;

export default function DashboardPage() {
  const { prices, status } = useBinancePrices();
  const { favorites, toggleFavorite } = usePreferences();
  const { alerts } = useAlerts();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [alertCoin, setAlertCoin] = useState<Coin | null>(null);
  const [showAlerts, setShowAlerts] = useState(false);
  const { icon: Icon, label, className } = statusConfig[status];

  useAlertMonitor(prices, alerts);
  const activeAlertCount = useMemo(() => alerts.filter((a) => a.active).length, [alerts]);

  const favSet = useMemo(() => new Set(favorites), [favorites]);

  const filteredAndSorted = useMemo(() => {
    const q = search.toLowerCase().trim();
    const coins = q
      ? COINS.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.base.toLowerCase().includes(q) ||
            c.symbol.toLowerCase().includes(q)
        )
      : [...COINS];

    coins.sort((a, b) => {
      // Favorites first
      const aFav = favSet.has(a.symbol) ? 0 : 1;
      const bFav = favSet.has(b.symbol) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;

      if (sortKey === "default") return 0;

      const ta = prices[a.symbol];
      const tb = prices[b.symbol];
      if (!ta && !tb) return 0;
      if (!ta) return 1;
      if (!tb) return -1;

      switch (sortKey) {
        case "price":
          return tb.price - ta.price;
        case "change":
          return tb.changePercent24h - ta.changePercent24h;
        case "volume":
          return tb.volume24h - ta.volume24h;
        default:
          return 0;
      }
    });

    return coins;
  }, [search, sortKey, favSet, prices]);

  const [selectedCoin, setSelectedCoin] = useState<Coin | null>(null);

  const handleSelect = useCallback((coin: Coin) => {
    setSelectedCoin(coin);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Markets</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAlerts(true)}
            className="relative flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Alertas"
          >
            <Bell className="h-4 w-4" />
            {activeAlertCount > 0 && (
              <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] flex items-center justify-center">
                {activeAlertCount}
              </Badge>
            )}
          </button>
          <div className={`flex items-center gap-1.5 text-xs ${className}`}>
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </div>
        </div>
      </div>
      <GridToolbar
        search={search}
        onSearchChange={setSearch}
        sortKey={sortKey}
        onSortChange={setSortKey}
      />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {filteredAndSorted.map((coin) => (
          <CryptoCard
            key={coin.symbol}
            coin={coin}
            ticker={prices[coin.symbol]}
            isFavorite={favSet.has(coin.symbol)}
            onToggleFavorite={toggleFavorite}
            onSelect={handleSelect}
          />
        ))}
      </div>
      <CoinDetailSheet
        coin={selectedCoin}
        ticker={selectedCoin ? prices[selectedCoin.symbol] : undefined}
        open={!!selectedCoin}
        onClose={() => setSelectedCoin(null)}
        onSetAlert={(coin) => {
          setSelectedCoin(null);
          setAlertCoin(coin);
        }}
      />
      <AlertDialog
        coin={alertCoin}
        ticker={alertCoin ? prices[alertCoin.symbol] : undefined}
        open={!!alertCoin}
        onClose={() => setAlertCoin(null)}
      />
      <AlertsList
        alerts={alerts}
        open={showAlerts}
        onClose={() => setShowAlerts(false)}
      />
    </div>
  );
}
