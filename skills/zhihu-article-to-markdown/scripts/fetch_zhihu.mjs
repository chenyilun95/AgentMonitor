#!/usr/bin/env node
/**
 * Fetch Zhihu zhuanlan article using puppeteer-extra + stealth plugin.
 *
 * Usage:
 *   node fetch_zhihu.mjs <url> <output.json>
 *
 * Zhihu blocks curl / headless-Chrome detection with a JS challenge (zse-ck).
 * puppeteer-extra-plugin-stealth patches the browser fingerprint so the
 * challenge is solved transparently.
 *
 * Output JSON: { title, author, date, url, content_html, content_text }
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { writeFileSync } from 'fs';

puppeteer.use(StealthPlugin());

const url = process.argv[2];
const outPath = process.argv[3] || '/tmp/zhihu_article.json';

if (!url) {
  console.error('Usage: node fetch_zhihu.mjs <zhihu-url> [output.json]');
  process.exit(1);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // Visit zhihu.com first to acquire session cookies
  console.log('Visiting zhihu.com for cookies...');
  await page.goto('https://www.zhihu.com', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Navigate to the article
  console.log('Fetching article:', url);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Extract article content from DOM
  const result = await page.evaluate(() => {
    const titleEl = document.querySelector('.Post-Title') || document.querySelector('h1');
    const contentEl = document.querySelector('.Post-RichText') || document.querySelector('.RichContent-inner');
    const authorEl = document.querySelector('.AuthorInfo-name') || document.querySelector('.UserLink-link');
    const dateEl = document.querySelector('.ContentItem-time') || document.querySelector('.Post-Header time');

    return {
      title: titleEl ? titleEl.innerText.trim() : '',
      content_html: contentEl ? contentEl.innerHTML : '',
      content_text: contentEl ? contentEl.innerText : '',
      author: authorEl ? authorEl.innerText.trim() : '',
      date: dateEl ? dateEl.innerText.trim() : '',
      url: window.location.href,
    };
  });

  if (!result.title && !result.content_text) {
    console.error('ERROR: Failed to extract article content. Page may have redirected to login.');
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
    console.error('Page body preview:', bodyText);
    await browser.close();
    process.exit(1);
  }

  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log('Title:', result.title);
  console.log('Author:', result.author);
  console.log('Date:', result.date);
  console.log('Content length:', result.content_text.length, 'chars');
  console.log('Saved to:', outPath);

  await browser.close();
})();
