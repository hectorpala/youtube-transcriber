"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type IPriceLine,
  type Time,
  ColorType,
  LineStyle,
  CandlestickSeries,
  HistogramSeries,
} from "lightweight-charts";
import type { Kline } from "@/hooks/use-binance-klines";

interface TradeMarker {
  type: "entry" | "sl" | "tp";
  price: number;
}

interface ReplayChartProps {
  visibleKlines: Kline[];
  tradeMarkers: TradeMarker[];
  onCrosshairPrice?: (price: number | null) => void;
}

const COLORS = {
  background: "#0a0a0a",
  text: "#d1d5db",
  grid: "#1f1f1f",
  upColor: "#22c55e",
  downColor: "#ef4444",
  upWick: "#22c55e",
  downWick: "#ef4444",
  entry: "#3b82f6",
  sl: "#ef4444",
  tp: "#22c55e",
};

export default function ReplayChart({
  visibleKlines,
  tradeMarkers,
  onCrosshairPrice,
}: ReplayChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const onCrosshairPriceRef = useRef(onCrosshairPrice);
  useEffect(() => {
    onCrosshairPriceRef.current = onCrosshairPrice;
  }, [onCrosshairPrice]);

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: COLORS.background },
        textColor: COLORS.text,
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      crosshair: {
        mode: 0, // Normal
      },
      rightPriceScale: {
        borderColor: COLORS.grid,
      },
      timeScale: {
        borderColor: COLORS.grid,
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.upColor,
      downColor: COLORS.downColor,
      wickUpColor: COLORS.upWick,
      wickDownColor: COLORS.downWick,
      borderVisible: false,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // Crosshair tracking
    chart.subscribeCrosshairMove((param) => {
      const cb = onCrosshairPriceRef.current;
      if (!cb) return;
      if (!param.point || !param.time) {
        cb(null);
        return;
      }
      const data = param.seriesData.get(candleSeries) as CandlestickData | undefined;
      if (data) {
        cb(data.close as number);
      }
    });

    // Resize observer
    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  // Update candle data when visibleKlines changes
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;

    const candleData: CandlestickData[] = visibleKlines.map((k) => ({
      time: k.time as Time,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    }));

    const volumeData = visibleKlines.map((k) => ({
      time: k.time as Time,
      value: k.volume,
      color: k.close >= k.open ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);

    // Scroll to show latest candle
    if (visibleKlines.length > 0) {
      chartRef.current?.timeScale().scrollToRealTime();
    }
  }, [visibleKlines]);

  // Update trade marker price lines
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    // Remove old lines
    priceLinesRef.current.forEach((line) => series.removePriceLine(line));
    priceLinesRef.current = [];

    // Add new lines
    tradeMarkers.forEach((marker) => {
      const colorMap = {
        entry: COLORS.entry,
        sl: COLORS.sl,
        tp: COLORS.tp,
      };
      const labelMap = {
        entry: "ENTRADA",
        sl: "STOP LOSS",
        tp: "TAKE PROFIT",
      };

      const line = series.createPriceLine({
        price: marker.price,
        color: colorMap[marker.type],
        lineWidth: 2,
        lineStyle: marker.type === "entry" ? LineStyle.Solid : LineStyle.Dashed,
        axisLabelVisible: true,
        title: labelMap[marker.type],
      });
      priceLinesRef.current.push(line);
    });
  }, [tradeMarkers]);

  return (
    <div ref={containerRef} className="w-full h-full" />
  );
}
