#!/usr/bin/env python3
"""
Transcribe a YouTube video using yt-dlp (audio download) + whisper.
Usage: python3 transcribe.py <video_url> [--model <model>] [--language <lang>]

Outputs JSON lines to stdout:
  {"type":"progress","stage":"download","message":"..."}
  {"type":"progress","stage":"transcribe","message":"...","percent":50}
  {"type":"result","text":"...","language":"en","method":"whisper-<model>"}
  {"type":"error","message":"..."}

Requires: yt-dlp, openai-whisper (pip install openai-whisper)
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile


def emit(obj: dict):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def download_audio(video_url: str, output_path: str) -> str:
    """Download audio from YouTube video, return path to audio file."""
    emit({"type": "progress", "stage": "download", "message": "Downloading audio..."})

    cmd = [
        "python3", "-m", "yt_dlp",
        "--cookies-from-browser", "chrome",
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "5",
        "-o", output_path,
        "--no-warnings",
        "--no-playlist",
        video_url,
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {proc.stderr[:500]}")

    # yt-dlp may add extension
    for ext in [".mp3", ".m4a", ".opus", ".webm", ""]:
        candidate = output_path.rsplit(".", 1)[0] + ext if ext else output_path
        if os.path.exists(candidate):
            return candidate

    if os.path.exists(output_path):
        return output_path

    raise RuntimeError("Audio file not found after download")


def transcribe_with_whisper(audio_path: str, model_name: str, language=None) -> dict:
    """Transcribe audio file using OpenAI Whisper."""
    emit({"type": "progress", "stage": "transcribe", "message": f"Loading whisper model '{model_name}'..."})

    try:
        import whisper
    except ImportError:
        raise RuntimeError("whisper not installed. Run: pip install openai-whisper")

    model = whisper.load_model(model_name)

    emit({"type": "progress", "stage": "transcribe", "message": "Transcribing audio...", "percent": 10})

    options = {}
    if language:
        options["language"] = language

    result = model.transcribe(audio_path, **options)

    detected_lang = result.get("language", language or "unknown")
    full_text = result.get("text", "").strip()

    emit({"type": "progress", "stage": "transcribe", "message": "Transcription complete.", "percent": 100})

    return {
        "text": full_text,
        "language": detected_lang,
        "method": f"whisper-{model_name}",
    }


def transcribe_with_subtitles(video_url: str):
    """Try to get existing subtitles/auto-captions from YouTube."""
    emit({"type": "progress", "stage": "subtitles", "message": "Checking for existing subtitles..."})

    with tempfile.TemporaryDirectory() as tmpdir:
        out_template = os.path.join(tmpdir, "subs")
        cmd = [
            "python3", "-m", "yt_dlp",
            "--cookies-from-browser", "chrome",
            "--write-auto-sub",
            "--write-sub",
            "--sub-lang", "es,en",
            "--sub-format", "vtt",
            "--skip-download",
            "-o", out_template,
            "--no-warnings",
            "--no-playlist",
            video_url,
        ]

        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            return None

        # Only accept Spanish subtitles
        vtt_files = [f for f in os.listdir(tmpdir) if f.endswith(".vtt") and ".es." in f]
        for fname in vtt_files:
            vtt_path = os.path.join(tmpdir, fname)
            text = parse_vtt(vtt_path)
            if text and len(text) > 50:
                return {
                    "text": text,
                    "language": "es",
                    "method": "youtube-subtitles",
                }

    return None


def parse_vtt(path: str) -> str:
    """Extract plain text from a VTT subtitle file."""
    import re
    lines = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("WEBVTT") or line.startswith("Kind:") or line.startswith("Language:"):
                continue
            if "-->" in line:
                continue
            # Remove VTT tags: <00:00:39.155>, <c>, </c>, etc.
            clean = re.sub(r"<[^>]+>", "", line).strip()
            if not clean:
                continue
            # Remove duplicate consecutive lines (common in auto-captions)
            if not lines or lines[-1] != clean:
                lines.append(clean)
    return " ".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Transcribe a YouTube video")
    parser.add_argument("video_url", help="YouTube video URL")
    parser.add_argument("--model", default="base", help="Whisper model (tiny/base/small/medium/large)")
    parser.add_argument("--language", default="es", help="Language hint (e.g., en, es)")
    parser.add_argument("--skip-subtitles", action="store_true", help="Skip subtitle check, go straight to whisper")
    args = parser.parse_args()

    try:
        # Step 1: Try YouTube subtitles first (fast, no GPU needed)
        if not args.skip_subtitles:
            result = transcribe_with_subtitles(args.video_url)
            if result:
                emit({"type": "result", **result})
                return

        # Step 2: Download audio and transcribe with Whisper
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_template = os.path.join(tmpdir, "audio.mp3")
            audio_path = download_audio(args.video_url, audio_template)

            emit({"type": "progress", "stage": "download", "message": "Audio downloaded."})

            result = transcribe_with_whisper(audio_path, args.model, args.language)
            emit({"type": "result", **result})

    except Exception as e:
        emit({"type": "error", "message": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
