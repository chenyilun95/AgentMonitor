#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse


DEFAULT_FFMPEG = "/opt/homebrew/bin/ffmpeg"
DEFAULT_YTDLP = "/Users/ylchen/tmp/youtube-raw-venv/bin/yt-dlp"


def infer_video_id(url: str) -> str:
    parsed = urlparse(url)
    if parsed.netloc.endswith("youtu.be"):
        return parsed.path.strip("/")
    query_id = parse_qs(parsed.query).get("v", [""])[0]
    if query_id:
        return query_id
    match = re.search(r"/(?:shorts|embed|live)/([^/?#]+)", parsed.path)
    return match.group(1) if match else ""


def run_json(cmd: list[str]) -> dict:
    proc = subprocess.run(cmd, text=True, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"command failed: {' '.join(cmd)}")
    return json.loads(proc.stdout)


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def find_audio(out_dir: Path) -> Path:
    candidates = sorted(out_dir.glob("audio.*"))
    for candidate in candidates:
        if candidate.suffix.lower() in {".m4a", ".mp3", ".opus", ".webm", ".wav"}:
            return candidate
    raise RuntimeError(f"yt-dlp did not produce an audio file in {out_dir}")


def normalize_to_m4a(audio: Path, ffmpeg: str) -> Path:
    target = audio.with_name("audio.m4a")
    if audio.resolve() == target.resolve():
        return target
    tmp = target.with_suffix(".tmp.m4a")
    run([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(audio), "-vn", "-c:a", "aac", "-b:a", "128k", str(tmp)])
    tmp.replace(target)
    audio.unlink(missing_ok=True)
    return target


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download audio only from a YouTube URL with yt-dlp.")
    parser.add_argument("url")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--yt-dlp", default=DEFAULT_YTDLP)
    parser.add_argument("--ffmpeg", default=DEFAULT_FFMPEG)
    parser.add_argument("--title", default="")
    parser.add_argument("--video-id", default="")
    parser.add_argument("--format", default="bestaudio/best")
    parser.add_argument("--extractor-args", default="")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    out_dir = args.output_dir.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    ytdlp = shutil.which(args.yt_dlp) or args.yt_dlp
    base_ytdlp_args = []
    if args.extractor_args:
        base_ytdlp_args.extend(["--extractor-args", args.extractor_args])
    info = run_json([ytdlp, *base_ytdlp_args, "--dump-single-json", "--no-playlist", args.url])
    (out_dir / "youtube-info.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")

    for old in out_dir.glob("audio.*"):
        old.unlink()
    run(
        [
            ytdlp,
            "--no-playlist",
            *base_ytdlp_args,
            "-f",
            args.format,
            "-x",
            "--audio-format",
            "m4a",
            "--ffmpeg-location",
            str(Path(args.ffmpeg).parent),
            "-o",
            str(out_dir / "audio.%(ext)s"),
            args.url,
        ]
    )
    audio = normalize_to_m4a(find_audio(out_dir), args.ffmpeg)

    metadata = {
        "source": "youtube",
        "source_provider": "yt-dlp",
        "source_url": args.url,
        "video_id": args.video_id or info.get("id") or infer_video_id(args.url),
        "title": args.title or info.get("title") or "youtube-video",
        "channel": info.get("channel") or info.get("uploader") or "",
        "duration_seconds": info.get("duration"),
        "webpage_url": info.get("webpage_url") or args.url,
        "audio_file": audio.name,
    }
    (out_dir / "source-metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"out_dir": str(out_dir), **metadata}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise
