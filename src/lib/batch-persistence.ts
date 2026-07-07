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
  addPendingBrainFiles,
  deletePendingBrainFiles,
  getChannel,
  getDb,
  getSetting,
  listPendingBrainFiles,
  recalcBatchCounts,
  updateVideoStatus,
  updateVideoTranscription,
} from "@/lib/db";
import { BRAIN_BATCH_CHUNK_SIZE, updateChannelBrainChunked } from "@/lib/brain-batch";
import { sendNotification } from "@/lib/notifications";

export const EXPORT_DIR_KEY = "export_dir";
// La base de conocimiento se movió a Documents/Conocimiento/ (jul-2026). Con el
// default viejo, un export sin setting recreaba la ruta vieja y PARTÍA la base.
export const DEFAULT_EXPORT_DIR = "/Users/openclaw/Documents/Conocimiento/trading-knowledge";

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

// Pending summary files live in SQLite (`pending_brain_files`), NOT in memory:
// if the app closes/crashes between summarize and the brain flush, the queue
// survives and the startup flush recovers it. In-memory state here is only
// the in-flight export+summarize promises, awaited before flushing.
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
    // El transcript ya vive en SQLite: su copia de respaldo en el spool sobra.
    void invoke("discard_spooled_transcript", { videoId }).catch(() => {});
    emitPersisted();
  } catch (err) {
    console.error("Failed to persist video transcription:", err);
  }
}

// Ingesta completa de una transcripción terminada — usada tanto por el evento
// video_done como por la recuperación del spool al arrancar. El registro del
// export es SÍNCRONO (antes de cualquier await): batch_done puede llegar justo
// después del último video_done y flushPendingBrain debe verlo en inflightExports.
function ingestTranscript(batchId: number, videoId: string, text: string, method: string, language: string) {
  const p = exportAndSummarizeVideo(videoId, text, method, language)
    .then((res) => {
      if (!res) return;
      // A SQLite, no a memoria: sobrevive cierre/crash de la app.
      return addPendingBrainFiles(res.channelDir, res.filePaths);
    })
    .catch((err) => console.error("Export+summarize failed for", videoId, err));
  inflightExports.push(p);
  void persistVideoDone(batchId, videoId, text, method, language);
}

// Transcripts que el backend Rust dejó en el spool y nunca llegaron a SQLite
// (webview recargado o app cerrada justo en el video_done): re-ingestarlos.
async function recoverSpooledTranscripts(): Promise<void> {
  try {
    const spooled = await invoke<
      { batch_id: number; video_id: string; text: string; language: string; method: string }[]
    >("read_spooled_transcripts");
    if (spooled.length === 0) return;
    console.log(`[batch-persistence] recovering ${spooled.length} spooled transcript(s) from previous session`);
    for (const t of spooled) {
      ingestTranscript(t.batch_id, t.video_id, t.text, t.method, t.language);
    }
  } catch (err) {
    console.error("Failed to read spooled transcripts:", err);
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

// Wait for pending export+summarize tasks, then integrate all queued
// summaries into CEREBRO.md in chunks (one Claude call per chunk, sequential).
// Reads the queue from SQLite; rows are deleted only AFTER their chunk was
// integrated, so a crash or failure keeps them queued for the next flush
// (re-integrating an already-merged file is cheap: the Python side skips it
// by video label). Returns the final status message of THIS run (or null if
// nothing was integrated) so callers never notify with a stale message.
let flushInProgress = false;
let flushQueued = false;

async function flushPendingBrain(): Promise<string | null> {
  if (flushInProgress) {
    // A flush is already draining the queue; make it loop once more so rows
    // added meanwhile are picked up.
    flushQueued = true;
    return null;
  }
  flushInProgress = true;
  let lastMsg: string | null = null;
  try {
    do {
      flushQueued = false;
      const inflight = inflightExports;
      inflightExports = [];
      if (inflight.length > 0) {
        await Promise.allSettled(inflight);
      }

      const rows = await listPendingBrainFiles();
      if (rows.length === 0) continue;

      const byChannel = new Map<string, string[]>();
      for (const r of rows) {
        const existing = byChannel.get(r.channel_dir) ?? [];
        existing.push(r.file_path);
        byChannel.set(r.channel_dir, existing);
      }

      emitBrain({ flushing: true, message: null });
      for (const [channelDir, files] of byChannel) {
        try {
          const run = await updateChannelBrainChunked(channelDir, files, {
            onProgress: (msg) => emitBrain({ flushing: true, message: msg }),
          });
          // Chunks run in order over `files`, so on a partial failure exactly
          // the first chunksCompleted*CHUNK_SIZE files were integrated.
          const integrated = run.failedChunk
            ? files.slice(0, run.chunksCompleted * BRAIN_BATCH_CHUNK_SIZE)
            : files;
          await deletePendingBrainFiles(integrated);
          if (run.failedChunk) {
            lastMsg =
              `Brain chunk ${run.failedChunk.index}/${run.chunksTotal} failed ` +
              `(${run.failedChunk.size} files). ${run.chunksCompleted} chunk(s) ` +
              `integrated, ${run.filesIntegrated} file(s) merged. ` +
              `${files.length - integrated.length} file(s) stay queued for retry.`;
            console.error("Brain chunk failed", run.failedChunk, "for", channelDir);
          } else {
            lastMsg =
              `Brain updated: ${run.chunksCompleted}/${run.chunksTotal} chunk(s), ` +
              `${run.filesIntegrated}/${run.filesAttempted} file(s) integrated ` +
              `in ${(run.durationMs / 1000).toFixed(1)}s.`;
            emitBrain({ flushing: true, message: lastMsg });
          }
        } catch (err) {
          // Unexpected throw (not a failedChunk result): keep this channel's
          // rows queued and continue with the remaining channels.
          console.error("Brain update failed for", channelDir, err);
          lastMsg =
            `Brain update failed for ${channelDir}: ` +
            `${err instanceof Error ? err.message : String(err)} — ` +
            `${files.length} file(s) stay queued for retry.`;
        }
      }
    } while (flushQueued);
  } finally {
    flushInProgress = false;
    emitBrain({ flushing: false, message: lastMsg });
  }
  return lastMsg;
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
          ingestTranscript(e.batch_id, e.video_id, e.text, e.method, e.language);
        } else {
          void persistVideoError(e.batch_id, e.video_id,
            "Transcripción sin texto/idioma/método (payload incompleto)");
        }
        break;

      case "video_error":
        void persistVideoError(e.batch_id, e.video_id, e.message);
        break;

      case "video_requeued":
        // Video interrumpido por pause/cancel (el backend mató el proceso):
        // vuelve a la cola, NO es un error.
        void updateVideoStatus(e.video_id, "en_cola")
          .then(() => recalcBatchCounts(e.batch_id))
          .then(() => emitPersisted())
          .catch((err) => console.error("Failed to requeue video", e.video_id, err));
        break;

      case "batch_done":
      case "batch_pausado":
      case "batch_cancelado":
        if (e.event_type === "batch_done") {
          void sendNotification("Lote terminado ✅", e.message || "Todas las transcripciones del lote acabaron.");
        }
        void flushPendingBrain()
          .then((msg) => {
            // Usar el mensaje de ESTE flush (no lastBrainStatus, que puede
            // conservar el de un lote anterior si este flush no integró nada).
            if (e.event_type === "batch_done" && msg) {
              void sendNotification("CEREBRO actualizado 🧠", msg);
            }
          })
          .catch((err) => console.error("Brain flush failed after batch event:", err));
        break;
    }
  }).then(() => {
    // Recuperación al arrancar, en orden: (1) transcripts que quedaron en el
    // spool sin llegar a SQLite, (2) resúmenes en cola sin integrar al CEREBRO.
    // recoverSpooledTranscripts registra sus exports en inflightExports, así
    // que el flush posterior también integra lo recién recuperado.
    recoverSpooledTranscripts()
      .then(() => flushPendingBrain())
      .then((msg) => {
        if (msg) {
          void sendNotification("CEREBRO actualizado 🧠", `Recuperado de la sesión anterior — ${msg}`);
        }
      })
      .catch((err) => console.error("Startup brain recovery flush failed:", err));
  }, (err) => {
    // Solo el fallo del REGISTRO del listener habilita el reintento; un fallo
    // del flush de arriba no debe permitir registrar un segundo listener.
    started = false;
    console.error("Failed to register global batch-event listener:", err);
  });
}
