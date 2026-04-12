"use client";

import { useState, useCallback } from "react";

export interface Kline {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type KlineInterval =
  | "1m"
  | "3m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "4h"
  | "1d";

const BINANCE_API = "https://api.binance.com/api/v3/klines";

/**
 * Fetches historical klines (candlestick data) from Binance REST API.
 * Returns up to 1000 candles starting from a given date.
 */
export function useBinanceKlines() {
  const [klines, setKlines] = useState<Kline[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchKlines = useCallback(
    async (
      symbol: string,
      interval: KlineInterval,
      startDate: Date,
      limit = 1000
    ) => {
      setLoading(true);
      setError(null);

      try {
        const startTime = startDate.getTime();
        const url = `${BINANCE_API}?symbol=${symbol}&interval=${interval}&startTime=${startTime}&limit=${limit}`;
        const res = await fetch(url);

        if (!res.ok) {
          throw new Error(`Binance API error: ${res.status}`);
        }

        const data = await res.json();

        const parsed: Kline[] = data.map((k: unknown[]) => ({
          time: Math.floor((k[0] as number) / 1000), // ms to seconds
          open: parseFloat(k[1] as string),
          high: parseFloat(k[2] as string),
          low: parseFloat(k[3] as string),
          close: parseFloat(k[4] as string),
          volume: parseFloat(k[5] as string),
        }));

        setKlines(parsed);
        return parsed;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to fetch klines";
        setError(msg);
        return [];
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { klines, loading, error, fetchKlines };
}
