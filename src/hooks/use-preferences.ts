"use client";

import { useSyncExternalStore } from "react";
import {
  subscribe,
  getSnapshot,
  setTheme,
  type Preferences,
} from "@/lib/preferences";

const actions = { setTheme } as const;

export function usePreferences(): Preferences & typeof actions {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, () => ({
    theme: "system" as const,
  }));
  return { ...prefs, ...actions };
}
