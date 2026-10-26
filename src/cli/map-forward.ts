// SPDX-License-Identifier: AGPL-3.0-only
//
// One window for every map (#168): `/m/<id>/<path>` reaches the map that `id` names in maps.json.
// This server's own map is served here with the prefix removed; another map's request is forwarded
// to that map's own local server. Only a request that passed this server's own gate for its route is
// forwarded, and Host and Origin change from this origin to the target's, so the target's gate still
// decides too. The browser never leaves this origin, which keeps a Safari Dock web app in its window.
import { readFileSync } from 'node:fs';
import { request, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { currentMapLinks } from '../core/map-links.ts';
import { isLocalReadRequest, isLocalSyncRequest } from './map-sync.ts';

const PREFIX = /^\/m\/([^/?#]+)(\/.*)$/;

/** True when the request was answered here; false to carry on (the prefix removed for this map). */
export async function forwardToMap(
  req: IncomingMessage,
  res: ServerResponse,
  {
    port,
    data,
    timeoutMs = 1_260_000,
  }: {
    readonly port: number;
    readonly data: string;
    readonly timeoutMs?: number;
  },
): Promise<boolean> {
  const match = PREFIX.exec(req.url ?? '');
  if (!match) return false;
  const path = match[2]!;
  const source = { method: req.method, url: path, headers: req.headers };
  // Every route's own gate runs here first.
  const allowed = path.startsWith('/sync')
    ? isLocalSyncRequest(source, port)
    : req.method === 'GET' && !path.startsWith('/m/');
  if (!isLocalReadRequest(req, port) || !allowed) {
    res.writeHead(403).end('forbidden');
    return true;
  }
  let maps = null;
  try {
    maps = currentMapLinks(JSON.parse(readFileSync(join(data, 'maps.json'), 'utf8')));
  } catch {
    // No map list: every prefixed request is unknown.
  }
  const map = maps?.find((entry) => encodeURIComponent(entry.id) === match[1]);
  if (!map) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return true;
  }
  const target = Number(new URL(map.url).port);
  if (target === port) {
    req.url = path;
    return false;
  }
  const headers = { ...req.headers, host: `127.0.0.1:${target}` };
  // The local gate allows only this origin or none, so a present Origin becomes the target's.
  if (headers.origin) headers.origin = `http://127.0.0.1:${target}`;
  delete headers.referer;
  await new Promise<void>((done) => {
    let answer: IncomingMessage | undefined;
    const finish = (): void => {
      clearTimeout(timer);
      req.off('aborted', disconnected);
      res.off('close', disconnected);
      done();
    };
    const disconnected = (): void => {
      out.destroy();
      answer?.destroy();
      finish();
    };
    const unavailable = (): void => {
      if (!res.headersSent)
        res.writeHead(502, { 'content-type': 'text/plain' }).end('map unavailable');
      else res.destroy();
      disconnected();
    };
    const out = request(
      { host: '127.0.0.1', port: target, method: req.method, path, headers },
      (response) => {
        answer = response;
        response.on('error', unavailable);
        response.on('aborted', unavailable);
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.on('end', finish);
        response.pipe(res);
      },
    );
    const timer = setTimeout(unavailable, timeoutMs);
    out.on('error', unavailable);
    req.once('aborted', disconnected);
    res.once('close', disconnected);
    req.pipe(out);
  });
  return true;
}
