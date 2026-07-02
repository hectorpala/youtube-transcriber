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
import shutil
import subprocess
import sys
import tempfile
from typing import Optional

# Re-exec with a Python that has whisper installed, if the current one doesn't.
# whisper is installed via pipx at ~/.local/pipx/venvs/openai-whisper/
WHISPER_PYTHON_CANDIDATES = [
    os.path.expanduser("~/.local/pipx/venvs/openai-whisper/bin/python"),
    os.path.expanduser("~/.local/pipx/venvs/openai-whisper/bin/python3"),
]


def _ensure_path():
    """Ensure ffmpeg and other tools are in PATH (Tauri strips PATH on macOS)."""
    extra = ["/opt/homebrew/bin", "/usr/local/bin", os.path.expanduser("~/.local/bin")]
    current = os.environ.get("PATH", "").split(":")
    for p in extra:
        if p not in current:
            current.insert(0, p)
    os.environ["PATH"] = ":".join(current)


_ensure_path()


def ensure_whisper_python():
    """If current Python lacks whisper, re-exec with a Python that has it."""
    try:
        import whisper  # noqa: F401
        return
    except ImportError:
        pass

    for candidate in WHISPER_PYTHON_CANDIDATES:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            if os.path.realpath(candidate) == os.path.realpath(sys.executable):
                return
            os.execv(candidate, [candidate, __file__, *sys.argv[1:]])


ensure_whisper_python()

YTDLP_SEARCH_PATHS = [
    os.path.expanduser("~/.local/bin/yt-dlp"),
    "/opt/homebrew/bin/yt-dlp",
    "/usr/local/bin/yt-dlp",
]

FFMPEG_SEARCH_DIRS = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    os.path.expanduser("~/.local/bin"),
]


def find_ytdlp() -> str:
    found = shutil.which("yt-dlp")
    if found:
        return found
    for p in YTDLP_SEARCH_PATHS:
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return "yt-dlp"


def find_ffmpeg_dir() -> Optional[str]:
    """Directory containing ffmpeg + ffprobe, for yt-dlp --ffmpeg-location."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return os.path.dirname(ffmpeg)
    for d in FFMPEG_SEARCH_DIRS:
        if os.path.isfile(os.path.join(d, "ffmpeg")) and os.path.isfile(os.path.join(d, "ffprobe")):
            return d
    return None


def emit(obj: dict):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def download_audio(video_url: str, output_path: str) -> str:
    """Download audio from YouTube video, return path to audio file."""
    emit({"type": "progress", "stage": "download", "message": "Downloading audio..."})

    cmd = [
        find_ytdlp(),
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "5",
        "-o", output_path,
        "--no-warnings",
        "--no-playlist",
        "--socket-timeout", "30",
    ]

    ffmpeg_dir = find_ffmpeg_dir()
    if ffmpeg_dir:
        cmd.extend(["--ffmpeg-location", ffmpeg_dir])

    cmd.append(video_url)

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    except subprocess.TimeoutExpired:
        raise RuntimeError("yt-dlp timed out downloading audio (30 min)")
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


def _try_subtitle_lang(video_url: str, lang: str):
    """Fetch captions for a single language. Returns dict on success, None otherwise.

    Isolated per-language subprocess + tempdir so a failure on one language
    (e.g. HTTP 429 on YouTube's auto-translate path when asking `es` for an
    English-only video) cannot abort the attempt for the other language.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        out_template = os.path.join(tmpdir, "subs")
        cmd = [
            find_ytdlp(),
            "--write-auto-sub",
            "--write-sub",
            "--sub-lang", lang,
            "--sub-format", "vtt",
            "--skip-download",
            "-o", out_template,
            "--no-warnings",
            "--no-playlist",
            "--socket-timeout", "30",
            video_url,
        ]
        try:
            subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        except subprocess.TimeoutExpired:
            return None  # network stall — fall through to next lang / whisper
        # Ignore return code — only the on-disk file matters.
        for fname in os.listdir(tmpdir):
            if fname.endswith(".vtt") and f".{lang}." in fname:
                text = parse_vtt(os.path.join(tmpdir, fname))
                if text and len(text) > 50:
                    return {
                        "text": text,
                        "language": lang,
                        "method": "youtube-subtitles",
                    }
    return None


def transcribe_with_subtitles(video_url: str):
    """Try YouTube subtitles, language by language.

    Each language gets its own yt-dlp call so a 429 on one (typically the
    en↔es auto-translate request, which YouTube rate-limits more aggressively
    than manual tracks) cannot abort the next. Only after both languages fail
    does the caller fall back to Whisper.

    Order: en first, then es. Asking `es` first on an English-only channel
    forces an en→es auto-translate and frequently 429s; en-first short-circuits
    that. On Spanish channels with a manual `es` track, en yields nothing and
    es resolves on the second call (one extra ~1-2s yt-dlp call).
    """
    emit({"type": "progress", "stage": "subtitles",
          "message": "Checking for existing subtitles..."})

    for lang in ("en", "es"):
        result = _try_subtitle_lang(video_url, lang)
        if result:
            return result
        emit({"type": "progress", "stage": "subtitles",
              "message": f"No {lang} subtitles, trying next..."})

    return None


def parse_vtt(path: str) -> str:
    """Extract plain text from a VTT subtitle file.

    YouTube auto-captions duplican con ventana deslizante: una línea reaparece
    con palabras nuevas al final (no idéntica ni siempre consecutiva). Además
    del dedup exacto, se hace dedup por SOLAPAMIENTO: si la línea nueva empieza
    con el final de lo ya acumulado, solo se agrega la cola nueva.
    """
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
            # Dedup exacto consecutivo (idénticas seguidas)
            if lines and lines[-1] == clean:
                continue
            # Dedup por solapamiento con las últimas 2 líneas: auto-caption
            # repite la línea anterior + palabras nuevas. Si `clean` empieza
            # igual que una línea previa reciente, conservar solo la cola.
            merged = False
            for back in (1, 2):
                if len(lines) >= back:
                    prev = lines[-back]
                    if clean.startswith(prev) and len(clean) > len(prev):
                        tail = clean[len(prev):].strip()
                        if tail:
                            lines.append(tail)
                        merged = True
                        break
                    if prev == clean:  # duplicada no-consecutiva inmediata
                        merged = True
                        break
            if not merged:
                lines.append(clean)
    return " ".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Transcribe a YouTube video")
    parser.add_argument("video_url", help="YouTube video URL")
    parser.add_argument("--model", default="small", help="Whisper model (tiny/base/small/medium/large)")
    parser.add_argument("--language", default=None, help="Language hint (e.g., en, es). If omitted, whisper auto-detects.")
    parser.add_argument("--skip-subtitles", action="store_true", help="Skip subtitle check, go straight to whisper")
    args = parser.parse_args()

    try:
        # Step 1: Try YouTube subtitles first (fast, no GPU needed)
        if not args.skip_subtitles:
            result = transcribe_with_subtitles(args.video_url)
            if result:
                emit({"type": "result", **result})
                return

        # Step 2: Download audio and transcribe with Whisper.
        # Verificar whisper ANTES de descargar: sin él, la descarga es ancho de
        # banda tirado (el import de transcribe_with_whisper fallaría después).
        try:
            import whisper  # noqa: F401
        except ImportError:
            emit({"type": "error", "message": "whisper no está instalado (pipx install openai-whisper). No se descarga audio."})
            sys.exit(1)

        # Audio en caché persistente por video: si whisper crashea o se cancela,
        # el próximo intento NO re-descarga (cientos de MB). Se borra al lograr
        # la transcripción.
        import hashlib
        import re as _re
        m = _re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})", args.video_url)
        vid = m.group(1) if m else hashlib.sha1(args.video_url.encode()).hexdigest()[:16]
        cache_dir = os.path.expanduser("~/Library/Caches/youtube-transcriber/audio")
        os.makedirs(cache_dir, exist_ok=True)
        audio_template = os.path.join(cache_dir, f"{vid}.mp3")

        cached = None
        for ext in (".mp3", ".m4a", ".opus", ".webm"):
            p = os.path.join(cache_dir, f"{vid}{ext}")
            if os.path.isfile(p) and os.path.getsize(p) > 0:
                cached = p
                break
        if cached:
            emit({"type": "progress", "stage": "download", "message": "Audio cacheado de un intento previo — sin re-descargar."})
            audio_path = cached
        else:
            audio_path = download_audio(args.video_url, audio_template)
            emit({"type": "progress", "stage": "download", "message": "Audio downloaded."})

        result = transcribe_with_whisper(audio_path, args.model, args.language)
        try:
            os.unlink(audio_path)  # éxito: liberar la caché de este video
        except OSError:
            pass
        emit({"type": "result", **result})

    except Exception as e:
        emit({"type": "error", "message": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
