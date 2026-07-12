---
name: xiaohongshu-note-to-markdown
description: "Archive Xiaohongshu / 小红书 note URLs into local Markdown with extracted note text and downloaded media assets. Use when Codex needs to process xiaohongshu.com login/share/explore links, preserve video notes by capturing real mp4/m3u8 network requests behind blob playback URLs, reuse a local browser login profile, or optionally wait for the user to complete QR/SMS login verification."
---

# Xiaohongshu Note to Markdown

## Workflow

1. Use `scripts/xhs_note_to_markdown.py` rather than parsing static HTML. Xiaohongshu renders note content client-side and video elements often use `blob:` URLs.
2. Pass the original share/login/explore URL. The script decodes `login?redirectPath=...` links into their real `/explore/<note_id>` URL.
3. Use a persistent browser profile. If login is required, run with `--interactive-login` and let the user complete QR/SMS login in the opened browser. Do not ask the user to paste passwords, cookies, or tokens.
4. Capture text from the rendered DOM and media from network responses. For video notes, prefer `sns-video-*.xhscdn.com` mp4/m3u8 responses over `video.src`, because the DOM usually exposes only a `blob:` URL.
5. Save Markdown under the target repo and media under a sibling asset directory.

## Script

```bash
python3 ~/.codex/skills/xiaohongshu-note-to-markdown/scripts/xhs_note_to_markdown.py \
  "https://www.xiaohongshu.com/explore/..." \
  --output-dir /path/to/wiki/xiaohongshu
```

If the page is blocked by login:

```bash
python3 ~/.codex/skills/xiaohongshu-note-to-markdown/scripts/xhs_note_to_markdown.py \
  "https://www.xiaohongshu.com/explore/..." \
  --output-dir /path/to/wiki/xiaohongshu \
  --interactive-login
```

With `--interactive-login`, the script opens Chromium and waits while the user completes QR/SMS login in the browser. Do not request or paste account passwords, SMS codes, cookies, or tokens into Codex. Use `--login-timeout 300` if the user needs more time.

The default browser profile is `~/.cache/codex/xiaohongshu-playwright`. Override it with `--user-data-dir`.

## Dependencies

The script needs Python Playwright:

```bash
python3 -m pip install --user playwright beautifulsoup4
python3 -m playwright install chromium
```

## Output

The script writes:

- `<original title>.md`
- `assets/<original title>/video-01.mp4` or `.m3u8` when media requests are captured
- `assets/<original title>/image-*.webp|jpg|png` for selected note images when available

The Markdown contains source URL, note ID, author, note text, hashtags, local media links, and basic engagement/comment text when it is visible in the rendered page.

## Practical Notes

- Some media URLs are signed and expire. Download immediately during the same browser session.
- Some notes expose text without login but still show a login modal. If extraction quality is poor, rerun with `--interactive-login`.
- Do not automate likes, comments, follows, posting, or other account actions in this skill. Keep the scope to user-directed archival of accessible notes.
