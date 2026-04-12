"use client";

import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useMemo } from "react";
import { COINS } from "@/lib/coins";
import { ArrowLeft } from "lucide-react";

const TradingViewChart = dynamic(() => import("@/components/tradingview-chart"), {
  ssr: false,
});

const VALID_SYMBOLS = new Set(COINS.map((c) => c.tradingViewSymbol));
const DEFAULT_SYMBOL = "BINANCE:ETHUSDT";

function ChartContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawSymbol = searchParams.get("symbol") || DEFAULT_SYMBOL;
  const interval = searchParams.get("interval") || "60";
  const symbol = useMemo(
    () => (VALID_SYMBOLS.has(rawSymbol) ? rawSymbol : DEFAULT_SYMBOL),
    [rawSymbol]
  );

  return (
    <div className="h-dvh flex flex-col bg-black">
      <div className="flex-none flex items-center h-12 px-4 bg-zinc-900 border-b border-zinc-700">
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-2 rounded-md bg-zinc-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-600"
        >
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <TradingViewChart key={`${symbol}-${interval}`} symbol={symbol} interval={interval} height="100%" />
      </div>
    </div>
  );
}

export default function ChartPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-black" />}>
      <ChartContent />
    </Suspense>
  );
}
