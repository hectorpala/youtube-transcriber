#!/usr/bin/env python3
"""
Resolve video + channel info from a YouTube video URL.
Usage: python3 resolve_video.py <video_url>

Outputs a single JSON line:
  {"type":"result","video_id":"...","title":"...","channel_id":"UC...","channel_name":"...","channel_url":"...","handle":"@...", "thumbnail":"...", "duration":123, "published_at":"2025-10-26"}
  {"type":"error","message":"..."}
"""

import json
import os
import shutil
import subprocess
import sys

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


def resolve_video(url: str):
    cmd = [
        find_ytdlp(),
        "--print", "%(id)s\t%(title)s\t%(channel_id)s\t%(channel)s\t%(channel_url)s\t%(duration)s\t%(upload_date)s\t%(thumbnail)s",
        "--no-download",
        "--no-warnings",
        "--no-playlist",
        url,
    ]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except FileNotFoundError:
        print(json.dumps({"type": "error", "message": "yt-dlp not found"}), flush=True)
        sys.exit(1)
    except subprocess.TimeoutExpired:
        print(json.dumps({"type": "error", "message": "Timed out resolving video"}), flush=True)
        sys.exit(1)

    if proc.returncode != 0:
        stderr = proc.stderr.strip()[:500]
        print(json.dumps({"type": "error", "message": f"yt-dlp error: {stderr}"}), flush=True)
        sys.exit(1)

    line = proc.stdout.strip()
    parts = line.split("\t")
    if len(parts) < 8:
        print(json.dumps({"type": "error", "message": "Could not extract video info"}), flush=True)
        sys.exit(1)

    video_id, title, channel_id, channel_name, channel_url, duration_str, upload_date, thumbnail = parts[:8]

    handle = None
    if "/@" in channel_url:
        handle = "@" + channel_url.split("/@")[-1].split("/")[0]
        channel_url = f"https://www.youtube.com/{handle}"

    duration = None
    if duration_str and duration_str != "NA":
        try:
            duration = int(float(duration_str))
        except ValueError:
            pass

    published_at = None
    if upload_date and len(upload_date) == 8 and upload_date != "NA":
        published_at = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}"

    print(json.dumps({
        "type": "result",
        "video_id": video_id,
        "title": title,
        "channel_id": channel_id,
        "channel_name": channel_name,
        "channel_url": channel_url,
        "handle": handle,
        "thumbnail": thumbnail if thumbnail != "NA" else None,
        "duration": duration,
        "published_at": published_at,
    }), flush=True)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"type": "error", "message": "Usage: resolve_video.py <video_url>"}), flush=True)
        sys.exit(1)
    resolve_video(sys.argv[1])
