---
name: youtube-audio-funasr-raw
description: "Full pipeline for YouTube video talks: download audio/video → FunASR transcription → extract frames or chapter screenshots → generate wiki document with interleaved images. Use when archiving YouTube talks, podcasts, or slide videos into structured wiki articles."
---

# YouTube Audio FunASR Raw

## End-to-End Pipeline

The complete workflow from YouTube URL to wiki document:

1. **Download audio** (and optionally video for frame extraction)
2. **Transcribe** audio with FunASR/SenseVoice
3. **Extract frames** — either via chapter screenshots (preferred for talks with chapters) or regular-interval ffmpeg extraction
4. **Generate wiki document** from transcript + frames (manual/LLM step)

## Step 1: Download Audio

```bash
# Linux — yt-dlp from system PATH or ~/.local/bin/yt-dlp
python3 \
  ~/.codex/skills/youtube-audio-funasr-raw/scripts/download_youtube_audio.py \
  'https://www.youtube.com/watch?v=VIDEO_ID' \
  --output-dir /tmp/youtube-audio

# macOS
/Users/ylchen/tmp/youtube-raw-venv/bin/python \
  ~/.codex/skills/youtube-audio-funasr-raw/scripts/download_youtube_audio.py \
  'https://www.youtube.com/watch?v=VIDEO_ID' \
  --output-dir /tmp/youtube-audio
```

Output:

- `audio.m4a`: extracted audio only
- `youtube-info.json`: yt-dlp metadata
- `source-metadata.json`: compact metadata for downstream transcription

To also download the video (needed for frame extraction without chapters):

```bash
# Use the bilibili-youtube-video-download skill
python ~/.claude/skills/bilibili-youtube-video-download/scripts/download_youtube_video.py \
  'https://www.youtube.com/watch?v=VIDEO_ID' \
  -o /tmp/youtube-audio/video.mp4
```

## Step 2: Transcribe with FunASR

```bash
# Linux
/home/yilunchen/.venvs/funasr/bin/python \
  ~/.codex/skills/youtube-audio-funasr-raw/scripts/transcribe_youtube_audio_to_raw.py \
  --audio /tmp/youtube-audio/audio.m4a \
  --metadata /tmp/youtube-audio/source-metadata.json \
  --language zh \
  --raw-root ~/rep/llm_wiki/raw

# macOS
/Users/ylchen/tmp/funasr-venv/bin/python \
  ~/.codex/skills/youtube-audio-funasr-raw/scripts/transcribe_youtube_audio_to_raw.py \
  --audio /tmp/youtube-audio/audio.m4a \
  --metadata /tmp/youtube-audio/source-metadata.json \
  --language en \
  --raw-root ~/rep/llm-wiki/raw
```

Output in `raw/youtube/<title>/`:

- `audio.m4a`: copied source audio
- `transcript.md`: readable Markdown transcript grouped by chunk offset
- `transcript.txt`: plain merged transcript text
- `transcript.json`: structured raw FunASR results and per-chunk metadata
- `metadata.json`: compact source/model metadata

## Step 3: Extract Frames

### Option A: Chapter Screenshots (preferred for talks with chapters)

Use when the YouTube video has chapters. Downloads a temporary low-res video, extracts representative frames per chapter, and downloads timed English captions.

```bash
# Linux
python3 \
  ~/.codex/skills/youtube-audio-funasr-raw/scripts/build_youtube_slide_notes.py \
  'https://www.youtube.com/watch?v=VIDEO_ID' \
  --output-dir ~/rep/llm_wiki/raw/youtube/<title> \
  --work-dir /tmp/youtube-slide-work \
  --html --pdf

# macOS
/Users/ylchen/tmp/youtube-raw-venv/bin/python \
  ~/.codex/skills/youtube-audio-funasr-raw/scripts/build_youtube_slide_notes.py \
  'https://www.youtube.com/watch?v=VIDEO_ID' \
  --output-dir ~/rep/llm-wiki/raw/youtube/<title> \
  --work-dir /tmp/youtube-slide-work \
  --html --pdf
```

Output:

- `slides/chapter-*.png`: representative screenshots per chapter
- `youtube-captions-by-chapter.json`: chapter title, time range, English captions
- `slide-notes.md`: Markdown with screenshots and captions
- `slide-notes.html` / `slide-notes.pdf`: browser-readable/printable versions

**Adding detailed Chinese notes**: After the first run, write a `summaries-zh.json`:

```json
{
  "1": "本节详细内容...",
  "2": "本节详细内容..."
}
```

Then rerun with `--summaries-json /tmp/youtube-slide-work/summaries-zh.json --html --pdf`.

### Option B: Regular-Interval Frame Extraction (for videos without chapters)

Extract one frame every 60 seconds from the downloaded video:

```bash
TITLE="Video Title"
mkdir -p ~/rep/llm_wiki/raw/youtube/"$TITLE"/frames
ffmpeg -y -i /tmp/youtube-audio/video.mp4 \
  -vf "fps=1/60,scale=1280:-1" -q:v 3 \
  ~/rep/llm_wiki/raw/youtube/"$TITLE"/frames/slide_%02d.jpg
```

Adjust `fps=1/60` for different intervals (`fps=1/30` = every 30s, `fps=1/120` = every 2min).

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

![Description](../../raw/youtube/<title>/frames/slide_XX.jpg)

Content from transcript, cleaned up and structured...

---

## 关键链接
| 项目 | 链接 |
|------|------|
| ... | ... |

#Tag1 #Tag2
```

Key guidelines:
- Image paths: `../../raw/youtube/<title>/frames/slide_XX.jpg` (or `slides/chapter-XX.png` if using chapter screenshots)
- Clean up ASR errors in technical terms
- Add timestamp ranges to section headers
- Include quantitative results in tables where possible
- After creating wiki doc, add entry to `wiki/index.md`

## Platform-Specific Defaults

### Linux
- yt-dlp: `~/.local/bin/yt-dlp` or system PATH
- Python/FunASR: `/home/yilunchen/.venvs/funasr/bin/python`
- ffmpeg/ffprobe: system PATH
- Repo root: `~/rep/llm_wiki`

### macOS
- yt-dlp Python environment: `/Users/ylchen/tmp/youtube-raw-venv/bin/python`
- Python/FunASR: `/Users/ylchen/tmp/funasr-venv/bin/python`
- ffmpeg: `/opt/homebrew/bin/ffmpeg`
- ffprobe: `/opt/homebrew/bin/ffprobe`
- Repo root: `~/rep/llm-wiki`

### Common
- ASR model: `iic/SenseVoiceSmall`
- VAD model: `fsmn-vad`
- Output namespace: `raw/youtube/<safe-title>/`
- Chunk size: `600` seconds
- Language: `en` for English talks, `zh` for Chinese talks

## Script Reference

```bash
python ~/.codex/skills/youtube-audio-funasr-raw/scripts/download_youtube_audio.py --help
python ~/.codex/skills/youtube-audio-funasr-raw/scripts/transcribe_youtube_audio_to_raw.py --help
python ~/.codex/skills/youtube-audio-funasr-raw/scripts/build_youtube_slide_notes.py --help
```

Key options for `download_youtube_audio.py`:

- `URL`: YouTube video URL
- `--output-dir PATH`: where to write downloaded files
- `--extractor-args ARGS`: yt-dlp extractor args (e.g. `youtube:player_client=android`)
- `--format FORMAT`: yt-dlp format selection (e.g. `18` for PO token issues)
- `--title TITLE`: override output title

Key options for `transcribe_youtube_audio_to_raw.py`:

- `--audio PATH`: local audio file
- `--metadata PATH`: `source-metadata.json` from download step
- `--language LANG`: `en` or `zh`
- `--raw-root PATH`: output root directory
- `--chunk-seconds N`: defaults to `600`

Key options for `build_youtube_slide_notes.py`:

- `URL`: YouTube video URL
- `--output-dir PATH`: where to write slide notes and screenshots
- `--work-dir PATH`: temporary directory for downloaded video/captions
- `--summaries-json PATH`: detailed Chinese per-section notes
- `--html` / `--pdf`: generate browser-readable/printable versions

## Quality Checks

After transcription:

```bash
ls -lh ~/rep/llm_wiki/raw/youtube/<title>
ls -lh ~/rep/llm_wiki/raw/youtube/<title>/frames/  # or slides/
wc -m ~/rep/llm_wiki/raw/youtube/<title>/transcript.txt
head -80 ~/rep/llm_wiki/raw/youtube/<title>/transcript.md
```

SenseVoice may misspell names, acronyms, and domain terms. Keep `transcript.json` for raw data and do a correction pass when generating wiki documents.

For slide notes, verify that `slides/` images are meaningful and aligned with the matching chapter. YouTube auto captions may be cleaner than local ASR for English timing.
