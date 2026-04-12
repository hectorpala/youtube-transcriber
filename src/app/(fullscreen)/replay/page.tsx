"use client";

import dynamic from "next/dynamic";
import { Suspense, useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { COINS } from "@/lib/coins";
import { useBinanceKlines, type KlineInterval } from "@/hooks/use-binance-klines";
import {
  ArrowLeft,
  Play,
  Pause,
  SkipForward,
  ChevronsRight,
  RotateCcw,
  Crosshair,
  Target,
  ShieldAlert,
} from "lucide-react";

const ReplayChart = dynamic(() => import("@/components/replay-chart"), {
  ssr: false,
});

interface TradeMarker {
  type: "entry" | "sl" | "tp";
  price: number;
}

interface TradeResult {
  outcome: "win" | "loss";
  pnlPercent: number;
  rr: number;
}

function computeTradeResult(
  candles: { high: number; low: number }[],
  markers: TradeMarker[]
): TradeResult | null {
  const entry = markers.find((m) => m.type === "entry");
  const sl = markers.find((m) => m.type === "sl");
  const tp = markers.find((m) => m.type === "tp");
  if (!entry || !sl || !tp) return null;

  const isLong = tp.price > entry.price;

  for (const candle of candles) {
    if (isLong) {
      if (candle.low <= sl.price) {
        const loss = (Math.abs(entry.price - sl.price) / entry.price) * 100;
        return { outcome: "loss", pnlPercent: -loss, rr: -1 };
      }
      if (candle.high >= tp.price) {
        const gain = (Math.abs(tp.price - entry.price) / entry.price) * 100;
        const risk = Math.abs(entry.price - sl.price);
        const reward = Math.abs(tp.price - entry.price);
        return { outcome: "win", pnlPercent: gain, rr: reward / risk };
      }
    } else {
      if (candle.high >= sl.price) {
        const loss = (Math.abs(sl.price - entry.price) / entry.price) * 100;
        return { outcome: "loss", pnlPercent: -loss, rr: -1 };
      }
      if (candle.low <= tp.price) {
        const gain = (Math.abs(entry.price - tp.price) / entry.price) * 100;
        const risk = Math.abs(sl.price - entry.price);
        const reward = Math.abs(entry.price - tp.price);
        return { outcome: "win", pnlPercent: gain, rr: reward / risk };
      }
    }
  }
  return null;
}

const INTERVALS: { value: KlineInterval; label: string }[] = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
];

const SPEED_OPTIONS = [
  { value: 500, label: "Rapido" },
  { value: 1000, label: "Normal" },
  { value: 2000, label: "Lento" },
];

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function ReplayContent() {
  const router = useRouter();
  const { klines, loading, error, fetchKlines } = useBinanceKlines();

  // Setup state
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState<KlineInterval>("15m");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 16);
  });
  const [started, setStarted] = useState(false);

  // Replay state
  const [currentIndex, setCurrentIndex] = useState(20); // Start showing 20 candles
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1000);


  // Trade state
  const [tradeMarkers, setTradeMarkers] = useState<TradeMarker[]>([]);
  const [markingMode, setMarkingMode] = useState<"entry" | "sl" | "tp" | null>(null);
  const [crosshairPrice, setCrosshairPrice] = useState<number | null>(null);

  const visibleKlines = useMemo(
    () => klines.slice(0, currentIndex),
    [klines, currentIndex]
  );

  const currentCandle = visibleKlines.length > 0 ? visibleKlines[visibleKlines.length - 1] : null;

  // Derive trade result from visible candles — pure computation, no effect needed
  const tradeResult = computeTradeResult(visibleKlines, tradeMarkers);

  // Start replay
  const handleStart = async () => {
    const data = await fetchKlines(symbol, interval, new Date(startDate), 1000);
    if (data.length > 0) {
      setCurrentIndex(Math.min(20, data.length));
      setStarted(true);
      setTradeMarkers([]);
      setPlaying(false);
    }
  };

  // Advance candles
  const advance = useCallback(
    (count: number) => {
      setCurrentIndex((prev) => Math.min(prev + count, klines.length));
    },
    [klines.length]
  );

  // Play / Pause — interval recreated when dependencies change
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= klines.length) {
          setPlaying(false);
          return prev;
        }
        const next = prev + 1;
        // Stop if trade resolved
        const visible = klines.slice(0, next);
        const result = computeTradeResult(visible, tradeMarkers);
        if (result) {
          setPlaying(false);
          return next;
        }
        return next;
      });
    }, speed);
    return () => clearInterval(id);
  }, [playing, speed, klines, tradeMarkers]);

  // Place marker from crosshair
  const placeMarker = () => {
    if (!markingMode || crosshairPrice === null) return;

    setTradeMarkers((prev) => {
      const filtered = prev.filter((m) => m.type !== markingMode);
      return [...filtered, { type: markingMode, price: crosshairPrice }];
    });
    setMarkingMode(null);
  };

  // Reset replay
  const handleReset = () => {
    setCurrentIndex(Math.min(20, klines.length));
    setPlaying(false);
    setTradeMarkers([]);
  };

  const coinInfo = COINS.find((c) => c.symbol === symbol);
  const progress = klines.length > 0 ? (currentIndex / klines.length) * 100 : 0;

  // -------- SETUP SCREEN --------
  if (!started) {
    return (
      <div className="h-dvh flex flex-col bg-[#0a0a0a] text-white">
        <div className="flex-none flex items-center h-12 px-4 bg-zinc-900 border-b border-zinc-800">
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-2 rounded-md bg-zinc-700 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-600"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </button>
          <span className="ml-4 text-sm text-zinc-400">Replay Mode</span>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-md space-y-6 p-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold">Replay Mode</h1>
              <p className="text-zinc-400 text-sm">
                Rebobina el mercado. Practica sin saber el futuro.
              </p>
            </div>

            {/* Symbol */}
            <div className="space-y-2">
              <label className="text-sm text-zinc-400">Moneda</label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {COINS.map((c) => (
                  <option key={c.symbol} value={c.symbol}>
                    {c.base} — {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Timeframe */}
            <div className="space-y-2">
              <label className="text-sm text-zinc-400">Timeframe</label>
              <div className="grid grid-cols-6 gap-2">
                {INTERVALS.map((i) => (
                  <button
                    key={i.value}
                    onClick={() => setInterval(i.value)}
                    className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      interval === i.value
                        ? "bg-blue-600 text-white"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                    }`}
                  >
                    {i.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Start date */}
            <div className="space-y-2">
              <label className="text-sm text-zinc-400">Fecha de inicio</label>
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm text-center">{error}</p>
            )}

            <button
              onClick={handleStart}
              disabled={loading}
              className="w-full rounded-md bg-blue-600 px-4 py-3 text-sm font-semibold transition-colors hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Cargando velas..." : "Iniciar Replay"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------- REPLAY SCREEN --------
  return (
    <div className="h-dvh flex flex-col bg-[#0a0a0a] text-white">
      {/* Top bar */}
      <div className="flex-none flex items-center justify-between h-12 px-4 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setStarted(false)}
            className="flex items-center gap-2 rounded-md bg-zinc-700 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-600"
          >
            <ArrowLeft className="h-4 w-4" />
            Config
          </button>
          <span className="text-sm font-medium">
            {coinInfo?.base ?? symbol}
          </span>
          <span className="text-xs text-zinc-500">
            {interval.toUpperCase()}
          </span>
          {currentCandle && (
            <span className="text-sm font-mono text-zinc-300">
              {formatPrice(currentCandle.close)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>
            Vela {currentIndex} / {klines.length}
          </span>
          <div className="w-32 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <ReplayChart
          visibleKlines={visibleKlines}
          tradeMarkers={tradeMarkers}
          onCrosshairPrice={setCrosshairPrice}
        />
      </div>

      {/* Controls bar */}
      <div className="flex-none bg-zinc-900 border-t border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Playback controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPlaying(!playing)}
              disabled={currentIndex >= klines.length}
              className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </button>
            <button
              onClick={() => advance(1)}
              disabled={playing || currentIndex >= klines.length}
              className="flex items-center gap-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm transition-colors hover:bg-zinc-700 disabled:opacity-50"
            >
              <SkipForward className="h-4 w-4" />
              +1
            </button>
            <button
              onClick={() => advance(5)}
              disabled={playing || currentIndex >= klines.length}
              className="flex items-center gap-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm transition-colors hover:bg-zinc-700 disabled:opacity-50"
            >
              <ChevronsRight className="h-4 w-4" />
              +5
            </button>

            {/* Speed */}
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-2 text-sm focus:outline-none"
            >
              {SPEED_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>

            <button
              onClick={handleReset}
              className="flex items-center gap-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm transition-colors hover:bg-zinc-700"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
          </div>

          {/* Trade marking controls */}
          <div className="flex items-center gap-2">
            {markingMode && crosshairPrice !== null && (
              <button
                onClick={placeMarker}
                className="rounded-lg bg-yellow-600 px-3 py-2 text-sm font-medium animate-pulse"
              >
                Colocar {markingMode.toUpperCase()} en {formatPrice(crosshairPrice)}
              </button>
            )}
            {markingMode && (
              <button
                onClick={() => setMarkingMode(null)}
                className="rounded-lg bg-zinc-700 px-3 py-2 text-sm"
              >
                Cancelar
              </button>
            )}
            {!markingMode && (
              <>
                <button
                  onClick={() => setMarkingMode("entry")}
                  className="flex items-center gap-1 rounded-lg bg-blue-600/20 border border-blue-600/50 px-3 py-2 text-sm text-blue-400 transition-colors hover:bg-blue-600/30"
                >
                  <Crosshair className="h-4 w-4" />
                  Entrada
                </button>
                <button
                  onClick={() => setMarkingMode("sl")}
                  className="flex items-center gap-1 rounded-lg bg-red-600/20 border border-red-600/50 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-600/30"
                >
                  <ShieldAlert className="h-4 w-4" />
                  Stop Loss
                </button>
                <button
                  onClick={() => setMarkingMode("tp")}
                  className="flex items-center gap-1 rounded-lg bg-green-600/20 border border-green-600/50 px-3 py-2 text-sm text-green-400 transition-colors hover:bg-green-600/30"
                >
                  <Target className="h-4 w-4" />
                  Take Profit
                </button>
              </>
            )}
          </div>
        </div>

        {/* Trade result */}
        {tradeResult && (
          <div
            className={`mt-3 rounded-lg px-4 py-3 text-center font-medium ${
              tradeResult.outcome === "win"
                ? "bg-green-600/20 border border-green-600/50 text-green-400"
                : "bg-red-600/20 border border-red-600/50 text-red-400"
            }`}
          >
            {tradeResult.outcome === "win" ? "TRADE GANADOR" : "TRADE PERDEDOR"}{" "}
            — {tradeResult.pnlPercent > 0 ? "+" : ""}
            {tradeResult.pnlPercent.toFixed(2)}%
            {tradeResult.outcome === "win" && (
              <span className="ml-2 text-sm opacity-75">
                (R:R {tradeResult.rr.toFixed(1)})
              </span>
            )}
          </div>
        )}

        {/* Active markers info */}
        {tradeMarkers.length > 0 && !tradeResult && (
          <div className="mt-3 flex gap-4 text-xs text-zinc-500">
            {tradeMarkers.map((m) => (
              <span key={m.type}>
                <span
                  className={
                    m.type === "entry"
                      ? "text-blue-400"
                      : m.type === "sl"
                        ? "text-red-400"
                        : "text-green-400"
                  }
                >
                  {m.type === "entry" ? "Entrada" : m.type === "sl" ? "SL" : "TP"}:
                </span>{" "}
                {formatPrice(m.price)}
              </span>
            ))}
            {tradeMarkers.length === 3 && (
              <span className="text-yellow-400 animate-pulse">
                Avanza velas para ver el resultado...
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReplayPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-[#0a0a0a]" />}>
      <ReplayContent />
    </Suspense>
  );
}
