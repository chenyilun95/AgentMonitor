---
name: wechat-article-to-markdown
description: Convert WeChat public-account article URLs or exported article HTML into local Markdown documents with images downloaded and referenced by relative paths. Use when Codex needs to archive mp.weixin.qq.com articles, preserve inline images from data-src lazy loading, or batch-process WeChat links into a repository such as llm-wiki.
---

# WeChat Article to Markdown

## Workflow

1. Open each `https://mp.weixin.qq.com/s/...` URL in Playwright and wait until `document.title` and `#js_content` are populated.
2. Export the article as JSON with `meta` and `html` fields:

```js
() => ({
  meta: {
    title: document.title,
    sourceUrl: location.href,
    author: document.querySelector('#js_name')?.innerText.trim() || '',
    publishTime: document.querySelector('#publish_time')?.innerText.trim() || ''
  },
  html: document.querySelector('#js_content')?.innerHTML || ''
})
```

3. Run `scripts/convert_wechat_article.py` on the JSON artifact. Prefer `--output-dir` under the target repo; by default the Markdown file and image asset directory use the original Chinese article title.
4. Validate that every Markdown image reference exists locally and that the image count matches the downloaded file count.

## Script

Use the bundled script:

```bash
python3 ~/.codex/skills/wechat-article-to-markdown/scripts/convert_wechat_article.py \
  --input /path/to/article.json \
  --output-dir /path/to/wiki/wechat
```

If dependencies are missing, install them in the active Python environment:

```bash
python3 -m pip install --user beautifulsoup4 markdownify
```

Optional flags:

- `--referer URL`: override the HTTP Referer used for image downloads.
- `--title TITLE`: override the Markdown H1.
- `--output FILE`: write to an explicit Markdown file instead of deriving the file name from the original Chinese article title.
- `--asset-dir DIR`: write images to an explicit directory instead of `assets/<original Chinese article title>`.
- `--no-download`: generate Markdown references without downloading images.

The script handles WeChat-specific image behavior:

- Use the original WeChat article title as the Markdown H1 and, by default, as the Markdown file name.
- Use `data-src` before `src` because many article images are lazy-loaded placeholders.
- Remove URL fragments such as `#imgIndex=...` before downloading.
- Infer image extensions from `wx_fmt` or response content type.
- Replace embedded WeChat video/player widgets with a compact video placeholder so player controls do not pollute the article text.
- Preserve article text with `markdownify`, then normalize excessive blank lines and adjacent image syntax.

## Quality Checks

After conversion, run:

```bash
grep -o '!\[[^]]*\](assets/[^)]*)' article.md | wc -l
python3 - <<'PY'
from pathlib import Path
import re, sys
md = Path(sys.argv[1])
refs = re.findall(r'!\[[^\]]*\]\(([^)]+)\)', md.read_text(encoding='utf-8'))
missing = [r for r in refs if not (md.parent / r).exists()]
print('image_refs', len(refs))
print('missing_refs', len(missing))
if missing:
    print('\n'.join(missing))
    raise SystemExit(1)
PY article.md
```

Review the opening 100-150 lines with `sed -n '1,150p'` to catch obvious conversion artifacts such as missing section titles or multiple images on one line.
