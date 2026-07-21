---
name: wechat-article-to-markdown
description: "Convert WeChat public-account article URLs into local Markdown with downloaded images, then optionally restructure into wiki-format articles. Use when archiving mp.weixin.qq.com articles, preserving inline images from data-src lazy loading, or producing illustrated wiki articles from WeChat sources."
---

# WeChat Article to Markdown

## End-to-End Pipeline

The complete workflow from WeChat article URL to wiki document:

1. **Capture article** — Playwright renders the page, exports DOM content as JSON
2. **Convert to Markdown** — script downloads images, converts HTML to Markdown
3. **Move to raw/** — organize under `raw/wechat/<title>/`
4. **Generate wiki document** — restructure into wiki format with interleaved images (manual/LLM step)

## Step 1: Capture Article

Open each `https://mp.weixin.qq.com/s/...` URL in Playwright and export as JSON:

```bash
# On Linux (headless server), wrap with xvfb-run if using headed mode
# On macOS, run directly

python3 -c "
import json, sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('$URL', wait_until='networkidle')
    page.wait_for_selector('#js_content', timeout=15000)
    data = page.evaluate('''() => ({
        meta: {
            title: document.title,
            sourceUrl: location.href,
            author: document.querySelector('#js_name')?.innerText.trim() || '',
            publishTime: document.querySelector('#publish_time')?.innerText.trim() || ''
        },
        html: document.querySelector('#js_content')?.innerHTML || ''
    })''')
    json.dump(data, open('/tmp/wechat-article.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    browser.close()
"
```

## Step 2: Convert to Markdown

```bash
python3 ~/.codex/skills/wechat-article-to-markdown/scripts/convert_wechat_article.py \
  --input /tmp/wechat-article.json \
  --output-dir ~/rep/llm_wiki/raw/wechat
```

Output:

- `<article-title>.md`: Markdown with relative image references
- `assets/<article-title>/*.jpg|png|webp`: downloaded article images

## Step 3: Organize in raw/

Move the converted article into the raw directory structure:

```bash
TITLE="文章标题"
mkdir -p ~/rep/llm_wiki/raw/wechat/"$TITLE"
mv ~/rep/llm_wiki/raw/wechat/"$TITLE".md ~/rep/llm_wiki/raw/wechat/"$TITLE"/article.md
mv ~/rep/llm_wiki/raw/wechat/assets/"$TITLE" ~/rep/llm_wiki/raw/wechat/"$TITLE"/images
```

## Step 4: Generate Wiki Document

WeChat articles are already text+image, so the wiki document is primarily a restructuring:

```markdown
# Article Title

> **来源**：[公众号名称](URL)
> **作者**：Author Name
> **日期**：YYYY-MM-DD

---

## 核心论点
One-paragraph summary...

---

## 一、Section Title

![Description](../../raw/wechat/<title>/images/image-01.jpg)

Content restructured from article...

---

## 关键链接
| 项目 | 链接 |
|------|------|
| ... | ... |

#Tag1 #Tag2
```

Key differences from video-based wiki docs:
- WeChat articles already have structured text and images — less cleanup needed
- Image paths: `../../raw/wechat/<title>/images/<filename>`
- No timestamp ranges (articles are not time-based)
- After creating wiki doc, add entry to `wiki/index.md`

## Dependencies

```bash
python3 -m pip install --user playwright beautifulsoup4 markdownify
python3 -m playwright install chromium
```

On Linux headless servers:

```bash
sudo apt-get install xvfb  # only if using headed Playwright mode
```

## Script Reference

```bash
python3 ~/.codex/skills/wechat-article-to-markdown/scripts/convert_wechat_article.py --help
```

Key options:

- `--input PATH`: JSON file exported from Playwright
- `--output-dir PATH`: where to write Markdown and images
- `--referer URL`: override HTTP Referer for image downloads
- `--title TITLE`: override the Markdown H1
- `--output FILE`: explicit Markdown output file
- `--asset-dir DIR`: explicit image directory
- `--no-download`: skip image downloads

The script handles WeChat-specific behavior:

- `data-src` before `src` for lazy-loaded images
- Removes URL fragments (`#imgIndex=...`) before downloading
- Infers extensions from `wx_fmt` or response content type
- Replaces embedded video widgets with compact placeholders
- Normalizes excessive blank lines and adjacent image syntax

## Quality Checks

After conversion:

```bash
grep -o '!\[[^]]*\](assets/[^)]*)' article.md | wc -l
ls -lh ~/rep/llm_wiki/raw/wechat/"$TITLE"/images/
head -150 ~/rep/llm_wiki/raw/wechat/"$TITLE"/article.md
```

Verify every Markdown image reference exists locally and the image count matches the downloaded file count.
