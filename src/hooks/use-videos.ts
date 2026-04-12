import { useCallback, useEffect, useState } from "react";
import {
  type Video,
  type VideoInsert,
  addVideo,
  listVideos,
  updateVideo,
  updateVideoStatus,
  bulkUpdateVideoStatus,
  getNextPendingVideos,
  countVideosByStatus,
} from "@/lib/db";

export function useVideos(channelId: string | null) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});

  const refresh = useCallback(async () => {
    if (!channelId) {
      setVideos([]);
      setStatusCounts({});
      return;
    }
    try {
      setLoading(true);
      const [data, counts] = await Promise.all([
        listVideos(channelId),
        countVideosByStatus(channelId),
      ]);
      setVideos(data);
      setStatusCounts(counts);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading videos");
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(
    async (video: VideoInsert) => {
      await addVideo(video);
      await refresh();
    },
    [refresh]
  );

  const setStatus = useCallback(
    async (id: string, status: string, errorMessage?: string) => {
      await updateVideoStatus(id, status, errorMessage);
      await refresh();
    },
    [refresh]
  );

  const update = useCallback(
    async (id: string, fields: Partial<Omit<Video, "id" | "created_at">>) => {
      await updateVideo(id, fields);
      await refresh();
    },
    [refresh]
  );

  const bulkSetStatus = useCallback(
    async (ids: string[], status: string) => {
      await bulkUpdateVideoStatus(ids, status);
      await refresh();
    },
    [refresh]
  );

  const getNextPending = useCallback(
    async (limit: number): Promise<Video[]> => {
      if (!channelId) return [];
      return getNextPendingVideos(channelId, limit);
    },
    [channelId]
  );

  return {
    videos,
    loading,
    error,
    statusCounts,
    refresh,
    add,
    setStatus,
    update,
    bulkSetStatus,
    getNextPending,
  };
}
