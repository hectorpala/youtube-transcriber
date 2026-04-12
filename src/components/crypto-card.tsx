"use client";

import { memo } from "react";
import type { Coin } from "@/lib/coins";
import type { TickerData } from "@/hooks/use-binance-prices";
import { TrendingUp, TrendingDown, Minus, Star } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface CryptoCardProps {
  coin: Coin;
  ticker: TickerData | undefined;
  isFavorite?: boolean;
  onToggleFavorite?: (symbol: string) => void;
  onSelect?: (coin: Coin) => void;
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return price.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(1)}B`;
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return vol.toFixed(0);
}

export const CryptoCard = memo(function CryptoCard({ coin, ticker, isFavorite, onToggleFavorite, onSelect }: CryptoCardProps) {
  const handleFavorite = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleFavorite?.(coin.symbol);
  };

  const handleClick = () => {
    onSelect?.(coin);
  };

  if (!ticker) {
    return (
      <div onClick={handleClick} className="cursor-pointer">
        <div className="group relative rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-foreground">{coin.base}</span>
              <span className="text-xs text-muted-foreground">/USDT</span>
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="mb-1">
            <Skeleton className="h-7 w-28" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">{coin.name}</span>
            <Skeleton className="h-3 w-14" />
          </div>
          <div className="mt-2">
            <Skeleton className="h-1 w-full rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  const isUp = ticker.changePercent24h > 0;
  const isDown = ticker.changePercent24h < 0;
  const changeColor = isUp ? "text-profit" : isDown ? "text-loss" : "text-muted-foreground";
  const bgGlow = isUp ? "hover:border-profit/30" : isDown ? "hover:border-loss/30" : "hover:border-border";

  return (
    <div onClick={handleClick} className="cursor-pointer">
      <div
        className={`group relative rounded-lg border border-border bg-card p-4 transition-all hover:bg-card/80 ${bgGlow}`}
      >
        {/* Header: symbol + name */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button onClick={handleFavorite} className="text-muted-foreground hover:text-warning transition-colors">
              <Star className={`h-3.5 w-3.5 ${isFavorite ? "fill-warning text-warning" : ""}`} />
            </button>
            <span className="text-sm font-bold text-foreground">{coin.base}</span>
            <span className="text-xs text-muted-foreground">/USDT</span>
          </div>
          <div
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              isUp
                ? "bg-profit/10 text-profit"
                : isDown
                ? "bg-loss/10 text-loss"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {isUp ? (
              <TrendingUp className="h-3 w-3" />
            ) : isDown ? (
              <TrendingDown className="h-3 w-3" />
            ) : (
              <Minus className="h-3 w-3" />
            )}
            {`${ticker.changePercent24h >= 0 ? "+" : ""}${ticker.changePercent24h.toFixed(2)}%`}
          </div>
        </div>

        {/* Price */}
        <div className="mb-1">
          <span className={`text-lg font-mono font-semibold ${changeColor}`}>
            ${formatPrice(ticker.price)}
          </span>
        </div>

        {/* 24h details */}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{coin.name}</span>
          <span>Vol {formatVolume(ticker.volume24h)}</span>
        </div>

        {/* 24h range bar */}
        {ticker.high24h > ticker.low24h && (
          <div className="mt-2">
            <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
              <span>${formatPrice(ticker.low24h)}</span>
              <span>${formatPrice(ticker.high24h)}</span>
            </div>
            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full ${isUp ? "bg-profit/60" : isDown ? "bg-loss/60" : "bg-muted-foreground/40"}`}
                style={{
                  width: `${((ticker.price - ticker.low24h) / (ticker.high24h - ticker.low24h)) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
