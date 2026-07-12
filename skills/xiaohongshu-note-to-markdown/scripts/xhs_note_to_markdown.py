#!/usr/bin/env python3
import argparse
import json
import re
import time
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


MEDIA_RE = re.compile(r"(sns-video|xhscdn).*\\.(mp4|m3u8)(\\?|$)", re.I)
IMAGE_RE = re.compile(r"(sns-img|sns-webpic|xhscdn).*\\.(jpg|jpeg|png|webp)(\\?|$)", re.I)


def normalize_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.path.startswith("/login"):
        redirect = parse_qs(parsed.query).get("redirectPath", [""])[0]
        if redirect:
            return unquote(redirect)
    return url


def note_id_from_url(url: str) -> str:
    match = re.search(r"/explore/([0-9a-fA-F]+)", url)
    return match.group(1) if match else ""


def safe_filename(title: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]+', " ", title).strip()
    name = re.sub(r"\\s+", " ", name)
    return name[:120] or "xiaohongshu-note"


def extension_for(url: str, content_type: str) -> str:
    lower = url.lower().split("?")[0]
    for ext in (".mp4", ".m3u8", ".jpg", ".jpeg", ".png", ".webp"):
        if lower.endswith(ext):
            return ".jpg" if ext == ".jpeg" else ext
    if "mpegurl" in content_type or "m3u8" in content_type:
        return ".m3u8"
    if "mp4" in content_type:
        return ".mp4"
    if "webp" in content_type:
        return ".webp"
    if "png" in content_type:
        return ".png"
    if "jpeg" in content_type or "jpg" in content_type:
        return ".jpg"
    return ".bin"


def download(url: str, path: Path, referer: str) -> None:
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        "Referer": referer,
        "Accept": "*/*",
    }
    with urlopen(Request(url, headers=headers), timeout=60) as response:
        body = response.read()
    path.write_bytes(body)


def is_login_wall(text: str) -> bool:
    return "手机号登录" in text and "获取验证码" in text and "登录后推荐" in text


def extract_page(page) -> Dict:
    return page.evaluate(
        r"""() => {
          const textOf = (sel) => document.querySelector(sel)?.innerText?.trim() || '';
          const titleFromDom = textOf('#detail-title') || textOf('.note-content .title') || textOf('.title');
          const descFromDom = textOf('#detail-desc') || textOf('.note-content .desc') || textOf('.desc');
          const author = textOf('.author .name') || textOf('.user-name') || textOf('.username') || textOf('.nickname');
          const rawText = document.body.innerText || '';
          const title = (titleFromDom || document.title.replace(/\s*-\s*小红书\s*$/, '')).trim();
          const lines = rawText.split('\n').map(x => x.trim()).filter(Boolean);
          const hashtags = Array.from(new Set(lines.join('\n').match(/#[^\s#]+/g) || []));
          const videos = Array.from(document.querySelectorAll('video')).map(v => ({
            src: v.currentSrc || v.src || '',
            poster: v.poster || '',
            readyState: v.readyState
          }));
          const images = Array.from(document.querySelectorAll('img')).map(img => ({
            src: img.currentSrc || img.src || '',
            alt: img.alt || '',
            width: img.naturalWidth || 0,
            height: img.naturalHeight || 0
          })).filter(img => img.src && !img.src.startsWith('data:'));
          const commentsStart = lines.findIndex(x => /^共\s*\d+\s*条评论/.test(x));
          let bodyText = descFromDom;
          if (!bodyText && title) {
            const idx = lines.findIndex(x => x === title);
            if (idx >= 0) {
              const stop = commentsStart > idx ? commentsStart : Math.min(lines.length, idx + 20);
              bodyText = lines.slice(idx + 1, stop).join('\n');
            }
          }
          return {
            url: location.href,
            pageTitle: document.title,
            title,
            author,
            bodyText,
            hashtags,
            rawText,
            textLength: rawText.length,
            videos,
            images
          };
        }"""
    )


def stimulate_media_loading(page) -> None:
    try:
        page.evaluate(
            r"""() => {
              const video = document.querySelector('video');
              if (video) {
                video.scrollIntoView({block: 'center'});
                video.muted = true;
                const attempt = video.play();
                if (attempt && attempt.catch) attempt.catch(() => {});
              }
            }"""
        )
        page.mouse.click(700, 500)
        time.sleep(5)
    except Exception:
        pass


def choose_images(images: List[Dict]) -> List[str]:
    selected: List[str] = []
    for img in images:
        src = img.get("src", "")
        if not src or src.startswith("data:"):
            continue
        if img.get("width", 0) < 200 and img.get("height", 0) < 200:
            continue
        if "avatar" in src or "fe-platform" in src:
            continue
        if src not in selected:
            selected.append(src)
    return selected[:20]


def write_markdown(output: Path, data: Dict, media_files: List[Path], image_files: List[Path], note_url: str, note_id: str) -> None:
    lines = [f"# {data.get('title') or '小红书笔记'}", ""]
    if data.get("author"):
        lines.append(f"> 作者：{data['author']}")
    lines.append(f"> 原文：{note_url}")
    if note_id:
        lines.append(f"> Note ID：{note_id}")
    lines.append("")
    body = (data.get("bodyText") or "").strip()
    if body:
        lines.extend([body, ""])
    if data.get("hashtags"):
        lines.extend(["## 标签", ""])
        lines.append(" ".join(data["hashtags"]))
        lines.append("")
    if media_files:
        lines.extend(["## 视频", ""])
        for path in media_files:
            rel = path.relative_to(output.parent).as_posix()
            lines.append(f"- [{path.name}]({rel})")
        lines.append("")
    if image_files:
        lines.extend(["## 图片", ""])
        for path in image_files:
            rel = path.relative_to(output.parent).as_posix()
            lines.append(f"![Image]({rel})")
            lines.append("")
    output.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Archive a Xiaohongshu note as Markdown with local media.")
    parser.add_argument("url")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--asset-dir", type=Path)
    parser.add_argument("--user-data-dir", type=Path, default=Path.home() / ".cache/codex/xiaohongshu-playwright")
    parser.add_argument("--interactive-login", action="store_true")
    parser.add_argument("--login-timeout", type=int, default=180, help="Seconds to wait for manual QR/SMS login when --interactive-login is set.")
    parser.add_argument("--no-download", action="store_true")
    parser.add_argument("--keep-browser-open", action="store_true")
    args = parser.parse_args()

    note_url = normalize_url(args.url)
    note_id = note_id_from_url(note_url)
    media_urls: List[str] = []

    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.user_data_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            str(args.user_data_dir),
            headless=False,
            viewport={"width": 1400, "height": 1000},
        )
        page = context.new_page()

        def on_response(response):
            url = response.url
            if MEDIA_RE.search(url) and url not in media_urls:
                media_urls.append(url)

        page.on("response", on_response)
        page.goto(note_url, wait_until="domcontentloaded", timeout=45000)
        try:
            page.wait_for_load_state("networkidle", timeout=12000)
        except PlaywrightTimeoutError:
            pass
        time.sleep(3)

        text = page.evaluate("() => document.body.innerText || ''")
        if is_login_wall(text) and args.interactive_login:
            print(f"Login required. Complete QR/SMS login in the opened browser. Waiting up to {args.login_timeout}s...")
            deadline = time.time() + args.login_timeout
            while time.time() < deadline:
                time.sleep(3)
                text = page.evaluate("() => document.body.innerText || ''")
                if not is_login_wall(text):
                    break
            page.goto(note_url, wait_until="domcontentloaded", timeout=45000)
            try:
                page.wait_for_load_state("networkidle", timeout=12000)
            except PlaywrightTimeoutError:
                pass
            time.sleep(3)
        elif is_login_wall(text):
            print("Warning: login wall detected. Rerun with --interactive-login if extraction is incomplete.")

        stimulate_media_loading(page)
        data = extract_page(page)
        if is_login_wall(data.get("rawText") or "") and (data.get("title") or "").strip() in ("手机号登录", "登录"):
            result = {
                "output": None,
                "title": data.get("title"),
                "note_id": note_id,
                "login_wall": True,
                "error": "login_required",
                "hint": "Rerun with --interactive-login and complete QR/SMS login in the opened browser.",
            }
            print(json.dumps(result, ensure_ascii=False, indent=2))
            context.close()
            return 2

        title = safe_filename(data.get("title") or note_id or "xiaohongshu-note")
        output = args.output_dir / f"{title}.md"
        asset_dir = args.asset_dir or args.output_dir / "assets" / title
        asset_dir.mkdir(parents=True, exist_ok=True)

        media_files: List[Path] = []
        image_files: List[Path] = []
        if not args.no_download:
            for idx, url in enumerate(media_urls, 1):
                ext = extension_for(url, "")
                path = asset_dir / f"video-{idx:02d}{ext}"
                download(url, path, note_url)
                media_files.append(path)
            for idx, url in enumerate(choose_images(data.get("images", [])), 1):
                ext = extension_for(url, "")
                path = asset_dir / f"image-{idx:02d}{ext}"
                try:
                    download(url, path, note_url)
                    image_files.append(path)
                except Exception:
                    continue

        write_markdown(output, data, media_files, image_files, note_url, note_id)

        result = {
            "output": str(output),
            "asset_dir": str(asset_dir),
            "title": data.get("title"),
            "author": data.get("author"),
            "note_id": note_id,
            "text_length": len(data.get("bodyText") or ""),
            "media_urls": len(media_urls),
            "media_files": len(media_files),
            "image_files": len(image_files),
            "login_wall": is_login_wall(data.get("rawText") or ""),
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))

        if args.keep_browser_open:
            print("Browser is left open. Press Enter to close.")
            input()
        context.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
