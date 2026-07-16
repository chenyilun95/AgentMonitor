#!/usr/bin/env python3
"""Batch download videos/audio from a JSON manifest.

Dispatches to Bilibili API or yt-dlp based on URL domain.
Supports --audio-only to download audio tracks only.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent


def is_bilibili(url: str) -> bool:
    return "bilibili.com" in url or "b23.tv" in url


def download_one(url: str, output: Path, quality: int = 80, audio_only: bool = False) -> bool:
    script = SCRIPTS_DIR / ("download_bilibili_video.py" if is_bilibili(url) else "download_youtube_video.py")
    cmd = [sys.executable, str(script), url, "-o", str(output)]
    if is_bilibili(url):
        cmd.extend(["--quality", str(quality)])
    if audio_only:
        cmd.append("--audio-only")
    proc = subprocess.run(cmd)
    return proc.returncode == 0


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Batch download videos/audio from JSON manifest.")
    p.add_argument("manifest", type=Path, help="JSON manifest file")
    p.add_argument("--output-dir", type=Path, default=Path("."), help="Base output directory")
    p.add_argument("--quality", type=int, default=80, help="Bilibili quality (default: 80=1080P)")
    p.add_argument("--audio-only", action="store_true", help="Download audio tracks only")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    entries = json.loads(args.manifest.read_text())
    args.output_dir.mkdir(parents=True, exist_ok=True)

    results = {"success": [], "failed": []}
    for i, entry in enumerate(entries, 1):
        url = entry["url"]
        output = args.output_dir / entry["output"]
        print(f"\n[{i}/{len(entries)}] {url}")
        print(f"  → {output}")
        if download_one(url, output, args.quality, args.audio_only):
            results["success"].append(str(output))
        else:
            results["failed"].append({"url": url, "output": str(output)})

    print(f"\n{'='*60}")
    print(f"Success: {len(results['success'])}, Failed: {len(results['failed'])}")
    if results["failed"]:
        for f in results["failed"]:
            print(f"  FAILED: {f['url']}")
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise
