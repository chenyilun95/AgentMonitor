---
name: youtube-audio-funasr-raw
description: Archive YouTube talks into llm-wiki raw/ by downloading audio, transcribing with FunASR/SenseVoice, and optionally reconstructing interleaved slide notes from YouTube chapter screenshots, timed English captions, and detailed Chinese per-section notes. Use when processing YouTube speech, talks, podcasts, or slide videos into Markdown/HTML/PDF study notes.
---

# YouTube Audio FunASR Raw

## Audio Transcript Workflow

1. Resolve and download audio only:

```bash
/Users/ylchen/tmp/youtube-raw-venv/bin/python \
  ~/.codex/skills/youtube-audio-funasr-raw/scripts/download_youtube_audio.py \
  'https://www.youtube.com/watch?v=VIDEO_ID' \
  --output-dir /tmp/youtube-audio
```

This writes:

- `audio.m4a`: extracted audio only
- `youtube-info.json`: yt-dlp metadata
- `source-metadata.json`: compact metadata for downstream transcription

2. Transcribe with the local FunASR environment:

```bash
/Users/ylchen/tmp/funasr-venv/bin/python \
  ~/.codex/skills/youtube-audio-funasr-raw/scripts/transcribe_youtube_audio_to_raw.py \
  --audio /tmp/youtube-audio/audio.m4a \
  --metadata /tmp/youtube-audio/source-metadata.json \
  --language en \
  --raw-root ~/rep/llm-wiki/raw
```

3. Verify the output directory contains:

- `audio.m4a`: copied source audio
- `transcript.md`: readable Markdown transcript grouped by chunk offset
- `transcript.txt`: plain merged transcript text
- `transcript.json`: structured raw FunASR results and per-chunk metadata
- `metadata.json`: compact source/model metadata

## Interleaved Slide Notes Workflow

Use this when the YouTube video is a talk with visible slides or useful screen content. The script downloads a temporary low-resolution video only as a frame source, extracts representative images from chapter time ranges, downloads YouTube timed English captions, and writes graph-text interleaved notes.

1. Build chapter screenshots and caption sections:

```bash
/Users/ylchen/tmp/youtube-raw-venv/bin/python \
  ~/.codex/skills/youtube-audio-funasr-raw/scripts/build_youtube_slide_notes.py \
  'https://www.youtube.com/watch?v=VIDEO_ID' \
  --output-dir ~/rep/llm-wiki/raw/youtube/<title> \
  --work-dir /tmp/youtube-slide-work \
  --html \
  --pdf
```

This writes:

- `slides/chapter-*.png`: representative screenshots, interleaved by chapter
- `youtube-info.json`: yt-dlp metadata
- `youtube-captions-by-chapter.json`: chapter title, time range, English captions, and optional detailed Chinese note in `summary_zh`
- `slide-notes.md`: Markdown with screenshots, detailed Chinese notes, and English captions
- `slide-notes.html`: browser-readable notes when `--html` or `--pdf` is used
- `slide-notes.pdf`: printable PDF when `--pdf` is used

2. Add detailed Chinese notes:

After the first run, read `youtube-captions-by-chapter.json` and write a JSON file with detailed Chinese notes. Keep the filename `summaries-zh.json` for script compatibility, but the content should be detailed notes rather than short summaries:

```json
{
  "1": "本节记录开场介绍、讲者身份、研究方向、主持人对机器人重要性的判断，以及现场如何引出主题。",
  "2": "本节记录 DGX-1 的具体历史场景、Jensen 写给 OpenAI 的文字、Jim 和 Andrej 的签名细节，以及它如何连接到深度学习的几次能力跃迁。"
}
```

Then rerun the script with:

```bash
--summaries-json /tmp/youtube-slide-work/summaries-zh.json --html --pdf
```

Write enough detail to preserve concepts, examples, numbers, named systems, jokes that carry meaning, and speaker claims. A good section note is usually one or more paragraphs or bullets, not a 1-3 sentence abstract. Preserve the English captions below the Chinese note so the note remains searchable against the original speech.

3. Visual quality check:

Generate or inspect a contact sheet for `slides/*.png` before finalizing. The script selects chapter start, midpoint, and late frames by time; if a frame is a transition or blank, rerun with manual replacement by extracting a better timestamp with `ffmpeg -ss`.

## Defaults

- yt-dlp Python environment: `/Users/ylchen/tmp/youtube-raw-venv/bin/python`
- Python/FunASR environment: `/Users/ylchen/tmp/funasr-venv/bin/python`
- Model: `iic/SenseVoiceSmall`
- VAD model: `fsmn-vad`
- ffmpeg: `/opt/homebrew/bin/ffmpeg`
- ffprobe: `/opt/homebrew/bin/ffprobe`
- Output root: `~/rep/llm-wiki/raw`
- Output namespace: `youtube/<safe-title>/`
- Chunk size: `600` seconds
- Language: use `en` for English talks, `zh` for Chinese talks, or override explicitly

## Scripts

```bash
python ~/.codex/skills/youtube-audio-funasr-raw/scripts/download_youtube_audio.py --help
python ~/.codex/skills/youtube-audio-funasr-raw/scripts/transcribe_youtube_audio_to_raw.py --help
python ~/.codex/skills/youtube-audio-funasr-raw/scripts/build_youtube_slide_notes.py --help
```

Common options:

- `download_youtube_audio.py URL`: download audio only; when YouTube exposes only muxed media, download the smallest acceptable muxed format and immediately extract audio.
- `--extractor-args ARGS`: pass yt-dlp extractor args, for example `youtube:player_client=android`.
- `--format FORMAT`: pass yt-dlp format selection, for example `18` when audio-only formats require a PO token.
- `--title TITLE`: override the raw output title while keeping YouTube metadata.
- `--video-id ID`: override inferred video id.
- `--metadata PATH`: pass `source-metadata.json` from the download step.
- `--language LANG`: ASR language, commonly `en` or `zh`.
- `--raw-root PATH`: defaults to `~/rep/llm-wiki/raw`.
- `--output-dir PATH`: explicit output directory, overriding `raw-root/youtube/<safe-title>`.
- `--chunk-seconds N`: defaults to `600`.
- `--keep-chunks`: keep generated 16 kHz mono WAV chunks for debugging.
- `build_youtube_slide_notes.py URL`: build graph-text interleaved notes from chapter frames and timed captions.
- `--work-dir PATH`: temporary directory for downloaded video and captions.
- `--summaries-json PATH`: insert detailed Chinese per-section notes into `slide-notes.md/html/pdf`.
- `--html` / `--pdf`: generate HTML and PDF versions. PDF requires a local Chrome executable.

## Quality Checks

After transcription, run:

```bash
ls -lh /tmp/youtube-audio
python3 -m json.tool /tmp/youtube-audio/source-metadata.json
ls -lh ~/rep/llm-wiki/raw/youtube/<title>
wc -m ~/rep/llm-wiki/raw/youtube/<title>/transcript.txt
sed -n '1,80p' ~/rep/llm-wiki/raw/youtube/<title>/transcript.md
```

SenseVoice may misspell names, acronyms, and robotics terms. Keep `transcript.json` for raw segment data and do a correction pass before publication.

For slide notes, verify that `slides/` images are meaningful and that detailed Chinese notes are aligned with the matching chapter. YouTube auto captions may be cleaner than local ASR for English timing, but still need terminology review.
