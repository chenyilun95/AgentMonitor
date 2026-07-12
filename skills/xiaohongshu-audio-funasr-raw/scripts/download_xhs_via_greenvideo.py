#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


DEFAULT_FFMPEG = "/opt/homebrew/bin/ffmpeg"
GREENVIDEO_URL = "https://greenvideo.cc/xiaohongshu"
NOTE_ID_RE = re.compile(r"/(?:explore|discovery/item|search_result)/([0-9a-fA-F]{24})")


def safe_name(value: str) -> str:
    value = re.sub(r'[\\/:*?"<>|]+', " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value[:120] or "untitled"


def infer_note_id(url: str) -> str:
    match = NOTE_ID_RE.search(url)
    return match.group(1) if match else ""


def pick_video_item(info: dict) -> dict:
    for key in ("videoItemVoList", "videoInfoVoList", "videoListItemVoList"):
        for item in info.get(key) or []:
            base_url = item.get("baseUrl") or item.get("url") or item.get("videoUrl") or ""
            if item.get("fileType") == "video" and base_url.startswith("http"):
                item = dict(item)
                item["_base_url"] = base_url
                return item
    raise RuntimeError("GreenVideo parsed the note, but no downloadable video item was found.")


def parse_with_greenvideo(url: str, headed: bool, timeout_ms: int) -> tuple[dict, str]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError("Python Playwright is required: python3 -m pip install playwright") from exc

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headed)
        page = browser.new_page(
            viewport={"width": 1400, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        page.goto(GREENVIDEO_URL, wait_until="domcontentloaded", timeout=timeout_ms)
        page.locator("input.n-input__input-el").fill(url)
        page.locator("button.button-1").click()

        deadline = time.time() + timeout_ms / 1000
        info = None
        while time.time() < deadline:
            info = page.evaluate(
                """() => {
                    const pinia = document.querySelector('#__nuxt')
                      ?.__vue_app__?.config?.globalProperties?.$pinia;
                    return pinia?.state?.value?.video?.videoExtractInfo || null;
                }"""
            )
            if info and (info.get("videoItemVoList") or info.get("videoInfoVoList") or info.get("videoListItemVoList")):
                break
            time.sleep(0.5)

        page_text = page.locator("body").inner_text(timeout=5000)[:4000]
        browser.close()

    if not info or not (info.get("videoItemVoList") or info.get("videoInfoVoList") or info.get("videoListItemVoList")):
        raise RuntimeError(f"GreenVideo did not return video data. Page text: {page_text[:500]}")
    return info, page_text


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def download_file(url: str, out_file: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as response, out_file.open("wb") as fh:
        shutil.copyfileobj(response, fh)


def extract_audio(video_url: str, out_file: Path, ffmpeg: str, seconds: int | None) -> None:
    cmd = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-user_agent",
        "Mozilla/5.0",
        "-i",
        video_url,
        "-vn",
        "-c:a",
        "copy",
    ]
    if seconds:
        cmd.extend(["-t", str(seconds)])
    cmd.append(str(out_file))
    run(cmd)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Resolve a Xiaohongshu video note via GreenVideo and extract audio without using a local Xiaohongshu account.")
    parser.add_argument("url", help="Xiaohongshu note/share URL")
    parser.add_argument("--output-dir", type=Path, help="Directory for greenvideo-result.json and audio.m4a")
    parser.add_argument("--ffmpeg", default=DEFAULT_FFMPEG)
    parser.add_argument("--timeout-ms", type=int, default=90000)
    parser.add_argument("--headed", action="store_true", help="Show the browser for debugging")
    parser.add_argument("--audio-seconds", type=int, help="Extract only the first N seconds for smoke tests")
    parser.add_argument("--download-video", action="store_true", help="Also download video.mp4. Long Xiaohongshu videos can be very large.")
    parser.add_argument("--no-audio", action="store_true", help="Only resolve metadata/video URL")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    note_id = infer_note_id(args.url)
    out_dir = args.output_dir.expanduser().resolve() if args.output_dir else Path("~/tmp/xhs-greenvideo").expanduser() / (note_id or str(int(time.time())))
    out_dir.mkdir(parents=True, exist_ok=True)

    info, page_text = parse_with_greenvideo(args.url, args.headed, args.timeout_ms)
    video_item = pick_video_item(info)
    video_url = video_item["_base_url"]
    title = info.get("displayTitle") or info.get("title") or note_id or "xiaohongshu-video"

    result = {
        "source": "xiaohongshu",
        "source_provider": "greenvideo",
        "source_url": args.url,
        "note_id": info.get("vid") or note_id,
        "title": title,
        "video_url": video_url,
        "video_item": video_item,
        "greenvideo_info": info,
        "page_text_excerpt": page_text,
    }
    (out_dir / "greenvideo-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.download_video:
        download_file(video_url, out_dir / "video.mp4")
    if not args.no_audio:
        extract_audio(video_url, out_dir / "audio.m4a", args.ffmpeg, args.audio_seconds)

    summary = {
        "out_dir": str(out_dir),
        "note_id": result["note_id"],
        "title": title,
        "video_url": video_url,
        "audio_file": str(out_dir / "audio.m4a") if not args.no_audio else "",
        "metadata_file": str(out_dir / "greenvideo-result.json"),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise
