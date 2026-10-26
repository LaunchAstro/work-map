// Serves the built page (dist) and the two data files (snapshot.json, agents.json) on this machine only, at
// http://127.0.0.1:<port>. No other address answers it. The page polls the data files and updates in place.
//
//   node src/cli/serve.ts [--port PORT (default $WORK_MAP_PORT, else 4317)] [--data DIR] [--dist DIR]

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createMapSync, isLocalSyncRequest, isLocalReadRequest } from './map-sync.ts';
import { fileFor, typeOf } from './serve-paths.ts';
import { forwardToMap } from './map-forward.ts';
import { toolCommit, watchToolCommit } from './tool-commit.ts';
import type { SyncResult } from '../core/sync.ts';

const app = fileURLToPath(new URL('../..', import.meta.url));

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: process.env['WORK_MAP_PORT'] || '4317' },
    data: { type: 'string', default: join(app, '.data') },
    dist: { type: 'string', default: join(app, 'dist') },
    project: { type: 'string', default: process.env['WORK_MAP_PROJECT'] },
    // The retired audit's options: still accepted, so an older launcher starts, and ignored.
    'audit-config': { type: 'string' },
    'audit-runtime': { type: 'string' },
    'repo-root': { type: 'string', default: process.env['WORK_MAP_ROADMAP'] },
  },
});
const roots = { dist: values.dist, data: values.data };
const sync =
  values.project && values['repo-root']
    ? createMapSync({
        app,
        data: values.data,
        node: process.execPath,
        project: values.project,
        roadmap: values['repo-root'],
      })
    : null;
const server = createServer(async (req, res) => {
  if (!isLocalReadRequest(req, Number(values.port))) {
    res.writeHead(403).end('forbidden');
    return;
  }
  // `/m/<id>/…`: another map is forwarded; this map's own continues below without the prefix.
  if (await forwardToMap(req, res, { port: Number(values.port), data: values.data })) return;
  if (req.url?.startsWith('/sync')) {
    if (!isLocalSyncRequest(req, Number(values.port))) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const result: SyncResult = sync
      ? await sync.run()
      : {
          status: 'failed',
          reason: 'Refresh configuration is unavailable',
          versionsRequired: false,
        };
    res
      .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify(result));
    return;
  }
  try {
    const file =
      req.method === 'GET'
        ? fileFor(new URL(req.url ?? '/', 'http://127.0.0.1').pathname, roots)
        : null;
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    const body = readFileSync(file);
    res.writeHead(200, {
      'content-type': typeOf(file) ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    if (!res.headersSent) res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('bad request');
  }
});
server.listen(Number(values.port), '127.0.0.1', () => {
  console.log(`live roadmap on http://127.0.0.1:${values.port}`);
});
// A pulled tool commit restarts the server: launchd's keep-alive starts it again on the new code.
watchToolCommit(
  () => toolCommit(app),
  (from, to) => {
    console.log(`tool moved ${from.slice(0, 7)} -> ${to.slice(0, 7)}; restarting`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  },
);
