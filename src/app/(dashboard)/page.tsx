"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useChannels } from "@/hooks/use-channels";
import {
  type Channel,
  type Batch,
  type VideoInsert,
  type ChannelProgress,
  type GlobalStats,
  addVideoBulk,
  updateChannel,
  deleteChannel,
  getGlobalStats,
  getAllChannelProgress,
  getPausedOrActiveBatches,
} from "@/lib/db";
import {
  Plus,
  ScanSearch,
  Loader2,
  Tv,
  Video,
  CheckCircle2,
  AlertCircle,
  List,
  Clock,
  Package,
  Play,
  XCircle,
  Trash2,
} from "lucide-react";

// ---------- Status helpers ----------

const statusConfig: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  nuevo: { label: "New", variant: "outline" },
  scrapeando: { label: "Scanning...", variant: "default" },
  scrapeado: { label: "Scraped", variant: "secondary" },
  en_progreso: { label: "In progress", variant: "default" },
  completado: { label: "Completed", variant: "secondary" },
  error: { label: "Error", variant: "destructive" },
};

function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

// ---------- Helpers ----------

function formatHours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ---------- Add channel form ----------

function extractChannelInfo(input: string): {
  id: string;
  name: string;
  handle: string | null;
  url: string;
} {
  const trimmed = input.trim();

  if (trimmed.startsWith("@")) {
    const handle = trimmed;
    return {
      id: handle.slice(1),
      name: handle,
      handle,
      url: `https://www.youtube.com/${handle}`,
    };
  }

  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts[0] === "channel" && parts[1]) {
      return { id: parts[1], name: parts[1], handle: null, url: `https://www.youtube.com/channel/${parts[1]}` };
    }
    if (parts[0]?.startsWith("@")) {
      const handle = parts[0];
      return { id: handle.slice(1), name: handle, handle, url: `https://www.youtube.com/${handle}` };
    }
    if (parts[0] === "c" && parts[1]) {
      return { id: parts[1], name: parts[1], handle: null, url: trimmed };
    }
  } catch {
    // Not a valid URL
  }

  return { id: trimmed, name: trimmed, handle: null, url: `https://www.youtube.com/@${trimmed}` };
}

function AddChannelForm({ onAdd }: { onAdd: () => void }) {
  const [value, setValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { add } = useChannels();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || adding) return;

    setAdding(true);
    setFormError(null);
    try {
      const info = extractChannelInfo(value);
      await add({ id: info.id, name: info.name, handle: info.handle, url: info.url });
      setValue("");
      onAdd();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to add channel");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => { setValue(e.target.value); setFormError(null); }}
          placeholder="YouTube URL or @handle..."
          className="max-w-sm"
          disabled={adding}
        />
        <Button type="submit" disabled={adding || !value.trim()}>
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          <span>Add Channel</span>
        </Button>
      </form>
      {formError && (
        <p className="text-xs text-destructive mt-1.5">{formError}</p>
      )}
    </div>
  );
}

// ---------- Recovery banner ----------

function RecoveryBanner({ batches }: { batches: Batch[] }) {
  if (batches.length === 0) return null;

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 mb-6">
      <div className="flex items-center gap-2 mb-2">
        <AlertCircle className="h-4 w-4 text-warning" />
        <span className="text-sm font-semibold">Unfinished batches detected</span>
      </div>
      <div className="space-y-2">
        {batches.map((b) => (
          <div key={b.id} className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Batch #{b.batch_number} — {b.completed_videos}/{b.total_videos} done
              <Badge variant={b.status === "pausado" ? "secondary" : "default"} className="ml-2">
                {b.status === "pausado" ? "Paused" : "In progress"}
              </Badge>
            </span>
            <Link href={`/batch?channelId=${b.channel_id}&batchId=${b.id}`}>
              <Button size="xs" variant="outline">
                <Play className="h-3 w-3" />
                <span>Resume</span>
              </Button>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Global stats ----------

function GlobalStatsBar({ stats }: { stats: GlobalStats | null }) {
  if (!stats) return null;

  const items = [
    { label: "Channels", value: stats.total_channels, icon: Tv },
    { label: "Videos", value: stats.total_videos, icon: Video },
    { label: "Transcribed", value: stats.total_transcribed, icon: CheckCircle2 },
    { label: "Errors", value: stats.total_errors, icon: XCircle },
    { label: "Pending", value: stats.total_pending, icon: Clock },
    { label: "Content", value: formatHours(stats.total_duration_seconds), icon: Package },
  ];

  return (
    <div className="grid grid-cols-6 gap-3 mb-6">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2.5 rounded-lg border border-border bg-card p-3">
          <item.icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-base font-semibold font-mono">{item.value}</p>
            <p className="text-[10px] text-muted-foreground">{item.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Channel card ----------

interface ScrapeState {
  channelId: string;
  progress: string;
}

const BATCH_STATUS_LABEL: Record<string, string> = {
  preparado: "Ready",
  procesando: "Processing",
  pausado: "Paused",
  completado: "Done",
  cancelado: "Cancelled",
  fallido: "Failed",
};

function ChannelCard({
  channel,
  progress,
  scrapeState,
  onScrape,
  onDelete,
}: {
  channel: Channel;
  progress: ChannelProgress | undefined;
  scrapeState: ScrapeState | null;
  onScrape: (channel: Channel) => void;
  onDelete: (channel: Channel) => void;
}) {
  const isScraping = scrapeState?.channelId === channel.id;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const transcribed = progress?.transcribed ?? 0;
  const total = progress?.total ?? channel.total_videos;
  const errors = progress?.errors ?? 0;
  const skipped = progress?.skipped ?? 0;
  const countable = total - skipped;
  const pct = countable > 0 ? Math.round((transcribed / countable) * 100) : 0;

  const actionButton = () => {
    switch (channel.status) {
      case "nuevo":
        return (
          <Button size="sm" onClick={() => onScrape(channel)} disabled={isScraping}>
            {isScraping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}
            <span>{isScraping ? "Scanning..." : "Scan Videos"}</span>
          </Button>
        );
      case "scrapeado":
      case "en_progreso":
      case "completado":
        return (
          <Link href={`/channel?id=${channel.id}`}>
            <Button size="sm" variant="secondary">
              <List className="h-3.5 w-3.5" />
              <span>View Videos</span>
            </Button>
          </Link>
        );
      case "error":
        return (
          <Button size="sm" variant="destructive" onClick={() => onScrape(channel)} disabled={isScraping}>
            <ScanSearch className="h-3.5 w-3.5" />
            <span>Retry</span>
          </Button>
        );
      default:
        return (
          <Link href={`/channel?id=${channel.id}`}>
            <Button size="sm" variant="ghost">
              <List className="h-3.5 w-3.5" />
              <span>Open</span>
            </Button>
          </Link>
        );
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Tv className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate">{channel.name}</CardTitle>
            {channel.handle && (
              <CardDescription className="text-xs truncate">{channel.handle}</CardDescription>
            )}
          </div>
        </div>
        <CardAction>{actionButton()}</CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
          <StatusBadge status={channel.status} />
          <span className="flex items-center gap-1">
            <Video className="h-3 w-3" />
            {total} videos
          </span>
          {transcribed > 0 && (
            <span className="flex items-center gap-1 text-profit">
              <CheckCircle2 className="h-3 w-3" />
              {transcribed}
            </span>
          )}
          {errors > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <AlertCircle className="h-3 w-3" />
              {errors}
            </span>
          )}
        </div>

        {isScraping && scrapeState?.progress && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
            <span>{scrapeState.progress}</span>
          </div>
        )}

        {/* Progress bar */}
        {channel.scraped && countable > 0 && (
          <div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden flex">
              {pct > 0 && (
                <div
                  className="h-full rounded-full bg-profit/60 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              )}
              {errors > 0 && (
                <div
                  className="h-full bg-destructive/40 transition-all duration-500"
                  style={{ width: `${Math.round((errors / countable) * 100)}%` }}
                />
              )}
            </div>
            <div className="flex justify-between mt-1">
              <p className="text-[10px] text-muted-foreground">
                {transcribed} / {countable} transcribed{skipped > 0 ? ` (${skipped} skipped)` : ""}
              </p>
              <p className="text-[10px] font-mono text-muted-foreground">{pct}%</p>
            </div>
          </div>
        )}

        {/* Last batch info */}
        {progress?.last_batch && (
          <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
            <Package className="h-3 w-3" />
            <span>
              Last batch: #{progress.last_batch.batch_number} — {BATCH_STATUS_LABEL[progress.last_batch.status] ?? progress.last_batch.status}
            </span>
          </div>
        )}

        {/* Delete */}
        <div className="mt-3 pt-2 border-t border-border">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-destructive">Delete channel and all videos?</span>
              <Button size="xs" variant="destructive" onClick={() => { onDelete(channel); setConfirmDelete(false); }}>
                Yes, delete
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3 w-3" />
              <span>Delete</span>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Main page ----------

interface ScrapeResultPayload {
  videos: Array<{
    id: string;
    title: string;
    url: string;
    thumbnail: string | null;
    duration: number | null;
    published_at: string | null;
  }>;
  total: number;
}

export default function ChannelsPage() {
  const { channels, loading, refresh } = useChannels();
  const [scrapeState, setScrapeState] = useState<ScrapeState | null>(null);
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);
  const [progressMap, setProgressMap] = useState<Map<string, ChannelProgress>>(new Map());
  const [recoveryBatches, setRecoveryBatches] = useState<Batch[]>([]);

  // Load stats and progress
  const loadStats = useCallback(async () => {
    const [stats, progress, recovery] = await Promise.all([
      getGlobalStats(),
      getAllChannelProgress(),
      getPausedOrActiveBatches(),
    ]);
    setGlobalStats(stats);
    setProgressMap(progress);
    setRecoveryBatches(recovery);
  }, []);

  useEffect(() => {
    if (!loading) loadStats();
  }, [loading, loadStats]);

  const handleRefresh = useCallback(async () => {
    await refresh();
    await loadStats();
  }, [refresh, loadStats]);

  const handleDelete = useCallback(async (channel: Channel) => {
    await deleteChannel(channel.id);
    await handleRefresh();
  }, [handleRefresh]);

  const handleScrape = useCallback(
    async (channel: Channel) => {
      setScrapeState({ channelId: channel.id, progress: "Starting scan..." });
      await updateChannel(channel.id, { status: "scrapeando" });
      await refresh();

      const unlisten = await listen<{ message: string }>("scrape-progress", (event) => {
        setScrapeState((prev) => (prev ? { ...prev, progress: event.payload.message } : null));
      });

      try {
        const result = await invoke<ScrapeResultPayload>("scrape_channel", { channelUrl: channel.url });

        const videoInserts: VideoInsert[] = result.videos.map((v) => ({
          id: v.id, channel_id: channel.id, title: v.title, url: v.url,
          thumbnail: v.thumbnail, duration: v.duration, published_at: v.published_at,
        }));

        const inserted = await addVideoBulk(videoInserts);
        await updateChannel(channel.id, { status: "scrapeado", scraped: true, total_videos: inserted });
        await handleRefresh();
      } catch (err) {
        console.error("Scrape failed:", err);
        await updateChannel(channel.id, { status: "error", notes: err instanceof Error ? err.message : String(err) });
        await handleRefresh();
      } finally {
        unlisten();
        setScrapeState(null);
      }
    },
    [refresh, handleRefresh]
  );

  if (loading) {
    return (
      <>
        <PageHeader title="Channels" description="YouTube channel pipeline for transcription" />
        <div className="grid grid-cols-6 gap-3 mb-6">
          {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="pt-4">
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Channels" description="YouTube channel pipeline for transcription" />

      {/* Recovery banner */}
      <RecoveryBanner batches={recoveryBatches} />

      {/* Global stats */}
      <GlobalStatsBar stats={globalStats} />

      {/* Add channel form */}
      <div className="mb-6">
        <AddChannelForm onAdd={handleRefresh} />
      </div>

      {/* Channel grid */}
      {channels.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No channels yet. Add one above to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {channels.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              progress={progressMap.get(channel.id)}
              scrapeState={scrapeState?.channelId === channel.id ? scrapeState : null}
              onScrape={handleScrape}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </>
  );
}
