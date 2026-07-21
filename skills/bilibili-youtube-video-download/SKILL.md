---
name: bilibili-youtube-video-download
description: "Download videos from Bilibili (via public API, no cookies) and YouTube (via yt-dlp with auto-fallback). Supports single downloads and batch downloads. Also provides frame extraction for wiki document generation. Use when downloading video files for archival, transcription, or wiki article creation."
---

# Bilibili & YouTube Video Download

## Full Pipeline for Wiki Article Generation

This skill handles the **download** step. For the complete pipeline to produce wiki articles:

1. **Download video** — this skill (Bilibili or YouTube)
2. **Extract audio + transcribe** — use `youtube-audio-funasr-raw` skill (works for any video source, not just YouTube)
3. **Extract frames** — ffmpeg command below
4. **Generate wiki document** — manual/LLM step from transcript + frames

### Frame Extraction from Downloaded Video

After downloading a video, extract frames for wiki article illustrations:

```bash
TITLE="Video Title"
SOURCE="bilibili"  # or "youtube"
mkdir -p ~/rep/llm_wiki/raw/$SOURCE/"$TITLE"/frames
ffmpeg -y -i /path/to/video.mp4 \
  -vf "fps=1/60,scale=1280:-1" -q:v 3 \
  ~/rep/llm_wiki/raw/$SOURCE/"$TITLE"/frames/slide_%02d.jpg
```

Adjust `fps=1/60` for different intervals (`fps=1/30` = every 30s, `fps=1/120` = every 2min).

### Audio Extraction for Transcription

```bash
ffmpeg -i /path/to/video.mp4 -vn -c:a copy ~/rep/llm_wiki/raw/$SOURCE/"$TITLE"/audio.m4a
```

Then use the `youtube-audio-funasr-raw` skill's transcription step (it works for any audio file, not just YouTube).

## Audio-Only Download

Download just the audio track (for transcription / summarization):

```bash
python ~/.claude/skills/bilibili-youtube-video-download/scripts/download_bilibili_video.py \
  'https://www.bilibili.com/video/BVxxx/' -o output.m4a --audio-only

python ~/.claude/skills/bilibili-youtube-video-download/scripts/download_youtube_video.py \
  'https://www.youtube.com/watch?v=VIDEO_ID' -o output.m4a --audio-only
```

## Metadata Only

Get video info (title, duration, description) without downloading:

```bash
python ~/.claude/skills/bilibili-youtube-video-download/scripts/download_bilibili_video.py \
  'https://www.bilibili.com/video/BVxxx/' --metadata-only

python ~/.claude/skills/bilibili-youtube-video-download/scripts/download_youtube_video.py \
  'https://www.youtube.com/watch?v=VIDEO_ID' --metadata-only
```

## Single Bilibili Video

Download via Bilibili's public web API (no cookies required):

```bash
python ~/.claude/skills/bilibili-youtube-video-download/scripts/download_bilibili_video.py \
  'https://www.bilibili.com/video/BVxxx/' \
  -o output.mp4 \
  --quality 80
```

Quality values: `116` = 4K, `80` = 1080P (default), `64` = 720P, `32` = 480P.

Add `--metadata` to save a sidecar JSON with title, BV/CID, owner, duration, etc.

## Single YouTube Video

Download via yt-dlp with automatic version discovery and format fallback:

```bash
python ~/.claude/skills/bilibili-youtube-video-download/scripts/download_youtube_video.py \
  'https://www.youtube.com/watch?v=VIDEO_ID' \
  -o output.mp4
```

The script tries `~/.local/bin/yt-dlp` first, then system yt-dlp. Format fallback chain: best 1080P → 720P → best → format 18.

Add `--metadata` to save a sidecar JSON with title, video ID, channel, duration, etc.

## Batch Download

Create a JSON manifest and download all entries:

```bash
python ~/.claude/skills/bilibili-youtube-video-download/scripts/download_batch.py \
  manifest.json \
  --output-dir ./videos \
  --quality 80 \
  --audio-only
```

Manifest format:

```json
[
  {"url": "https://www.bilibili.com/video/BVxxx/", "output": "video-a.mp4"},
  {"url": "https://www.youtube.com/watch?v=yyy", "output": "video-b.mp4"}
]
```

The batch script auto-dispatches to the Bilibili or YouTube downloader based on URL domain.

## Defaults

- yt-dlp binary: `~/.local/bin/yt-dlp` (install/upgrade: `curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ~/.local/bin/yt-dlp && chmod +x ~/.local/bin/yt-dlp`)
- Bilibili quality: `80` (1080P)
- YouTube format: `bestvideo[height<=1080]+bestaudio/best[height<=1080]/best`
- Merge format: `mp4`

## Scripts

```bash
python ~/.claude/skills/bilibili-youtube-video-download/scripts/download_bilibili_video.py --help
python ~/.claude/skills/bilibili-youtube-video-download/scripts/download_youtube_video.py --help
python ~/.claude/skills/bilibili-youtube-video-download/scripts/download_batch.py --help
```

## Quality Checks

After downloading, verify:

```bash
ls -lh <output-dir>/
file <output.mp4>
```

- Bilibili API may return lower quality than requested if the video doesn't have that quality level available.
- If yt-dlp fails on YouTube, upgrade: `curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ~/.local/bin/yt-dlp && chmod +x ~/.local/bin/yt-dlp`
- Bilibili downloads require no cookies but are limited to public videos. The `Referer: https://www.bilibili.com` header is set automatically.
