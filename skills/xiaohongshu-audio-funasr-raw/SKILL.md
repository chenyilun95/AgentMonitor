---
name: xiaohongshu-audio-funasr-raw
description: "Full pipeline for Xiaohongshu video notes: download video via greenvideo.cc → extract audio → FunASR transcription → extract video frames → generate wiki document. Use when archiving Xiaohongshu video-note talks into structured wiki articles with interleaved frame images."
---

# Xiaohongshu Audio FunASR Raw

## End-to-End Pipeline

The complete workflow from Xiaohongshu URL to wiki document:

1. **Download video** via greenvideo.cc (no login needed)
2. **Extract audio** from the downloaded video
3. **Transcribe** audio with FunASR/SenseVoice
4. **Extract frames** from video at regular intervals
5. **Generate wiki document** from transcript + frames (manual/LLM step)

## Step 1: Download Video via GreenVideo

Use greenvideo.cc to resolve public Xiaohongshu video URLs without login. This avoids login-wall and bot-detection issues.

```bash
python3 \
  ~/.codex/skills/xiaohongshu-audio-funasr-raw/scripts/download_xhs_via_greenvideo.py \
  'https://www.xiaohongshu.com/explore/NOTE_ID?...' \
  --output-dir /tmp/xhs-greenvideo \
  --download-video
```

The script writes:

- `greenvideo-result.json`: parsed metadata and resolved video URL
- `audio.m4a`: audio extracted from the remote video URL
- `video.mp4`: full video (when `--download-video` is passed)

For a quick test, add `--audio-seconds 60` to only extract the first 60 seconds.

**Move assets to raw/**: After download, copy video and audio to the raw directory:

```bash
TITLE="中文标题"
mkdir -p ~/rep/llm_wiki/raw/assets/"$TITLE"
mkdir -p ~/rep/llm_wiki/raw/xiaohongshu/"$TITLE"
cp /tmp/xhs-greenvideo/video.mp4 ~/rep/llm_wiki/raw/assets/"$TITLE"/video-01.mp4
cp /tmp/xhs-greenvideo/audio.m4a ~/rep/llm_wiki/raw/xiaohongshu/"$TITLE"/audio.m4a
```

## Step 2: Transcribe with FunASR

```bash
# Linux
/home/yilunchen/.venvs/funasr/bin/python \
  ~/.codex/skills/xiaohongshu-audio-funasr-raw/scripts/transcribe_xhs_audio_to_raw.py \
  --audio ~/rep/llm_wiki/raw/xiaohongshu/"$TITLE"/audio.m4a \
  --title "$TITLE" \
  --note-id NOTE_ID \
  --source-url 'https://www.xiaohongshu.com/explore/NOTE_ID?...' \
  --source-provider greenvideo \
  --raw-root ~/rep/llm_wiki/raw

# macOS
/Users/ylchen/tmp/funasr-venv/bin/python \
  ~/.codex/skills/xiaohongshu-audio-funasr-raw/scripts/transcribe_xhs_audio_to_raw.py \
  --audio ~/rep/llm-wiki/raw/xiaohongshu/"$TITLE"/audio.m4a \
  --title "$TITLE" \
  --note-id NOTE_ID \
  --source-url 'https://www.xiaohongshu.com/explore/NOTE_ID?...' \
  --source-provider greenvideo \
  --raw-root ~/rep/llm-wiki/raw
```

Output in `raw/xiaohongshu/<title>/`:

- `audio.m4a`: source audio
- `transcript.md`: readable Markdown transcript grouped by 10-minute chunks
- `transcript.txt`: plain merged transcript text
- `transcript.json`: structured raw FunASR results
- `metadata.json`: source/model metadata

## Step 3: Extract Video Frames

Extract one frame every 60 seconds from the downloaded video:

```bash
mkdir -p ~/rep/llm_wiki/raw/xiaohongshu/"$TITLE"/frames
ffmpeg -y -i ~/rep/llm_wiki/raw/assets/"$TITLE"/video-01.mp4 \
  -vf "fps=1/60,scale=1280:-1" -q:v 3 \
  ~/rep/llm_wiki/raw/xiaohongshu/"$TITLE"/frames/slide_%02d.jpg
```

This produces `slide_01.jpg`, `slide_02.jpg`, ... (one per minute of video). Adjust `fps=1/60` for different intervals:
- `fps=1/30` = one frame every 30 seconds (more frames)
- `fps=1/120` = one frame every 2 minutes (fewer frames)

## Step 4: Generate Wiki Document

Create a structured wiki article under `wiki/talks/` based on the transcript and frames. Reference format: `wiki/talks/dyna-york-yang-interview.md`.

Structure:

```markdown
# Talk Title

> **主讲人**：Name (Affiliation)
> **主题**：Topic description
> **时长**：约 Xmin
> **来源**：[Source](URL)

---

## 核心论点
One-paragraph summary of the main argument.

---

## 一、Section Title `[MM:SS-MM:SS]`

![Description](../../raw/xiaohongshu/<title>/frames/slide_XX.jpg)

Content from transcript, cleaned up and structured...

---

## 关键链接
| 项目 | 链接 |
|------|------|
| ... | ... |

#Tag1 #Tag2
```

Key guidelines:
- Interleave frame images at meaningful points (slide changes, demos, key diagrams)
- Use `../../raw/xiaohongshu/<title>/frames/slide_XX.jpg` for image paths
- Clean up ASR errors in technical terms (see Quality Checks below)
- Add timestamp ranges `[MM:SS-MM:SS]` to section headers
- Include quantitative results in tables where possible

After creating wiki doc, add an entry to `wiki/index.md` under the appropriate section.

## Platform-Specific Defaults

### Linux
- Python/FunASR: `/home/yilunchen/.venvs/funasr/bin/python`
- ffmpeg/ffprobe: system PATH (no prefix needed)
- Repo root: `~/rep/llm_wiki`

### macOS
- Python/FunASR: `/Users/ylchen/tmp/funasr-venv/bin/python`
- ffmpeg: `/opt/homebrew/bin/ffmpeg`
- ffprobe: `/opt/homebrew/bin/ffprobe`
- Repo root: `~/rep/llm-wiki`

### Common
- GreenVideo resolver: `https://greenvideo.cc/xiaohongshu`
- ASR model: `iic/SenseVoiceSmall`
- VAD model: `fsmn-vad`
- Output namespace: `raw/xiaohongshu/<safe-title>/`
- Chunk size: `600` seconds

## Script Reference

```bash
python ~/.codex/skills/xiaohongshu-audio-funasr-raw/scripts/download_xhs_via_greenvideo.py --help
python ~/.codex/skills/xiaohongshu-audio-funasr-raw/scripts/transcribe_xhs_audio_to_raw.py --help
```

Key options for `download_xhs_via_greenvideo.py`:

- `URL`: Xiaohongshu explore/share URL
- `--output-dir PATH`: where to write downloaded files
- `--download-video`: download full video MP4 (recommended for frame extraction)
- `--audio-seconds N`: extract only first N seconds (for smoke tests)

Key options for `transcribe_xhs_audio_to_raw.py`:

- `--audio PATH`: local audio file
- `--title TITLE`: preserve original Chinese title
- `--note-id ID`: Xiaohongshu note ID
- `--source-url URL`: original URL for metadata
- `--source-provider PROVIDER`: e.g. `greenvideo`
- `--raw-root PATH`: output root directory
- `--output-dir PATH`: explicit output directory
- `--chunk-seconds N`: defaults to `600`

## Quality Checks

After transcription:

```bash
ls -lh ~/rep/llm_wiki/raw/xiaohongshu/"$TITLE"
ls -lh ~/rep/llm_wiki/raw/xiaohongshu/"$TITLE"/frames/
wc -m ~/rep/llm_wiki/raw/xiaohongshu/"$TITLE"/transcript.txt
head -80 ~/rep/llm_wiki/raw/xiaohongshu/"$TITLE"/transcript.md
```

SenseVoice common ASR errors in embodied AI domain:
- `派林` / `派零` → `π0` (pi0)
- `VRM` → `VLM`
- `仿存` → `访存`
- `剧身` → `具身`
- `微微` / `V微` → `VLA`
- `呃` / `嗯` → remove filler words in wiki doc

When generating wiki documents, correct these terms and remove filler words. The raw transcript files should be kept as-is for archival.

## Troubleshooting

- **GreenVideo fails**: The service may be rate-limited or down. Retry after a few minutes, or try with a different URL format (share link vs explore link).
- **Large video files**: Videos can be 50-130 MB. Use `--audio-seconds` for testing before full download.
- **CDN disconnects**: Some CDNs drop long ffmpeg streams. Download the full video first (`--download-video`), then extract audio locally.
- **FunASR import errors**: Ensure the correct Python venv is used (platform-specific paths above).
