"use client";

import { useEffect, useRef, memo } from "react";

interface TradingViewChartProps {
  symbol?: string;
  height?: number | string;
  interval?: string;
}

const TradingViewChart = memo(function TradingViewChart({
  symbol = "BINANCE:ETHUSDT",
  height = 240,
  interval = "60",
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Exact structure TradingView expects
    container.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "tradingview-widget-container";
    wrapper.style.height = "100%";
    wrapper.style.width = "100%";

    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    widgetDiv.style.height = "100%";
    widgetDiv.style.width = "100%";
    wrapper.appendChild(widgetDiv);

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.textContent = JSON.stringify({
      symbol: symbol,
      width: "100%",
      height: "100%",
      autosize: true,
      interval: interval,
      timezone: "America/Mexico_City",
      theme: "dark",
      style: "1",
      locale: "es",
      backgroundColor: "rgba(0, 0, 0, 0)",
      allow_symbol_change: true,
      calendar: false,
      hide_volume: false,
      support_host: "https://www.tradingview.com",
    });
    wrapper.appendChild(script);

    container.appendChild(wrapper);

    return () => {
      if (container) container.innerHTML = "";
    };
  }, [symbol, interval]);

  return <div ref={containerRef} style={{ height, width: "100%" }} />;
});

export default TradingViewChart;
