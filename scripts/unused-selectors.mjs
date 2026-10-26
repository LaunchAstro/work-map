// SPDX-License-Identifier: AGPL-3.0-only
//
// Lists CSS rules whose class, id or element selectors match no markup.
//
//   node scripts/unused-selectors.mjs
//
// Reads every rule in src/web/**/*.css (descending into @media and similar blocks, skipping @keyframes and
// @font-face) and every class and id it names. Each name is then looked up in src/web/**/*.{ts,tsx} and
// index.html:
//
//   used               the name appears inside a string or template literal (className, classList,
//                      querySelector, a CLASS map value, a union of literal types ...)
//   possibly dynamic   the name only appears as a bare word (an identifier, an object key, a comment), it
//                      starts or ends with a fragment glued to a template expression, such as `n-${id}`, or
//                      it is a string literal elsewhere in src/ (the view model sends some class names as data:
//                      src/core/work.ts gives wires the kind 'dash', which App.tsx appends to `edge`)
//   unused             the name appears nowhere
//
// An element name, listed as `<kbd>`, is used when the markup renders that tag: a lower-case JSX tag in
// src/web, a createElement or createElementNS argument there, a tag in index.html, or html and body.
//
// Attribute selectors (data-*, aria-*) are ignored: only class, id and element names are checked. A
// selector is dead when it names at least one unused class, id or element outside a functional
// pseudo-class; names inside :not(), :is(), :where() or :has() never make a selector dead. A rule is listed
// for deletion only when every selector in its list is dead. The script only reports; it never edits a file.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
const web = join(root, 'src', 'web');

function walk(dir, test) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path, test);
    return test(entry.name) ? [path] : [];
  });
}

// ---- CSS: rules with their selector lists and line numbers ----

function stripComments(css) {
  // Keeps newlines so line numbers survive.
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

// Returns the index just past the block that opens at `open` (text[open] === '{').
function blockEnd(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i = text.indexOf(c, i + 1);
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  throw new Error('unbalanced braces');
}

function rules(text, start = 0, end = text.length) {
  const found = [];
  let i = start;
  while (i < end) {
    const open = text.indexOf('{', i);
    if (open === -1 || open >= end) break;
    const raw = text.slice(i, open);
    // An at-rule without a block (@import, @charset) ends at its semicolon.
    const semi = raw.lastIndexOf(';');
    const preludeStart = semi === -1 ? i : i + semi + 1;
    const prelude = text.slice(preludeStart, open).trim();
    const close = blockEnd(text, open);
    if (prelude.startsWith('@')) {
      if (/^@(media|supports|container|layer|document)\b/.test(prelude))
        found.push(...rules(text, open + 1, close - 1));
    } else if (prelude) {
      const at =
        preludeStart +
        (text.slice(preludeStart, open).length - text.slice(preludeStart, open).trimStart().length);
      found.push({ prelude, line: lineAt(text, at) });
    }
    i = close;
  }
  return found;
}

function splitTopLevel(list) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const c of list) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += c;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const NAME = /([.#])(-?[_a-zA-Z][\w-]*)/g;

// Splits a selector into names that decide whether it can match, and names inside functional
// pseudo-classes, which cannot make it dead on their own.
function selectorNames(selector) {
  let s = selector.replace(/\[(?:[^\]'"]|'[^']*'|"[^"]*")*\]/g, '[]');
  const guarded = [];
  for (;;) {
    const m = /:(not|is|where|has|matches)\(/.exec(s);
    if (!m) break;
    let depth = 0;
    let j = m.index + m[0].length - 1;
    for (; j < s.length; j++) {
      if (s[j] === '(') depth++;
      else if (s[j] === ')' && --depth === 0) break;
    }
    const inner = s.slice(m.index + m[0].length, j);
    guarded.push(...[...inner.matchAll(NAME)].map((n) => n[1] + n[2]));
    guarded.push(...elements(inner.replace(/::?[\w-]+/g, ' ').split(/[\s>+~,()]+/)));
    s = s.slice(0, m.index) + s.slice(j + 1);
  }
  const required = [...s.matchAll(NAME)].map((n) => n[1] + n[2]);
  required.push(...elements(s.replace(/::?[\w-]+(\([^)]*\))?/g, '').split(/[\s>+~]+/)));
  return { required, guarded };
}

// Each compound's leading element name, as `<tag>`; `*` and compounds without one add nothing.
function elements(compounds) {
  return compounds.flatMap((compound) => {
    const tag = /^[a-zA-Z][\w-]*/.exec(compound);
    return tag ? [`<${tag[0].toLowerCase()}>`] : [];
  });
}

// ---- Sources: names inside literals, bare words, and fragments glued to template expressions ----

function scanSource(text, out) {
  const addTokens = (literal) => {
    for (const token of literal.split(/[^\w-]+/)) if (token) out.literal.add(token);
  };
  const n = text.length;
  // Reads a template literal starting after its opening backtick; returns the index after the closing one.
  const template = (k) => {
    let chunk = '';
    while (k < n) {
      const c = text[k];
      if (c === '\\') {
        chunk += text[k + 1] ?? '';
        k += 2;
      } else if (c === '`') {
        addTokens(chunk);
        return k + 1;
      } else if (c === '$' && text[k + 1] === '{') {
        addTokens(chunk);
        const glued = /[\w-]+$/.exec(chunk);
        if (glued) out.prefixes.add(glued[0]);
        k = code(k + 2, '}');
        const after = /^[\w-]+/.exec(text.slice(k, k + 80));
        if (after) out.suffixes.add(after[0]);
        chunk = '';
      } else {
        chunk += c;
        k++;
      }
    }
    return k;
  };
  const quoted = (k, quote) => {
    let chunk = '';
    while (k < n && text[k] !== quote && text[k] !== '\n') {
      if (text[k] === '\\') k++;
      chunk += text[k] ?? '';
      k++;
    }
    addTokens(chunk);
    return k + 1;
  };
  // Reads code until the closing character at depth zero; returns the index after it.
  const code = (k, closer) => {
    let depth = 0;
    while (k < n) {
      const c = text[k];
      if (c === '/' && text[k + 1] === '/') {
        const eol = text.indexOf('\n', k);
        k = eol === -1 ? n : eol;
      } else if (c === '/' && text[k + 1] === '*') {
        const close = text.indexOf('*/', k + 2);
        k = close === -1 ? n : close + 2;
      } else if (c === "'" || c === '"') k = quoted(k + 1, c);
      else if (c === '`') k = template(k + 1);
      else {
        if (c === '{') depth++;
        else if (c === '}') {
          if (depth === 0 && closer === '}') return k + 1;
          depth--;
        }
        k++;
      }
    }
    return k;
  };
  code(0, null);
  for (const word of text.split(/[^\w-]+/)) if (word) out.words.add(word);
}

// ---- Report ----

const cssFiles = walk(web, (name) => name.endsWith('.css')).toSorted();
const isSource = (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name);
const sourceFiles = walk(web, isSource).toSorted();
const otherSources = walk(join(root, 'src'), isSource).filter(
  (file) => !file.startsWith(web + '/'),
);

const seen = { literal: new Set(), words: new Set(), prefixes: new Set(), suffixes: new Set() };
for (const file of sourceFiles) scanSource(readFileSync(file, 'utf8'), seen);
const elsewhere = {
  literal: new Set(),
  words: new Set(),
  prefixes: new Set(),
  suffixes: new Set(),
};
for (const file of otherSources) scanSource(readFileSync(file, 'utf8'), elsewhere);
// Markup in index.html is plain text: count every word there as a literal.
const html = readFileSync(join(root, 'index.html'), 'utf8');
for (const word of html.split(/[^\w-]+/)) if (word) seen.literal.add(word);

// Rendered elements: lower-case JSX tags, tags made by createElement or createElementNS, the tags in
// index.html, and html and body. TypeScript generics such as `<string>` only add tags that keep a rule.
const tags = new Set(['html', 'body']);
const addTags = (text, pattern) => {
  for (const m of text.matchAll(pattern)) tags.add(m[1].toLowerCase());
};
for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');
  if (file.endsWith('.tsx')) addTags(text, /<([a-z][\w-]*)[\s/>]/g);
  addTags(text, /createElement(?:NS)?\(\s*(?:[^,()]*,\s*)?['"`]([a-zA-Z][\w-]*)['"`]/g);
}
addTags(html, /<([a-zA-Z][\w-]*)/g);

function status(name) {
  if (name.startsWith('<')) return { kind: tags.has(name.slice(1, -1)) ? 'used' : 'unused' };
  const bare = name.slice(1);
  if (seen.literal.has(bare)) return { kind: 'used' };
  // Template fragments count wherever they are written: core code can build class names too.
  const prefixes = [...seen.prefixes, ...elsewhere.prefixes];
  const suffixes = [...seen.suffixes, ...elsewhere.suffixes];
  const prefix = prefixes.find((p) => p.length > 1 && bare.startsWith(p) && bare !== p);
  if (prefix) return { kind: 'dynamic', why: `starts with template fragment '${prefix}'` };
  const suffix = suffixes.find((p) => p.length > 1 && bare.endsWith(p) && bare !== p);
  if (suffix) return { kind: 'dynamic', why: `ends with template fragment '${suffix}'` };
  if (seen.words.has(bare))
    return { kind: 'dynamic', why: 'appears only as a bare word (identifier, key or comment)' };
  if (elsewhere.literal.has(bare))
    return { kind: 'dynamic', why: 'string literal outside src/web (may reach markup as data)' };
  return { kind: 'unused' };
}

const names = new Map();
const deletable = [];
const partly = [];
let ruleCount = 0;
for (const file of cssFiles) {
  const where = relative(root, file);
  for (const rule of rules(stripComments(readFileSync(file, 'utf8')))) {
    ruleCount++;
    const selectors = splitTopLevel(rule.prelude);
    const dead = selectors.map((selector) => {
      const { required, guarded } = selectorNames(selector);
      for (const name of [...required, ...guarded])
        names.set(name, names.get(name) ?? status(name));
      return required.some((name) => names.get(name).kind === 'unused');
    });
    const entry = { where: `${where}:${rule.line}`, prelude: rule.prelude.replace(/\s+/g, ' ') };
    if (dead.every(Boolean)) deletable.push(entry);
    else if (dead.some(Boolean)) partly.push(entry);
  }
}

const byKind = (kind) =>
  [...names].filter(([, s]) => s.kind === kind).toSorted(([a], [b]) => a.localeCompare(b));
const unused = byKind('unused');
const dynamic = byKind('dynamic');

console.log(
  `${cssFiles.length} stylesheets, ${ruleCount} rules, ${names.size} class, id and element names; ` +
    `${byKind('used').length} used, ${dynamic.length} possibly dynamic, ${unused.length} unused.`,
);
console.log(`\nUnused names (${unused.length}):`);
for (const [name] of unused) console.log(`  ${name}`);
console.log(`\nRules to delete, every selector dead (${deletable.length}):`);
for (const r of deletable) console.log(`  ${r.where}  ${r.prelude}`);
console.log(`\nRules kept, some selectors dead (${partly.length}):`);
for (const r of partly) console.log(`  ${r.where}  ${r.prelude}`);
console.log(`\nKept, possibly dynamic (${dynamic.length}):`);
for (const [name, s] of dynamic) console.log(`  ${name}  ${s.why}`);
