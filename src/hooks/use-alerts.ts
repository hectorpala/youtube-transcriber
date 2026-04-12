"use client";

import { useSyncExternalStore } from "react";
import {
  subscribe,
  getSnapshot,
  addAlert,
  removeAlert,
  type Alert,
} from "@/lib/alerts";

const actions = { addAlert, removeAlert } as const;

export function useAlerts(): { alerts: Alert[] } & typeof actions {
  const alerts = useSyncExternalStore(subscribe, getSnapshot, () => [] as Alert[]);
  return { alerts, ...actions };
}
