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
import subprocess
import sys


def scrape_channel(channel_url: str):
    print(json.dumps({"type": "progress", "message": "Starting yt-dlp scan..."}), flush=True)

    cmd = [
        "python3", "-m", "yt_dlp",
        "--flat-playlist",
        "--dump-json",
        "--no-warnings",
        "--extractor-args", "youtubetab:approximate_date",
        channel_url,
    ]

    videos = []
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

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

        if proc.returncode != 0:
            stderr = proc.stderr.read()
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
