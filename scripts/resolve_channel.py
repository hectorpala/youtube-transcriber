#!/usr/bin/env python3
"""
Resolve channel info from any YouTube URL (video or channel).
Usage: python3 resolve_channel.py <youtube_url>

Outputs a single JSON line:
  {"type":"result","channel_id":"UC...","channel_name":"...","channel_url":"https://..."}
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


def resolve_channel(url: str):
    cmd = [
        find_ytdlp(),
        "--print", "channel_id",
        "--print", "channel",
        "--print", "channel_url",
        "--playlist-items", "1",
        "--no-download",
        "--no-warnings",
        url,
    ]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except FileNotFoundError:
        print(json.dumps({"type": "error", "message": "yt-dlp not found"}), flush=True)
        sys.exit(1)
    except subprocess.TimeoutExpired:
        print(json.dumps({"type": "error", "message": "Timed out resolving channel"}), flush=True)
        sys.exit(1)

    if proc.returncode != 0:
        stderr = proc.stderr.strip()[:500]
        print(json.dumps({"type": "error", "message": f"yt-dlp error: {stderr}"}), flush=True)
        sys.exit(1)

    lines = proc.stdout.strip().split("\n")
    if len(lines) < 3:
        print(json.dumps({"type": "error", "message": "Could not extract channel info"}), flush=True)
        sys.exit(1)

    channel_id = lines[0].strip()
    channel_name = lines[1].strip()
    channel_url = lines[2].strip()

    # Extract handle from channel URL if available
    handle = None
    if "/@" in channel_url:
        handle = "@" + channel_url.split("/@")[-1].split("/")[0]
        # Prefer handle-based URL for scraping
        channel_url = f"https://www.youtube.com/{handle}"

    print(json.dumps({
        "type": "result",
        "channel_id": channel_id,
        "channel_name": channel_name,
        "channel_url": channel_url,
        "handle": handle,
    }), flush=True)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"type": "error", "message": "Usage: resolve_channel.py <youtube_url>"}), flush=True)
        sys.exit(1)
    resolve_channel(sys.argv[1])
