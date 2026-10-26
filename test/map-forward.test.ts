// One window for every map (#168): a map's server forwards `/m/<id>/…` to that map's own local
// server, rewriting only Host and Origin, and only for requests that passed its own local gate.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { forwardToMap } from '../src/cli/map-forward.ts';

let target: Server;
let own: Server;
let ownPort = 0;
let targetPort = 0;
type Seen = {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
};
const seen: Seen[] = [];
const local: string[] = [];

const listen = (server: Server): Promise<number> =>
  new Promise((done) =>
    server.listen(0, '127.0.0.1', () => done((server.address() as AddressInfo).port)),
  );

beforeAll(async () => {
  target = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      res
        .writeHead(201, { 'content-type': 'application/json', 'x-from': 'target' })
        .end('{"ok":1}');
    });
  });
  targetPort = await listen(target);
  const data = mkdtempSync(join(tmpdir(), 'map-forward-'));
  own = createServer(async (req, res) => {
    if (await forwardToMap(req, res, { port: ownPort, data })) return;
    local.push(req.url ?? '');
    res.writeHead(200).end('local');
  });
  ownPort = await listen(own);
  writeFileSync(
    join(data, 'maps.json'),
    JSON.stringify([
      { id: 'home', title: 'Home map', url: `http://127.0.0.1:${ownPort}/` },
      { id: 'other', title: 'Other map', url: `http://127.0.0.1:${targetPort}/` },
    ]),
  );
});
afterAll(() => {
  target?.close();
  own?.close();
});

function send(
  path: string,
  headers: Record<string, string>,
  method = 'GET',
  body = '',
): Promise<{ status: number; text: string; headers: IncomingHttpHeaders }> {
  return new Promise((done, fail) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: ownPort,
        path,
        method,
        headers: { host: `127.0.0.1:${ownPort}`, ...headers },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => done({ status: res.statusCode ?? 0, text, headers: res.headers }));
      },
    );
    req.on('error', fail);
    req.end(body);
  });
}

it('forwards another map’s reads with Host rewritten and the answer passed back unchanged', async () => {
  const answer = await send('/m/other/data/snapshot.json?x=1', {});
  expect(answer).toMatchObject({ status: 201, text: '{"ok":1}' });
  expect(answer.headers['x-from']).toBe('target');
  expect(seen.at(-1)).toMatchObject({ method: 'GET', url: '/data/snapshot.json?x=1' });
  expect(seen.at(-1)!.headers!.host).toBe(`127.0.0.1:${targetPort}`);
  expect(seen.at(-1)!.headers!.origin).toBeUndefined();
});

it('forwards a same-origin write as the target’s own origin, body and headers intact', async () => {
  await send(
    '/m/other/sync',
    {
      origin: `http://127.0.0.1:${ownPort}`,
      'x-work-map-sync': '1',
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
    },
    'POST',
  );
  const last = seen.at(-1)!;
  expect(last).toMatchObject({ method: 'POST', url: '/sync', body: '' });
  expect(last.headers).toMatchObject({
    host: `127.0.0.1:${targetPort}`,
    origin: `http://127.0.0.1:${targetPort}`,
    'x-work-map-sync': '1',
    'content-type': 'application/json',
    'sec-fetch-site': 'same-origin',
  });
});

it('serves its own map locally, without the prefix', async () => {
  expect(await send('/m/home/data/maps.json', {})).toMatchObject({ status: 200, text: 'local' });
  expect(local.at(-1)).toBe('/data/maps.json');
});

it('refuses unknown maps, foreign origins and other hosts, and leaves plain paths alone', async () => {
  const before = seen.length;
  expect((await send('/m/nowhere/data/snapshot.json', {})).status).toBe(404);
  expect((await send('/m/other/sync', { origin: 'http://evil.example' }, 'POST')).status).toBe(403);
  expect((await send('/m/other/data/snapshot.json', { host: 'localhost' })).status).toBe(403);
  expect(seen.length).toBe(before);
  expect(await send('/data/snapshot.json', {})).toMatchObject({ status: 200, text: 'local' });
});

it('refuses every Sync gate variant and a foreign read here, sending nothing to the other map', async () => {
  const sync = {
    origin: `http://127.0.0.1:${ownPort}`,
    'x-work-map-sync': '1',
    'content-type': 'application/json',
    'sec-fetch-site': 'same-origin',
  };
  const without = (name: string): Record<string, string> =>
    Object.fromEntries(Object.entries(sync).filter(([key]) => key !== name));
  const before = seen.length;
  for (const headers of [
    { ...sync, origin: 'https://foreign.example' },
    { ...sync, host: `localhost:${ownPort}` },
    { ...sync, 'sec-fetch-site': 'cross-site' },
    { ...sync, 'content-type': 'text/plain' },
    without('x-work-map-sync'),
    without('origin'),
  ])
    // oxlint-disable-next-line no-await-in-loop -- one refused request at a time
    expect((await send('/m/other/sync', headers, 'POST')).status, JSON.stringify(headers)).toBe(
      403,
    );
  expect((await send('/m/other/sync', sync, 'POST', '{}')).status).toBe(403);
  expect((await send('/m/other/sync', sync, 'GET')).status).toBe(403);
  expect(
    (await send('/m/other/data/snapshot.json', { origin: 'https://foreign.example' })).status,
  ).toBe(403);
  expect(seen.length).toBe(before);
});
