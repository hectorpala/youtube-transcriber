"use client";

import { useEffect, useRef, useState } from "react";
import { COINS } from "@/lib/coins";

export interface TickerData {
  price: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}

export type PriceMap = Record<string, TickerData>;

/**
 * Connects to Binance's combined WebSocket stream for all coins.
 * Uses the !miniTicker@arr stream which sends updates for all symbols every ~1s.
 */
const STALE_THRESHOLD_MS = 5000;

export type ConnectionStatus = "connected" | "stale" | "disconnected";

export function useBinancePrices(): { prices: PriceMap; status: ConnectionStatus } {
  const [prices, setPrices] = useState<PriceMap>({});
  const [socketOpen, setSocketOpen] = useState(false);
  const [lastTickAt, setLastTickAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Tick a clock every 2s so the status can transition to "stale"
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(id);
  }, []);

  const status: ConnectionStatus = !socketOpen
    ? "disconnected"
    : lastTickAt > 0 && now - lastTickAt < STALE_THRESHOLD_MS
      ? "connected"
      : "stale";

  useEffect(() => {
    let disposed = false;
    const symbolSet = new Set(COINS.map((c) => c.symbol.toLowerCase()));
    const batch: Record<string, TickerData> = {};
    let batchTimer: ReturnType<typeof setTimeout> | null = null;

    // Use individual miniTicker streams combined
    const streams = COINS.map(
      (c) => `${c.symbol.toLowerCase()}@miniTicker`
    ).join("/");
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    function connect() {
      if (disposed) return;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!disposed) setSocketOpen(true);
      };

      ws.onmessage = (event) => {
        if (disposed) return;

        const msg = JSON.parse(event.data);
        const d = msg.data;
        if (!d || !d.s) return;

        const symbol = d.s as string;
        if (!symbolSet.has(symbol.toLowerCase())) return;

        const price = parseFloat(d.c);
        const open = parseFloat(d.o);

        batch[symbol] = {
          price,
          change24h: price - open,
          changePercent24h: ((price - open) / open) * 100,
          high24h: parseFloat(d.h),
          low24h: parseFloat(d.l),
          volume24h: parseFloat(d.q),
        };

        if (!batchTimer) {
          batchTimer = setTimeout(() => {
            batchTimer = null;
            const updates = { ...batch };
            for (const key in batch) delete batch[key];
            setLastTickAt(Date.now());
            setPrices((prev) => ({ ...prev, ...updates }));
          }, 200);
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setSocketOpen(false);
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      disposed = true;
      if (batchTimer) clearTimeout(batchTimer);
      clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { prices, status };
}
