#!/usr/bin/env python3
"""Download YouTube videos/audio via yt-dlp.

Supports audio-only extraction and metadata-only queries.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def find_ytdlp() -> str:
    candidates = [
        Path.home() / ".local" / "bin" / "yt-dlp",
        Path("/usr/local/bin/yt-dlp"),
    ]
    for c in candidates:
        if c.exists() and c.stat().st_size > 0:
            return str(c)
    system = shutil.which("yt-dlp")
    if system:
        return system
    raise RuntimeError(
        "yt-dlp not found. Install: "
        "curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp "
        "-o ~/.local/bin/yt-dlp && chmod +x ~/.local/bin/yt-dlp"
    )


def infer_video_id(url: str) -> str:
    parsed = urlparse(url)
    if parsed.netloc.endswith("youtu.be"):
        return parsed.path.strip("/")
    qid = parse_qs(parsed.query).get("v", [""])[0]
    if qid:
        return qid
    m = re.search(r"/(?:shorts|embed|live)/([^/?#]+)", parsed.path)
    return m.group(1) if m else ""


def get_metadata(ytdlp: str, url: str) -> dict:
    proc = subprocess.run(
        [ytdlp, "--dump-single-json", "--no-playlist", url],
        capture_output=True, text=True,
    )
    if proc.returncode == 0:
        try:
            return json.loads(proc.stdout)
        except json.JSONDecodeError:
            pass
    return {}


def download(ytdlp: str, url: str, output: Path, fmt: str, merge_format: str,
             extract_audio: bool = False) -> bool:
    cmd = [ytdlp, "-f", fmt, "-o", str(output), "--no-playlist", url]
    if extract_audio:
        cmd.extend(["--extract-audio", "--audio-format", "m4a"])
    else:
        cmd.extend(["--merge-output-format", merge_format])
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode == 0:
        return True
    print(f"  yt-dlp stderr: {proc.stderr.strip()[:300]}", file=sys.stderr)
    return False


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Download YouTube video/audio via yt-dlp.")
    p.add_argument("url", help="YouTube video URL")
    p.add_argument("-o", "--output", type=Path, help="Output file path")
    p.add_argument("--output-dir", type=Path, help="Output directory (auto-names from title)")
    p.add_argument("--format", default="", help="yt-dlp format string (auto-set based on mode)")
    p.add_argument("--merge-format", default="mp4", help="Merge output format")
    p.add_argument("--yt-dlp", default="", help="Path to yt-dlp binary")
    p.add_argument("--audio-only", action="store_true",
                   help="Download audio track only (m4a output)")
    p.add_argument("--metadata-only", action="store_true",
                   help="Print metadata JSON without downloading")
    p.add_argument("--metadata", action="store_true", help="Save sidecar metadata JSON")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    ytdlp = args.yt_dlp or find_ytdlp()
    vid = infer_video_id(args.url)

    info = get_metadata(ytdlp, args.url)
    title = info.get("title", vid)

    meta = {
        "source": "youtube",
        "video_id": vid,
        "title": title,
        "url": args.url,
        "channel": info.get("channel", ""),
        "duration": info.get("duration"),
        "description": (info.get("description") or "")[:500],
    }

    if args.metadata_only:
        print(json.dumps(meta, ensure_ascii=False, indent=2))
        return

    ext = "m4a" if args.audio_only else "%(ext)s"
    if args.output:
        out_file = args.output
    elif args.output_dir:
        safe = re.sub(r'[\\/:*?"<>|]+', "_", title)[:80]
        out_file = args.output_dir / f"{safe}.{ext}"
    else:
        safe = re.sub(r'[\\/:*?"<>|]+', "_", title)[:80]
        out_file = Path(f"{safe}.{ext}")

    out_file.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading: {title}")
    print(f"  URL: {args.url}")
    print(f"  Mode: {'audio-only' if args.audio_only else 'video'}")

    if args.audio_only:
        fmt = args.format or "bestaudio[ext=m4a]/bestaudio/best"
        formats_to_try = [fmt, "bestaudio", "best"]
    else:
        fmt = args.format or "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best"
        formats_to_try = [fmt, "bestvideo[height<=720]+bestaudio/best[height<=720]/best", "best", "18"]

    ok = False
    for f in formats_to_try:
        print(f"  Trying format: {f}")
        if download(ytdlp, args.url, out_file, f, args.merge_format, extract_audio=args.audio_only):
            ok = True
            break

    if not ok:
        print("error: all format attempts failed", file=sys.stderr)
        sys.exit(1)

    # Find actual output file
    stem = str(out_file).replace(".%(ext)s", "")
    actual = None
    search_exts = ["m4a", "opus", "ogg", "mp3", "webm"] if args.audio_only else ["mp4", "mkv", "webm", "flv"]
    for e in search_exts:
        candidate = Path(f"{stem}.{e}")
        if candidate.exists():
            actual = candidate
            break
    if not actual:
        candidates = list(out_file.parent.glob(f"{Path(stem).name}*"))
        actual = candidates[0] if candidates else out_file

    size_mb = actual.stat().st_size / (1024 * 1024) if actual.exists() else 0
    print(f"  Done: {actual} ({size_mb:.1f} MB)")

    if args.metadata and info:
        meta_file = actual.with_suffix(".json")
        meta_file.write_text(json.dumps(meta, ensure_ascii=False, indent=2))

    result = {"file": str(actual), "size_mb": round(size_mb, 1), "video_id": vid, "title": title}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise
