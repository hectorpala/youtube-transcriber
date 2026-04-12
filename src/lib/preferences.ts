import { z } from "zod";

const STORAGE_KEY = "trading-dashboard-preferences";

const preferencesSchema = z.object({
  favorites: z.array(z.string()).default([]),
  theme: z.enum(["system", "dark", "light"]).default("system"),
  chartInterval: z.string().default("60"),
});

export type Preferences = z.infer<typeof preferencesSchema>;

const DEFAULTS: Preferences = {
  favorites: [],
  theme: "system",
  chartInterval: "60",
};

let listeners: Array<() => void> = [];
let cached: Preferences | null = null;

function notify() {
  cached = null;
  for (const listener of listeners) listener();
}

export function getPreferences(): Preferences {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return (cached = DEFAULTS);
    cached = preferencesSchema.parse(JSON.parse(raw));
    return cached;
  } catch {
    return (cached = DEFAULTS);
  }
}

function save(prefs: Preferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  notify();
}

export function toggleFavorite(symbol: string) {
  const prefs = getPreferences();
  const idx = prefs.favorites.indexOf(symbol);
  const favorites =
    idx >= 0
      ? prefs.favorites.filter((s) => s !== symbol)
      : [...prefs.favorites, symbol];
  save({ ...prefs, favorites });
}

export function setTheme(theme: Preferences["theme"]) {
  save({ ...getPreferences(), theme });
}

export function setChartInterval(interval: string) {
  save({ ...getPreferences(), chartInterval: interval });
}

export function subscribe(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function getSnapshot(): Preferences {
  return getPreferences();
}
