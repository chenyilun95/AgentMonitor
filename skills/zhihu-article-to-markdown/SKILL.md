---
name: zhihu-article-to-markdown
description: "Download Zhihu (知乎) zhuanlan articles into local Markdown with images. Use when archiving zhuanlan.zhihu.com articles — Zhihu blocks curl/WebFetch with a JS challenge (zse-ck), so this skill uses puppeteer-extra + stealth plugin to bypass it."
---

# Zhihu Article to Markdown

## Why This Skill Exists

Zhihu (知乎) blocks all non-browser access with a JS challenge (`zse-ck`). The following methods all fail:

- `curl` / `wget` with browser UA → 650-byte JS challenge page
- Zhihu API (`/api/v4/articles/`) → 403
- Google Cache / Wayback Machine → no snapshots
- Jina Reader / archive.ph → login/captcha wall

The only reliable method is **puppeteer-extra + stealth plugin**, which patches the headless Chrome fingerprint to pass the JS challenge transparently.

## End-to-End Pipeline

### Step 1: Fetch Article via Puppeteer

```bash
NODE_PATH=/tmp/node_modules node \
  ~/rep/AgentMonitor/skills/zhihu-article-to-markdown/scripts/fetch_zhihu.mjs \
  "https://zhuanlan.zhihu.com/p/ARTICLE_ID" \
  /tmp/zhihu_article.json
```

This:
1. Launches headless Chrome with stealth patches
2. Visits `zhihu.com` first to acquire session cookies
3. Navigates to the article URL
4. Extracts title, author, date, HTML content, and plain text from the DOM
5. Saves structured JSON to the output path

### Step 2: Convert to Markdown

```bash
python3 ~/rep/AgentMonitor/skills/zhihu-article-to-markdown/scripts/zhihu_to_markdown.py \
  --input /tmp/zhihu_article.json \
  --output-dir ~/rep/llm_wiki/raw/zhihu
```

Output:
- `<slug>.md` — Markdown with YAML frontmatter (source, author, date, platform)
- `assets/<slug>/` — downloaded article images

Options:
- `--output PATH` — explicit output file path
- `--no-images` — skip image downloads

### Step 3 (Optional): Place in Wiki

```bash
# Move to target wiki location
mv ~/rep/llm_wiki/raw/zhihu/<slug>.md ~/rep/llm_wiki/wiki/basics/<name>.md
```

## Batch Usage

To download multiple articles, loop over URLs:

```bash
URLS=(
  "https://zhuanlan.zhihu.com/p/ID1"
  "https://zhuanlan.zhihu.com/p/ID2"
)

for url in "${URLS[@]}"; do
  ID=$(echo "$url" | grep -oP 'p/\K\d+')
  NODE_PATH=/tmp/node_modules node \
    ~/rep/AgentMonitor/skills/zhihu-article-to-markdown/scripts/fetch_zhihu.mjs \
    "$url" "/tmp/zhihu_${ID}.json"
  python3 ~/rep/AgentMonitor/skills/zhihu-article-to-markdown/scripts/zhihu_to_markdown.py \
    --input "/tmp/zhihu_${ID}.json" \
    --output-dir ~/rep/llm_wiki/raw/zhihu
  sleep 3  # polite delay
done
```

## Dependencies

```bash
# Node.js (puppeteer + stealth)
cd /tmp && npm install puppeteer-extra puppeteer-extra-plugin-stealth puppeteer

# Python (optional, for better HTML→Markdown)
pip install markdownify beautifulsoup4
```

The Node packages install to `/tmp/node_modules`. Set `NODE_PATH=/tmp/node_modules` when running the fetch script.

Puppeteer will auto-download a Chromium binary on first install (~170MB).

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| 650-byte HTML with `zse-ck` | Stealth not loaded | Ensure `NODE_PATH=/tmp/node_modules` is set |
| Empty title + content | Login redirect | Re-run — sometimes needs a second attempt |
| `Error: Browser closed` | Chromium not found | Re-run `npm install puppeteer` |
| Timeout on zhihu.com | Network issue | Increase timeout in script or retry |

## How It Works (Technical)

1. **puppeteer-extra-plugin-stealth** patches ~10 browser fingerprint leaks that Zhihu's `zse-ck` script checks: `navigator.webdriver`, Chrome runtime, plugin array, language consistency, WebGL vendor, etc.
2. Visiting `zhihu.com` first is critical — the main domain sets session cookies (`z_c0`, `_xsrf`) that are required for article pages.
3. The 3-second delays allow the JS challenge to complete and cookies to propagate.
4. Article content is in `.Post-RichText` (zhuanlan format) with images served from Zhihu's CDN (`pic1.zhimg.com`).
