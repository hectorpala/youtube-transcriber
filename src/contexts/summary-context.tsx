"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useApi } from "@/hooks/use-api";
import type { SummaryResponse } from "@/lib/data/summary-types";

interface SummaryContextValue {
  data: SummaryResponse | undefined;
  error: unknown;
  isLoading: boolean;
  isValidating: boolean;
}

const SummaryContext = createContext<SummaryContextValue | null>(null);

export function SummaryProvider({ children }: { children: ReactNode }) {
  const { data, error, isLoading, isValidating } =
    useApi<SummaryResponse>("/api/summary");

  return (
    <SummaryContext.Provider value={{ data, error, isLoading, isValidating }}>
      {children}
    </SummaryContext.Provider>
  );
}

export function useSummary(): SummaryContextValue {
  const ctx = useContext(SummaryContext);
  if (!ctx) {
    throw new Error("useSummary must be used within a SummaryProvider");
  }
  return ctx;
}
