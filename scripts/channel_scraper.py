#!/usr/bin/env python3
"""
Channel scraper: extracts video list from a YouTube channel using yt-dlp.
Usage: python3 channel_scraper.py <channel_url>

Outputs JSON lines:
  {"type":"progress","message":"..."}
  {"type":"result","videos":[...]}
  {"type":"error","message":"..."}
"""

import json
import os
import shutil
import subprocess
import sys
import threading

# Tope duro del escaneo completo (canales enormes en red lenta). yt-dlp con
# --flat-playlist lista ~1000 videos en segundos; 15 min es muy holgado.
SCAN_TIMEOUT_S = 900

YTDLP_SEARCH_PATHS = [
    os.path.expanduser("~/.local/bin/yt-dlp"),
    "/opt/homebrew/bin/yt-dlp",
    "/usr/local/bin/yt-dlp",
]


def find_ytdlp() -> str:
    found = shutil.which("yt-dlp")
    if found:
        return found
    for p in YTDLP_SEARCH_PATHS:
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return "yt-dlp"


def scrape_channel(channel_url: str):
    print(json.dumps({"type": "progress", "message": "Starting yt-dlp scan..."}), flush=True)

    cmd = [
        find_ytdlp(),
        "--flat-playlist",
        "--dump-json",
        "--no-warnings",
        "--socket-timeout", "30",
        "--extractor-args", "youtubetab:approximate_date",
        channel_url,
    ]

    videos = []
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        # Drenar stderr en un hilo: si yt-dlp emite muchos errores por-video y
        # nadie lee ese pipe, se llena el buffer (~64KB) y AMBOS lados se
        # bloquean (deadlock clásico de pipes).
        stderr_chunks: list[str] = []
        def _drain():
            try:
                stderr_chunks.append(proc.stderr.read() or "")
            except Exception:
                pass
        t_err = threading.Thread(target=_drain, daemon=True)
        t_err.start()

        # Watchdog: mata el proceso si el escaneo excede el tope (red atorada).
        watchdog = threading.Timer(SCAN_TIMEOUT_S, proc.kill)
        watchdog.start()

        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            video_id = entry.get("id", "")
            title = entry.get("title", "")
            if not video_id or not title:
                continue

            duration = entry.get("duration")
            thumbnail = None
            thumbnails = entry.get("thumbnails")
            if thumbnails and isinstance(thumbnails, list):
                thumbnail = thumbnails[-1].get("url")

            upload_date = entry.get("upload_date")
            published_at = None
            if upload_date and len(upload_date) == 8:
                published_at = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}"

            videos.append({
                "id": video_id,
                "title": title,
                "url": f"https://www.youtube.com/watch?v={video_id}",
                "thumbnail": thumbnail,
                "duration": int(duration) if duration else None,
                "published_at": published_at,
            })

            if len(videos) % 50 == 0:
                print(json.dumps({"type": "progress", "message": f"Found {len(videos)} videos..."}), flush=True)

        proc.wait()
        watchdog.cancel()
        t_err.join(timeout=5)

        if proc.returncode != 0:
            stderr = (stderr_chunks[0] if stderr_chunks else "")
            # NO tirar el trabajo hecho: un solo video roto al final del canal
            # puede hacer que yt-dlp salga con código != 0. Si ya parseamos
            # videos, se entregan como resultado parcial con un aviso.
            if videos:
                print(json.dumps({"type": "progress",
                                  "message": (f"yt-dlp exited with code {proc.returncode} "
                                              f"(partial scan, kept {len(videos)} videos): {stderr[:300]}")}), flush=True)
            else:
                print(json.dumps({"type": "error", "message": f"yt-dlp exited with code {proc.returncode}: {stderr[:500]}"}), flush=True)
                sys.exit(1)

    except FileNotFoundError:
        print(json.dumps({"type": "error", "message": "yt-dlp not found. Install it with: pip install yt-dlp"}), flush=True)
        sys.exit(1)

    print(json.dumps({"type": "progress", "message": f"Scan complete. Found {len(videos)} videos."}), flush=True)
    print(json.dumps({"type": "result", "videos": videos}), flush=True)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"type": "error", "message": "Usage: channel_scraper.py <channel_url>"}), flush=True)
        sys.exit(1)
    scrape_channel(sys.argv[1])
