import { z } from "zod";

const STORAGE_KEY = "trading-dashboard-alerts";

const alertSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  targetPrice: z.number(),
  direction: z.enum(["above", "below"]),
  active: z.boolean(),
  createdAt: z.number(),
});

export type Alert = z.infer<typeof alertSchema>;

const alertsArraySchema = z.array(alertSchema);

let listeners: Array<() => void> = [];
let cached: Alert[] | null = null;

function notify() {
  cached = null;
  for (const listener of listeners) listener();
}

export function getAlerts(): Alert[] {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return (cached = []);
    cached = alertsArraySchema.parse(JSON.parse(raw));
    return cached;
  } catch {
    return (cached = []);
  }
}

function save(alerts: Alert[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
  notify();
}

export function addAlert(symbol: string, targetPrice: number, direction: "above" | "below") {
  const alerts = getAlerts();
  const newAlert: Alert = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symbol,
    targetPrice,
    direction,
    active: true,
    createdAt: Date.now(),
  };
  save([...alerts, newAlert]);
  return newAlert;
}

export function removeAlert(id: string) {
  save(getAlerts().filter((a) => a.id !== id));
}

export function deactivateAlert(id: string) {
  save(getAlerts().map((a) => (a.id === id ? { ...a, active: false } : a)));
}

export function subscribe(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function getSnapshot(): Alert[] {
  return getAlerts();
}
