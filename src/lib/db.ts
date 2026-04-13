import Database from "@tauri-apps/plugin-sql";

let initPromise: Promise<Database> | null = null;

async function initDb(): Promise<Database> {
  const db = await Database.load("sqlite:youtube-transcriber.db");
  await db.execute("PRAGMA foreign_keys = ON");
  // Reset stale "procesando" batches once on app startup
  await db.execute(
    "UPDATE batches SET status = 'pausado' WHERE status = 'procesando'"
  );
  return db;
}

export async function getDb(): Promise<Database> {
  if (!initPromise) {
    initPromise = initDb();
  }
  return initPromise;
}

// ---------- Channel types ----------

export interface Channel {
  id: string;
  name: string;
  handle: string | null;
  url: string;
  thumbnail: string | null;
  total_videos: number;
  scraped: boolean;
  status: string;
  priority: number;
  notes: string | null;
  created_at: string;
}

export type ChannelInsert = Pick<Channel, "id" | "name" | "url"> &
  Partial<Omit<Channel, "id" | "name" | "url" | "created_at">>;

// ---------- Video types ----------

export interface Video {
  id: string;
  channel_id: string;
  title: string;
  url: string;
  thumbnail: string | null;
  duration: number | null;
  published_at: string | null;
  status: string;
  batch_number: number | null;
  error_message: string | null;
  full_text: string | null;
  transcription_method: string | null;
  language: string | null;
  priority: number;
  tags: string | null;
  transcribed_at: string | null;
  created_at: string;
}

export type VideoInsert = Pick<Video, "id" | "channel_id" | "title" | "url"> &
  Partial<Omit<Video, "id" | "channel_id" | "title" | "url" | "created_at">>;

// ---------- Batch types ----------

export interface Batch {
  id: number;
  channel_id: string;
  batch_number: number;
  total_videos: number;
  completed_videos: number;
  failed_videos: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export type BatchInsert = Pick<Batch, "channel_id" | "batch_number"> &
  Partial<Omit<Batch, "id" | "channel_id" | "batch_number" | "created_at">>;

// ---------- Channels CRUD ----------

export async function addChannel(channel: ChannelInsert): Promise<void> {
  const d = await getDb();
  const existing = await d.select<Channel[]>(
    "SELECT id FROM channels WHERE id = $1",
    [channel.id]
  );
  if (existing.length > 0) {
    throw new Error(`Channel "${channel.id}" already exists.`);
  }
  await d.execute(
    `INSERT INTO channels (id, name, handle, url, thumbnail, total_videos, scraped, status, priority, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      channel.id,
      channel.name,
      channel.handle ?? null,
      channel.url,
      channel.thumbnail ?? null,
      channel.total_videos ?? 0,
      channel.scraped ?? false,
      channel.status ?? "nuevo",
      channel.priority ?? 0,
      channel.notes ?? null,
    ]
  );
}

export async function listChannels(): Promise<Channel[]> {
  const d = await getDb();
  return d.select<Channel[]>(
    "SELECT * FROM channels ORDER BY created_at DESC"
  );
}

export async function getChannel(id: string): Promise<Channel | undefined> {
  const d = await getDb();
  const rows = await d.select<Channel[]>(
    "SELECT * FROM channels WHERE id = $1",
    [id]
  );
  return rows[0];
}

const CHANNEL_COLUMNS = new Set(["name", "handle", "url", "thumbnail", "total_videos", "scraped", "status", "priority", "notes"]);
const VIDEO_COLUMNS = new Set(["channel_id", "title", "url", "thumbnail", "duration", "published_at", "status", "batch_number", "error_message", "full_text", "transcription_method", "language", "priority", "tags", "transcribed_at"]);

export async function updateChannel(
  id: string,
  fields: Partial<Omit<Channel, "id" | "created_at">>
): Promise<void> {
  const entries = Object.entries(fields).filter(([k, v]) => v !== undefined && CHANNEL_COLUMNS.has(k));
  if (entries.length === 0) return;

  const setClauses = entries.map(([key], i) => `${key} = $${i + 1}`);
  const values = entries.map(([, v]) => v);

  const d = await getDb();
  await d.execute(
    `UPDATE channels SET ${setClauses.join(", ")} WHERE id = $${values.length + 1}`,
    [...values, id]
  );
}

export async function deleteChannel(id: string): Promise<void> {
  const d = await getDb();
  await d.execute("DELETE FROM videos WHERE channel_id = $1", [id]);
  await d.execute("DELETE FROM batches WHERE channel_id = $1", [id]);
  await d.execute("DELETE FROM channels WHERE id = $1", [id]);
}

// ---------- Videos CRUD ----------

export async function addVideo(video: VideoInsert): Promise<void> {
  const d = await getDb();
  await d.execute(
    `INSERT INTO videos (id, channel_id, title, url, thumbnail, duration, published_at, status, batch_number, priority, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      video.id,
      video.channel_id,
      video.title,
      video.url,
      video.thumbnail ?? null,
      video.duration ?? null,
      video.published_at ?? null,
      video.status ?? "pendiente",
      video.batch_number ?? null,
      video.priority ?? 0,
      video.tags ?? null,
    ]
  );
}

export async function listVideos(channelId: string): Promise<Video[]> {
  const d = await getDb();
  return d.select<Video[]>(
    "SELECT * FROM videos WHERE channel_id = $1 ORDER BY published_at DESC",
    [channelId]
  );
}

export async function updateVideoStatus(
  id: string,
  status: string,
  errorMessage?: string
): Promise<void> {
  const d = await getDb();
  if (status === "completado") {
    await d.execute(
      "UPDATE videos SET status = $1, error_message = $2, transcribed_at = CURRENT_TIMESTAMP WHERE id = $3",
      [status, errorMessage ?? null, id]
    );
  } else {
    await d.execute(
      "UPDATE videos SET status = $1, error_message = $2 WHERE id = $3",
      [status, errorMessage ?? null, id]
    );
  }
}

export async function updateVideo(
  id: string,
  fields: Partial<Omit<Video, "id" | "created_at">>
): Promise<void> {
  const entries = Object.entries(fields).filter(([k, v]) => v !== undefined && VIDEO_COLUMNS.has(k));
  if (entries.length === 0) return;

  const setClauses = entries.map(([key], i) => `${key} = $${i + 1}`);
  const values = entries.map(([, v]) => v);

  const d = await getDb();
  await d.execute(
    `UPDATE videos SET ${setClauses.join(", ")} WHERE id = $${values.length + 1}`,
    [...values, id]
  );
}

export async function addVideoBulk(videos: VideoInsert[]): Promise<number> {
  const d = await getDb();
  let inserted = 0;
  for (const video of videos) {
    const result = await d.execute(
      `INSERT OR IGNORE INTO videos (id, channel_id, title, url, thumbnail, duration, published_at, status, batch_number, priority, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        video.id,
        video.channel_id,
        video.title,
        video.url,
        video.thumbnail ?? null,
        video.duration ?? null,
        video.published_at ?? null,
        video.status ?? "pendiente",
        video.batch_number ?? null,
        video.priority ?? 0,
        video.tags ?? null,
      ]
    );
    if (result.rowsAffected > 0) inserted++;
  }
  return inserted;
}

export async function bulkUpdateVideoStatus(
  ids: string[],
  status: string
): Promise<void> {
  if (ids.length === 0) return;
  const d = await getDb();
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");
  await d.execute(
    `UPDATE videos SET status = $1 WHERE id IN (${placeholders})`,
    [status, ...ids]
  );
}

export async function getNextPendingVideos(
  channelId: string,
  limit: number
): Promise<Video[]> {
  const d = await getDb();
  return d.select<Video[]>(
    "SELECT * FROM videos WHERE channel_id = $1 AND status = 'pendiente' ORDER BY published_at ASC LIMIT $2",
    [channelId, limit]
  );
}

export async function countVideosByStatus(
  channelId: string
): Promise<Record<string, number>> {
  const d = await getDb();
  const rows = await d.select<{ status: string; count: number }[]>(
    "SELECT status, COUNT(*) as count FROM videos WHERE channel_id = $1 GROUP BY status",
    [channelId]
  );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.status] = row.count;
  }
  return counts;
}

export async function getMaxBatchNumber(channelId: string): Promise<number> {
  const d = await getDb();
  const rows = await d.select<{ max_num: number | null }[]>(
    "SELECT MAX(batch_number) as max_num FROM batches WHERE channel_id = $1",
    [channelId]
  );
  return rows[0]?.max_num ?? 0;
}

export async function hasActiveBatch(channelId: string): Promise<boolean> {
  const d = await getDb();
  const rows = await d.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM batches WHERE channel_id = $1 AND status IN ('preparado', 'procesando')",
    [channelId]
  );
  return (rows[0]?.count ?? 0) > 0;
}

export async function createBatchWithVideos(
  channelId: string,
  videoIds: string[]
): Promise<{ batchId: number; batchNumber: number }> {
  const d = await getDb();
  const maxNum = await getMaxBatchNumber(channelId);
  const batchNumber = maxNum + 1;

  const result = await d.execute(
    `INSERT INTO batches (channel_id, batch_number, total_videos, status)
     VALUES ($1, $2, $3, 'preparado')`,
    [channelId, batchNumber, videoIds.length]
  );
  const batchId = result.lastInsertId ?? 0;

  const ph = videoIds.map((_, i) => `$${i + 2}`).join(", ");
  await d.execute(
    `UPDATE videos SET status = 'en_cola', batch_number = $1 WHERE id IN (${ph})`,
    [batchNumber, ...videoIds]
  );

  return { batchId, batchNumber };
}

// ---------- Batches CRUD ----------

export async function createBatch(batch: BatchInsert): Promise<number> {
  const d = await getDb();
  const result = await d.execute(
    `INSERT INTO batches (channel_id, batch_number, total_videos, status)
     VALUES ($1, $2, $3, $4)`,
    [
      batch.channel_id,
      batch.batch_number,
      batch.total_videos ?? 0,
      batch.status ?? "preparado",
    ]
  );
  return result.lastInsertId ?? 0;
}

export async function listBatches(channelId?: string): Promise<Batch[]> {
  const d = await getDb();
  if (channelId) {
    return d.select<Batch[]>(
      "SELECT * FROM batches WHERE channel_id = $1 ORDER BY batch_number DESC",
      [channelId]
    );
  }
  return d.select<Batch[]>("SELECT * FROM batches ORDER BY created_at DESC");
}

export async function updateBatchStatus(
  id: number,
  status: string,
  counts?: { completed_videos?: number; failed_videos?: number }
): Promise<void> {
  const d = await getDb();
  const now =
    status === "completado" || status === "fallido"
      ? ", completed_at = CURRENT_TIMESTAMP"
      : status === "procesando"
        ? ", started_at = CURRENT_TIMESTAMP"
        : "";

  const completedVideos = counts?.completed_videos;
  const failedVideos = counts?.failed_videos;

  let extra = "";
  const params: unknown[] = [status];

  if (completedVideos !== undefined) {
    extra += `, completed_videos = $${params.length + 1}`;
    params.push(completedVideos);
  }
  if (failedVideos !== undefined) {
    extra += `, failed_videos = $${params.length + 1}`;
    params.push(failedVideos);
  }

  params.push(id);
  await d.execute(
    `UPDATE batches SET status = $1${extra}${now} WHERE id = $${params.length}`,
    params
  );
}

// ---------- Batch processing helpers ----------

export async function hasGlobalActiveBatch(): Promise<boolean> {
  const d = await getDb();
  const rows = await d.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM batches WHERE status IN ('procesando')"
  );
  return (rows[0]?.count ?? 0) > 0;
}

export async function getBatch(id: number): Promise<Batch | undefined> {
  const d = await getDb();
  const rows = await d.select<Batch[]>(
    "SELECT * FROM batches WHERE id = $1",
    [id]
  );
  return rows[0];
}

export async function getVideosForBatch(
  channelId: string,
  batchNumber: number
): Promise<Video[]> {
  const d = await getDb();
  return d.select<Video[]>(
    "SELECT * FROM videos WHERE channel_id = $1 AND batch_number = $2 ORDER BY published_at ASC",
    [channelId, batchNumber]
  );
}

export async function updateVideoTranscription(
  id: string,
  data: {
    full_text: string;
    transcription_method: string;
    language: string;
  }
): Promise<void> {
  const d = await getDb();
  await d.execute(
    `UPDATE videos SET status = 'completado', full_text = $1, transcription_method = $2, language = $3, transcribed_at = CURRENT_TIMESTAMP WHERE id = $4`,
    [data.full_text, data.transcription_method, data.language, id]
  );
}

export async function recalcBatchCounts(batchId: number): Promise<{ completed: number; failed: number }> {
  const d = await getDb();
  const batch = await getBatch(batchId);
  if (!batch) return { completed: 0, failed: 0 };

  const rows = await d.select<{ status: string; count: number }[]>(
    "SELECT status, COUNT(*) as count FROM videos WHERE channel_id = $1 AND batch_number = $2 GROUP BY status",
    [batch.channel_id, batch.batch_number]
  );

  let completed = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.status === "completado") completed = row.count;
    if (row.status === "error") failed = row.count;
  }

  await d.execute(
    "UPDATE batches SET completed_videos = $1, failed_videos = $2 WHERE id = $3",
    [completed, failed, batchId]
  );

  return { completed, failed };
}

export async function getCompletedVideosWithText(channelId: string): Promise<Video[]> {
  const d = await getDb();
  return d.select<Video[]>(
    "SELECT * FROM videos WHERE channel_id = $1 AND status = 'completado' AND full_text IS NOT NULL ORDER BY published_at ASC",
    [channelId]
  );
}

export async function getPausedOrActiveBatches(): Promise<Batch[]> {
  const d = await getDb();
  return d.select<Batch[]>(
    "SELECT * FROM batches WHERE status IN ('procesando', 'pausado') ORDER BY created_at DESC"
  );
}

export async function resetStaleBatches(): Promise<number> {
  const d = await getDb();
  const result = await d.execute(
    "UPDATE batches SET status = 'pausado' WHERE status = 'procesando'"
  );
  return result.rowsAffected;
}

// ---------- Global stats ----------

export interface GlobalStats {
  total_channels: number;
  total_videos: number;
  total_transcribed: number;
  total_errors: number;
  total_pending: number;
  total_duration_seconds: number;
  active_batch: Batch | null;
}

export async function getGlobalStats(): Promise<GlobalStats> {
  const d = await getDb();

  const channelRows = await d.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM channels"
  );

  const videoRows = await d.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM videos"
  );

  const statusRows = await d.select<{ status: string; count: number }[]>(
    "SELECT status, COUNT(*) as count FROM videos GROUP BY status"
  );

  const durationRows = await d.select<{ total: number | null }[]>(
    "SELECT SUM(duration) as total FROM videos WHERE status = 'completado'"
  );

  const activeBatches = await d.select<Batch[]>(
    "SELECT * FROM batches WHERE status IN ('procesando', 'pausado') ORDER BY created_at DESC LIMIT 1"
  );

  const statusMap: Record<string, number> = {};
  for (const row of statusRows) {
    statusMap[row.status] = row.count;
  }

  return {
    total_channels: channelRows[0]?.count ?? 0,
    total_videos: videoRows[0]?.count ?? 0,
    total_transcribed: statusMap["completado"] ?? 0,
    total_errors: statusMap["error"] ?? 0,
    total_pending: (statusMap["pendiente"] ?? 0) + (statusMap["en_cola"] ?? 0),
    total_duration_seconds: durationRows[0]?.total ?? 0,
    active_batch: activeBatches[0] ?? null,
  };
}

export interface ChannelProgress {
  channel_id: string;
  total: number;
  transcribed: number;
  errors: number;
  pending: number;
  skipped: number;
  last_batch: Batch | null;
}

export async function getChannelProgress(channelId: string): Promise<ChannelProgress> {
  const d = await getDb();

  const statusRows = await d.select<{ status: string; count: number }[]>(
    "SELECT status, COUNT(*) as count FROM videos WHERE channel_id = $1 GROUP BY status",
    [channelId]
  );

  const lastBatchRows = await d.select<Batch[]>(
    "SELECT * FROM batches WHERE channel_id = $1 ORDER BY batch_number DESC LIMIT 1",
    [channelId]
  );

  const statusMap: Record<string, number> = {};
  let total = 0;
  for (const row of statusRows) {
    statusMap[row.status] = row.count;
    total += row.count;
  }

  return {
    channel_id: channelId,
    total,
    transcribed: statusMap["completado"] ?? 0,
    errors: statusMap["error"] ?? 0,
    pending: (statusMap["pendiente"] ?? 0) + (statusMap["en_cola"] ?? 0),
    skipped: statusMap["omitido"] ?? 0,
    last_batch: lastBatchRows[0] ?? null,
  };
}

export async function getAllChannelProgress(): Promise<Map<string, ChannelProgress>> {
  const d = await getDb();

  const statusRows = await d.select<{ channel_id: string; status: string; count: number }[]>(
    "SELECT channel_id, status, COUNT(*) as count FROM videos GROUP BY channel_id, status"
  );

  const lastBatches = await d.select<(Batch & { _rn?: number })[]>(
    `SELECT b.* FROM batches b
     INNER JOIN (SELECT channel_id, MAX(batch_number) as max_bn FROM batches GROUP BY channel_id) m
     ON b.channel_id = m.channel_id AND b.batch_number = m.max_bn`
  );

  const batchMap = new Map<string, Batch>();
  for (const b of lastBatches) {
    batchMap.set(b.channel_id, b);
  }

  const progressMap = new Map<string, ChannelProgress>();

  for (const row of statusRows) {
    let p = progressMap.get(row.channel_id);
    if (!p) {
      p = {
        channel_id: row.channel_id,
        total: 0,
        transcribed: 0,
        errors: 0,
        pending: 0,
        skipped: 0,
        last_batch: batchMap.get(row.channel_id) ?? null,
      };
      progressMap.set(row.channel_id, p);
    }
    p.total += row.count;
    if (row.status === "completado") p.transcribed = row.count;
    else if (row.status === "error") p.errors = row.count;
    else if (row.status === "pendiente" || row.status === "en_cola") p.pending += row.count;
    else if (row.status === "omitido") p.skipped = row.count;
  }

  return progressMap;
}
