use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
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

// ---------- Resolve channel from any YouTube URL ----------

#[derive(serde::Deserialize, Debug)]
#[serde(tag = "type")]
enum ResolveOutput {
    #[serde(rename = "result")]
    Result {
        channel_id: String,
        channel_name: String,
        channel_url: String,
        handle: Option<String>,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(serde::Serialize)]
struct ResolvedChannel {
    channel_id: String,
    channel_name: String,
    channel_url: String,
    handle: Option<String>,
}

#[tauri::command]
async fn resolve_channel(
    app: tauri::AppHandle,
    url: String,
) -> Result<ResolvedChannel, String> {
    let scripts_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve resource dir: {e}"))?;
    let script_path = scripts_dir.join("_up_/scripts/resolve_channel.py");

    if !script_path.exists() {
        return Err(format!(
            "Resolve script not found at {}",
            script_path.display()
        ));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let output = StdCommand::new("python3")
            .arg(&script_path)
            .arg(&url)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("Failed to start resolve script: {e}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            match serde_json::from_str::<ResolveOutput>(line) {
                Ok(ResolveOutput::Result {
                    channel_id,
                    channel_name,
                    channel_url,
                    handle,
                }) => {
                    return Ok(ResolvedChannel {
                        channel_id,
                        channel_name,
                        channel_url,
                        handle,
                    });
                }
                Ok(ResolveOutput::Error { message }) => {
                    return Err(message);
                }
                Err(_) => continue,
            }
        }

        Err("No valid output from resolve script".into())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

// ---------- Resolve video info from URL ----------

#[derive(serde::Deserialize, Debug)]
#[serde(tag = "type")]
enum ResolveVideoOutput {
    #[serde(rename = "result")]
    Result {
        video_id: String,
        title: String,
        channel_id: String,
        channel_name: String,
        channel_url: String,
        handle: Option<String>,
        thumbnail: Option<String>,
        duration: Option<i64>,
        published_at: Option<String>,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(serde::Serialize)]
struct ResolvedVideo {
    video_id: String,
    title: String,
    channel_id: String,
    channel_name: String,
    channel_url: String,
    handle: Option<String>,
    thumbnail: Option<String>,
    duration: Option<i64>,
    published_at: Option<String>,
}

#[tauri::command]
async fn resolve_video(
    app: tauri::AppHandle,
    url: String,
) -> Result<ResolvedVideo, String> {
    let scripts_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve resource dir: {e}"))?;
    let script_path = scripts_dir.join("_up_/scripts/resolve_video.py");

    if !script_path.exists() {
        return Err(format!(
            "Resolve video script not found at {}",
            script_path.display()
        ));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let output = StdCommand::new("python3")
            .arg(&script_path)
            .arg(&url)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("Failed to start resolve_video script: {e}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            match serde_json::from_str::<ResolveVideoOutput>(line) {
                Ok(ResolveVideoOutput::Result {
                    video_id,
                    title,
                    channel_id,
                    channel_name,
                    channel_url,
                    handle,
                    thumbnail,
                    duration,
                    published_at,
                }) => {
                    return Ok(ResolvedVideo {
                        video_id,
                        title,
                        channel_id,
                        channel_name,
                        channel_url,
                        handle,
                        thumbnail,
                        duration,
                        published_at,
                    });
                }
                Ok(ResolveVideoOutput::Error { message }) => {
                    return Err(message);
                }
                Err(_) => continue,
            }
        }

        Err("No valid output from resolve_video script".into())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

// ---------- Summarize video command ----------

#[derive(serde::Deserialize, Debug)]
#[serde(tag = "type")]
enum SummarizeOutput {
    #[serde(rename = "progress")]
    Progress { message: String },
    #[serde(rename = "result")]
    Result {
        summary_chars: u64,
        file: String,
        #[serde(default)]
        skipped: bool,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(serde::Serialize)]
struct SummarizeResult {
    summary_chars: u64,
    file: String,
    skipped: bool,
}

#[tauri::command]
async fn summarize_video(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<SummarizeResult, String> {
    let scripts_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve resource dir: {e}"))?;
    let script_path = scripts_dir.join("_up_/scripts/summarize.py");

    if !script_path.exists() {
        return Err(format!("Summarize script not found at {}", script_path.display()));
    }

    let app_handle = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut child = StdCommand::new("python3")
            .arg(&script_path)
            .arg(&file_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start summarize script: {e}"))?;

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let reader = std::io::BufReader::new(stdout);

        let mut final_result: Option<SummarizeResult> = None;

        for line in reader.lines() {
            let line = line.map_err(|e| format!("Read error: {e}"))?;
            if line.trim().is_empty() {
                continue;
            }

            match serde_json::from_str::<SummarizeOutput>(&line) {
                Ok(SummarizeOutput::Progress { message }) => {
                    let _ = app_handle.emit(
                        "summarize-progress",
                        ScrapeProgress {
                            msg_type: "progress".into(),
                            message,
                        },
                    );
                }
                Ok(SummarizeOutput::Result { summary_chars, file, skipped }) => {
                    final_result = Some(SummarizeResult { summary_chars, file, skipped });
                }
                Ok(SummarizeOutput::Error { message }) => {
                    let _ = child.wait();
                    return Err(message);
                }
                Err(_) => continue,
            }
        }

        let _ = child.wait();
        final_result.ok_or_else(|| "No result from summarize script".into())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

// ---------- Update channel brain command ----------

#[derive(serde::Deserialize, Debug)]
#[serde(tag = "type")]
enum UpdateBrainOutput {
    #[serde(rename = "progress")]
    Progress { message: String },
    #[serde(rename = "result")]
    Result {
        brain_file: String,
        action: String,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(serde::Serialize)]
struct UpdateBrainResult {
    brain_file: String,
    action: String,
}

#[tauri::command]
async fn update_channel_brain(
    app: tauri::AppHandle,
    channel_dir: String,
    summary_file: String,
) -> Result<UpdateBrainResult, String> {
    let scripts_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve resource dir: {e}"))?;
    let script_path = scripts_dir.join("_up_/scripts/update_brain.py");

    if !script_path.exists() {
        return Err(format!("Brain update script not found at {}", script_path.display()));
    }

    let app_handle = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut child = StdCommand::new("python3")
            .arg(&script_path)
            .arg(&channel_dir)
            .arg(&summary_file)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start brain script: {e}"))?;

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let reader = std::io::BufReader::new(stdout);

        let mut final_result: Option<UpdateBrainResult> = None;

        for line in reader.lines() {
            let line = line.map_err(|e| format!("Read error: {e}"))?;
            if line.trim().is_empty() { continue; }

            match serde_json::from_str::<UpdateBrainOutput>(&line) {
                Ok(UpdateBrainOutput::Progress { message }) => {
                    let _ = app_handle.emit(
                        "brain-progress",
                        ScrapeProgress { msg_type: "progress".into(), message },
                    );
                }
                Ok(UpdateBrainOutput::Result { brain_file, action }) => {
                    final_result = Some(UpdateBrainResult { brain_file, action });
                }
                Ok(UpdateBrainOutput::Error { message }) => {
                    let _ = child.wait();
                    return Err(message);
                }
                Err(_) => continue,
            }
        }

        let _ = child.wait();
        final_result.ok_or_else(|| "No result from brain script".into())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

// ---------- Update channel brain (BATCH) command ----------

#[derive(serde::Deserialize, Debug)]
#[serde(tag = "type")]
enum UpdateBrainBatchOutput {
    #[serde(rename = "progress")]
    Progress { message: String },
    #[serde(rename = "result")]
    Result {
        brain_file: String,
        action: String,
        #[serde(default)]
        total_files: u64,
        #[serde(default)]
        processed_files: u64,
        #[serde(default)]
        skipped_files: u64,
        #[serde(default)]
        total_summary_chars: u64,
        #[serde(default)]
        cerebro_bytes_before: u64,
        #[serde(default)]
        cerebro_bytes_after: u64,
        #[serde(default)]
        delta_bytes: i64,
        #[serde(default)]
        claude_ms: f64,
        #[serde(default)]
        duration_ms: f64,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(serde::Serialize)]
struct UpdateBrainBatchResult {
    brain_file: String,
    action: String,
    total_files: u64,
    processed_files: u64,
    skipped_files: u64,
    total_summary_chars: u64,
    cerebro_bytes_before: u64,
    cerebro_bytes_after: u64,
    delta_bytes: i64,
    claude_ms: f64,
    duration_ms: f64,
}

#[tauri::command]
async fn update_channel_brain_batch(
    app: tauri::AppHandle,
    channel_dir: String,
    summary_files: Vec<String>,
) -> Result<UpdateBrainBatchResult, String> {
    if summary_files.is_empty() {
        return Err("summary_files is empty".into());
    }

    let scripts_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve resource dir: {e}"))?;
    let script_path = scripts_dir.join("_up_/scripts/update_brain_batch.py");

    if !script_path.exists() {
        return Err(format!(
            "Brain batch script not found at {}",
            script_path.display()
        ));
    }

    let app_handle = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = StdCommand::new("python3");
        cmd.arg(&script_path).arg(&channel_dir);
        for f in &summary_files {
            cmd.arg(f);
        }
        let mut child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start brain batch script: {e}"))?;

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let reader = std::io::BufReader::new(stdout);

        let mut final_result: Option<UpdateBrainBatchResult> = None;

        for line in reader.lines() {
            let line = line.map_err(|e| format!("Read error: {e}"))?;
            if line.trim().is_empty() {
                continue;
            }

            match serde_json::from_str::<UpdateBrainBatchOutput>(&line) {
                Ok(UpdateBrainBatchOutput::Progress { message }) => {
                    let _ = app_handle.emit(
                        "brain-batch-progress",
                        ScrapeProgress {
                            msg_type: "progress".into(),
                            message,
                        },
                    );
                }
                Ok(UpdateBrainBatchOutput::Result {
                    brain_file,
                    action,
                    total_files,
                    processed_files,
                    skipped_files,
                    total_summary_chars,
                    cerebro_bytes_before,
                    cerebro_bytes_after,
                    delta_bytes,
                    claude_ms,
                    duration_ms,
                }) => {
                    final_result = Some(UpdateBrainBatchResult {
                        brain_file,
                        action,
                        total_files,
                        processed_files,
                        skipped_files,
                        total_summary_chars,
                        cerebro_bytes_before,
                        cerebro_bytes_after,
                        delta_bytes,
                        claude_ms,
                        duration_ms,
                    });
                }
                Ok(UpdateBrainBatchOutput::Error { message }) => {
                    let _ = child.wait();
                    return Err(message);
                }
                Err(_) => continue,
            }
        }

        let _ = child.wait();
        final_result.ok_or_else(|| "No result from brain batch script".into())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

// ---------- Update channel brain (DELTA) command ----------

#[derive(serde::Deserialize, Debug)]
#[serde(tag = "type")]
enum UpdateBrainDeltaOutput {
    #[serde(rename = "progress")]
    Progress { message: String },
    #[serde(rename = "result")]
    Result {
        brain_file: String,
        action: String,
        #[serde(default)]
        total_files: u64,
        #[serde(default)]
        processed_files: u64,
        #[serde(default)]
        skipped_files: u64,
        #[serde(default)]
        cerebro_bytes_before: u64,
        #[serde(default)]
        cerebro_bytes_after: u64,
        #[serde(default)]
        delta_bytes: i64,
        #[serde(default)]
        prompt_bytes: u64,
        #[serde(default)]
        response_bytes: u64,
        #[serde(default)]
        claude_ms: f64,
        #[serde(default)]
        apply_ms: f64,
        #[serde(default)]
        duration_ms: f64,
        #[serde(default)]
        apply_report: Option<serde_json::Value>,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(serde::Serialize)]
struct UpdateBrainDeltaResult {
    brain_file: String,
    action: String,
    total_files: u64,
    processed_files: u64,
    skipped_files: u64,
    cerebro_bytes_before: u64,
    cerebro_bytes_after: u64,
    delta_bytes: i64,
    prompt_bytes: u64,
    response_bytes: u64,
    claude_ms: f64,
    apply_ms: f64,
    duration_ms: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    apply_report: Option<serde_json::Value>,
}

#[tauri::command]
async fn update_channel_brain_delta(
    app: tauri::AppHandle,
    channel_dir: String,
    summary_files: Vec<String>,
) -> Result<UpdateBrainDeltaResult, String> {
    if summary_files.is_empty() {
        return Err("summary_files is empty".into());
    }

    let scripts_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve resource dir: {e}"))?;
    let script_path = scripts_dir.join("_up_/scripts/update_brain_delta.py");

    if !script_path.exists() {
        return Err(format!(
            "Brain delta script not found at {}",
            script_path.display()
        ));
    }

    let app_handle = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = StdCommand::new("python3");
        cmd.arg(&script_path).arg(&channel_dir);
        for f in &summary_files {
            cmd.arg(f);
        }
        let mut child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start brain delta script: {e}"))?;

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let reader = std::io::BufReader::new(stdout);

        let mut final_result: Option<UpdateBrainDeltaResult> = None;

        for line in reader.lines() {
            let line = line.map_err(|e| format!("Read error: {e}"))?;
            if line.trim().is_empty() {
                continue;
            }

            match serde_json::from_str::<UpdateBrainDeltaOutput>(&line) {
                Ok(UpdateBrainDeltaOutput::Progress { message }) => {
                    let _ = app_handle.emit(
                        "brain-delta-progress",
                        ScrapeProgress {
                            msg_type: "progress".into(),
                            message,
                        },
                    );
                }
                Ok(UpdateBrainDeltaOutput::Result {
                    brain_file,
                    action,
                    total_files,
                    processed_files,
                    skipped_files,
                    cerebro_bytes_before,
                    cerebro_bytes_after,
                    delta_bytes,
                    prompt_bytes,
                    response_bytes,
                    claude_ms,
                    apply_ms,
                    duration_ms,
                    apply_report,
                }) => {
                    final_result = Some(UpdateBrainDeltaResult {
                        brain_file,
                        action,
                        total_files,
                        processed_files,
                        skipped_files,
                        cerebro_bytes_before,
                        cerebro_bytes_after,
                        delta_bytes,
                        prompt_bytes,
                        response_bytes,
                        claude_ms,
                        apply_ms,
                        duration_ms,
                        apply_report,
                    });
                }
                Ok(UpdateBrainDeltaOutput::Error { message }) => {
                    let _ = child.wait();
                    return Err(message);
                }
                Err(_) => continue,
            }
        }

        let _ = child.wait();
        final_result.ok_or_else(|| "No result from brain delta script".into())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
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

    let model = model.unwrap_or_else(|| "small".into());
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

    let model = model.unwrap_or_else(|| "small".into());
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
    skipped: u32,
    output_dir: String,
    exported_files: Vec<String>,
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
    let clean_name = request.channel_name.trim_start_matches('@');
    let channel_dir = base_dir.join(clean_name);

    std::fs::create_dir_all(&channel_dir)
        .map_err(|e| format!("Failed to create directory: {e}"))?;

    let mut exported: u32 = 0;
    let mut skipped: u32 = 0;
    let mut exported_files: Vec<String> = Vec::new();

    for video in &request.videos {
        let date_prefix = video.published_at.as_deref().unwrap_or("unknown-date");
        let title_slug = slugify(&video.title);
        let filename = format!("{date_prefix}_{title_slug}.md");

        // Organize into transcripciones/YYYY/ subfolders
        let year_folder = if date_prefix.len() >= 4 && date_prefix != "unknown-date" {
            &date_prefix[..4]
        } else {
            "sin-fecha"
        };
        let year_dir = channel_dir.join("transcripciones").join(year_folder);
        std::fs::create_dir_all(&year_dir)
            .map_err(|e| format!("Failed to create year directory: {e}"))?;
        let filepath = year_dir.join(&filename);

        // Skip if file already exists
        if filepath.exists() {
            skipped += 1;
            continue;
        }

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
        exported_files.push(filepath.to_string_lossy().to_string());
    }

    Ok(ExportResult {
        exported,
        skipped,
        output_dir: channel_dir.to_string_lossy().to_string(),
        exported_files,
    })
}

// ---------- Brain metrics telemetry ----------
//
// Single JSONL log, one line per chunk outcome. The caller (TS helper) already
// has the structured line; we only resolve the path, create the dir, and append.
//
// Path (macOS): ~/Library/Caches/youtube-transcriber/brain-metrics.jsonl
// On other platforms we fall back to $XDG_CACHE_HOME/youtube-transcriber/ (or
// $HOME/.cache/youtube-transcriber/ as a last resort). The app only targets
// macOS today; the fallbacks exist only so tests/dev on Linux don't crash.
//
// On any I/O failure the command returns Err and the TS side swallows it with
// console.warn — telemetry must never break the brain-update flow.

fn brain_metrics_dir() -> Result<PathBuf, String> {
    if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").map_err(|e| format!("HOME not set: {e}"))?;
        return Ok(PathBuf::from(home).join("Library").join("Caches").join("youtube-transcriber"));
    }
    if let Ok(xdg) = std::env::var("XDG_CACHE_HOME") {
        if !xdg.is_empty() {
            return Ok(PathBuf::from(xdg).join("youtube-transcriber"));
        }
    }
    let home = std::env::var("HOME").map_err(|e| format!("HOME not set: {e}"))?;
    Ok(PathBuf::from(home).join(".cache").join("youtube-transcriber"))
}

fn brain_metrics_path() -> Result<PathBuf, String> {
    let dir = brain_metrics_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir.join("brain-metrics.jsonl"))
}

/// Pure append helper — isolated from Tauri state so it can be unit-tested.
/// Appends exactly one newline-terminated record. Does not validate JSON
/// shape; the caller owns the schema.
fn append_metric_line(path: &Path, line: &str) -> std::io::Result<()> {
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
    let needs_nl = !line.ends_with('\n');
    f.write_all(line.as_bytes())?;
    if needs_nl {
        f.write_all(b"\n")?;
    }
    Ok(())
}

#[tauri::command]
async fn record_brain_metric(line: String) -> Result<(), String> {
    let path = brain_metrics_path()?;
    tauri::async_runtime::spawn_blocking(move || {
        append_metric_line(&path, &line)
            .map_err(|e| format!("write {}: {e}", path.display()))
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

#[cfg(test)]
mod brain_metrics_tests {
    use super::append_metric_line;
    use std::fs;
    use std::io::Read;

    #[test]
    fn appends_lines_and_terminates_with_newline() {
        let tmp = std::env::temp_dir().join(format!(
            "yt-brain-metrics-{}.jsonl",
            std::process::id()
        ));
        let _ = fs::remove_file(&tmp);

        append_metric_line(&tmp, r#"{"a":1}"#).unwrap();
        append_metric_line(&tmp, r#"{"b":2}"#).unwrap();
        // Pre-terminated line should not get double-newline.
        append_metric_line(&tmp, "{\"c\":3}\n").unwrap();

        let mut s = String::new();
        fs::File::open(&tmp).unwrap().read_to_string(&mut s).unwrap();
        assert_eq!(s, "{\"a\":1}\n{\"b\":2}\n{\"c\":3}\n");

        let _ = fs::remove_file(&tmp);
    }

    #[test]
    fn creates_file_on_first_write() {
        let tmp = std::env::temp_dir().join(format!(
            "yt-brain-metrics-new-{}.jsonl",
            std::process::id()
        ));
        let _ = fs::remove_file(&tmp);
        assert!(!tmp.exists());

        append_metric_line(&tmp, r#"{"hello":"world"}"#).unwrap();
        assert!(tmp.exists());

        let _ = fs::remove_file(&tmp);
    }
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
        Migration {
            version: 3,
            description: "add settings table for app preferences",
            sql: r#"
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
            "#,
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            resolve_channel,
            resolve_video,
            summarize_video,
            update_channel_brain,
            update_channel_brain_batch,
            update_channel_brain_delta,
            record_brain_metric,
            scrape_channel,
            process_batch,
            signal_batch,
            transcribe_single,
            export_channel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
