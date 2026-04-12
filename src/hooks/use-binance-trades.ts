"use client";

import useSWR from "swr";

export interface TradeData {
  id: number;
  price: string;
  qty: string;
  time: number;
  isBuyerMaker: boolean;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useBinanceTrades(symbol: string | null) {
  const { data, error, isLoading } = useSWR<TradeData[]>(
    symbol ? `https://api.binance.com/api/v3/trades?symbol=${symbol}&limit=20` : null,
    fetcher,
    { refreshInterval: 5000 }
  );

  return { trades: data ?? null, error, isLoading };
}
