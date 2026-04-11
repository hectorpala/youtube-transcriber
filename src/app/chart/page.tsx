"use client";

import dynamic from "next/dynamic";

const TradingViewChart = dynamic(() => import("@/components/tradingview-chart"), {
  ssr: false,
});

export default function ChartPage() {
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
      <div className="fixed inset-0 bg-black">
        <TradingViewChart symbol="BINANCE:ETHUSDT" height="100vh" />
      </div>
    </>
  );
}
