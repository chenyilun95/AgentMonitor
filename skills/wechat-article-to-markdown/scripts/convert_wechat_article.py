#!/usr/bin/env python3
import argparse
import json
import re
import time
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup
from markdownify import markdownify as markdownify


def safe_filename(title: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]+', " ", title).strip()
    name = re.sub(r"\s+", " ", name)
    return name or "WeChat Article"


def clean_url(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


def extension_for(url: str, content_type: str) -> str:
    fmt = (parse_qs(urlsplit(url).query).get("wx_fmt") or [""])[0].lower()
    if fmt in ("jpeg", "jpg"):
        return ".jpg"
    if fmt == "png":
        return ".png"
    if fmt == "gif":
        return ".gif"
    if "jpeg" in content_type:
        return ".jpg"
    if "png" in content_type:
        return ".png"
    if "webp" in content_type:
        return ".webp"
    if "gif" in content_type:
        return ".gif"
    return ".img"


def download_image(url: str, index: int, asset_dir: Path, referer: str) -> Path:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
        ),
        "Referer": referer,
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    }
    url = clean_url(url)
    with urlopen(Request(url, headers=headers), timeout=30) as response:
        body = response.read()
        content_type = response.headers.get("Content-Type", "").lower()
    path = asset_dir / f"image-{index:02d}{extension_for(url, content_type)}"
    path.write_bytes(body)
    return path


def normalize_markdown(text: str) -> str:
    text = text.replace("\xa0", " ")
    text = text.replace("****", "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"(!\[[^\]]*\]\([^)]+\))(?=!\[)", r"\1\n\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines = []
    for line in text.splitlines():
        if line.strip() in ("****", "** **"):
            continue
        lines.append(line.rstrip())
    return "\n".join(lines).strip()


def replace_wechat_videos(soup: BeautifulSoup) -> int:
    count = 0
    candidates = []
    for tag in soup.find_all(True):
        classes = tag.get("class") or []
        if isinstance(classes, str):
            classes = classes.split()
        if tag.get("data-mpvid") or tag.get("vid") or "video_iframe" in classes or tag.name == "video":
            if not any(parent in candidates for parent in tag.parents):
                candidates.append(tag)

    for tag in candidates:
        vid = tag.get("data-mpvid") or tag.get("vid") or ""
        video = tag.find("video") if tag.name != "video" else tag
        src = video.get("src") if video else ""
        label = f"视频：{vid}" if vid else "视频"
        if src:
            label = f"{label}（源视频链接可能会过期）"
        replacement = soup.new_tag("blockquote")
        p = soup.new_tag("p")
        p.string = label
        replacement.append(p)
        tag.replace_with(replacement)
        count += 1
    return count


def convert(input_path: Path, output_path: Path, asset_dir: Path, title_override: Optional[str], referer_override: Optional[str], download: bool) -> dict:
    data = json.loads(input_path.read_text(encoding="utf-8"))
    meta = data.get("meta", {})
    html = data.get("html", "")
    title = title_override or meta.get("title") or "WeChat Article"
    source_url = referer_override or meta.get("sourceUrl") or ""

    output_path.parent.mkdir(parents=True, exist_ok=True)
    asset_dir.mkdir(parents=True, exist_ok=True)

    soup = BeautifulSoup(html, "html.parser")
    raw_img_nodes = len(soup.find_all("img"))
    video_placeholders = replace_wechat_videos(soup)
    for tag in soup(["script", "style", "svg", "noscript"]):
        tag.decompose()
    for tag in soup.find_all(True):
        for attr in list(tag.attrs):
            if attr not in ("href", "src", "data-src", "alt"):
                del tag.attrs[attr]

    seen: dict[str, Path] = {}
    image_index = 0
    skipped_img_nodes = 0
    failures: list[tuple[int, str, str]] = []
    for img in soup.find_all("img"):
        url = img.get("data-src") or img.get("src") or ""
        if not url or url.startswith("data:"):
            skipped_img_nodes += 1
            img.decompose()
            continue
        url = clean_url(url)
        if url not in seen:
            image_index += 1
            if download:
                try:
                    path = download_image(url, image_index, asset_dir, source_url)
                    time.sleep(0.15)
                except Exception as exc:
                    failures.append((image_index, url, repr(exc)))
                    path = asset_dir / f"image-{image_index:02d}.missing"
            else:
                path = asset_dir / f"image-{image_index:02d}.img"
            seen[url] = path
        img["src"] = seen[url].relative_to(output_path.parent).as_posix()
        img["alt"] = img.get("alt") or "Image"

    body = markdownify(str(soup), heading_style="ATX", bullets="-")
    body = normalize_markdown(body)
    front = [
        f"# {title}",
        "",
    ]
    byline = " / ".join(x for x in [meta.get("author", ""), meta.get("publishTime", "")] if x)
    if byline:
        front.append(f"> {byline}")
    if source_url:
        front.append(f"> 原文：{source_url}")
    front.append("")
    output_path.write_text("\n".join(front) + body + "\n", encoding="utf-8")

    refs = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", output_path.read_text(encoding="utf-8"))
    missing = [ref for ref in refs if not (output_path.parent / ref).exists()]
    return {
        "output": str(output_path),
        "raw_img_nodes": raw_img_nodes,
        "images_seen": len(seen),
        "skipped_img_nodes": skipped_img_nodes,
        "image_refs": len(refs),
        "missing_refs": len(missing),
        "video_placeholders": video_placeholders,
        "failures": failures,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert exported WeChat article HTML JSON to Markdown with local images.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", type=Path, help="Markdown output file. Defaults to '<output-dir>/<original Chinese title>.md'.")
    parser.add_argument("--output-dir", type=Path, help="Directory used when --output is omitted.")
    parser.add_argument("--asset-dir", type=Path, help="Image output directory. Defaults to '<markdown-dir>/assets/<original Chinese title>'.")
    parser.add_argument("--referer")
    parser.add_argument("--title")
    parser.add_argument("--no-download", action="store_true")
    args = parser.parse_args()

    data = json.loads(args.input.read_text(encoding="utf-8"))
    meta = data.get("meta", {})
    title = args.title or meta.get("title") or "WeChat Article"
    if args.output:
        output = args.output
    else:
        if not args.output_dir:
            parser.error("--output or --output-dir is required")
        output = args.output_dir / f"{safe_filename(title)}.md"
    asset_dir = args.asset_dir or output.parent / "assets" / safe_filename(title)

    result = convert(args.input, output, asset_dir, args.title, args.referer, not args.no_download)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result["missing_refs"] or result["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
