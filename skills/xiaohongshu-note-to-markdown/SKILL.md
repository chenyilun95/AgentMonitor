---
name: xiaohongshu-note-to-markdown
description: "Archive Xiaohongshu / 小红书 note URLs into local Markdown with extracted note text and downloaded media assets. Best for image/text notes. For video notes, prefer the xiaohongshu-audio-funasr-raw skill which uses greenvideo.cc to bypass login walls and provides the full video→transcript→frames→wiki pipeline."
---

# Xiaohongshu Note to Markdown

## When to Use Which Skill

- **Image/text notes** (图文笔记): Use this skill. It captures rendered DOM text and images.
- **Video notes** (视频笔记 / 直播回放): Use the `xiaohongshu-audio-funasr-raw` skill instead. It downloads video via greenvideo.cc (no login needed), transcribes audio, extracts frames, and produces structured wiki documents.

This skill often hits login walls on video notes, resulting in wrong/missing images (login-wall screenshots instead of actual content). The audio-funasr skill avoids this entirely.

## Workflow

1. Use `scripts/xhs_note_to_markdown.py` rather than parsing static HTML. Xiaohongshu renders note content client-side and video elements often use `blob:` URLs.
2. Pass the original share/login/explore URL. The script decodes `login?redirectPath=...` links into their real `/explore/<note_id>` URL.
3. Use a persistent browser profile. If login is required, run with `--interactive-login` and let the user complete QR/SMS login in the opened browser. Do not ask the user to paste passwords, cookies, or tokens.
4. Capture text from the rendered DOM and media from network responses. For video notes, prefer `sns-video-*.xhscdn.com` mp4/m3u8 responses over `video.src`, because the DOM usually exposes only a `blob:` URL.
5. Save Markdown under the target repo and media under a sibling asset directory.

## Script

**On Linux** (headless server), wrap with `xvfb-run` for headed browser mode:

```bash
# Find the Python with playwright installed (e.g. miniconda)
PYTHON=$(which python3)  # or ~/miniconda3/bin/python

xvfb-run $PYTHON ~/.codex/skills/xiaohongshu-note-to-markdown/scripts/xhs_note_to_markdown.py \
  "https://www.xiaohongshu.com/explore/..." \
  --output-dir /path/to/raw/xiaohongshu
```

**On macOS** (display available):

```bash
python3 ~/.codex/skills/xiaohongshu-note-to-markdown/scripts/xhs_note_to_markdown.py \
  "https://www.xiaohongshu.com/explore/..." \
  --output-dir /path/to/raw/xiaohongshu
```

If the page is blocked by login:

```bash
# Add --interactive-login and let the user complete QR/SMS login in the browser
# Use --login-timeout 300 if the user needs more time
xvfb-run $PYTHON ~/.codex/skills/xiaohongshu-note-to-markdown/scripts/xhs_note_to_markdown.py \
  "https://www.xiaohongshu.com/explore/..." \
  --output-dir /path/to/raw/xiaohongshu \
  --interactive-login
```

Do not request or paste account passwords, SMS codes, cookies, or tokens.

The default browser profile is `~/.cache/codex/xiaohongshu-playwright`. Override it with `--user-data-dir`.

## Dependencies

The script needs Python Playwright:

```bash
python3 -m pip install --user playwright beautifulsoup4
python3 -m playwright install chromium
```

On Linux, also install xvfb for headed browser automation:

```bash
sudo apt-get install xvfb
```

## Output

The script writes:

- `<original title>.md`
- `assets/<original title>/video-01.mp4` or `.m3u8` when media requests are captured
- `assets/<original title>/image-*.webp|jpg|png` for selected note images when available

The Markdown contains source URL, note ID, author, note text, hashtags, local media links, and basic engagement/comment text when it is visible in the rendered page.

## Known Limitations

- **Login wall on video notes**: Xiaohongshu frequently blocks video playback and full content access behind a login wall. Images captured from such pages are login-wall screenshots, not actual content frames. For video notes, use the `xiaohongshu-audio-funasr-raw` skill instead.
- **xvfb-run required on Linux**: The Playwright script runs in headed mode. On headless Linux servers, `xvfb-run` provides a virtual display.
- Some media URLs are signed and expire. Download immediately during the same browser session.
- Do not automate likes, comments, follows, posting, or other account actions. Keep the scope to user-directed archival of accessible notes.
