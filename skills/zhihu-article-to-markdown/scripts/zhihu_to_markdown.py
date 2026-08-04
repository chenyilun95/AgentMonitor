#!/usr/bin/env python3
"""
Convert a Zhihu article JSON (from fetch_zhihu.mjs) to clean Markdown.

Usage:
    python3 zhihu_to_markdown.py --input /tmp/zhihu_article.json --output-dir ./output

Output:
    <slug>.md          — Markdown with YAML frontmatter
    assets/<slug>/     — downloaded images (if any)
"""

import argparse
import json
import os
import re
import sys
import urllib.request

def slugify(text, max_len=60):
    """Create a filesystem-safe slug from Chinese/English text."""
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', text)
    text = re.sub(r'\s+', '-', text.strip())
    return text[:max_len].rstrip('-')

def html_to_markdown(html):
    """Best-effort HTML → Markdown without external dependencies."""
    try:
        from markdownify import markdownify as md
        return md(html, heading_style='ATX', strip=['script', 'style'])
    except ImportError:
        pass

    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, 'html.parser')
        for tag in soup.find_all(['script', 'style']):
            tag.decompose()
        return soup.get_text('\n', strip=True)
    except ImportError:
        pass

    # Fallback: regex strip tags
    text = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL)
    text = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', '', text)
    return text.strip()

def download_images(html, asset_dir):
    """Extract image URLs from HTML, download them, return url→local path map."""
    img_urls = re.findall(r'<img[^>]+(?:src|data-original)=["\']([^"\']+)["\']', html)
    if not img_urls:
        return {}

    os.makedirs(asset_dir, exist_ok=True)
    url_map = {}
    for i, url in enumerate(img_urls):
        if url.startswith('data:'):
            continue
        ext = '.jpg'
        if 'format=png' in url or url.endswith('.png'):
            ext = '.png'
        elif 'format=webp' in url or url.endswith('.webp'):
            ext = '.webp'

        local_name = f'image-{i+1:02d}{ext}'
        local_path = os.path.join(asset_dir, local_name)

        if not os.path.exists(local_path):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://zhuanlan.zhihu.com/'})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    with open(local_path, 'wb') as f:
                        f.write(resp.read())
            except Exception as e:
                print(f'  Warning: failed to download {url}: {e}', file=sys.stderr)
                continue

        url_map[url] = local_name
    return url_map

def main():
    parser = argparse.ArgumentParser(description='Convert Zhihu article JSON to Markdown')
    parser.add_argument('--input', required=True, help='JSON file from fetch_zhihu.mjs')
    parser.add_argument('--output-dir', required=True, help='Output directory')
    parser.add_argument('--no-images', action='store_true', help='Skip image downloads')
    parser.add_argument('--output', help='Explicit output .md path (overrides auto-naming)')
    args = parser.parse_args()

    with open(args.input, 'r', encoding='utf-8') as f:
        data = json.load(f)

    title = data.get('title', 'untitled')
    author = data.get('author', '')
    date = data.get('date', '')
    source_url = data.get('url', '')
    content_html = data.get('content_html', '')
    content_text = data.get('content_text', '')

    slug = slugify(title)
    os.makedirs(args.output_dir, exist_ok=True)

    # Download images
    asset_rel = f'assets/{slug}'
    asset_dir = os.path.join(args.output_dir, asset_rel)
    url_map = {}
    if not args.no_images and content_html:
        url_map = download_images(content_html, asset_dir)
        if url_map:
            print(f'Downloaded {len(url_map)} images to {asset_dir}')

    # Convert HTML to markdown
    if content_html:
        md_body = html_to_markdown(content_html)
    else:
        md_body = content_text

    # Replace image URLs with local paths in markdown
    for orig_url, local_name in url_map.items():
        md_body = md_body.replace(orig_url, f'{asset_rel}/{local_name}')

    # Build final markdown
    out_lines = [
        '---',
        f'source: {source_url}',
        f'author: {author}',
        f'date: {date}',
        'platform: 知乎专栏',
        '---',
        '',
        f'# {title}',
        '',
        md_body,
    ]

    out_path = args.output or os.path.join(args.output_dir, f'{slug}.md')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out_lines))

    print(f'Written: {out_path} ({os.path.getsize(out_path)} bytes)')

if __name__ == '__main__':
    main()
