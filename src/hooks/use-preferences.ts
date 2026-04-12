"use client";

import { useSyncExternalStore } from "react";
import {
  subscribe,
  getSnapshot,
  toggleFavorite,
  setTheme,
  setChartInterval,
  type Preferences,
} from "@/lib/preferences";

const actions = { toggleFavorite, setTheme, setChartInterval } as const;

export function usePreferences(): Preferences & typeof actions {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, () => ({
    favorites: [],
    theme: "system" as const,
    chartInterval: "60",
  }));
  return { ...prefs, ...actions };
}
