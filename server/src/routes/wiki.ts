import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AgentStore } from '../store/AgentStore.js';

function getPublicPagesPath(wikiDir: string): string {
  return path.join(wikiDir, 'public.json');
}

function readPublicPages(wikiDir: string): string[] {
  try {
    const data = fs.readFileSync(getPublicPagesPath(wikiDir), 'utf-8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePublicPages(wikiDir: string, pages: string[]): void {
  fs.writeFileSync(getPublicPagesPath(wikiDir), JSON.stringify(pages, null, 2), 'utf-8');
}

function resolveWikiPath(store: AgentStore): string {
  let dir: string;
  const settings = store.getSettings();
  if (settings.wikiDirectory) {
    dir = settings.wikiDirectory.replace(/^~/, os.homedir());
  } else {
    const projectRoot = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '..', '..', '..',
    );
    dir = path.resolve(projectRoot, '..', 'llm-wiki');
  }
  try { return fs.realpathSync(dir); } catch { return dir; }
}

export interface WikiPageEntry {
  name: string;
  path: string;
  updated?: string;
}

export interface WikiSourceEntry {
  name: string;
  path: string;
  size: number;
}

export function wikiRoutes(store: AgentStore): Router {
  const router = Router();

  router.get('/config', (_req, res) => {
    const wikiDir = resolveWikiPath(store);
    const exists = fs.existsSync(wikiDir);
    res.json({ wikiDirectory: wikiDir, exists });
  });

  router.put('/config', (req, res) => {
    const dir = typeof req.body?.wikiDirectory === 'string' ? req.body.wikiDirectory.trim() : '';
    if (!dir) {
      res.status(400).json({ error: 'wikiDirectory is required' });
      return;
    }
    const resolved = dir.replace(/^~/, os.homedir());
    const current = store.getSettings();
    store.saveSettings({ ...current, wikiDirectory: resolved });
    res.json({ wikiDirectory: resolved, exists: fs.existsSync(resolved) });
  });

  router.get('/pages', (_req, res) => {
    const wikiDir = path.join(resolveWikiPath(store), 'wiki');
    if (!fs.existsSync(wikiDir)) {
      res.json({ pages: [] });
      return;
    }
    try {
      const pages: WikiPageEntry[] = [];
      const scan = (dir: string, prefix: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            scan(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const filePath = path.join(dir, entry.name);
            const name = prefix ? `${prefix}/${entry.name}` : entry.name;
            let updated: string | undefined;
            try {
              const content = fs.readFileSync(filePath, 'utf-8').slice(0, 500);
              const match = content.match(/updated:\s*(\d{4}-\d{2}-\d{2})/);
              if (match) updated = match[1];
            } catch { /* ignore */ }
            pages.push({ name, path: filePath, updated });
          }
        }
      };
      scan(wikiDir, '');
      pages.sort((a, b) => {
        if (a.updated && b.updated) return b.updated.localeCompare(a.updated);
        if (a.updated) return -1;
        if (b.updated) return 1;
        return a.name.localeCompare(b.name);
      });
      res.json({ pages });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/sources', (_req, res) => {
    const rawDir = path.join(resolveWikiPath(store), 'raw');
    if (!fs.existsSync(rawDir)) {
      res.json({ sources: [] });
      return;
    }
    try {
      const sources: WikiSourceEntry[] = [];
      for (const entry of fs.readdirSync(rawDir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const entryPath = path.join(rawDir, entry.name);
        if (entry.isFile()) {
          sources.push({ name: entry.name, path: entryPath, size: fs.statSync(entryPath).size });
        } else if (entry.isDirectory()) {
          let totalSize = 0;
          try {
            for (const sub of fs.readdirSync(entryPath)) {
              try { totalSize += fs.statSync(path.join(entryPath, sub)).size; } catch { /* ignore */ }
            }
          } catch { /* ignore */ }
          sources.push({ name: entry.name, path: entryPath, size: totalSize });
        }
      }
      sources.sort((a, b) => a.name.localeCompare(b.name));
      res.json({ sources });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/public', (_req, res) => {
    const wikiDir = resolveWikiPath(store);
    res.json({ pages: readPublicPages(wikiDir) });
  });

  router.put('/public/:name', (req, res) => {
    const wikiDir = resolveWikiPath(store);
    const pageName = decodeURIComponent(req.params.name);
    const { isPublic } = req.body || {};
    const publicPages = readPublicPages(wikiDir);
    if (isPublic) {
      if (!publicPages.includes(pageName)) publicPages.push(pageName);
    } else {
      const idx = publicPages.indexOf(pageName);
      if (idx >= 0) publicPages.splice(idx, 1);
    }
    writePublicPages(wikiDir, publicPages);
    res.json({ pages: publicPages });
  });

  router.get('/page/:name', (req, res) => {
    const wikiDir = path.join(resolveWikiPath(store), 'wiki');
    const pageName = decodeURIComponent(req.params.name);
    const filePath = path.join(wikiDir, pageName);
    if (!filePath.startsWith(wikiDir)) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.json({ name: pageName, content });
    } catch {
      res.status(404).json({ error: 'Page not found' });
    }
  });

  return router;
}

/**
 * Public (no-auth) routes for serving wiki pages as standalone HTML.
 * Mounted at /wiki/* BEFORE auth middleware.
 */
const WIKI_ASSET_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.ico',
  '.mp4', '.webm', '.mov', '.ogg',
]);

function rewriteAssetUrl(rawUrl: string, pageDir: string): string {
  if (/^(https?:|data:|blob:|\/wiki\/)/i.test(rawUrl)) return rawUrl;
  const resolved = path.posix.normalize(path.posix.join(pageDir, rawUrl));
  const encoded = resolved.split('/').map(s => encodeURIComponent(s)).join('/');
  return `/wiki/_assets/${encoded}`;
}

function rewriteMediaPaths(markdown: string, pageDir: string): string {
  let result = markdown.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt: string, rawUrl: string) => {
      const rewritten = rewriteAssetUrl(rawUrl, pageDir);
      return rewritten === rawUrl ? match : `![${alt}](${rewritten})`;
    },
  );
  result = result.replace(
    /(<(?:video|img|source)\b[^>]*\s)src=(["'])([^"']+)\2/gi,
    (match, before: string, quote: string, rawUrl: string) => {
      const rewritten = rewriteAssetUrl(rawUrl, pageDir);
      return rewritten === rawUrl ? match : `${before}src=${quote}${rewritten}${quote}`;
    },
  );
  return result;
}

export function publicWikiRoutes(store: AgentStore): Router {
  const router = Router();

  router.get('/_assets/*', (req, res) => {
    const assetPath = (req.params as unknown as Record<string, string>)[0];
    if (!assetPath) { res.status(400).send('Missing path'); return; }
    const ext = path.extname(assetPath).toLowerCase();
    if (!WIKI_ASSET_EXTENSIONS.has(ext)) { res.status(403).send('Forbidden file type'); return; }
    const wikiDir = resolveWikiPath(store);

    const filePath = path.resolve(wikiDir, assetPath);
    if (!filePath.startsWith(path.resolve(wikiDir))) { res.status(400).send('Invalid path'); return; }
    if (!fs.existsSync(filePath)) { res.status(404).send('Not found'); return; }
    res.sendFile(filePath);
  });

  router.get('/*', (req, res, next) => {
    const rawPath = (req.params as unknown as Record<string, string>)[0];
    const wikiDir = resolveWikiPath(store);
    const publicPages = readPublicPages(wikiDir);

    if (!rawPath) {
      const host = req.get('host') || '';
      if (!host.includes('yilunchen.com')) { next(); return; }

      const items = publicPages.map(p => {
        const slug = path.posix.basename(p, '.md');
        const href = `/wiki/${slug}`;
        return `<li><a href="${href}">${slug}</a></li>`;
      }).join('\n');

      res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LLM Wiki</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.7; color: #1a1a2e; background: #fafbfc; }
  .container { max-width: 820px; margin: 0 auto; padding: 2rem 1.5rem; }
  h1 { font-size: 1.6rem; font-weight: 700; margin-bottom: 1.5rem; border-bottom: 1px solid #eaecef; padding-bottom: 0.5rem; }
  ul { list-style: none; }
  li { padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
  a { color: #0366d6; text-decoration: none; font-size: 1rem; }
  a:hover { text-decoration: underline; }
  .empty { color: #6a737d; padding: 2rem 0; }
</style>
</head>
<body>
<div class="container">
  <h1>LLM Wiki</h1>
  ${publicPages.length > 0 ? `<ul>${items}</ul>` : '<p class="empty">No public pages yet.</p>'}
</div>
</body>
</html>`);
      return;
    }

    const wikiBase = path.join(wikiDir, 'wiki');
    const slug = rawPath.replace(/\.md$/, '');
    const pagePath = publicPages.find(p => path.posix.basename(p, '.md') === slug);

    if (!pagePath) {
      next();
      return;
    }

    const filePath = path.resolve(wikiBase, pagePath);
    if (!filePath.startsWith(path.resolve(wikiBase))) {
      res.status(400).send('Invalid path');
      return;
    }

    let markdown: string;
    try {
      markdown = fs.readFileSync(filePath, 'utf-8');
    } catch {
      next();
      return;
    }

    // Strip YAML frontmatter
    markdown = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

    const pageDir = path.posix.dirname('wiki/' + pagePath);
    markdown = rewriteMediaPaths(markdown, pageDir);

    const title = slug || 'Wiki';

    res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - LLM Wiki</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.7; color: #1a1a2e; background: #fafbfc; }
  .container { max-width: 820px; margin: 0 auto; padding: 2rem 1.5rem; }
  .header { border-bottom: 1px solid #e1e4e8; padding-bottom: 1rem; margin-bottom: 2rem; display: flex; align-items: center; justify-content: space-between; }
  .header h1 { font-size: 1.1rem; font-weight: 600; color: #586069; }
  .header a { color: #0366d6; text-decoration: none; font-size: 0.9rem; }
  #content { font-size: 1rem; }
  #content h1 { font-size: 1.8rem; font-weight: 700; margin: 1.5rem 0 0.8rem; border-bottom: 1px solid #eaecef; padding-bottom: 0.4rem; }
  #content h2 { font-size: 1.4rem; font-weight: 600; margin: 1.3rem 0 0.6rem; border-bottom: 1px solid #eaecef; padding-bottom: 0.3rem; }
  #content h3 { font-size: 1.15rem; font-weight: 600; margin: 1rem 0 0.5rem; }
  #content p { margin: 0.6rem 0; }
  #content a { color: #0366d6; text-decoration: none; }
  #content a:hover { text-decoration: underline; }
  #content code { background: #f0f0f0; padding: 0.15em 0.4em; border-radius: 3px; font-size: 0.9em; }
  #content pre { background: #f6f8fa; padding: 1rem; border-radius: 6px; overflow-x: auto; margin: 0.8rem 0; }
  #content pre code { background: none; padding: 0; }
  #content blockquote { border-left: 4px solid #dfe2e5; padding: 0.5rem 1rem; color: #6a737d; margin: 0.8rem 0; }
  #content table { border-collapse: collapse; width: 100%; margin: 0.8rem 0; }
  #content th, #content td { border: 1px solid #dfe2e5; padding: 0.5rem 0.8rem; text-align: left; }
  #content th { background: #f6f8fa; font-weight: 600; }
  #content img { max-width: 100%; border-radius: 4px; }
  #content ul, #content ol { padding-left: 1.5rem; margin: 0.5rem 0; }
  #content li { margin: 0.2rem 0; }
  .katex-display { margin: 12px 0; overflow-x: auto; overflow-y: hidden; }
  .katex { white-space: normal; word-break: normal; }
  @media (max-width: 600px) {
    .container { padding: 1rem; }
    #content h1 { font-size: 1.4rem; }
    #content h2 { font-size: 1.2rem; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>LLM Wiki</h1>
    <a href="/wiki/">Index</a>
  </div>
  <div id="content"></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/marked@14/marked.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16/dist/contrib/auto-render.min.js"><\/script>
<script>
  const md = ${JSON.stringify(markdown)};
  document.getElementById('content').innerHTML = marked.parse(md);
  renderMathInElement(document.getElementById('content'), {
    trust: true,
    strict: false,
    delimiters: [
      {left: '$$', right: '$$', display: true},
      {left: '$', right: '$', display: false},
      {left: '\\\\(', right: '\\\\)', display: false},
      {left: '\\\\[', right: '\\\\]', display: true},
      {left: '\\\\begin{equation}', right: '\\\\end{equation}', display: true},
      {left: '\\\\begin{equation*}', right: '\\\\end{equation*}', display: true},
      {left: '\\\\begin{align}', right: '\\\\end{align}', display: true},
      {left: '\\\\begin{align*}', right: '\\\\end{align*}', display: true},
      {left: '\\\\begin{gather}', right: '\\\\end{gather}', display: true},
      {left: '\\\\begin{gather*}', right: '\\\\end{gather*}', display: true},
    ],
  });
<\/script>
</body>
</html>`);
  });

  return router;
}
