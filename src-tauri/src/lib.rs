use std::collections::HashMap;
use std::io::BufRead;
use std::process::{Child, Command as StdCommand, Stdio};
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

// ---------- Shared state for pause/cancel ----------

#[derive(Default)]
struct BatchProcessorState {
    /// batch_id -> "pause" | "cancel"
    signals: HashMap<i64, String>,
    /// batch_id -> child process PID (so we can kill on cancel)
    active_child: HashMap<i64, u32>,
}

struct ProcessorState(Arc<Mutex<BatchProcessorState>>);

// ---------- Scraper types ----------

#[derive(serde::Serialize, Clone)]
struct ScrapeProgress {
    #[serde(rename = "type")]
    msg_type: String,
    message: String,
}

#[derive(serde::Deserialize, Debug)]
struct ScrapedVideo {
    id: String,
    title: String,
    url: String,
    thumbnail: Option<String>,
    duration: Option<i64>,
    published_at: Option<String>,
}

#[derive(serde::Deserialize, Debug)]
#[serde(tag = "type")]
enum ScraperOutput {
    #[serde(rename = "progress")]
    Progress { message: String },
    #[serde(rename = "result")]
    Result { videos: Vec<ScrapedVideo> },
    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(serde::Serialize)]
struct ScrapeResult {
    videos: Vec<ScrapedVideoOut>,
    total: usize,
}

#[derive(serde::Serialize)]
struct ScrapedVideoOut {
    id: String,
    title: String,
    url: String,
    thumbnail: Option<String>,
    duration: Option<i64>,
    published_at: Option<String>,
}

// ---------- Transcription types ----------

#[derive(serde::Deserialize, Debug)]
#[serde(tag = "type")]
enum TranscribeOutput {
    #[serde(rename = "progress")]
    Progress {
        stage: String,
        message: String,
        #[serde(default)]
        percent: Option<u32>,
    },
    #[serde(rename = "result")]
    Result {
        text: String,
        language: String,
        method: String,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(serde::Serialize, Clone)]
struct BatchEvent {
    batch_id: i64,
    video_id: String,
    event_type: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    percent: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    method: Option<String>,
}

#[derive(serde::Deserialize)]
struct BatchVideoInput {
    id: String,
    url: String,
    title: String,
}

#[derive(serde::Serialize)]
struct BatchProcessResult {
    completed: u32,
    failed: u32,
    status: String,
}

// ---------- Scrape channel command ----------
// Fix #1: spawn_blocking + Fix #3: child.wait()

#[tauri::command]
async fn scrape_channel(
    app: tauri::AppHandle,
    channel_url: String,
) -> Result<ScrapeResult, String> {
    let scripts_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve resource dir: {e}"))?;
    let script_path = scripts_dir.join("_up_/scripts/channel_scraper.py");

    if !script_path.exists() {
        return Err(format!(
            "Scraper script not found at {}",
            script_path.display()
        ));
    }

    let app_handle = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut child = StdCommand::new("python3")
            .arg(&script_path)
            .arg(&channel_url)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start scraper: {e}"))?;

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let reader = std::io::BufReader::new(stdout);

        let mut final_videos: Vec<ScrapedVideoOut> = Vec::new();

        for line in reader.lines() {
            let line = line.map_err(|e| format!("Read error: {e}"))?;
            if line.trim().is_empty() {
                continue;
            }

            match serde_json::from_str::<ScraperOutput>(&line) {
                Ok(ScraperOutput::Progress { message }) => {
                    let _ = app_handle.emit(
                        "scrape-progress",
                        ScrapeProgress {
                            msg_type: "progress".into(),
                            message,
                        },
                    );
                }
                Ok(ScraperOutput::Result { videos }) => {
                    final_videos = videos
                        .into_iter()
                        .map(|v| ScrapedVideoOut {
                            id: v.id,
                            title: v.title,
                            url: v.url,
                            thumbnail: v.thumbnail,
                            duration: v.duration,
                            published_at: v.published_at,
                        })
                        .collect();
                }
                Ok(ScraperOutput::Error { message }) => {
                    let _ = child.wait();
                    return Err(message);
                }
                Err(_) => continue,
            }
        }

        // Fix #3: wait for child to avoid zombie
        let _ = child.wait();

        let total = final_videos.len();
        Ok(ScrapeResult {
            videos: final_videos,
            total,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

// ---------- Batch processing commands ----------

fn run_transcribe(
    script_path: &std::path::Path,
    video_url: &str,
    model: &str,
    language: Option<&str>,
) -> Result<Child, String> {
    let mut cmd = StdCommand::new("python3");
    cmd.arg(script_path)
        .arg(video_url)
        .arg("--model")
        .arg(model)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(lang) = language {
        cmd.arg("--language").arg(lang);
    }

    cmd.spawn()
        .map_err(|e| format!("Failed to start transcribe.py: {e}"))
}

fn check_signal(state: &Arc<Mutex<BatchProcessorState>>, batch_id: i64) -> Option<String> {
    let lock = state.lock().unwrap();
    lock.signals.get(&batch_id).cloned()
}

// Fix #1: spawn_blocking for process_batch
#[tauri::command]
async fn process_batch(
    app: tauri::AppHandle,
    state: tauri::State<'_, ProcessorState>,
    batch_id: i64,
    videos: Vec<BatchVideoInput>,
    model: Option<String>,
    language: Option<String>,
) -> Result<BatchProcessResult, String> {
    let scripts_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve resource dir: {e}"))?;
    let script_path = scripts_dir.join("_up_/scripts/transcribe.py");

    if !script_path.exists() {
        return Err(format!(
            "Transcribe script not found at {}",
            script_path.display()
        ));
    }

    // Clone Arc for the blocking thread
    let shared_state = state.0.clone();
    let app_handle = app.clone();

    // Clear any stale signals
    {
        let mut lock = shared_state.lock().unwrap();
        lock.signals.remove(&batch_id);
    }

    let model = model.unwrap_or_else(|| "base".into());
    let language = language;

    tauri::async_runtime::spawn_blocking(move || {
        let lang_ref = language.as_deref();
        let mut completed: u32 = 0;
        let mut failed: u32 = 0;

        for video in &videos {
            // Check for pause/cancel before starting each video
            if let Some(signal) = check_signal(&shared_state, batch_id) {
                let status = if signal == "cancel" {
                    "cancelado"
                } else {
                    "pausado"
                };

                let _ = app_handle.emit(
                    "batch-event",
                    BatchEvent {
                        batch_id,
                        video_id: String::new(),
                        event_type: format!("batch_{status}"),
                        message: format!("Batch {status}"),
                        percent: None,
                        text: None,
                        language: None,
                        method: None,
                    },
                );

                {
                    let mut lock = shared_state.lock().unwrap();
                    lock.signals.remove(&batch_id);
                }

                return Ok(BatchProcessResult {
                    completed,
                    failed,
                    status: status.to_string(),
                });
            }

            // Emit video_start
            let _ = app_handle.emit(
                "batch-event",
                BatchEvent {
                    batch_id,
                    video_id: video.id.clone(),
                    event_type: "video_start".into(),
                    message: format!("Starting: {}", video.title),
                    percent: None,
                    text: None,
                    language: None,
                    method: None,
                },
            );

            // Run transcription
            let child_result = run_transcribe(&script_path, &video.url, &model, lang_ref);

            let mut child = match child_result {
                Ok(c) => c,
                Err(e) => {
                    failed += 1;
                    let _ = app_handle.emit(
                        "batch-event",
                        BatchEvent {
                            batch_id,
                            video_id: video.id.clone(),
                            event_type: "video_error".into(),
                            message: e,
                            percent: None,
                            text: None,
                            language: None,
                            method: None,
                        },
                    );
                    continue;
                }
            };

            // Store pid for potential kill
            {
                let mut lock = shared_state.lock().unwrap();
                lock.active_child.insert(batch_id, child.id());
            }

            let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
            let reader = std::io::BufReader::new(stdout);

            let mut video_succeeded = false;
            let mut error_msg = String::new();

            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => continue,
                };
                if line.trim().is_empty() {
                    continue;
                }

                match serde_json::from_str::<TranscribeOutput>(&line) {
                    Ok(TranscribeOutput::Progress {
                        stage,
                        message,
                        percent,
                    }) => {
                        let _ = app_handle.emit(
                            "batch-event",
                            BatchEvent {
                                batch_id,
                                video_id: video.id.clone(),
                                event_type: "video_progress".into(),
                                message: format!("[{stage}] {message}"),
                                percent,
                                text: None,
                                language: None,
                                method: None,
                            },
                        );
                    }
                    Ok(TranscribeOutput::Result {
                        text,
                        language,
                        method,
                    }) => {
                        video_succeeded = true;
                        let _ = app_handle.emit(
                            "batch-event",
                            BatchEvent {
                                batch_id,
                                video_id: video.id.clone(),
                                event_type: "video_done".into(),
                                message: "Transcription complete".into(),
                                percent: Some(100),
                                text: Some(text),
                                language: Some(language),
                                method: Some(method),
                            },
                        );
                    }
                    Ok(TranscribeOutput::Error { message }) => {
                        error_msg = message;
                    }
                    Err(_) => continue,
                }
            }

            // Wait for process to finish
            let _ = child.wait();

            // Clean up active_child
            {
                let mut lock = shared_state.lock().unwrap();
                lock.active_child.remove(&batch_id);
            }

            if video_succeeded {
                completed += 1;
            } else {
                failed += 1;
                if error_msg.is_empty() {
                    error_msg = "Unknown transcription error".into();
                }
                let _ = app_handle.emit(
                    "batch-event",
                    BatchEvent {
                        batch_id,
                        video_id: video.id.clone(),
                        event_type: "video_error".into(),
                        message: error_msg,
                        percent: None,
                        text: None,
                        language: None,
                        method: None,
                    },
                );
            }
        }

        let _ = app_handle.emit(
            "batch-event",
            BatchEvent {
                batch_id,
                video_id: String::new(),
                event_type: "batch_done".into(),
                message: format!("Batch complete: {completed} done, {failed} failed"),
                percent: None,
                text: None,
                language: None,
                method: None,
            },
        );

        Ok(BatchProcessResult {
            completed,
            failed,
            status: "completado".to_string(),
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

// Fix #7: signal_batch kills active process on cancel
#[tauri::command]
async fn signal_batch(
    state: tauri::State<'_, ProcessorState>,
    batch_id: i64,
    signal: String,
) -> Result<(), String> {
    let mut lock = state.0.lock().unwrap();
    lock.signals.insert(batch_id, signal.clone());

    // If cancelling, kill the active child process immediately
    if signal == "cancel" {
        if let Some(pid) = lock.active_child.get(&batch_id) {
            #[cfg(unix)]
            {
                unsafe {
                    libc::kill(*pid as i32, libc::SIGTERM);
                }
            }
            #[cfg(not(unix))]
            {
                // On Windows, we can't easily kill by PID from here.
                // The signal check between videos will handle it.
                let _ = pid;
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn transcribe_single(
    app: tauri::AppHandle,
    video_id: String,
    video_url: String,
    model: Option<String>,
    language: Option<String>,
) -> Result<BatchEvent, String> {
    let scripts_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve resource dir: {e}"))?;
    let script_path = scripts_dir.join("_up_/scripts/transcribe.py");

    if !script_path.exists() {
        return Err("Transcribe script not found".into());
    }

    let model = model.unwrap_or_else(|| "base".into());
    let app_handle = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut child = run_transcribe(&script_path, &video_url, &model, language.as_deref())?;

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let reader = std::io::BufReader::new(stdout);

        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => continue,
            };
            if line.trim().is_empty() {
                continue;
            }

            match serde_json::from_str::<TranscribeOutput>(&line) {
                Ok(TranscribeOutput::Progress {
                    stage,
                    message,
                    percent,
                }) => {
                    let _ = app_handle.emit(
                        "batch-event",
                        BatchEvent {
                            batch_id: 0,
                            video_id: video_id.clone(),
                            event_type: "video_progress".into(),
                            message: format!("[{stage}] {message}"),
                            percent,
                            text: None,
                            language: None,
                            method: None,
                        },
                    );
                }
                Ok(TranscribeOutput::Result {
                    text,
                    language,
                    method,
                }) => {
                    let _ = child.wait();
                    return Ok(BatchEvent {
                        batch_id: 0,
                        video_id,
                        event_type: "video_done".into(),
                        message: "Transcription complete".into(),
                        percent: Some(100),
                        text: Some(text),
                        language: Some(language),
                        method: Some(method),
                    });
                }
                Ok(TranscribeOutput::Error { message }) => {
                    let _ = child.wait();
                    return Err(message);
                }
                Err(_) => continue,
            }
        }

        let _ = child.wait();
        Err("Transcription ended without result".into())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

// ---------- Export command ----------

#[derive(serde::Deserialize)]
struct ExportVideo {
    id: String,
    title: String,
    url: String,
    duration: Option<i64>,
    published_at: Option<String>,
    language: Option<String>,
    transcription_method: Option<String>,
    full_text: String,
    tags: Option<String>,
}

#[derive(serde::Deserialize)]
struct ExportRequest {
    channel_name: String,
    channel_handle: Option<String>,
    channel_url: String,
    output_dir: String,
    videos: Vec<ExportVideo>,
}

#[derive(serde::Serialize)]
struct ExportResult {
    exported: u32,
    output_dir: String,
}

fn slugify(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c.to_ascii_lowercase()
            } else if c == ' ' {
                '-'
            } else {
                '_'
            }
        })
        .collect::<String>()
        .chars()
        .take(80)
        .collect()
}

fn format_duration(seconds: i64) -> String {
    let h = seconds / 3600;
    let m = (seconds % 3600) / 60;
    let s = seconds % 60;
    if h > 0 {
        format!("{h}h {m:02}m {s:02}s")
    } else {
        format!("{m}m {s:02}s")
    }
}

#[tauri::command]
async fn export_channel(request: ExportRequest) -> Result<ExportResult, String> {
    let base_dir = std::path::PathBuf::from(&request.output_dir);
    let channel_dir = base_dir.join(slugify(&request.channel_name));

    std::fs::create_dir_all(&channel_dir)
        .map_err(|e| format!("Failed to create directory: {e}"))?;

    let mut exported: u32 = 0;

    for video in &request.videos {
        let date_prefix = video.published_at.as_deref().unwrap_or("unknown-date");
        let title_slug = slugify(&video.title);
        let filename = format!("{date_prefix}_{title_slug}.md");
        let filepath = channel_dir.join(&filename);

        let duration_str = video
            .duration
            .map(|d| format_duration(d))
            .unwrap_or_else(|| "unknown".into());

        let tags_str = video.tags.as_deref().unwrap_or("");

        let content = format!(
            r#"---
channel: "{channel_name}"
channel_handle: "{channel_handle}"
channel_url: "{channel_url}"
title: "{title}"
video_id: "{video_id}"
url: "{url}"
date: "{date}"
duration_seconds: {duration_raw}
duration: "{duration}"
language: "{language}"
transcription_method: "{method}"
tags: "{tags}"
---

{text}
"#,
            channel_name = request.channel_name,
            channel_handle = request.channel_handle.as_deref().unwrap_or(""),
            channel_url = request.channel_url,
            title = video.title.replace('"', "'"),
            video_id = video.id,
            url = video.url,
            date = date_prefix,
            duration_raw = video.duration.unwrap_or(0),
            duration = duration_str,
            language = video.language.as_deref().unwrap_or("unknown"),
            method = video.transcription_method.as_deref().unwrap_or("unknown"),
            tags = tags_str,
            text = video.full_text,
        );

        std::fs::write(&filepath, content)
            .map_err(|e| format!("Failed to write {}: {e}", filename))?;

        exported += 1;
    }

    Ok(ExportResult {
        exported,
        output_dir: channel_dir.to_string_lossy().to_string(),
    })
}

// ---------- App entry ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create channels, videos and batches tables",
            sql: r#"
                CREATE TABLE IF NOT EXISTS channels (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    handle TEXT,
                    url TEXT NOT NULL,
                    thumbnail TEXT,
                    total_videos INTEGER DEFAULT 0,
                    scraped BOOLEAN DEFAULT FALSE,
                    status TEXT DEFAULT 'nuevo',
                    priority INTEGER DEFAULT 0,
                    notes TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS videos (
                    id TEXT PRIMARY KEY,
                    channel_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    url TEXT NOT NULL,
                    thumbnail TEXT,
                    duration INTEGER,
                    published_at DATETIME,
                    status TEXT DEFAULT 'pendiente',
                    batch_number INTEGER,
                    error_message TEXT,
                    full_text TEXT,
                    transcription_method TEXT,
                    language TEXT,
                    priority INTEGER DEFAULT 0,
                    tags TEXT,
                    transcribed_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (channel_id) REFERENCES channels(id)
                );

                CREATE TABLE IF NOT EXISTS batches (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    channel_id TEXT NOT NULL,
                    batch_number INTEGER NOT NULL,
                    total_videos INTEGER DEFAULT 0,
                    completed_videos INTEGER DEFAULT 0,
                    failed_videos INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'preparado',
                    started_at DATETIME,
                    completed_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (channel_id) REFERENCES channels(id)
                );
            "#,
            kind: MigrationKind::Up,
        },
        // Fix #8: Add indexes for performance
        Migration {
            version: 2,
            description: "add indexes on videos for channel and batch queries",
            sql: r#"
                CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);
                CREATE INDEX IF NOT EXISTS idx_videos_channel_batch ON videos(channel_id, batch_number);
                CREATE INDEX IF NOT EXISTS idx_videos_channel_status ON videos(channel_id, status);
                CREATE INDEX IF NOT EXISTS idx_batches_channel ON batches(channel_id);
            "#,
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:youtube-transcriber.db", migrations)
                .build(),
        )
        .manage(ProcessorState(Arc::new(Mutex::new(
            BatchProcessorState::default(),
        ))))
        .invoke_handler(tauri::generate_handler![
            scrape_channel,
            process_batch,
            signal_batch,
            transcribe_single,
            export_channel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
