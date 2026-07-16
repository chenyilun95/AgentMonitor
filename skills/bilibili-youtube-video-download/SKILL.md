---
name: bilibili-youtube-video-download
description: "Access Bilibili and YouTube videos — download audio tracks, metadata, or full video. Bilibili uses public API (no cookies). YouTube uses yt-dlp. Default mode is audio-only for transcription workflows. Use when an agent needs to access video/audio content from Bilibili or YouTube."
---

# Bilibili & YouTube Video Access

Access videos from Bilibili and YouTube. Default mode downloads **audio only** (for transcription, summarization, etc.). Full video download is available when needed.

## Audio-Only Download (Default)

### Bilibili

```bash
python <skills>/bilibili-youtube-video-download/scripts/download_bilibili_video.py \
  'https://www.bilibili.com/video/BVxxx/' \
  -o output.m4a \
  --audio-only
```

### YouTube

```bash
python <skills>/bilibili-youtube-video-download/scripts/download_youtube_video.py \
  'https://www.youtube.com/watch?v=VIDEO_ID' \
  -o output.m4a \
  --audio-only
```

## Metadata Only (No Download)

Get video title, duration, description without downloading anything:

### Bilibili

```bash
python <skills>/bilibili-youtube-video-download/scripts/download_bilibili_video.py \
  'https://www.bilibili.com/video/BVxxx/' \
  --metadata-only
```

### YouTube

```bash
python <skills>/bilibili-youtube-video-download/scripts/download_youtube_video.py \
  'https://www.youtube.com/watch?v=VIDEO_ID' \
  --metadata-only
```

Both print a JSON object with title, duration, source URL, etc.

## Full Video Download

Add no flags (omit `--audio-only`) to download the full video:

```bash
python <skills>/bilibili-youtube-video-download/scripts/download_bilibili_video.py \
  'https://www.bilibili.com/video/BVxxx/' \
  -o output.mp4 --quality 80

python <skills>/bilibili-youtube-video-download/scripts/download_youtube_video.py \
  'https://www.youtube.com/watch?v=VIDEO_ID' \
  -o output.mp4
```

Bilibili quality values: `116` = 4K, `80` = 1080P (default), `64` = 720P, `32` = 480P.

## Batch Download

```bash
python <skills>/bilibili-youtube-video-download/scripts/download_batch.py \
  manifest.json --output-dir ./media --audio-only
```

Manifest format:

```json
[
  {"url": "https://www.bilibili.com/video/BVxxx/", "output": "talk-a.m4a"},
  {"url": "https://www.youtube.com/watch?v=yyy", "output": "talk-b.m4a"}
]
```

Auto-dispatches to Bilibili or YouTube downloader based on URL domain.

## Defaults & Notes

- yt-dlp binary: `~/.local/bin/yt-dlp` → system yt-dlp (auto-discover)
- Bilibili: public API, no cookies, public videos only
- `--metadata` flag on any download also saves a sidecar `.json`
- Upgrade yt-dlp: `curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ~/.local/bin/yt-dlp && chmod +x ~/.local/bin/yt-dlp`
- `<skills>` path is resolved at deploy time via symlink

## Typical Workflow

1. `--metadata-only` to check video info (title, duration)
2. `--audio-only` to grab the audio track for transcription
3. Pipe audio to FunASR / Whisper for transcript
4. Full video download only if frames/screenshots are needed
