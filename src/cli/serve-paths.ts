// SPDX-License-Identifier: AGPL-3.0-only
//
// Which file a request to the local server may read: the built page and its assets, and its named data files.
// Kept apart from serve.ts so it is tested without starting a server.

import { realpathSync, statSync } from 'node:fs';
import { extname, join, sep } from 'node:path';

const DATA_FILES = new Set(['snapshot.json', 'agents.json', 'versions.json', 'maps.json']);

/** The real file for `rel` inside `root`, or null for anything that leaves it, a symlink out included. */
export function resolveInside(root: string, rel: string): string | null {
  try {
    const realRoot = realpathSync(root);
    const real = realpathSync(join(realRoot, rel));
    if (!real.startsWith(realRoot + sep) || !statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

/** Which file a request path names, or null. Throws nothing: a bad path is simply not found. */
export function fileFor(pathname: string, roots: { dist: string; data: string }): string | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (path.startsWith('/data/')) {
    const name = path.slice('/data/'.length);
    return DATA_FILES.has(name) ? resolveInside(roots.data, name) : null;
  }
  return resolveInside(roots.dist, path === '/' ? 'index.html' : path);
}

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** The content type for a served file, by its extension; undefined for anything else. */
export function typeOf(path: string): string | undefined {
  return TYPES[extname(path)];
}
