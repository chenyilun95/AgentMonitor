import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const MATH_PATTERN = /\$\$|\$[^$]|\\\(|\\\[|\\begin\{/;

export function parseFrontmatter(content: string): { body: string; origin?: string } {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { body: content };
  const body = content.slice(match[0].length);
  const urlMatch = match[1].match(/^url:\s*(https?:\/\/[^\s]+)/m);
  let origin: string | undefined;
  if (urlMatch) {
    try { origin = new URL(urlMatch[1]).origin; } catch { /* ignore */ }
  }
  return { body, origin };
}

/**
 * Ensure \begin{...}...\end{...} blocks are separated into their own paragraphs.
 * remark-math requires block math to start as a new paragraph (blank line before),
 * but scraped content often has them inline with only a hard line break.
 */
export function prepareMarkdownForMath(content: string): string {
  let result = content.replace(/([^\n])\n([ \t]*\\begin\{)/g, '$1\n\n$2');
  result = result.replace(/(\\end\{[^}]*\})[^\S\n]*\n([^\n])/g, '$1\n\n$2');
  return result;
}

/**
 * Wrap link/image URLs that contain spaces in angle brackets so CommonMark
 * parsers (remark) can handle them. Without this, `![alt](path with spaces)`
 * is treated as plain text.
 */
function fixLinkUrlsWithSpaces(content: string): string {
  return content.replace(
    /(!?\[[^\]]*\])\(([^)<>][^)]*)\)/g,
    (match, prefix: string, url: string) =>
      /\s/.test(url) ? `${prefix}(<${url.trim()}>)` : match,
  );
}

export function prepareMarkdown(content: string): { body: string; origin?: string } {
  const { body, origin } = parseFrontmatter(content);
  return { body: fixLinkUrlsWithSpaces(prepareMarkdownForMath(body)), origin };
}

export function hasMath(content: string): boolean {
  return MATH_PATTERN.test(content);
}

export const REMARK_PLAIN: any[] = [remarkGfm];
export const REMARK_MATH: any[] = [remarkGfm, remarkMath];
export const REHYPE_PLAIN: any[] = [];
export const REHYPE_MATH: any[] = [[rehypeKatex, { trust: true, strict: false }]];
