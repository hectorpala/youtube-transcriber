import { useCallback, useEffect, useState } from "react";
import {
  type Batch,
  type BatchInsert,
  createBatch,
  listBatches,
  updateBatchStatus,
} from "@/lib/db";

export function useBatches(channelId?: string) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listBatches(channelId);
      setBatches(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading batches");
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (batch: BatchInsert): Promise<number> => {
      const id = await createBatch(batch);
      await refresh();
      return id;
    },
    [refresh]
  );

  const setStatus = useCallback(
    async (
      id: number,
      status: string,
      counts?: { completed_videos?: number; failed_videos?: number }
    ) => {
      await updateBatchStatus(id, status, counts);
      await refresh();
    },
    [refresh]
  );

  return { batches, loading, error, refresh, create, setStatus };
}
