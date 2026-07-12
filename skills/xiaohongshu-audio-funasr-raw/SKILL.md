---
name: xiaohongshu-audio-funasr-raw
description: Extract audio from Xiaohongshu video captures or use an existing audio file, transcribe it locally with FunASR/SenseVoice, and save raw audio plus transcript artifacts under llm-wiki raw/. Use when archiving Xiaohongshu video-note speech into local Markdown/text/JSON for llm-wiki.
---

# Xiaohongshu Audio FunASR Raw

## Workflow

1. Prefer the no-login GreenVideo route for public Xiaohongshu video notes when the local Xiaohongshu account triggers AI/bot detection. This avoids touching the user's logged-in Xiaohongshu session.

```bash
python3 \
  ~/.codex/skills/xiaohongshu-audio-funasr-raw/scripts/download_xhs_via_greenvideo.py \
  'https://www.xiaohongshu.com/explore/NOTE_ID?...' \
  --output-dir /tmp/xhs-greenvideo
```

For a quick connectivity test, add `--audio-seconds 60`. The script writes:

- `greenvideo-result.json`: parsed GreenVideo/Xiaohongshu metadata and resolved video URL
- `audio.m4a`: audio extracted directly from the remote video URL
- `video.mp4`: only when `--download-video` is explicitly passed

2. Run the bundled FunASR script with the extracted local audio file and the original Chinese title:

```bash
/Users/ylchen/tmp/funasr-venv/bin/python \
  ~/.codex/skills/xiaohongshu-audio-funasr-raw/scripts/transcribe_xhs_audio_to_raw.py \
  --audio /tmp/xhs-greenvideo/audio.m4a \
  --title '原始中文标题' \
  --note-id NOTE_ID \
  --source-url 'https://www.xiaohongshu.com/explore/NOTE_ID?...' \
  --source-provider greenvideo \
  --raw-root ~/rep/llm-wiki/raw
```

3. If GreenVideo fails or the task needs the note text/comments/media beyond the public video, fall back to the `xiaohongshu-note-to-markdown` skill or Playwright network capture. If the asset is video-only, extract audio with `ffmpeg`.

4. Verify the output directory contains:

- `audio.<ext>`: copied source audio
- `transcript.md`: readable Markdown transcript grouped by chunk offset
- `transcript.txt`: plain merged transcript text
- `transcript.json`: structured raw FunASR results and per-chunk metadata
- `metadata.json`: compact source/model metadata

Long Xiaohongshu videos may resolve to very large MP4 files. Prefer remote audio extraction over full video download. Some CDNs may disconnect a single long remote `ffmpeg` stream partway through; use `--audio-seconds` for smoke tests, and use a resumable/segmented download approach when a complete hour-long extraction is required.

## Defaults

The script uses this local stack unless overridden:

- Python/FunASR environment: `/Users/ylchen/tmp/funasr-venv/bin/python`
- No-login Xiaohongshu resolver: GreenVideo `https://greenvideo.cc/xiaohongshu`
- Model: `iic/SenseVoiceSmall`
- VAD model: `fsmn-vad`
- ffmpeg: `/opt/homebrew/bin/ffmpeg`
- ffprobe: `/opt/homebrew/bin/ffprobe`
- Output root: `~/rep/llm-wiki/raw`
- Output namespace: `xiaohongshu/<safe-title>/`
- Chunk size: `600` seconds

Use chunked transcription for long videos. This avoids pushing a full hour-long audio file into the ASR model at once and leaves recoverable intermediate chunks in a temporary directory.

## Script

```bash
python ~/.codex/skills/xiaohongshu-audio-funasr-raw/scripts/download_xhs_via_greenvideo.py --help
python ~/.codex/skills/xiaohongshu-audio-funasr-raw/scripts/transcribe_xhs_audio_to_raw.py --help
```

Common options:

- `download_xhs_via_greenvideo.py URL`: resolve a public Xiaohongshu video note without local Xiaohongshu cookies.
- `--audio-seconds N`: only extract the first N seconds from the remote video URL for smoke tests.
- `--download-video`: also download the full video. Avoid this unless needed because long notes can exceed 1 GB.
- `--audio PATH`: required local audio input. Use `ffmpeg -i video.mp4 -vn -c:a copy audio.m4a` when starting from video.
- `--title TITLE`: required title; preserve the original Chinese title when known.
- `--note-id ID`: Xiaohongshu note id or share id for metadata.
- `--source-url URL`: original Xiaohongshu URL for metadata.
- `--source-provider PROVIDER`: provider used to obtain the audio, for example `greenvideo` or `xiaohongshu-direct`.
- `--raw-root PATH`: defaults to `~/rep/llm-wiki/raw`.
- `--output-dir PATH`: explicit output directory, overriding `raw-root/xiaohongshu/<safe-title>`.
- `--chunk-seconds N`: defaults to `600`.
- `--keep-chunks`: keep generated 16 kHz mono WAV chunks for debugging.

## Quality Checks

After transcription, run:

```bash
ls -lh /tmp/xhs-greenvideo
python3 -m json.tool /tmp/xhs-greenvideo/greenvideo-result.json | sed -n '1,80p'
ls -lh ~/rep/llm-wiki/raw/xiaohongshu/<title>
wc -m ~/rep/llm-wiki/raw/xiaohongshu/<title>/transcript.txt
sed -n '1,80p' ~/rep/llm-wiki/raw/xiaohongshu/<title>/transcript.md
```

SenseVoice may misrecognize domain terms such as `具身智能`. If the transcript is intended for publication, do a lightweight correction pass or add a future hotword/post-correction step.
