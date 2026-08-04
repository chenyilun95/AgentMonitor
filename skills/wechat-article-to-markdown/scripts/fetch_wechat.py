#!/usr/bin/env python3
"""
Fetch WeChat public-account article via curl-style HTTP request.

Usage:
    python3 fetch_wechat.py <url> [output.json]

WeChat shows a "环境异常" verification wall to bare requests, but setting
browser-like headers (User-Agent, Accept-Language, Referer) bypasses it.

Output JSON: { meta: { title, sourceUrl, author, publishTime }, html }
— same schema as the Playwright capture, so convert_wechat_article.py works
with either method's output.
"""

import json
import re
import sys

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://mp.weixin.qq.com/",
}


def fetch_wechat_article(url):
    resp = requests.get(url, headers=HEADERS, timeout=15, allow_redirects=True)
    resp.encoding = "utf-8"

    if len(resp.text) < 500 or "环境异常" in resp.text:
        raise RuntimeError("Hit verification wall — article may be deleted or require login")

    soup = BeautifulSoup(resp.text, "html.parser")

    content_div = soup.find(id="js_content")
    if not content_div:
        raise RuntimeError("No #js_content found — page structure unexpected")

    title_el = soup.find(id="activity-name") or soup.find("h1")
    title = title_el.get_text(strip=True) if title_el else ""

    author_el = soup.find(id="js_name")
    author = author_el.get_text(strip=True) if author_el else ""

    date_el = soup.find(id="publish_time")
    date_str = date_el.get_text(strip=True) if date_el else ""

    return {
        "meta": {
            "title": title,
            "sourceUrl": url,
            "author": author,
            "publishTime": date_str,
        },
        "html": str(content_div),
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 fetch_wechat.py <url> [output.json]", file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else "/tmp/wechat-article.json"

    result = fetch_wechat_article(url)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"Title: {result['meta']['title']}")
    print(f"Author: {result['meta']['author']}")
    print(f"Date: {result['meta']['publishTime']}")
    print(f"Content length: {len(result['html'])} chars")
    print(f"Saved to: {out_path}")


if __name__ == "__main__":
    main()
