"use client";

import useSWR from "swr";
import { POLL_INTERVAL, DEDUP_INTERVAL } from "@/lib/constants";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Generic hook to poll any of our API endpoints.
 * Returns { data, error, isLoading, isValidating }.
 *
 * T should be the full ApiResponse<D> shape from the endpoint.
 */
export function useApi<T = unknown>(endpoint: string, interval = POLL_INTERVAL) {
  return useSWR<T>(endpoint, fetcher, {
    refreshInterval: interval,
    dedupingInterval: DEDUP_INTERVAL,
    revalidateOnFocus: true,
    keepPreviousData: true,
    onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
      // Don't retry on 404
      if (error?.status === 404) return;
      // Max 3 retries with exponential backoff
      if (retryCount >= 3) return;
      const delay = Math.min(1000 * 2 ** retryCount, 30_000);
      console.error(
        `[useApi] Error fetching ${endpoint} (retry ${retryCount + 1}/3):`,
        error
      );
      setTimeout(() => revalidate({ retryCount }), delay);
    },
  });
}
