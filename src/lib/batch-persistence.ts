// Global, page-independent persistence for batch transcription events.
//
// WHY THIS EXISTS (fix for the top audit finding): the Rust `process_batch`
// command only EMITS "batch-event" events — it does not write transcriptions
// to the DB. Persistence used to live inside BatchViewPage's event listener,
// which is destroyed when the user navigates away; hours of transcription
// could be silently lost. This module registers ONE app-lifetime listener
// (mounted from the dashboard layout) that persists every video regardless
// of which page is open. Pages subscribe to lightweight callbacks for UI.

import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  getChannel,
  getDb,
  getSetting,
  recalcBatchCounts,
  updateVideoStatus,
  updateVideoTranscription,
} from "@/lib/db";
import { updateChannelBrainChunked } from "@/lib/brain-batch";
import { sendNotification } from "@/lib/notifications";

export const EXPORT_DIR_KEY = "export_dir";
export const DEFAULT_EXPORT_DIR = "/Users/openclaw/Documents/trading-knowledge";

// Whisper: modelo e idioma configurables (settings SQLite). El backend Rust ya
// aceptaba `model`/`language` opcionales pero la UI nunca los pasaba (siempre
// corría small + autodetección).
export const WHISPER_MODEL_KEY = "whisper_model";
export const WHISPER_LANGUAGE_KEY = "whisper_language";

export async function getWhisperOpts(): Promise<{ model: string | null; language: string | null }> {
  const [model, language] = await Promise.all([
    getSetting(WHISPER_MODEL_KEY),
    getSetting(WHISPER_LANGUAGE_KEY),
  ]);
  return {
    model: model || null, // null → default del backend ("small")
    language: language && language !== "auto" ? language : null, // null → autodetectar
  };
}

export interface BatchEventPayload {
  batch_id: number;
  video_id: string;
  event_type: string;
  message: string;
  percent?: number;
  text?: string;
  language?: string;
  method?: string;
}

// ---------- subscriptions (pages render status from these) ----------

export interface BrainStatus {
  flushing: boolean;
  message: string | null;
}

type BrainStatusCb = (s: BrainStatus) => void;
type PersistedCb = () => void;

const brainStatusCbs = new Set<BrainStatusCb>();
const persistedCbs = new Set<PersistedCb>();
let lastBrainStatus: BrainStatus = { flushing: false, message: null };

export function subscribeBrainStatus(cb: BrainStatusCb): () => void {
  brainStatusCbs.add(cb);
  cb(lastBrainStatus); // deliver current state on subscribe
  return () => {
    brainStatusCbs.delete(cb);
  };
}

/** Fires after each video is persisted to the DB (pages reload their data). */
export function subscribePersisted(cb: PersistedCb): () => void {
  persistedCbs.add(cb);
  return () => {
    persistedCbs.delete(cb);
  };
}

function emitBrain(s: BrainStatus) {
  lastBrainStatus = s;
  brainStatusCbs.forEach((cb) => cb(s));
}

function emitPersisted() {
  persistedCbs.forEach((cb) => cb());
}

// ---------- module state (survives page navigation) ----------

// Pending summary files per channelDir, flushed into CEREBRO.md once per batch.
const pendingBrain = new Map<string, string[]>();
// In-flight export+summarize promises; awaited before flushing the brain.
let inflightExports: Promise<unknown>[] = [];

// Export + summarize one video, WITHOUT updating CEREBRO.md.
// The brain is updated once per batch (see flushPendingBrain) to avoid paying
// the ~4min-per-video CEREBRO rewrite cost on every video.
export async function exportAndSummarizeVideo(
  videoId: string,
  text: string,
  method: string,
  language: string,
): Promise<{ channelDir: string; filePaths: string[] } | null> {
  try {
    const db = await getDb();
    const rows = await db.select<
      { channel_id: string; title: string; url: string; duration: number | null; published_at: string | null; tags: string | null }[]
    >(
      "SELECT channel_id, title, url, duration, published_at, tags FROM videos WHERE id = $1",
      [videoId]
    );
    const v = rows[0];
    if (!v) return null;

    const [channel, dir] = await Promise.all([
      getChannel(v.channel_id),
      getSetting(EXPORT_DIR_KEY).then((val) => val ?? DEFAULT_EXPORT_DIR),
    ]);
    if (!channel) return null;

    const exportRes = await invoke<{ exported_files: string[]; output_dir: string }>("export_channel", {
      request: {
        channel_name: channel.name,
        channel_handle: channel.handle,
        channel_url: channel.url,
        output_dir: dir,
        videos: [{
          id: videoId,
          title: v.title,
          url: v.url,
          duration: v.duration,
          published_at: v.published_at,
          language: language,
          transcription_method: method,
          full_text: text,
          tags: v.tags,
        }],
      },
    });

    const summarized: string[] = [];
    for (const filePath of exportRes.exported_files) {
      try {
        await invoke("summarize_video", { filePath });
        summarized.push(filePath);
      } catch (sumErr) {
        console.error("Summary failed for", videoId, sumErr);
      }
    }
    if (summarized.length === 0) return null;
    return { channelDir: exportRes.output_dir, filePaths: summarized };
  } catch (err) {
    console.error("Auto-export failed for video", videoId, err);
    return null;
  }
}

async function persistVideoDone(batchId: number, videoId: string, text: string, method: string, language: string) {
  try {
    await updateVideoTranscription(videoId, { full_text: text, transcription_method: method, language });
    await recalcBatchCounts(batchId);
    emitPersisted();
  } catch (err) {
    console.error("Failed to persist video transcription:", err);
  }
}

async function persistVideoError(batchId: number, videoId: string, message: string) {
  try {
    await updateVideoStatus(videoId, "error", message);
    await recalcBatchCounts(batchId);
    emitPersisted();
  } catch (err) {
    console.error("Failed to persist video error:", err);
  }
}

// Wait for pending export+summarize tasks, then integrate all buffered
// summaries into CEREBRO.md in chunks (one Claude call per chunk, sequential).
async function flushPendingBrain() {
  const inflight = inflightExports;
  inflightExports = [];
  if (inflight.length > 0) {
    await Promise.allSettled(inflight);
  }
  const entries = Array.from(pendingBrain.entries());
  pendingBrain.clear();
  if (entries.length === 0) return;

  emitBrain({ flushing: true, message: null });
  let lastMsg: string | null = null;
  try {
    for (const [channelDir, files] of entries) {
      if (files.length === 0) continue;
      const run = await updateChannelBrainChunked(channelDir, files, {
        onProgress: (msg) => emitBrain({ flushing: true, message: msg }),
      });
      if (run.failedChunk) {
        lastMsg =
          `Brain chunk ${run.failedChunk.index}/${run.chunksTotal} failed ` +
          `(${run.failedChunk.size} files). ${run.chunksCompleted} chunk(s) ` +
          `integrated, ${run.filesIntegrated} file(s) merged. Remaining chunks skipped.`;
        console.error("Brain chunk failed", run.failedChunk, "for", channelDir);
        break;
      }
      lastMsg =
        `Brain updated: ${run.chunksCompleted}/${run.chunksTotal} chunk(s), ` +
        `${run.filesIntegrated}/${run.filesAttempted} file(s) integrated ` +
        `in ${(run.durationMs / 1000).toFixed(1)}s.`;
      emitBrain({ flushing: true, message: lastMsg });
    }
  } finally {
    emitBrain({ flushing: false, message: lastMsg });
  }
}

// ---------- init (singleton, mounted once from the dashboard layout) ----------

let started = false;

export function initBatchPersistence(): void {
  if (started) return;
  started = true;

  listen<BatchEventPayload>("batch-event", (event) => {
    const e = event.payload;
    switch (e.event_type) {
      case "video_done":
        if (e.text && e.language && e.method) {
          // Register the export promise SYNCHRONOUSLY (before any await):
          // batch_done can arrive right after the last video_done, and
          // flushPendingBrain must see this export in inflightExports.
          const p = exportAndSummarizeVideo(e.video_id, e.text, e.method, e.language)
            .then((res) => {
              if (!res) return;
              const existing = pendingBrain.get(res.channelDir) ?? [];
              pendingBrain.set(res.channelDir, existing.concat(res.filePaths));
            })
            .catch((err) => console.error("Export+summarize failed for", e.video_id, err));
          inflightExports.push(p);
          void persistVideoDone(e.batch_id, e.video_id, e.text, e.method, e.language);
        } else {
          void persistVideoError(e.batch_id, e.video_id,
            "Transcripción sin texto/idioma/método (payload incompleto)");
        }
        break;

      case "video_error":
        void persistVideoError(e.batch_id, e.video_id, e.message);
        break;

      case "batch_done":
      case "batch_pausado":
      case "batch_cancelado":
        if (e.event_type === "batch_done") {
          void sendNotification("Lote terminado ✅", e.message || "Todas las transcripciones del lote acabaron.");
        }
        void flushPendingBrain()
          .then(() => {
            if (e.event_type === "batch_done" && lastBrainStatus.message) {
              void sendNotification("CEREBRO actualizado 🧠", lastBrainStatus.message);
            }
          });
        break;
    }
  }).catch((err) => {
    started = false;
    console.error("Failed to register global batch-event listener:", err);
  });
}
