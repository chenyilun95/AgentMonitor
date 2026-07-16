#!/usr/bin/env python3
"""Download Bilibili videos via public web API (no cookies required).

Supports audio-only extraction and metadata-only queries.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import shutil
import sys
import urllib.request
from pathlib import Path

BILIBILI_REFERER = "https://www.bilibili.com"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
BV_RE = re.compile(r"BV([A-Za-z0-9]+)")


def _api_get(url: str) -> dict:
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Referer": BILIBILI_REFERER,
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    if data.get("code") != 0:
        raise RuntimeError(f"Bilibili API error: {data}")
    return data["data"]


def extract_bvid(url: str) -> str:
    m = BV_RE.search(url)
    if not m:
        raise ValueError(f"Cannot extract BV ID from: {url}")
    return "BV" + m.group(1)


def get_cid(bvid: str) -> tuple[int, dict]:
    data = _api_get(f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}")
    cid = data.get("cid") or data["pages"][0]["cid"]
    return cid, data


def get_stream_url(bvid: str, cid: int, qn: int = 80) -> str:
    data = _api_get(
        f"https://api.bilibili.com/x/player/playurl"
        f"?bvid={bvid}&cid={cid}&qn={qn}&fnval=1&fourk=0"
    )
    urls = data.get("durl")
    if not urls:
        raise RuntimeError(f"No stream URLs returned for {bvid}")
    return urls[0]["url"]


def download_stream(stream_url: str, output: Path, chunk_size: int = 1 << 20) -> None:
    req = urllib.request.Request(stream_url, headers={
        "User-Agent": USER_AGENT,
        "Referer": BILIBILI_REFERER,
    })
    with urllib.request.urlopen(req, timeout=120) as resp, output.open("wb") as fh:
        while True:
            chunk = resp.read(chunk_size)
            if not chunk:
                break
            fh.write(chunk)


def extract_audio(video_path: Path, audio_path: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found — needed for audio extraction")
    subprocess.run(
        [ffmpeg, "-i", str(video_path), "-vn", "-c:a", "copy", str(audio_path), "-y"],
        check=True, capture_output=True,
    )


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Download Bilibili video/audio via public API.")
    p.add_argument("url", help="Bilibili video URL")
    p.add_argument("-o", "--output", type=Path, help="Output file path")
    p.add_argument("--output-dir", type=Path, help="Output directory (auto-names from title)")
    p.add_argument("--quality", type=int, default=80,
                   help="Quality: 116=4K, 80=1080P, 64=720P, 32=480P (default: 80)")
    p.add_argument("--audio-only", action="store_true",
                   help="Extract audio track only (downloads video, extracts audio, removes video)")
    p.add_argument("--metadata-only", action="store_true",
                   help="Print metadata JSON without downloading")
    p.add_argument("--metadata", action="store_true", help="Save sidecar metadata JSON")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    bvid = extract_bvid(args.url)
    cid, info = get_cid(bvid)
    title = info.get("title", bvid)

    meta = {
        "source": "bilibili",
        "bvid": bvid,
        "cid": cid,
        "title": title,
        "url": args.url,
        "owner": info.get("owner", {}),
        "duration": info.get("duration"),
        "desc": info.get("desc", ""),
    }

    if args.metadata_only:
        print(json.dumps(meta, ensure_ascii=False, indent=2))
        return

    stream_url = get_stream_url(bvid, cid, qn=args.quality)
    meta["quality"] = args.quality

    ext = "m4a" if args.audio_only else "mp4"
    if args.output:
        out_file = args.output
    elif args.output_dir:
        safe = re.sub(r'[\\/:*?"<>|]+', "_", title)[:80]
        out_file = args.output_dir / f"{safe}.{ext}"
    else:
        out_file = Path(f"{bvid}.{ext}")

    out_file.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading: {title}")
    print(f"  BV: {bvid}, CID: {cid}, Quality: {args.quality}")

    if args.audio_only:
        tmp_video = out_file.with_suffix(".tmp.mp4")
        print(f"  → {tmp_video} (temp video)")
        download_stream(stream_url, tmp_video)
        print(f"  Extracting audio → {out_file}")
        extract_audio(tmp_video, out_file)
        tmp_video.unlink()
    else:
        print(f"  → {out_file}")
        download_stream(stream_url, out_file)

    size_mb = out_file.stat().st_size / (1024 * 1024)
    print(f"  Done: {size_mb:.1f} MB")

    if args.metadata:
        meta_file = out_file.with_suffix(".json")
        meta_file.write_text(json.dumps(meta, ensure_ascii=False, indent=2))
        print(f"  Metadata: {meta_file}")

    result = {"file": str(out_file), "size_mb": round(size_mb, 1), "bvid": bvid, "title": title}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise
