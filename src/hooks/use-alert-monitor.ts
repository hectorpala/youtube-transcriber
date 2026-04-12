"use client";

import { useEffect, useRef } from "react";
import type { PriceMap } from "@/hooks/use-binance-prices";
import type { Alert } from "@/lib/alerts";
import { deactivateAlert } from "@/lib/alerts";
import { sendNotification } from "@/lib/notifications";
import { COINS } from "@/lib/coins";

const coinNames = Object.fromEntries(COINS.map((c) => [c.symbol, c.name]));

export function useAlertMonitor(prices: PriceMap, alerts: Alert[]) {
  const prevPrices = useRef<Record<string, number>>({});

  useEffect(() => {
    const activeAlerts = alerts.filter((a) => a.active);
    if (activeAlerts.length === 0) return;

    for (const alert of activeAlerts) {
      const currentPrice = prices[alert.symbol]?.price;
      const previousPrice = prevPrices.current[alert.symbol];

      if (currentPrice === undefined || previousPrice === undefined) continue;

      const triggered =
        (alert.direction === "above" &&
          previousPrice < alert.targetPrice &&
          currentPrice >= alert.targetPrice) ||
        (alert.direction === "below" &&
          previousPrice > alert.targetPrice &&
          currentPrice <= alert.targetPrice);

      if (triggered) {
        const name = coinNames[alert.symbol] || alert.symbol;
        const dir = alert.direction === "above" ? "superó" : "cayó a";
        sendNotification(
          `${name} ${dir} $${alert.targetPrice}`,
          `Precio actual: $${currentPrice.toFixed(2)}`
        );
        deactivateAlert(alert.id);
      }
    }

    // Update previous prices
    for (const [symbol, data] of Object.entries(prices)) {
      prevPrices.current[symbol] = data.price;
    }
  }, [prices, alerts]);
}
