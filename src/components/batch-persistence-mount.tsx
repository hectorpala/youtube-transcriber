"use client";

import { useEffect } from "react";
import { initBatchPersistence } from "@/lib/batch-persistence";

/**
 * Mounts the app-lifetime batch persistence listener (see lib/batch-persistence).
 * Lives in the dashboard layout so transcriptions persist no matter which page
 * the user is on. Renders nothing.
 */
export function BatchPersistenceMount() {
  useEffect(() => {
    initBatchPersistence();
  }, []);
  return null;
}
