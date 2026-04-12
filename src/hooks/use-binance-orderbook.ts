"use client";

import useSWR from "swr";

export interface OrderbookData {
  bids: [string, string][]; // [price, qty]
  asks: [string, string][];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useBinanceOrderbook(symbol: string | null) {
  const { data, error, isLoading } = useSWR<OrderbookData>(
    symbol ? `https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=10` : null,
    fetcher,
    { refreshInterval: 5000 }
  );

  return { orderbook: data ?? null, error, isLoading };
}
