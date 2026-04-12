import { useCallback, useEffect, useState } from "react";
import {
  type Channel,
  type ChannelInsert,
  addChannel,
  deleteChannel,
  listChannels,
  updateChannel,
} from "@/lib/db";

export function useChannels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listChannels();
      setChannels(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading channels");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(
    async (channel: ChannelInsert) => {
      await addChannel(channel);
      await refresh();
    },
    [refresh]
  );

  const update = useCallback(
    async (id: string, fields: Partial<Omit<Channel, "id" | "created_at">>) => {
      await updateChannel(id, fields);
      await refresh();
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteChannel(id);
      await refresh();
    },
    [refresh]
  );

  return { channels, loading, error, refresh, add, update, remove };
}
