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
  const symbol = useMemo(
    () => (VALID_SYMBOLS.has(rawSymbol) ? rawSymbol : DEFAULT_SYMBOL),
    [rawSymbol]
  );

  return (
    <>
      <style>{`
        [data-slot="sidebar"], nav, header, [class*="topbar"], [class*="Topbar"] {
          display: none !important;
        }
        main {
          padding: 0 !important;
          margin: 0 !important;
        }
        body {
          background: #000 !important;
        }
        nextjs-portal, [data-nextjs-toast], [data-nextjs-dialog-overlay] {
          display: none !important;
        }
      `}</style>
      <div className="fixed inset-0 flex flex-col bg-black">
        <div className="flex-none flex items-center h-10 px-3">
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs text-white transition-colors hover:bg-white/20"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Dashboard
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <TradingViewChart symbol={symbol} height="100%" />
        </div>
      </div>
    </>
  );
}

export default function ChartPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-black" />}>
      <ChartContent />
    </Suspense>
  );
}
