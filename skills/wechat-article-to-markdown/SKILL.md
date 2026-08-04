---
name: wechat-article-to-markdown
description: "Download WeChat public-account (mp.weixin.qq.com) articles into local Markdown with images. Two fetch methods: curl-style HTTP (simple, works for most articles) and Playwright (fallback for JS-heavy pages). Use when archiving mp.weixin.qq.com articles."
---

# WeChat Article to Markdown

## Why Two Methods

WeChat shows a "环境异常" verification wall to bare HTTP requests. However, setting browser-like headers (User-Agent, Accept-Language, Referer) bypasses it for most articles. This curl-based method is the **primary** approach — no browser dependency needed.

For articles that require JS rendering (e.g., interactive content, lazy-loaded sections beyond images), fall back to **Playwright**.

## End-to-End Pipeline

### Step 1: Fetch Article

**Method A — HTTP fetch (recommended)**

```bash
python3 ~/rep/AgentMonitor/skills/wechat-article-to-markdown/scripts/fetch_wechat.py \
  "https://mp.weixin.qq.com/s/ARTICLE_ID" \
  /tmp/wechat-article.json
```

This:
1. Sends a GET request with browser-like headers
2. Extracts `#js_content` div (article body), title, author, date from HTML
3. Saves structured JSON compatible with the convert script

**Method B — Playwright (fallback)**

Use when Method A fails (returns "环境异常" or empty content):

```bash
python3 -c "
import json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('URL', wait_until='networkidle')
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

### Step 2: Convert to Markdown

```bash
python3 ~/rep/AgentMonitor/skills/wechat-article-to-markdown/scripts/convert_wechat_article.py \
  --input /tmp/wechat-article.json \
  --output-dir ~/rep/llm_wiki/raw/wechat
```

Output:
- `<article-title>.md` — Markdown with relative image references
- `assets/<article-title>/*.jpg|png|webp` — downloaded article images

### Step 3 (Optional): Place in Wiki

```bash
TITLE="文章标题"
mv ~/rep/llm_wiki/raw/wechat/"$TITLE".md ~/rep/llm_wiki/wiki/wechat/"$TITLE".md
```

## Batch Usage

```bash
URLS=(
  "https://mp.weixin.qq.com/s/ID1"
  "https://mp.weixin.qq.com/s/ID2"
)

for url in "${URLS[@]}"; do
  python3 ~/rep/AgentMonitor/skills/wechat-article-to-markdown/scripts/fetch_wechat.py \
    "$url" /tmp/wechat-article.json
  python3 ~/rep/AgentMonitor/skills/wechat-article-to-markdown/scripts/convert_wechat_article.py \
    --input /tmp/wechat-article.json \
    --output-dir ~/rep/llm_wiki/raw/wechat
  sleep 2
done
```

## Dependencies

```bash
# Method A (HTTP fetch) — minimal
pip install requests beautifulsoup4

# Method B (Playwright fallback)
pip install playwright beautifulsoup4 markdownify
python3 -m playwright install chromium

# Convert script
pip install beautifulsoup4 markdownify
```

## Script Reference

| Script | Purpose |
|--------|---------|
| `scripts/fetch_wechat.py` | HTTP-based article fetch → JSON |
| `scripts/convert_wechat_article.py` | JSON → Markdown + downloaded images |

### fetch_wechat.py

```
Usage: python3 fetch_wechat.py <url> [output.json]
```

Output JSON schema: `{ meta: { title, sourceUrl, author, publishTime }, html }`

### convert_wechat_article.py

```
Usage: python3 convert_wechat_article.py --input FILE --output-dir DIR
```

Key options:
- `--input PATH` — JSON file from fetch step
- `--output-dir PATH` — where to write Markdown and images
- `--referer URL` — override HTTP Referer for image downloads
- `--title TITLE` — override the Markdown H1
- `--output FILE` — explicit Markdown output file
- `--asset-dir DIR` — explicit image directory
- `--no-download` — skip image downloads

The script handles WeChat-specific behavior:
- `data-src` before `src` for lazy-loaded images
- Removes URL fragments (`#imgIndex=...`) before downloading
- Infers extensions from `wx_fmt` or response content type
- Replaces embedded video widgets with compact placeholders

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "环境异常" in response | Verification wall triggered | Try again; if persistent, use Playwright method |
| Empty `#js_content` | Article deleted or requires login | Check URL manually in browser |
| Image download failures | CDN rate limiting | Re-run with `--referer` set to the article URL |
| `ModuleNotFoundError: markdownify` | Missing dependency | `pip install markdownify` |

## How It Works (Technical)

1. **HTTP method**: WeChat's verification wall checks User-Agent and Accept-Language headers. Setting these to match a real Chrome browser bypasses the JS challenge for static article pages.
2. Article content lives in `<div id="js_content">` with images lazy-loaded via `data-src` attributes pointing to `mmbiz.qpic.cn` CDN.
3. The convert script downloads images with a `Referer: https://mp.weixin.qq.com/` header, which the CDN requires.
4. Articles that have been deleted or migrated will return a short page without `#js_content` — the fetch script detects this and errors out.
