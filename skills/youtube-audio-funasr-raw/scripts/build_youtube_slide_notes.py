#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import subprocess
from pathlib import Path


DEFAULT_YTDLP = "/Users/ylchen/tmp/youtube-raw-venv/bin/yt-dlp"
DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def run_json(cmd: list[str]) -> dict:
    proc = subprocess.run(cmd, check=True, text=True, capture_output=True)
    return json.loads(proc.stdout)


def safe_file_part(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-")[:80] or "section"


def human_ts(sec: float) -> str:
    sec = max(0, int(round(sec)))
    minutes, seconds = divmod(sec, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes:02d}:{seconds:02d}"


def file_ts(sec: float) -> str:
    sec = max(0, int(round(sec)))
    minutes, seconds = divmod(sec, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}-{minutes:02d}-{seconds:02d}"


def parse_vtt_time(value: str) -> float:
    match = re.match(r"(\d\d):(\d\d):(\d\d)\.(\d+)", value)
    if not match:
        raise ValueError(value)
    return int(match.group(1)) * 3600 + int(match.group(2)) * 60 + int(match.group(3)) + float("0." + match.group(4))


def clean_vtt_text(value: str) -> str:
    value = re.sub(r"<\d\d:\d\d:\d\d\.\d+>", "", value)
    value = re.sub(r"</?c[^>]*>", "", value)
    value = re.sub(r"<[^>]+>", "", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def merge_caption_windows(texts: list[str]) -> str:
    merged = ""
    for text in texts:
        if not text:
            continue
        if not merged:
            merged = text
            continue
        if text in merged[-500:]:
            continue
        best = 0
        for size in range(1, min(len(merged), len(text), 240) + 1):
            if merged[-size:] == text[:size]:
                best = size
        merged += text[best:] if best else " " + text
    return re.sub(r"\s+", " ", merged).strip()


def parse_vtt(path: Path) -> list[tuple[float, str]]:
    cues = []
    if not path.exists():
        return cues
    for block in path.read_text(encoding="utf-8").split("\n\n"):
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines or "-->" not in lines[0]:
            continue
        try:
            start = parse_vtt_time(lines[0].split("-->")[0].strip())
        except ValueError:
            continue
        text = clean_vtt_text(" ".join(lines[1:]))
        if text:
            cues.append((start, text))
    return cues


def load_summaries(path: Path | None) -> dict[str, str]:
    if not path:
        return {}
    data = json.loads(path.expanduser().read_text(encoding="utf-8"))
    if isinstance(data, list):
        return {str(item.get("chapter_index")): item.get("summary_zh", "") for item in data if isinstance(item, dict)}
    return {str(key): str(value) for key, value in data.items()}


def extract_frames(video: Path, slides_dir: Path, chapters: list[dict]) -> list[dict]:
    slides_dir.mkdir(parents=True, exist_ok=True)
    for old in slides_dir.glob("chapter-*.png"):
        old.unlink()
    frames = []
    for index, chapter in enumerate(chapters, 1):
        start = float(chapter["start_time"])
        end = float(chapter["end_time"])
        duration = end - start
        points = [("start", min(start + 1.0, max(start, end - 0.5)))]
        if duration >= 80:
            points.append(("mid", start + duration * 0.5))
        if duration >= 180:
            points.append(("late", start + duration * 0.78))
        for label, timestamp in points:
            name = f"chapter-{index:02d}-{label}-{file_ts(timestamp)}-{safe_file_part(chapter['title'])}.png"
            out = slides_dir / name
            run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", str(timestamp), "-i", str(video), "-frames:v", "1", "-q:v", "2", str(out)])
            frames.append({"chapter_index": index, "label": label, "time": timestamp, "file": name})
    return frames


def write_outputs(out_dir: Path, info: dict, sections: list[dict], frames: list[dict], make_html: bool, make_pdf: bool, chrome: str) -> None:
    frames_by_chapter: dict[int, list[dict]] = {}
    for frame in frames:
        frames_by_chapter.setdefault(int(frame["chapter_index"]), []).append(frame)

    title = info.get("title") or "YouTube Video"
    source = info.get("webpage_url") or f"https://www.youtube.com/watch?v={info.get('id', '')}"
    channel = info.get("channel") or info.get("uploader") or ""

    md_lines = [
        f"# {title} - 图文讲义",
        "",
        f"- Source: {source}",
        f"- Channel: {channel}",
        "- Method: YouTube chapter screenshots, timed captions, and detailed Chinese notes.",
        "- Original transcript: [transcript.md](transcript.md)",
        "- Audio-only archive: [audio.m4a](audio.m4a)",
        "",
        "> This is a reconstructed study deck from public video frames, not the original PPT/PDF file.",
        "",
    ]
    for index, section in enumerate(sections, 1):
        md_lines.append(f"## {index}. {section['title']} ({human_ts(section['start_time'])}-{human_ts(section['end_time'])})")
        md_lines.append("")
        for frame in frames_by_chapter.get(index, []):
            md_lines.append(f"![{section['title']} - {frame['label']} {human_ts(frame['time'])}](slides/{frame['file']})")
            md_lines.append("")
        summary = section.get("summary_zh", "").strip()
        if summary:
            md_lines.extend(["### 中文详尽笔记", "", summary, ""])
        md_lines.extend(["### English Captions", "", section.get("caption_text", ""), ""])
    (out_dir / "slide-notes.md").write_text("\n".join(md_lines).rstrip() + "\n", encoding="utf-8")

    (out_dir / "youtube-captions-by-chapter.json").write_text(json.dumps(sections, ensure_ascii=False, indent=2), encoding="utf-8")

    if make_html or make_pdf:
        css = """
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; margin: 40px auto; max-width: 980px; color: #151515; line-height: 1.55; }
h1 { font-size: 30px; margin-bottom: 8px; }
h2 { font-size: 22px; border-top: 1px solid #ddd; padding-top: 22px; margin-top: 34px; }
h3 { font-size: 17px; margin-top: 18px; }
.meta, .note { color: #555; }
.note { background: #f6f6f6; padding: 10px 12px; border-left: 4px solid #999; }
img { width: 100%; max-width: 900px; display: block; margin: 14px 0; border: 1px solid #ddd; }
a { color: #0645ad; }
@media print { body { max-width: none; margin: 18mm; } h2 { page-break-before: always; } img { max-height: 42vh; object-fit: contain; } }
"""
        parts = [f'<!doctype html><html><head><meta charset="utf-8"><title>{html.escape(title)} - 图文讲义</title><style>{css}</style></head><body>']
        parts.append(f"<h1>{html.escape(title)} - 图文讲义</h1>")
        parts.append(f'<p class="meta">Source: <a href="{html.escape(source)}">{html.escape(source)}</a><br>Channel: {html.escape(channel)}</p>')
        parts.append('<p class="note">This is a reconstructed study deck from public video frames, not the original PPT/PDF file.</p>')
        parts.append('<p><a href="transcript.md">Full FunASR transcript</a> | <a href="audio.m4a">Archived audio</a></p>')
        for index, section in enumerate(sections, 1):
            parts.append(f"<h2>{index}. {html.escape(section['title'])} <span class=\"meta\">({human_ts(section['start_time'])}-{human_ts(section['end_time'])})</span></h2>")
            for frame in frames_by_chapter.get(index, []):
                parts.append(f'<img src="slides/{html.escape(frame["file"])}" alt="{html.escape(section["title"])}">')
            if section.get("summary_zh", "").strip():
                parts.append(f"<h3>中文详尽笔记</h3><p>{html.escape(section['summary_zh'])}</p>")
            parts.append(f"<h3>English Captions</h3><p>{html.escape(section.get('caption_text', ''))}</p>")
        parts.append("</body></html>")
        html_path = out_dir / "slide-notes.html"
        html_path.write_text("\n".join(parts), encoding="utf-8")
        if make_pdf:
            chrome_path = shutil.which(chrome) or chrome
            run([chrome_path, "--headless", "--disable-gpu", "--no-sandbox", f"--print-to-pdf={out_dir / 'slide-notes.pdf'}", html_path.as_uri()])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build interleaved YouTube slide notes with screenshots, captions, and optional detailed Chinese notes.")
    parser.add_argument("url")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--yt-dlp", default=DEFAULT_YTDLP)
    parser.add_argument("--format", default="18")
    parser.add_argument("--extractor-args", default="youtube:player_client=android")
    parser.add_argument("--sub-lang", default="en")
    parser.add_argument("--summaries-json", type=Path, help="JSON mapping chapter index to detailed Chinese note, or list items with chapter_index/summary_zh.")
    parser.add_argument("--keep-video", action="store_true")
    parser.add_argument("--html", action="store_true")
    parser.add_argument("--pdf", action="store_true")
    parser.add_argument("--chrome", default=DEFAULT_CHROME)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    out_dir = args.output_dir.expanduser().resolve()
    work_dir = args.work_dir.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    ytdlp = shutil.which(args.yt_dlp) or args.yt_dlp
    extractor_args = ["--extractor-args", args.extractor_args] if args.extractor_args else []

    info = run_json([ytdlp, *extractor_args, "--dump-single-json", "--no-playlist", args.url])
    (out_dir / "youtube-info.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")

    chapters = info.get("chapters") or [{"start_time": 0, "end_time": info.get("duration") or 0, "title": info.get("title") or "Video"}]
    video_path = work_dir / "video.mp4"
    run([ytdlp, "--no-playlist", *extractor_args, "-f", args.format, "-o", str(work_dir / "video.%(ext)s"), args.url])
    if not video_path.exists():
        matches = sorted(work_dir.glob("video.*"))
        if not matches:
            raise RuntimeError("yt-dlp did not produce a video file")
        video_path = matches[0]

    run([ytdlp, *extractor_args, "--write-auto-subs", "--sub-lang", args.sub_lang, "--sub-format", "vtt", "--skip-download", "-o", str(work_dir / "captions.%(ext)s"), args.url])
    captions = work_dir / f"captions.{args.sub_lang}.vtt"
    cues = parse_vtt(captions)
    summaries = load_summaries(args.summaries_json)

    sections = []
    for index, chapter in enumerate(chapters, 1):
        start = float(chapter["start_time"])
        end = float(chapter["end_time"])
        texts = [text for timestamp, text in cues if start <= timestamp < end]
        sections.append(
            {
                "chapter_index": index,
                "title": chapter["title"],
                "start_time": start,
                "end_time": end,
                "summary_zh": summaries.get(str(index), ""),
                "caption_text": merge_caption_windows(texts),
            }
        )

    frames = extract_frames(video_path, out_dir / "slides", chapters)
    write_outputs(out_dir, info, sections, frames, make_html=args.html or args.pdf, make_pdf=args.pdf, chrome=args.chrome)
    if not args.keep_video:
        video_path.unlink(missing_ok=True)
    print(json.dumps({"out_dir": str(out_dir), "chapters": len(sections), "frames": len(frames), "has_summaries": bool(summaries)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
