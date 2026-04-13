"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type Batch,
  type Channel,
  type Video,
  getBatch,
  getChannel,
  getVideosForBatch,
  updateBatchStatus,
  updateVideoStatus,
  updateVideoTranscription,
  recalcBatchCounts,
  hasGlobalActiveBatch,
  hasActiveBatch,
  getNextPendingVideos,
  createBatchWithVideos,
} from "@/lib/db";
import {
  ArrowLeft,
  Play,
  Pause,
  XCircle,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  RotateCcw,
  Video as VideoIcon,
  Package,
  FileText,
  Plus,
} from "lucide-react";

// ---------- Types ----------

interface BatchEventPayload {
  batch_id: number;
  video_id: string;
  event_type: string;
  message: string;
  percent?: number;
  text?: string;
  language?: string;
  method?: string;
}

// ---------- Status config ----------

const VIDEO_STATUS: Record<string, { label: string; icon: typeof Clock; color: string }> = {
  pendiente: { label: "Pending", icon: Clock, color: "text-muted-foreground" },
  en_cola: { label: "Queued", icon: Clock, color: "text-muted-foreground" },
  transcribiendo: { label: "Transcribing...", icon: Loader2, color: "text-primary" },
  completado: { label: "Completed", icon: CheckCircle2, color: "text-profit" },
  error: { label: "Error", icon: AlertCircle, color: "text-destructive" },
  omitido: { label: "Skipped", icon: XCircle, color: "text-muted-foreground" },
};

const BATCH_STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  preparado: { label: "Ready", variant: "outline" },
  procesando: { label: "Processing", variant: "default" },
  pausado: { label: "Paused", variant: "secondary" },
  completado: { label: "Completed", variant: "secondary" },
  cancelado: { label: "Cancelled", variant: "destructive" },
  fallido: { label: "Failed", variant: "destructive" },
};

// ---------- Progress bar ----------

function ProgressBar({ completed, failed, total }: { completed: number; failed: number; total: number }) {
  const pctDone = total > 0 ? (completed / total) * 100 : 0;
  const pctFail = total > 0 ? (failed / total) * 100 : 0;

  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-muted-foreground mb-1">
        <span>{completed + failed} / {total} processed</span>
        <span>{Math.round(pctDone + pctFail)}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden flex">
        {pctDone > 0 && (
          <div
            className="h-full bg-profit transition-all duration-500"
            style={{ width: `${pctDone}%` }}
          />
        )}
        {pctFail > 0 && (
          <div
            className="h-full bg-destructive transition-all duration-500"
            style={{ width: `${pctFail}%` }}
          />
        )}
      </div>
    </div>
  );
}

// ---------- Post-batch summary ----------

function BatchSummary({
  batch,
  videos,
  channelId,
  onNextBatchCreated,
}: {
  batch: Batch;
  videos: Video[];
  channelId: string;
  onNextBatchCreated: (batchId: number) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const completed = videos.filter(v => v.status === "completado");
  const errors = videos.filter(v => v.status === "error");
  const isFinished = batch.status === "completado" || batch.status === "cancelado" || batch.status === "fallido";

  if (!isFinished) return null;

  const handleCreateNext = async (n: number) => {
    setCreating(true);
    setError(null);
    try {
      // Fix #11: Check for active batch before creating next
      const active = await hasActiveBatch(channelId);
      if (active) {
        setError("There's already an active batch for this channel.");
        return;
      }
      const pending = await getNextPendingVideos(channelId, n);
      if (pending.length === 0) {
        setError("No pending videos available.");
        return;
      }
      const { batchId } = await createBatchWithVideos(channelId, pending.map(v => v.id));
      onNextBatchCreated(batchId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Batch Summary</h3>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-md bg-profit/10 px-3 py-2 text-center">
          <p className="text-lg font-semibold font-mono text-profit">{completed.length}</p>
          <p className="text-[10px] text-muted-foreground">Completed</p>
        </div>
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-center">
          <p className="text-lg font-semibold font-mono text-destructive">{errors.length}</p>
          <p className="text-[10px] text-muted-foreground">Errors</p>
        </div>
        <div className="rounded-md bg-muted px-3 py-2 text-center">
          <p className="text-lg font-semibold font-mono">{batch.total_videos}</p>
          <p className="text-[10px] text-muted-foreground">Total</p>
        </div>
      </div>

      {/* Preview of completed transcriptions */}
      {completed.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Recent transcriptions</p>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {completed.slice(0, 5).map(v => (
              <div key={v.id} className="rounded-md bg-muted/50 px-3 py-2">
                <p className="text-xs font-medium truncate">{v.title}</p>
                {v.full_text && (
                  <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                    {v.full_text.slice(0, 200)}...
                  </p>
                )}
                {v.transcription_method && (
                  <span className="text-[10px] text-muted-foreground">
                    via {v.transcription_method} ({v.language})
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create next batch */}
      <div className="flex items-center gap-2 pt-3 border-t border-border">
        <span className="text-xs text-muted-foreground">Next batch:</span>
        {[10, 20, 50].map(n => (
          <Button key={n} size="xs" variant="outline" disabled={creating} onClick={() => handleCreateNext(n)}>
            {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            <span>{n} pending</span>
          </Button>
        ))}
      </div>
      {error && (
        <p className="text-xs text-destructive mt-2">{error}</p>
      )}
    </div>
  );
}

// ---------- Video list item ----------

function BatchVideoRow({
  video,
  currentVideoId,
  progressMsg,
  retrying,
  onRetry,
}: {
  video: Video;
  currentVideoId: string | null;
  progressMsg: string;
  retrying: string | null;
  onRetry: (video: Video) => void;
}) {
  const isCurrent = currentVideoId === video.id;
  const isRetrying = retrying === video.id;
  const cfg = VIDEO_STATUS[video.status] ?? { label: video.status, icon: Clock, color: "text-muted-foreground" };
  const Icon = isCurrent ? Loader2 : cfg.icon;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 border-b border-border transition-colors ${
        isCurrent ? "bg-primary/5" : ""
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${isCurrent ? "animate-spin text-primary" : cfg.color}`} />

      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{video.title}</p>
        {isCurrent && progressMsg && (
          <p className="text-xs text-muted-foreground mt-0.5">{progressMsg}</p>
        )}
        {video.status === "error" && video.error_message && !isCurrent && (
          <p className="text-xs text-destructive mt-0.5 truncate">{video.error_message}</p>
        )}
        {video.status === "completado" && video.full_text && !isCurrent && (
          <div className="mt-0.5">
            <p className="text-[11px] text-muted-foreground line-clamp-1">
              {video.full_text.slice(0, 120)}...
            </p>
            {video.language && (
              <span className={`text-[10px] ${video.language !== "es" ? "text-warning" : "text-muted-foreground"}`}>
                {video.language !== "es" ? `lang: ${video.language}` : ""}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 flex items-center gap-2">
        {video.status === "error" && (
          <Button
            size="xs"
            variant="outline"
            disabled={isRetrying}
            onClick={() => onRetry(video)}
          >
            {isRetrying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )}
            <span>Retry</span>
          </Button>
        )}
        {video.status === "completado" && (
          <Button
            size="xs"
            variant="ghost"
            disabled={isRetrying}
            onClick={() => onRetry(video)}
            title="Re-transcribe this video"
          >
            {isRetrying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )}
            <span>Re-transcribe</span>
          </Button>
        )}
        <Badge variant={isCurrent ? "default" : (BATCH_STATUS_BADGE[video.status]?.variant ?? "outline")}>
          {isCurrent ? "Transcribing" : cfg.label}
        </Badge>
      </div>
    </div>
  );
}

// ---------- Main page ----------

export default function BatchViewPageWrapper() {
  return (
    <Suspense fallback={
      <>
        <Skeleton className="h-7 w-64 mb-2" />
        <Skeleton className="h-4 w-96 mb-6" />
        <Skeleton className="h-2 w-full mb-6" />
      </>
    }>
      <BatchViewPage />
    </Suspense>
  );
}

function BatchViewPage() {
  const searchParams = useSearchParams();
  const channelId = searchParams.get("channelId") ?? "";
  const batchId = parseInt(searchParams.get("batchId") ?? "0", 10);
  const router = useRouter();

  const [channel, setChannel] = useState<Channel | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);

  // Processing state
  const [processing, setProcessing] = useState(false);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);

  // Ref to track if we should listen for events
  const unlistenRef = useRef<(() => void) | null>(null);

  // Load data
  const loadData = useCallback(async () => {
    const [ch, b] = await Promise.all([
      getChannel(channelId),
      getBatch(batchId),
    ]);
    setChannel(ch ?? null);
    setBatch(b ?? null);

    if (b) {
      const vids = await getVideosForBatch(channelId, b.batch_number);
      setVideos(vids);
      // If batch was already processing (app restart), reflect that
      if (b.status === "procesando") {
        setProcessing(true);
      }
    }
    setLoading(false);
  }, [channelId, batchId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Persist helpers with error handling
  const persistVideoDone = useCallback(async (videoId: string, text: string, method: string, language: string) => {
    try {
      await updateVideoTranscription(videoId, { full_text: text, transcription_method: method, language });
      await recalcBatchCounts(batchId);
      await loadData();
    } catch (err) {
      console.error("Failed to persist video transcription:", err);
    }
  }, [batchId, loadData]);

  const persistVideoError = useCallback(async (videoId: string, message: string) => {
    try {
      await updateVideoStatus(videoId, "error", message);
      await recalcBatchCounts(batchId);
      await loadData();
    } catch (err) {
      console.error("Failed to persist video error:", err);
    }
  }, [batchId, loadData]);

  // Listen for batch events
  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      const unlisten = await listen<BatchEventPayload>("batch-event", (event) => {
        if (cancelled) return;
        const e = event.payload;
        if (e.batch_id !== batchId && e.batch_id !== 0) return;

        switch (e.event_type) {
          case "video_start":
            setCurrentVideoId(e.video_id);
            setProgressMsg(e.message);
            setVideos(prev =>
              prev.map(v =>
                v.id === e.video_id ? { ...v, status: "transcribiendo" } : v
              )
            );
            break;

          case "video_progress":
            setProgressMsg(e.message);
            break;

          case "video_done":
            setCurrentVideoId(null);
            setProgressMsg("");
            setVideos(prev =>
              prev.map(v =>
                v.id === e.video_id
                  ? { ...v, status: "completado", full_text: e.text ?? null, language: e.language ?? null, transcription_method: e.method ?? null }
                  : v
              )
            );
            if (e.text && e.language && e.method) {
              persistVideoDone(e.video_id, e.text, e.method, e.language);
            }
            break;

          case "video_error":
            setCurrentVideoId(null);
            setProgressMsg("");
            setVideos(prev =>
              prev.map(v =>
                v.id === e.video_id
                  ? { ...v, status: "error", error_message: e.message }
                  : v
              )
            );
            persistVideoError(e.video_id, e.message);
            break;

          case "batch_done":
          case "batch_pausado":
          case "batch_cancelado":
            setProcessing(false);
            setCurrentVideoId(null);
            setProgressMsg("");
            loadData();
            break;
        }
      });

      if (!cancelled) {
        unlistenRef.current = unlisten;
      } else {
        unlisten();
      }
    };

    setup();

    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
  }, [batchId, loadData]);

  // ---------- Actions ----------

  const handleStart = useCallback(async () => {
    if (!batch) return;

    const active = await hasGlobalActiveBatch();
    if (active) {
      alert("Another batch is already processing. Wait for it to finish or pause it first.");
      return;
    }

    setProcessing(true);
    await updateBatchStatus(batchId, "procesando");

    // Fix #2: Fetch fresh videos from DB, not stale React state
    const freshVideos = await getVideosForBatch(channelId, batch.batch_number);
    const pendingVideos = freshVideos
      .filter(v => v.status === "en_cola" || v.status === "pendiente")
      .map(v => ({ id: v.id, url: v.url, title: v.title }));

    if (pendingVideos.length === 0) {
      await updateBatchStatus(batchId, "completado");
      setProcessing(false);
      await loadData();
      return;
    }

    for (const v of pendingVideos) {
      await updateVideoStatus(v.id, "en_cola");
    }

    try {
      const result = await invoke<{ completed: number; failed: number; status: string }>(
        "process_batch",
        { batchId, videos: pendingVideos }
      );

      // Fix #5: Always recalc from DB to include previous runs
      await recalcBatchCounts(batchId);
      const finalStatus = result.status === "completado" ? "completado" : result.status;
      await updateBatchStatus(batchId, finalStatus);
    } catch (err) {
      console.error("Batch processing error:", err);
      await updateBatchStatus(batchId, "fallido");
    }

    setProcessing(false);
    await loadData();
  }, [batch, batchId, channelId, loadData]);

  const handleResume = useCallback(async () => {
    if (!batch) return;

    const active = await hasGlobalActiveBatch();
    if (active) {
      alert("Another batch is already processing.");
      return;
    }

    setProcessing(true);
    await updateBatchStatus(batchId, "procesando");

    // Fix #2: Fetch fresh videos from DB
    const freshVideos = await getVideosForBatch(channelId, batch.batch_number);
    const pendingVideos = freshVideos
      .filter(v => v.status === "en_cola")
      .map(v => ({ id: v.id, url: v.url, title: v.title }));

    if (pendingVideos.length === 0) {
      await updateBatchStatus(batchId, "completado");
      setProcessing(false);
      await loadData();
      return;
    }

    try {
      const result = await invoke<{ completed: number; failed: number; status: string }>(
        "process_batch",
        { batchId, videos: pendingVideos }
      );

      await recalcBatchCounts(batchId);
      const finalStatus = result.status === "completado" ? "completado" : result.status;
      await updateBatchStatus(batchId, finalStatus);
    } catch (err) {
      console.error("Batch resume error:", err);
      await updateBatchStatus(batchId, "fallido");
    }

    setProcessing(false);
    await loadData();
  }, [batch, batchId, channelId, loadData]);

  const handlePause = useCallback(async () => {
    await invoke("signal_batch", { batchId: batchId, signal: "pause" });
    // Persist immediately so the status survives if user navigates away
    await updateBatchStatus(batchId, "pausado");
    await loadData();
  }, [batchId, loadData]);

  const handleCancel = useCallback(async () => {
    if (!batch) return;
    await invoke("signal_batch", { batchId: batchId, signal: "cancel" });
    // Fetch fresh from DB to avoid stale state
    const freshVideos = await getVideosForBatch(channelId, batch.batch_number);
    const remaining = freshVideos.filter(v => v.status === "en_cola");
    for (const v of remaining) {
      await updateVideoStatus(v.id, "pendiente");
    }
    await updateBatchStatus(batchId, "cancelado");
    await loadData();
  }, [batch, batchId, channelId, loadData]);

  const handleNextBatchCreated = useCallback((newBatchId: number) => {
    router.push(`/batch?channelId=${channelId}&batchId=${newBatchId}`);
  }, [channelId, router]);

  const handleRetry = useCallback(async (video: Video) => {
    setRetrying(video.id);
    await updateVideoStatus(video.id, "transcribiendo");
    setVideos(prev => prev.map(v => v.id === video.id ? { ...v, status: "transcribiendo" } : v));

    try {
      const result = await invoke<BatchEventPayload>("transcribe_single", {
        videoId: video.id,
        videoUrl: video.url,
      });

      if (result.text && result.language && result.method) {
        await updateVideoTranscription(video.id, {
          full_text: result.text,
          transcription_method: result.method,
          language: result.language,
        });
      }
      await recalcBatchCounts(batchId);
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateVideoStatus(video.id, "error", msg);
      await loadData();
    } finally {
      setRetrying(null);
    }
  }, [batchId, loadData]);

  // ---------- Render ----------

  if (loading) {
    return (
      <>
        <Skeleton className="h-7 w-64 mb-2" />
        <Skeleton className="h-4 w-96 mb-6" />
        <Skeleton className="h-2 w-full mb-6" />
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full mb-2" />)}
      </>
    );
  }

  if (!batch || !channel) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AlertCircle className="h-8 w-8 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Batch not found.</p>
        <Link href={`/channel?id=${channelId}`}>
          <Button size="sm" variant="ghost" className="mt-4">
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to channel</span>
          </Button>
        </Link>
      </div>
    );
  }

  const batchBadge = BATCH_STATUS_BADGE[batch.status] ?? { label: batch.status, variant: "outline" as const };
  const canStart = batch.status === "preparado";
  const canResume = batch.status === "pausado";
  const canPause = processing;
  const canCancel = processing || batch.status === "pausado";

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <Link href={`/channel?id=${channelId}`}>
          <Button size="icon-sm" variant="ghost">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <PageHeader
          title={`Batch #${batch.batch_number}`}
          description={`${channel.name} — ${batch.total_videos} videos`}
        />
      </div>

      {/* Stats + controls */}
      <div className="rounded-lg border border-border bg-card p-4 mb-6">
        <div className="mb-4">
          <div className="flex items-center gap-3 mb-3">
            <Package className="h-5 w-5 text-primary" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">Batch #{batch.batch_number}</span>
                <Badge variant={batchBadge.variant}>{batchBadge.label}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {batch.completed_videos} completed, {batch.failed_videos} failed of {batch.total_videos}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canStart && (
              <Button onClick={handleStart}>
                <Play className="h-4 w-4" />
                <span>Start Batch</span>
              </Button>
            )}
            {canResume && (
              <Button onClick={handleResume}>
                <Play className="h-4 w-4" />
                <span>Resume Batch</span>
              </Button>
            )}
            {canPause && (
              <Button variant="secondary" onClick={handlePause}>
                <Pause className="h-4 w-4" />
                <span>Pause</span>
              </Button>
            )}
            {canCancel && (
              <Button variant="destructive" onClick={handleCancel}>
                <XCircle className="h-4 w-4" />
                <span>Cancel</span>
              </Button>
            )}
          </div>
        </div>

        <ProgressBar
          completed={batch.completed_videos}
          failed={batch.failed_videos}
          total={batch.total_videos}
        />
      </div>

      {/* Post-batch summary */}
      <BatchSummary
        batch={batch}
        videos={videos}
        channelId={channelId}
        onNextBatchCreated={handleNextBatchCreated}
      />

      {/* Video list */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="border-b border-border bg-muted/50 px-4 py-2 flex items-center gap-2">
          <VideoIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Videos in batch</span>
        </div>
        {videos.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No videos in this batch.
          </div>
        ) : (
          videos.map(video => (
            <BatchVideoRow
              key={video.id}
              video={video}
              currentVideoId={currentVideoId}
              progressMsg={currentVideoId === video.id ? progressMsg : ""}
              retrying={retrying}
              onRetry={handleRetry}
            />
          ))
        )}
      </div>
    </>
  );
}
