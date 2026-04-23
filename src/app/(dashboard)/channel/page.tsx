"use client";

import { Suspense, useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { useVideos } from "@/hooks/use-videos";
import { useBatches } from "@/hooks/use-batches";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  type Channel,
  type Batch,
  type Video,
  getChannel,
  hasActiveBatch,
  createBatchWithVideos,
  getCompletedVideosWithText,
  getSetting,
  setSetting,
  updateVideoStatus,
  updateVideoTranscription,
} from "@/lib/db";
import { updateChannelBrainChunked } from "@/lib/brain-batch";
import {
  ArrowLeft,
  Search,
  CheckSquare,
  Square,
  MinusSquare,
  Ban,
  RotateCcw,
  Package,
  Video as VideoIcon,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  FolderOpen,
  ExternalLink,
  SkipForward,
  RefreshCw,
  X,
} from "lucide-react";

// ---------- Constants ----------

const PAGE_SIZE = 50;

type DurationFilter = "all" | "short" | "medium" | "long";
type DateFilter = "all" | "30d" | "3m" | "6m" | "1y";
type StatusFilter = "all" | "pendiente" | "en_cola" | "transcribiendo" | "completado" | "error" | "omitido";
type SortField = "title" | "duration" | "date" | "status";
type SortDir = "asc" | "desc";

const DURATION_OPTIONS: { value: DurationFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "short", label: "<5 min" },
  { value: "medium", label: "5-30 min" },
  { value: "long", label: ">30 min" },
];

const DATE_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "30d", label: "30 days" },
  { value: "3m", label: "3 months" },
  { value: "6m", label: "6 months" },
  { value: "1y", label: "1 year" },
];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pendiente", label: "Pending" },
  { value: "en_cola", label: "Queued" },
  { value: "transcribiendo", label: "Processing" },
  { value: "completado", label: "Completed" },
  { value: "error", label: "Error" },
  { value: "omitido", label: "Skipped" },
];

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pendiente: { label: "Pending", variant: "outline" },
  en_cola: { label: "Queued", variant: "default" },
  transcribiendo: { label: "Processing", variant: "default" },
  completado: { label: "Completed", variant: "secondary" },
  error: { label: "Error", variant: "destructive" },
  omitido: { label: "Skipped", variant: "outline" },
};

// ---------- Helpers ----------

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "--";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}:${String(rm).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "--";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getDateCutoff(filter: DateFilter): Date | null {
  if (filter === "all") return null;
  const now = new Date();
  switch (filter) {
    case "30d": return new Date(now.getTime() - 30 * 86400000);
    case "3m": return new Date(now.getTime() - 90 * 86400000);
    case "6m": return new Date(now.getTime() - 180 * 86400000);
    case "1y": return new Date(now.getTime() - 365 * 86400000);
  }
}

function matchesDuration(video: Video, filter: DurationFilter): boolean {
  if (filter === "all") return true;
  const d = video.duration;
  if (d == null) return filter === "short";
  switch (filter) {
    case "short": return d < 300;
    case "medium": return d >= 300 && d <= 1800;
    case "long": return d > 1800;
  }
}

// ---------- Filter bar ----------

function FilterBar({
  search, onSearch,
  duration, onDuration,
  date, onDate,
  status, onStatus,
  onClear,
}: {
  search: string; onSearch: (v: string) => void;
  duration: DurationFilter; onDuration: (v: DurationFilter) => void;
  date: DateFilter; onDate: (v: DateFilter) => void;
  status: StatusFilter; onStatus: (v: StatusFilter) => void;
  onClear: () => void;
}) {
  const hasFilters = search !== "" || duration !== "all" || date !== "all" || status !== "all";

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search videos..."
          className="pl-8 w-56"
        />
      </div>
      <FilterSelect label="Duration" options={DURATION_OPTIONS} value={duration} onChange={onDuration} />
      <FilterSelect label="Date" options={DATE_OPTIONS} value={date} onChange={onDate} />
      <FilterSelect label="Status" options={STATUS_OPTIONS} value={status} onChange={onStatus} />
      {hasFilters && (
        <Button size="sm" variant="ghost" onClick={onClear} className="text-muted-foreground">
          <X className="h-3.5 w-3.5" />
          <span>Clear</span>
        </Button>
      )}
    </div>
  );
}

function FilterSelect<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-8 appearance-none rounded-lg border border-input bg-transparent px-2.5 pr-7 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {label}: {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
    </div>
  );
}

// ---------- Stats bar ----------

function ChannelStats({ statusCounts, total }: { statusCounts: Record<string, number>; total: number }) {
  const pending = statusCounts["pendiente"] ?? 0;
  const queued = statusCounts["en_cola"] ?? 0;
  const completed = statusCounts["completado"] ?? 0;
  const errors = statusCounts["error"] ?? 0;
  const skipped = statusCounts["omitido"] ?? 0;

  const stats = [
    { label: "Total", value: total, icon: VideoIcon },
    { label: "Pending", value: pending, icon: Clock },
    { label: "Queued", value: queued, icon: Package },
    { label: "Completed", value: completed, icon: CheckCircle2 },
    { label: "Errors", value: errors, icon: AlertCircle },
    { label: "Skipped", value: skipped, icon: SkipForward },
  ];

  return (
    <div className="grid grid-cols-6 gap-3 mb-6">
      {stats.map((s) => (
        <div key={s.label} className="flex items-center gap-2.5 rounded-lg border border-border bg-card p-3">
          <s.icon className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-base font-semibold font-mono">{s.value}</p>
            <p className="text-[10px] text-muted-foreground">{s.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Sortable header ----------

function SortableHeader({
  field, label, current, dir, onSort, className,
}: {
  field: SortField; label: string; current: SortField; dir: SortDir;
  onSort: (f: SortField) => void; className?: string;
}) {
  const active = current === field;
  return (
    <th className={`px-3 py-2 text-xs font-medium text-muted-foreground ${className ?? ""}`}>
      <button
        className="flex items-center gap-1 hover:text-foreground transition-colors"
        onClick={() => onSort(field)}
      >
        <span>{label}</span>
        {active
          ? (dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
          : <ArrowUpDown className="h-3 w-3 opacity-30" />
        }
      </button>
    </th>
  );
}

// ---------- Video row ----------

function VideoRow({
  video,
  index,
  selected,
  onToggle,
  onRetranscribe,
  retranscribing,
}: {
  video: Video;
  index: number;
  selected: boolean;
  onToggle: (id: string) => void;
  onRetranscribe: (video: Video) => void;
  retranscribing: boolean;
}) {
  const badge = STATUS_BADGE[video.status] ?? { label: video.status, variant: "outline" as const };
  const canRetranscribe = video.status === "completado" || video.status === "error" || video.status === "omitido";

  return (
    <tr
      className={`border-b border-border transition-colors hover:bg-muted/30 ${selected ? "bg-primary/5" : ""}`}
      onClick={() => onToggle(video.id)}
    >
      <td className="px-3 py-2.5 w-10">
        <button onClick={(e) => { e.stopPropagation(); onToggle(video.id); }} className="text-muted-foreground hover:text-foreground">
          {selected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
        </button>
      </td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground w-10 font-mono">{index + 1}</td>
      <td className="px-3 py-2.5 text-sm max-w-md">
        <div className="flex items-center gap-1.5">
          <span className="line-clamp-1 flex-1" title={video.title}>{video.title}</span>
          <a
            href={video.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:text-foreground shrink-0"
            title="Open in YouTube"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground font-mono w-20">{formatDuration(video.duration)}</td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground w-28">{formatDate(video.published_at)}</td>
      <td className="px-3 py-2.5 w-28">
        <div title={video.status === "error" && video.error_message ? video.error_message : undefined}>
          <Badge variant={badge.variant}>{badge.label}</Badge>
          {video.status === "error" && video.error_message && (
            <p className="text-[9px] text-destructive mt-0.5 line-clamp-1">{video.error_message}</p>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground font-mono w-16">
        {video.batch_number != null ? `#${video.batch_number}` : "--"}
      </td>
      <td className="px-3 py-2.5 w-12">
        {canRetranscribe && (
          <button
            onClick={(e) => { e.stopPropagation(); onRetranscribe(video); }}
            disabled={retranscribing}
            className="text-muted-foreground hover:text-primary disabled:opacity-50"
            title="Re-transcribe"
          >
            {retranscribing
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />
            }
          </button>
        )}
      </td>
    </tr>
  );
}

// ---------- Bulk actions ----------

function BulkActions({
  selectedCount,
  filteredCount,
  allSelected,
  onSelectAll,
  onSkip,
  onRestore,
}: {
  selectedCount: number;
  filteredCount: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onSkip: () => void;
  onRestore: () => void;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Button size="sm" variant="ghost" onClick={onSelectAll}>
        {allSelected ? <MinusSquare className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}
        <span>{allSelected ? "Deselect all" : "Select all"}</span>
      </Button>
      {selectedCount > 0 && (
        <>
          <span className="text-xs text-muted-foreground">
            {selectedCount} of {filteredCount} selected
          </span>
          <div className="h-4 w-px bg-border mx-1" />
          <Button size="sm" variant="outline" onClick={onSkip}>
            <Ban className="h-3.5 w-3.5" />
            <span>Skip</span>
          </Button>
          <Button size="sm" variant="outline" onClick={onRestore}>
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Restore</span>
          </Button>
        </>
      )}
    </div>
  );
}

// ---------- Batch creation panel ----------

function BatchPanel({
  channelId,
  selectedIds,
  onCreated,
  getNextPending,
}: {
  channelId: string;
  selectedIds: Set<string>;
  onCreated: (batchId: number) => void;
  getNextPending: (limit: number) => Promise<Video[]>;
}) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createFromSelection = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await doCreate(channelId, ids, onCreated, setCreating, setError);
  }, [channelId, selectedIds, onCreated]);

  const createQuick = useCallback(async (n: number) => {
    const videos = await getNextPending(n);
    if (videos.length === 0) {
      setError("No pending videos available");
      return;
    }
    await doCreate(channelId, videos.map(v => v.id), onCreated, setCreating, setError);
  }, [channelId, getNextPending, onCreated]);

  return (
    <div className="rounded-lg border border-border bg-card p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Package className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Create Batch</h3>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground mr-1">Quick:</span>
        {[10, 20, 50].map((n) => (
          <Button key={n} size="sm" variant="outline" disabled={creating} onClick={() => createQuick(n)}>
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            <span>Next {n} pending</span>
          </Button>
        ))}

        <div className="h-4 w-px bg-border mx-1" />

        <Button
          size="sm"
          disabled={creating || selectedIds.size === 0}
          onClick={createFromSelection}
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
          <span>Create from selection ({selectedIds.size})</span>
        </Button>
      </div>

      {selectedIds.size > 50 && (
        <p className="text-xs text-warning mt-2">
          Warning: Selecting more than 50 videos per batch is not recommended. Consider 20-30 for optimal processing.
        </p>
      )}

      {error && (
        <p className="text-xs text-destructive mt-2">{error}</p>
      )}
    </div>
  );
}

async function doCreate(
  channelId: string,
  videoIds: string[],
  onCreated: (batchId: number) => void,
  setCreating: (v: boolean) => void,
  setError: (v: string | null) => void,
) {
  setCreating(true);
  setError(null);
  try {
    const active = await hasActiveBatch(channelId);
    if (active) {
      setError("There's already an active batch for this channel. Finish or cancel it first.");
      return;
    }
    const { batchId } = await createBatchWithVideos(channelId, videoIds);
    onCreated(batchId);
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  } finally {
    setCreating(false);
  }
}

// ---------- Batch list ----------

const BATCH_STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  preparado: { label: "Ready", variant: "outline" },
  procesando: { label: "Processing", variant: "default" },
  pausado: { label: "Paused", variant: "secondary" },
  completado: { label: "Completed", variant: "secondary" },
  cancelado: { label: "Cancelled", variant: "destructive" },
  fallido: { label: "Failed", variant: "destructive" },
};

function BatchList({ channelId, batches }: { channelId: string; batches: Batch[] }) {
  if (batches.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Package className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Batches</h3>
      </div>
      <div className="space-y-2">
        {batches.map((b) => {
          const badge = BATCH_STATUS_BADGE[b.status] ?? { label: b.status, variant: "outline" as const };
          const pct = b.total_videos > 0 ? Math.round(((b.completed_videos + b.failed_videos) / b.total_videos) * 100) : 0;
          return (
            <Link
              key={b.id}
              href={`/batch?channelId=${channelId}&batchId=${b.id}`}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono font-medium">#{b.batch_number}</span>
                <Badge variant={badge.variant}>{badge.label}</Badge>
                <span className="text-xs text-muted-foreground">
                  {b.completed_videos}/{b.total_videos} done
                  {b.failed_videos > 0 && `, ${b.failed_videos} failed`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-profit rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs text-muted-foreground font-mono">{pct}%</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Export button ----------

const EXPORT_DIR_KEY = "export_dir";
const DEFAULT_EXPORT_DIR = "/Users/openclaw/Documents/trading-knowledge";

function ExportButton({ channelId, channel }: { channelId: string; channel: Channel }) {
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [exportDir, setExportDir] = useState<string | null>(null);

  useEffect(() => {
    getSetting(EXPORT_DIR_KEY).then((val) => setExportDir(val ?? DEFAULT_EXPORT_DIR));
  }, []);

  const handleChangeDir = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select export folder",
      defaultPath: exportDir ?? DEFAULT_EXPORT_DIR,
    });
    if (selected) {
      await setSetting(EXPORT_DIR_KEY, selected);
      setExportDir(selected);
      setResult(`Export folder: ${selected}`);
    }
  }, [exportDir]);

  const handleExport = useCallback(async () => {
    const dir = exportDir ?? DEFAULT_EXPORT_DIR;
    setExporting(true);
    setResult(null);
    try {
      const videos = await getCompletedVideosWithText(channelId);
      if (videos.length === 0) {
        setResult("No completed transcriptions to export.");
        return;
      }

      const res = await invoke<{ exported: number; skipped: number; output_dir: string }>("export_channel", {
        request: {
          channel_name: channel.name,
          channel_handle: channel.handle,
          channel_url: channel.url,
          output_dir: dir,
          videos: videos.map(v => ({
            id: v.id,
            title: v.title,
            url: v.url,
            duration: v.duration,
            published_at: v.published_at,
            language: v.language,
            transcription_method: v.transcription_method,
            full_text: v.full_text ?? "",
            tags: v.tags,
          })),
        },
      });

      const skipMsg = res.skipped > 0 ? ` (${res.skipped} already exported)` : "";
      setResult(`Exported ${res.exported} new files${skipMsg}`);
    } catch (err) {
      setResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  }, [channelId, channel, exportDir]);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={handleChangeDir} title="Change export folder">
          <FolderOpen className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="outline" disabled={exporting} onClick={handleExport}>
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          <span>Export All</span>
        </Button>
      </div>
      {exportDir && (
        <p className="text-[10px] text-muted-foreground max-w-xs text-right truncate" title={exportDir}>
          {exportDir}
        </p>
      )}
      {result && (
        <p className={`text-[10px] max-w-xs text-right ${result.startsWith("Error") ? "text-destructive" : "text-profit"}`}>
          {result}
        </p>
      )}
    </div>
  );
}

// ---------- Main page ----------

export default function ChannelDetailPageWrapper() {
  return (
    <Suspense fallback={
      <>
        <Skeleton className="h-7 w-48 mb-2" />
        <Skeleton className="h-4 w-64 mb-6" />
        <div className="grid grid-cols-6 gap-3 mb-6">
          {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </div>
      </>
    }>
      <ChannelDetailPage />
    </Suspense>
  );
}

function ChannelDetailPage() {
  const searchParams = useSearchParams();
  const channelId = searchParams.get("id") ?? "";
  const router = useRouter();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [channelLoading, setChannelLoading] = useState(true);

  const { videos, loading, statusCounts, refresh, bulkSetStatus, getNextPending } = useVideos(channelId);
  const { batches, refresh: refreshBatches } = useBatches(channelId);

  // Filters
  const [search, setSearch] = useState("");
  const [durationFilter, setDurationFilter] = useState<DurationFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Sorting
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Pagination
  const [page, setPage] = useState(0);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Load channel info
  useEffect(() => {
    (async () => {
      setChannelLoading(true);
      const ch = await getChannel(channelId);
      setChannel(ch ?? null);
      setChannelLoading(false);
    })();
  }, [channelId]);

  // Filtered + sorted videos
  const filtered = useMemo(() => {
    const dateCutoff = getDateCutoff(dateFilter);
    const searchLower = search.toLowerCase();

    const result = videos.filter((v) => {
      if (searchLower && !v.title.toLowerCase().includes(searchLower)) return false;
      if (!matchesDuration(v, durationFilter)) return false;
      if (statusFilter !== "all" && v.status !== statusFilter) return false;
      if (dateCutoff && v.published_at) {
        if (new Date(v.published_at) < dateCutoff) return false;
      }
      return true;
    });

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "title": cmp = a.title.localeCompare(b.title); break;
        case "duration": cmp = (a.duration ?? 0) - (b.duration ?? 0); break;
        case "date": cmp = (a.published_at ?? "").localeCompare(b.published_at ?? ""); break;
        case "status": cmp = a.status.localeCompare(b.status); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [videos, search, durationFilter, dateFilter, statusFilter, sortField, sortDir]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paginatedVideos = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [search, durationFilter, dateFilter, statusFilter]);

  // Selection helpers
  const allSelected = filtered.length > 0 && filtered.every((v) => selected.has(v.id));

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((v) => v.id)));
    }
  }, [allSelected, filtered]);

  const handleSkip = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    await bulkSetStatus(ids, "omitido");
    setSelected(new Set());
  }, [selected, bulkSetStatus]);

  const handleRestore = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    await bulkSetStatus(ids, "pendiente");
    setSelected(new Set());
  }, [selected, bulkSetStatus]);

  const [retranscribing, setRetranscribing] = useState<string | null>(null);
  const [autoExportMsg, setAutoExportMsg] = useState<string | null>(null);

  const autoExport = useCallback(async (video: Video, fullText: string, language: string | null, method: string | null) => {
    if (!channel) return;
    const dir = (await getSetting(EXPORT_DIR_KEY)) ?? DEFAULT_EXPORT_DIR;
    try {
      const res = await invoke<{ exported: number; skipped: number; output_dir: string; exported_files: string[] }>("export_channel", {
        request: {
          channel_name: channel.name,
          channel_handle: channel.handle,
          channel_url: channel.url,
          output_dir: dir,
          videos: [{
            id: video.id,
            title: video.title,
            url: video.url,
            duration: video.duration,
            published_at: video.published_at,
            language: language,
            transcription_method: method,
            full_text: fullText,
            tags: video.tags,
          }],
        },
      });
      if (res.exported > 0) {
        setAutoExportMsg(`Exported — generating summary...`);
        const summarized: string[] = [];
        for (const filePath of res.exported_files) {
          try {
            await invoke("summarize_video", { filePath });
            summarized.push(filePath);
          } catch (err) {
            console.error("Summary failed:", err);
            setAutoExportMsg(`Exported (summary failed)`);
          }
        }
        if (summarized.length > 0) {
          setAutoExportMsg(`Summary ready — updating brain (chunked)...`);
          const run = await updateChannelBrainChunked(res.output_dir, summarized, {
            onProgress: (msg) => setAutoExportMsg(msg),
          });
          if (run.failedChunk) {
            setAutoExportMsg(
              `Brain chunk ${run.failedChunk.index}/${run.chunksTotal} failed ` +
              `(${run.failedChunk.size} files). ${run.chunksCompleted} chunk(s) ok.`,
            );
          } else {
            setAutoExportMsg(
              `Done: ${run.chunksCompleted}/${run.chunksTotal} chunk(s), ` +
              `${run.filesIntegrated} file(s) merged.`,
            );
          }
        }
      } else if (res.skipped > 0) {
        setAutoExportMsg(`File already existed at ${res.output_dir}`);
      }
      setTimeout(() => setAutoExportMsg(null), 10000);
    } catch (err) {
      console.error("Auto-export failed:", err);
    }
  }, [channel]);

  const handleRetranscribe = useCallback(async (video: Video) => {
    setRetranscribing(video.id);
    try {
      await updateVideoStatus(video.id, "transcribiendo");
      await refresh();

      const result = await invoke<{
        video_id: string;
        event_type: string;
        message: string;
        text?: string;
        language?: string;
        method?: string;
      }>("transcribe_single", {
        videoId: video.id,
        videoUrl: video.url,
      });

      if (result.text && result.language && result.method) {
        await updateVideoTranscription(video.id, {
          full_text: result.text,
          transcription_method: result.method,
          language: result.language,
        });
        await autoExport(video, result.text, result.language, result.method);
      }
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateVideoStatus(video.id, "error", msg);
      await refresh();
    } finally {
      setRetranscribing(null);
    }
  }, [refresh, autoExport]);

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "title" ? "asc" : "desc");
    }
  }, [sortField]);

  const clearFilters = useCallback(() => {
    setSearch("");
    setDurationFilter("all");
    setDateFilter("all");
    setStatusFilter("all");
  }, []);

  const handleBatchCreated = useCallback((batchId: number) => {
    setSelected(new Set());
    refresh();
    refreshBatches();
    router.push(`/batch?channelId=${channelId}&batchId=${batchId}`);
  }, [refresh, refreshBatches, channelId, router]);

  if (channelLoading) {
    return (
      <>
        <Skeleton className="h-7 w-48 mb-2" />
        <Skeleton className="h-4 w-64 mb-6" />
        <div className="grid grid-cols-5 gap-3 mb-6">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      </>
    );
  }

  if (!channel) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="h-8 w-8 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Channel not found.</p>
        <Link href="/">
          <Button size="sm" variant="ghost" className="mt-4">
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to channels</span>
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <Link href="/">
          <Button size="icon-sm" variant="ghost">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <PageHeader
            title={channel.name}
            description={`${channel.handle ?? channel.url} — ${channel.total_videos} videos`}
          />
        </div>
        <ExportButton channelId={channelId} channel={channel} />
      </div>

      {autoExportMsg && (
        <div className="mb-3 rounded-md border border-profit/30 bg-profit/5 px-3 py-2 text-xs text-profit">
          {autoExportMsg}
        </div>
      )}

      {/* Stats */}
      <ChannelStats statusCounts={statusCounts} total={videos.length} />

      {/* Existing batches */}
      <BatchList channelId={channelId} batches={batches} />

      {/* Batch creation */}
      <BatchPanel
        channelId={channelId}
        selectedIds={selected}
        onCreated={handleBatchCreated}
        getNextPending={getNextPending}
      />

      {/* Filters */}
      <FilterBar
        search={search} onSearch={setSearch}
        duration={durationFilter} onDuration={setDurationFilter}
        date={dateFilter} onDate={setDateFilter}
        status={statusFilter} onStatus={setStatusFilter}
        onClear={clearFilters}
      />

      {/* Bulk actions */}
      <BulkActions
        selectedCount={selected.size}
        filteredCount={filtered.length}
        allSelected={allSelected}
        onSelectAll={toggleAll}
        onSkip={handleSkip}
        onRestore={handleRestore}
      />

      {/* Video table */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-10 w-full rounded" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
          <VideoIcon className="h-6 w-6 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            {videos.length === 0 ? "No videos yet." : "No videos match your filters."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-3 py-2 w-10">
                    <button onClick={toggleAll} className="text-muted-foreground hover:text-foreground">
                      {allSelected
                        ? <CheckSquare className="h-4 w-4 text-primary" />
                        : selected.size > 0
                          ? <MinusSquare className="h-4 w-4" />
                          : <Square className="h-4 w-4" />
                      }
                    </button>
                  </th>
                  <th className="px-3 py-2 text-xs font-medium text-muted-foreground w-10">#</th>
                  <SortableHeader field="title" label="Title" current={sortField} dir={sortDir} onSort={handleSort} />
                  <SortableHeader field="duration" label="Duration" current={sortField} dir={sortDir} onSort={handleSort} className="w-20" />
                  <SortableHeader field="date" label="Date" current={sortField} dir={sortDir} onSort={handleSort} className="w-28" />
                  <SortableHeader field="status" label="Status" current={sortField} dir={sortDir} onSort={handleSort} className="w-28" />
                  <th className="px-3 py-2 text-xs font-medium text-muted-foreground w-16">Batch</th>
                  <th className="px-3 py-2 text-xs font-medium text-muted-foreground w-12"></th>
                </tr>
              </thead>
              <tbody>
                {paginatedVideos.map((video, i) => (
                  <VideoRow
                    key={video.id}
                    video={video}
                    index={safePage * PAGE_SIZE + i}
                    selected={selected.has(video.id)}
                    onToggle={toggleOne}
                    onRetranscribe={handleRetranscribe}
                    retranscribing={retranscribing === video.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border bg-muted/30 px-3 py-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {filtered.length === videos.length
                ? `${filtered.length} videos`
                : `${filtered.length} of ${videos.length} videos`}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs text-muted-foreground font-mono px-2">
                  {safePage + 1} / {totalPages}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
