---
name: xhs-talk-to-illustrated-notes
description: "Convert a Xiaohongshu talk/lecture video into illustrated Markdown notes with interleaved key-frame screenshots and per-section summaries. Orchestrates video download, FunASR audio transcription, ffmpeg frame extraction, and LLM-driven summarization into a single timestamped document."
---

# Xiaohongshu Talk → Illustrated Notes

End-to-end pipeline that turns a Xiaohongshu video note (typically a conference talk or lecture) into a polished Markdown document with key-frame screenshots interleaved with section-level summaries.

## When to Use

- The source is a **Xiaohongshu video note** containing a talk, lecture, or presentation with slides.
- The user wants a **readable study document** — not raw transcript, but organized summaries with slide screenshots at corresponding timestamps.
- The video is in Chinese (SenseVoice is the default ASR model).

## Prerequisites

| Dependency | Install |
|---|---|
| Python 3.10+ | system |
| Playwright + Chromium | `pip install playwright && python -m playwright install chromium` |
| beautifulsoup4 | `pip install beautifulsoup4` |
| FunASR + SenseVoice | `pip install funasr` (needs a venv with torch) |
| ffmpeg / ffprobe | system package |
| xvfb (headless Linux) | `apt install xvfb` |

Persistent browser profile for Xiaohongshu login: `~/.cache/codex/xiaohongshu-playwright`

## Workflow

### Step 1 — Download video

**Preferred method**: Use greenvideo.cc via the `xiaohongshu-audio-funasr-raw` skill (no login needed):

```bash
python3 \
  <skills>/xiaohongshu-audio-funasr-raw/scripts/download_xhs_via_greenvideo.py \
  'https://www.xiaohongshu.com/explore/NOTE_ID?...' \
  --output-dir /tmp/xhs-greenvideo \
  --download-video
```

This produces `video.mp4` and `audio.m4a` without touching any login session.

**Fallback**: If greenvideo.cc is down, intercept the video URL via Playwright. Xiaohongshu video URLs follow the pattern `sns-video-*.xhscdn.com/stream/…/*.mp4?sign=…&t=…`. Capture the mp4 URL from network responses via Playwright's `page.on("response", …)` callback, then download with curl:

```bash
curl -L -o video.mp4 \
  -H "Referer: https://www.xiaohongshu.com/" \
  "<captured-sns-video-url>"
```

On headless Linux, use `xvfb-run` for non-interactive Playwright runs. For interactive login, use the user's real display.

### Step 2 — Extract audio & transcribe

If using greenvideo.cc (Step 1 preferred method), `audio.m4a` is already extracted. Otherwise:

```bash
ffmpeg -i video.mp4 -vn -c:a copy audio.m4a
```

Transcribe with FunASR/SenseVoice:

```bash
# Linux
/home/yilunchen/.venvs/funasr/bin/python \
  <skills>/xiaohongshu-audio-funasr-raw/scripts/transcribe_xhs_audio_to_raw.py \
  --audio audio.m4a \
  --title '<中文标题>' \
  --note-id <note_id> \
  --source-url '<原始URL>' \
  --source-provider greenvideo \
  --raw-root ~/rep/llm_wiki/raw \
  --chunk-seconds 600

# macOS
/Users/ylchen/tmp/funasr-venv/bin/python \
  <skills>/xiaohongshu-audio-funasr-raw/scripts/transcribe_xhs_audio_to_raw.py \
  --audio audio.m4a \
  --title '<中文标题>' \
  --note-id <note_id> \
  --source-url '<原始URL>' \
  --source-provider greenvideo \
  --raw-root ~/rep/llm-wiki/raw \
  --chunk-seconds 600
```

Output: `transcript.md`, `transcript.txt`, `transcript.json`, `metadata.json` under `raw/xiaohongshu/<title>/`.

### Step 3 — Extract key frames (30 s interval)

```bash
# One frame per 30 seconds — the default density
ffmpeg -i video.mp4 -vf "fps=1/30" -q:v 2 frames/slide_%03d.jpg
```

For talks shorter than 10 min, use `fps=1/15`.

**Frame-number ↔ timestamp mapping** (interval = 30 s):

| Frame file | Timestamp |
|---|---|
| `slide_001.jpg` | 0:00 (the first frame, at t = 0 s) |
| `slide_002.jpg` | 0:30 |
| `slide_003.jpg` | 1:00 |
| `slide_NNN.jpg` | `(NNN - 1) × 30` seconds |

Formula: **`timestamp_seconds = (frame_number - 1) × 30`**, or equivalently **`frame_number = floor(timestamp_seconds / 30) + 1`**.

Use `%03d` (3-digit zero-padded) so numbering works for videos up to ~8 hours.

Frames go into `raw/xiaohongshu/<title>/frames/`.

### Step 4 — Generate illustrated notes (content-driven frame selection)

This is the core LLM step. It runs in **two phases** so that frame selection is driven by actual content timestamps, not arbitrary pre-chosen numbers.

#### Phase A — Analyze transcript & determine chapter timestamps

1. Read the full transcript (`transcript.md` or `transcript.txt`).
2. Divide the talk into logical chapters by topic (not fixed-length time blocks).
3. For each chapter, record:
   - **start / end time** (seconds)
   - **1–3 key content moments** within the chapter (timestamps in seconds) — points where a new slide appears, a demo is shown, a key claim is made, or the topic shifts.

This gives a list of content-driven timestamps that need illustration.

#### Phase B — Select frames by timestamp & write notes

For each content timestamp from Phase A:

1. **Compute the closest frame number**: `frame_number = floor(timestamp_seconds / 30) + 1`
2. **View that frame** (read the `slide_NNN.jpg` file) to confirm it shows relevant content.
3. If the frame is blurry or shows a transition, check the ±1 neighboring frames and pick the best one.

Then write a single Markdown document that:

- Follows **time order** of the talk — each section corresponds to a time range
- At each key content moment, inserts the **selected frame** as an inline image
- Maintains an overall density of roughly **one image per 30 seconds of talk** — for a 30-min talk this means ~60 images, for a 90-min talk ~180 images. Not every image needs prose; consecutive slides on the same sub-topic can be grouped under a single paragraph.
- Summarizes the content of each section in **the agent's own words** — not pasting transcript verbatim, but digesting it into clear, organized prose that preserves all technical details
- Preserves specific names, paper references, project URLs, and quotable remarks
- Includes a header block with speaker, conference, video link, and source URL

**Image path convention**: frames are stored at `../raw/xiaohongshu/<title>/frames/slide_NNN.jpg` relative to the output Markdown in `xiaohongshu/<title>.md`. URL-encode spaces as `%20`.

**Section granularity**: aim for 5–10 chapters for a 30-minute talk. Each chapter contains multiple images at their actual content timestamps.

### Step 5 — Verify

- All image paths in the Markdown resolve to existing files
- The document reads coherently as a standalone study note
- Key technical details (paper names, project URLs, specific claims) are preserved accurately

## Output Structure

```
xiaohongshu/
  <title>.md                          # Final illustrated notes
  assets/<title>/video-01.mp4         # Downloaded video

raw/xiaohongshu/<title>/
  audio.m4a                           # Extracted audio
  transcript.md                       # FunASR transcript (timestamped)
  transcript.txt                      # Plain text transcript
  transcript.json                     # Structured ASR results
  metadata.json                       # Source metadata
  frames/
    slide_001.jpg … slide_NNN.jpg     # Key frames (30 s apart)
```

## Practical Notes

- Xiaohongshu share links expire. The `xsec_token` parameter is time-limited. If the page shows "页面不见了", the token may have expired — ask the user for a fresh share link.
- Video URLs (`sns-video-*.xhscdn.com`) are also signed and expire within hours. Download immediately.
- On headless Linux servers without a display, use `xvfb-run` for non-interactive runs. For interactive login, use the user's real display (check `who` or `loginctl` for active X sessions).
- SenseVoice may misrecognize domain terms (e.g., "具身智能" → "巨身/巨深智能"). The summarization step naturally corrects these by interpreting context.
- For multi-speaker panels or Q&A sessions, note speaker transitions in the summary.
