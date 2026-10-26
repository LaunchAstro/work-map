// SPDX-License-Identifier: AGPL-3.0-only
//
// Kept apart from issues.ts so the Markdown parser stays out of the web bundle: only work.ts, which
// the web imports for types alone, reads it.

import { Lexer, type Token } from 'marked';
import { issueKey } from './issues.ts';

const PROSE_LINK = /(?:[A-Za-z0-9-]+\/)?[A-Za-z0-9._-]+#\d+|#\d+/g;
const ISSUE_URL = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/issues\/\d+$/;

/**
 * Every issue a PR body names in prose (#107), by one rule over a CommonMark + GFM parse:
 * plain text counts "#n", "repo#n" and "owner/repo#n"; a link (inline, reference or a bare URL) counts
 * only its destination, and only when that is a plain GitHub issue URL. Link text, link titles,
 * reference labels, unused definitions, images, code, raw HTML and the text inside an HTML <a> count nothing.
 */
export function proseIssueKeys(body: string, defaultRepo: string): string[] {
  const out = new Set<string>();
  const add = (ref: string): void => {
    const key = issueKey(ref, defaultRepo);
    if (key) out.add(key);
  };
  let anchors = 0;
  const walk = (tokens: readonly Token[]): void => {
    for (const t of tokens) {
      if (t.type === 'html') {
        if (t.block) continue;
        if (/^<a[\s>]/i.test(t.raw)) anchors++;
        else if (/^<\/a\s*>/i.test(t.raw)) anchors = Math.max(0, anchors - 1);
      } else if (t.type === 'link') {
        if (ISSUE_URL.test(t.href)) add(t.href);
      } else if (['code', 'codespan', 'image', 'def'].includes(t.type)) {
        continue;
      } else if (t.type === 'list') {
        walk(t.items);
      } else if (t.type === 'table') {
        for (const cell of [...t.header, ...t.rows.flat()]) walk(cell.tokens);
      } else if ('tokens' in t && t.tokens) {
        walk(t.tokens);
      } else if (t.type === 'text' && anchors === 0) {
        for (const m of t.text.matchAll(PROSE_LINK)) add(m[0]);
      }
    }
  };
  walk(Lexer.lex(body, { gfm: true }));
  return [...out];
}

const REF = String.raw`(?:https://github\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/issues/\d+|(?:[A-Za-z0-9-]+/)?[A-Za-z0-9._-]+#\d+|#\d+)`;
const CLOSING = new RegExp(
  String.raw`(?<![A-Za-z0-9_-])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?[ \t]+(${REF}(?:[ \t]*(?:,[ \t]*(?:and|&)?|and|&)[ \t]*${REF})*)`,
  'gi',
);

/**
 * The tickets a PR body closes with GitHub's closing keywords (#191): "Closes #1, #2, and repo#3",
 * every ticket in the list, where GitHub links only the first. Code and raw HTML count nothing.
 */
export function closingIssueKeys(body: string, defaultRepo: string): string[] {
  const out = new Set<string>();
  const text: string[] = [];
  const walk = (tokens: readonly Token[]): void => {
    for (const t of tokens) {
      if (['code', 'codespan', 'html', 'image', 'def'].includes(t.type)) {
        text.push('\n');
        continue;
      }
      if (t.type === 'list') walk(t.items);
      else if (t.type === 'table')
        for (const cell of [...t.header, ...t.rows.flat()]) {
          walk(cell.tokens);
          text.push('\n');
        }
      else if ('tokens' in t && t.tokens) walk(t.tokens);
      else if (t.type === 'text') text.push(t.text);
      else text.push('\n');
      // #193: a block or list item ends its text, so the next one's first word never joins this list.
      if (['list_item', 'paragraph', 'heading', 'blockquote'].includes(t.type)) text.push('\n');
    }
  };
  walk(Lexer.lex(body, { gfm: true }));
  for (const m of text.join('').matchAll(CLOSING))
    for (const ref of m[1]!.match(new RegExp(REF, 'g')) ?? []) {
      const key = issueKey(ref, defaultRepo);
      if (key) out.add(key);
    }
  return [...out];
}
