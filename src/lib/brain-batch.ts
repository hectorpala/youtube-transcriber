import { invoke } from "@tauri-apps/api/core";

// Default number of summary files per Claude call. Keep conservative to bound
// prompt size (CEREBRO.md + N summaries + instructions) and timeout risk.
// Safe range empirically: 5–20. Increase only after validating against a larger CEREBRO.
export const BRAIN_BATCH_CHUNK_SIZE = 10;

// Brain update strategy.
// - "batch": Claude rewrites full CEREBRO.md per chunk (slow, proven). Safe default.
// - "delta": Claude emits a JSON patch, Python applies locally (5× faster, less output).
//           On any failure or suspicion the helper auto-falls-back to "batch" for that chunk.
// Change this default only after validating delta over many runs.
export type BrainUpdateMode = "batch" | "delta";
export const BRAIN_UPDATE_MODE: BrainUpdateMode = "batch";

// ---------- Result types for each backend command ----------

export interface BrainBatchChunkResult {
  brain_file: string;
  action: string;
  total_files: number;
  processed_files: number;
  skipped_files: number;
  total_summary_chars: number;
  cerebro_bytes_before: number;
  cerebro_bytes_after: number;
  delta_bytes: number;
  claude_ms: number;
  duration_ms: number;
}

export interface BrainDeltaApplyReport {
  applied: number;
  target_missing: number;
  sections_missing: number;
  invalid_ops: number;
  ambiguous_targets: number;
  total_ops: number;
  video_sources_added: number;
}

export interface BrainDeltaChunkResult {
  brain_file: string;
  action: string;
  total_files: number;
  processed_files: number;
  skipped_files: number;
  cerebro_bytes_before: number;
  cerebro_bytes_after: number;
  delta_bytes: number;
  prompt_bytes: number;
  response_bytes: number;
  claude_ms: number;
  apply_ms: number;
  duration_ms: number;
  apply_report?: BrainDeltaApplyReport;
}

export type BrainChunkResult = BrainBatchChunkResult | BrainDeltaChunkResult;

export interface BrainBatchChunkRun {
  index: number;
  size: number;
  durationMs: number;
  modeUsed: BrainUpdateMode;
  fallbackTriggered: boolean;
  fallbackReason?: string;
  result?: BrainChunkResult;
  error?: string;
}

export interface ChunkedBrainRunResult {
  chunksTotal: number;
  chunksCompleted: number;
  filesAttempted: number;
  filesIntegrated: number;
  durationMs: number;
  fallbacks: number;
  perChunk: BrainBatchChunkRun[];
  failedChunk?: { index: number; size: number; error: string };
}

export interface ChunkedBrainOpts {
  chunkSize?: number;
  mode?: BrainUpdateMode;
  onProgress?: (msg: string) => void;
}

// ---------- Single-flight lock per channel_dir ----------
//
// Two concurrent brain updates for the same CEREBRO.md are unsafe: each chunk
// does read-modify-write on the file via atomic_write, and a second flush can
// overwrite the first's integration without ever reading it. We observed this
// live — a delta run and its batch fallback raced against a second delta run
// for a different batch on the same channel, and the last os.replace won.
//
// Fix: keep a module-level Map<channelDir, Promise>. New calls chain onto the
// tail of the channel's in-flight promise, so they only start AFTER the
// predecessor resolves (success or failure). Different channels remain
// parallelizable — only same-channel work serializes.
//
// Scope is per-webview-process. Survives component unmounts within the same
// app session. Does NOT persist across app restarts — that's fine, no child
// processes survive the restart either.

const inflightByChannel = new Map<string, Promise<unknown>>();

export async function withChannelLock<T>(
  channelDir: string,
  task: () => Promise<T>,
  opts: { onWait?: () => void } = {},
): Promise<T> {
  const previous = inflightByChannel.get(channelDir);
  const runWithLock = (async () => {
    if (previous) {
      opts.onWait?.();
      console.log(`[brain-lock] wait ${channelDir}`);
      // Wait for predecessor to resolve or reject — never propagate its error.
      await previous.catch(() => {});
    }
    console.log(`[brain-lock] acquire ${channelDir}`);
    try {
      return await task();
    } finally {
      console.log(`[brain-lock] release ${channelDir}`);
    }
  })();
  // Register as the channel's tail. Only clear if we're still the tail when
  // we finish — a later caller may have already chained onto us, in which
  // case they own the slot.
  inflightByChannel.set(channelDir, runWithLock);
  try {
    return await runWithLock;
  } finally {
    if (inflightByChannel.get(channelDir) === runWithLock) {
      inflightByChannel.delete(channelDir);
    }
  }
}

// ---------- Telemetry ----------
//
// One JSONL line per chunk, persisted via the Rust command `record_brain_metric`
// to ~/Library/Caches/youtube-transcriber/brain-metrics.jsonl (on macOS).
//
// Fields that don't apply to the chosen backend (e.g. prompt_bytes for batch)
// are written as null. Telemetry failures are swallowed with console.warn and
// never interrupt the brain-update flow.

export interface BrainMetricLine {
  timestamp: string;              // ISO 8601 UTC
  channel_dir: string;
  mode_requested: BrainUpdateMode;
  mode_used: BrainUpdateMode;
  fallback_triggered: boolean;
  fallback_reason: string | null;
  chunk_index: number;            // 1-based
  chunk_total: number;
  chunk_size: number;             // files in this chunk
  processed_files: number | null;
  action: string | null;          // "created" | "updated" | "skipped"
  duration_ms: number | null;
  claude_ms: number | null;
  prompt_bytes: number | null;
  response_bytes: number | null;
  applied: number | null;
  target_missing: number | null;
  sections_missing: number | null;
  invalid_ops: number | null;
  ambiguous_targets: number | null;
  total_ops: number | null;
  video_sources_added: number | null;
}

function buildMetricLine(args: {
  channelDir: string;
  modeRequested: BrainUpdateMode;
  run: BrainBatchChunkRun;
  chunkTotal: number;
}): BrainMetricLine {
  const { channelDir, modeRequested, run, chunkTotal } = args;
  const r = run.result;
  const isDelta = run.modeUsed === "delta";
  const delta = (isDelta ? (r as BrainDeltaChunkResult | undefined) : undefined);
  const ar = delta?.apply_report;

  return {
    timestamp: new Date().toISOString(),
    channel_dir: channelDir,
    mode_requested: modeRequested,
    mode_used: run.modeUsed,
    fallback_triggered: run.fallbackTriggered,
    fallback_reason: run.fallbackReason ?? null,
    chunk_index: run.index,
    chunk_total: chunkTotal,
    chunk_size: run.size,
    processed_files: r?.processed_files ?? null,
    action: r?.action ?? null,
    duration_ms: run.durationMs,
    claude_ms: r?.claude_ms ?? null,
    prompt_bytes: delta?.prompt_bytes ?? null,
    response_bytes: delta?.response_bytes ?? null,
    applied: ar?.applied ?? null,
    target_missing: ar?.target_missing ?? null,
    sections_missing: ar?.sections_missing ?? null,
    invalid_ops: ar?.invalid_ops ?? null,
    ambiguous_targets: ar?.ambiguous_targets ?? null,
    total_ops: ar?.total_ops ?? null,
    video_sources_added: ar?.video_sources_added ?? null,
  };
}

async function recordBrainMetric(line: BrainMetricLine): Promise<void> {
  try {
    await invoke("record_brain_metric", { line: JSON.stringify(line) });
  } catch (err) {
    console.warn("[brain-metric] failed to persist:", err);
  }
}

// ---------- Internals ----------

function splitIntoChunks<T>(arr: T[], size: number): T[][] {
  if (size <= 0) throw new Error(`chunkSize must be >= 1 (got ${size})`);
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// Returns null if the delta result looks healthy, or a short reason string
// describing why it is suspicious and should trigger a fallback to batch.
//
// The update_brain_delta.py script already exits non-zero for the obvious bad
// cases (invalid JSON, missing required sections, refuse-to-write on target
// ambiguity). These TS-side checks are a belt-and-suspenders layer in case a
// future script variant relaxes one of those guards.
function deltaSuspicionReason(
  r: BrainDeltaChunkResult,
  chunkSize: number,
): string | null {
  if (r.action === "skipped") return null; // all videos already in brain — legitimate no-op
  if (r.processed_files === 0) return null; // nothing to do — no suspicion
  const ar = r.apply_report;
  if (!ar) return "missing apply_report";
  const totalOps = ar.applied + ar.target_missing + ar.sections_missing;
  if (ar.sections_missing > 0) {
    return `sections_missing=${ar.sections_missing}`;
  }
  if (totalOps > 0 && ar.applied === 0) {
    return `applied=0 on chunk of ${chunkSize} file(s)`;
  }
  if (totalOps > 0 && ar.target_missing >= totalOps) {
    return `target_missing (${ar.target_missing}) >= total_ops (${totalOps})`;
  }
  if (r.processed_files > 0 && ar.video_sources_added < r.processed_files) {
    return `video_sources_added (${ar.video_sources_added}) < processed_files (${r.processed_files})`;
  }
  return null;
}

// Public entry point. Wraps the chunked update in a per-channel single-flight
// lock so two brain updates for the same CEREBRO.md can never run concurrently.
// See `withChannelLock` above for the rationale.
export async function updateChannelBrainChunked(
  channelDir: string,
  summaryFiles: string[],
  opts: ChunkedBrainOpts = {},
): Promise<ChunkedBrainRunResult> {
  return withChannelLock(
    channelDir,
    () => runChunkedBrainUpdate(channelDir, summaryFiles, opts),
    {
      onWait: () =>
        opts.onProgress?.(
          `Brain update: waiting for previous run on ${channelDir} to finish...`,
        ),
    },
  );
}

// Call `update_channel_brain_{batch|delta}` one chunk at a time, in order, awaiting each.
// On the first failing chunk, stop and return early (never proceed — we do NOT want
// a later chunk to rewrite CEREBRO after a partial integration failed).
//
// When mode === "delta", each chunk tries the delta command first; if it throws
// or the result looks suspicious (see `deltaSuspicionReason`), the SAME chunk is
// automatically retried with the batch command. The flag `fallbackTriggered` and
// `fallbackReason` are recorded per chunk run. A successful fallback keeps the
// overall run healthy.
//
// Atomicity per chunk is guaranteed by the Python scripts (tempfile + os.replace).
async function runChunkedBrainUpdate(
  channelDir: string,
  summaryFiles: string[],
  opts: ChunkedBrainOpts = {},
): Promise<ChunkedBrainRunResult> {
  const chunkSize = opts.chunkSize ?? BRAIN_BATCH_CHUNK_SIZE;
  const mode: BrainUpdateMode = opts.mode ?? BRAIN_UPDATE_MODE;
  const chunks = splitIntoChunks(summaryFiles, chunkSize);
  const start = performance.now();
  const perChunk: BrainBatchChunkRun[] = [];
  let filesIntegrated = 0;
  let fallbacks = 0;

  if (chunks.length === 0) {
    return {
      chunksTotal: 0,
      chunksCompleted: 0,
      filesAttempted: 0,
      filesIntegrated: 0,
      durationMs: 0,
      fallbacks: 0,
      perChunk,
    };
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const idx = i + 1;
    const label = mode === "delta" ? "delta" : "batch";
    opts.onProgress?.(`Brain batch ${idx}/${chunks.length}: ${chunk.length} files (${label})`);
    const cStart = performance.now();

    let modeUsed: BrainUpdateMode = mode;
    let fallbackTriggered = false;
    let fallbackReason: string | undefined;
    let result: BrainChunkResult | undefined;

    if (mode === "delta") {
      try {
        const deltaResult = await invoke<BrainDeltaChunkResult>("update_channel_brain_delta", {
          channelDir,
          summaryFiles: chunk,
        });
        const reason = deltaSuspicionReason(deltaResult, chunk.length);
        if (reason) {
          fallbackTriggered = true;
          fallbackReason = `suspicious: ${reason}`;
          console.warn(
            `[brain-batch] chunk ${idx}/${chunks.length} delta suspicious (${reason}). Falling back to batch.`,
          );
          opts.onProgress?.(
            `Brain batch ${idx}/${chunks.length}: delta ${reason} — falling back to batch...`,
          );
        } else {
          result = deltaResult;
          modeUsed = "delta";
        }
      } catch (err) {
        fallbackTriggered = true;
        fallbackReason = `delta error: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(
          `[brain-batch] chunk ${idx}/${chunks.length} delta threw. Falling back to batch. ${fallbackReason}`,
        );
        opts.onProgress?.(
          `Brain batch ${idx}/${chunks.length}: delta failed — falling back to batch...`,
        );
      }
    }

    if (result === undefined) {
      // Either mode was "batch" from the start, or delta just fell back.
      try {
        const batchResult = await invoke<BrainBatchChunkResult>("update_channel_brain_batch", {
          channelDir,
          summaryFiles: chunk,
        });
        result = batchResult;
        modeUsed = "batch";
        if (fallbackTriggered) fallbacks += 1;
      } catch (err) {
        const durationMs = performance.now() - cStart;
        const error = err instanceof Error ? err.message : String(err);
        const failedRun: BrainBatchChunkRun = {
          index: idx,
          size: chunk.length,
          durationMs,
          modeUsed,
          fallbackTriggered,
          fallbackReason,
          error,
        };
        perChunk.push(failedRun);
        // Best-effort telemetry for the failed chunk (no result fields, just the
        // envelope). Fire-and-forget; don't await before returning.
        void recordBrainMetric(buildMetricLine({
          channelDir,
          modeRequested: mode,
          run: failedRun,
          chunkTotal: chunks.length,
        }));
        return {
          chunksTotal: chunks.length,
          chunksCompleted: i,
          filesAttempted: summaryFiles.length,
          filesIntegrated,
          durationMs: performance.now() - start,
          fallbacks,
          perChunk,
          failedChunk: { index: idx, size: chunk.length, error },
        };
      }
    }

    const durationMs = performance.now() - cStart;
    const run: BrainBatchChunkRun = {
      index: idx,
      size: chunk.length,
      durationMs,
      modeUsed,
      fallbackTriggered,
      fallbackReason,
      result,
    };
    perChunk.push(run);
    filesIntegrated += result.processed_files ?? 0;

    // Persist telemetry for this chunk. Failure is logged but does NOT block
    // the next chunk; we intentionally await so the cache file grows in order.
    await recordBrainMetric(buildMetricLine({
      channelDir,
      modeRequested: mode,
      run,
      chunkTotal: chunks.length,
    }));
  }

  return {
    chunksTotal: chunks.length,
    chunksCompleted: chunks.length,
    filesAttempted: summaryFiles.length,
    filesIntegrated,
    durationMs: performance.now() - start,
    fallbacks,
    perChunk,
  };
}
