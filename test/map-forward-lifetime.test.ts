// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { forwardToMap } from '../src/cli/map-forward.ts';

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const listen = (server: ReturnType<typeof createServer>): Promise<number> =>
  new Promise((done) =>
    server.listen(0, '127.0.0.1', () => done((server.address() as AddressInfo).port)),
  );

async function within(promise: Promise<unknown>, milliseconds = 400): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((done) => {
        timer = setTimeout(done, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function fixture(
  handleTarget: (req: IncomingMessage, res: ServerResponse) => void,
  timeoutMs = 5_000,
) {
  const sockets = new Set<Socket>();
  const data = mkdtempSync(join(tmpdir(), 'map-forward-lifetime-'));
  const forwarded = signal();
  let settled = false;
  let rejected = false;
  let ownPort = 0;
  const target = createServer(handleTarget);
  const own = createServer((req, res) => {
    const settings = { port: ownPort, data, timeoutMs };
    void forwardToMap(req, res, settings).then(
      () => {
        settled = true;
        forwarded.resolve();
        return;
      },
      () => {
        rejected = true;
        forwarded.resolve();
        return;
      },
    );
  });
  for (const server of [own, target]) {
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
  }
  const targetPort = await listen(target);
  ownPort = await listen(own);
  writeFileSync(
    join(data, 'maps.json'),
    JSON.stringify([
      { id: 'other', title: 'Disposable target', url: `http://127.0.0.1:${targetPort}/` },
    ]),
  );
  const client = request({
    host: '127.0.0.1',
    port: ownPort,
    path: '/m/other/disposable',
    agent: false,
  });
  // A truncated response can fail either the request or its response stream.
  client.on('error', () => {});
  return {
    client,
    forwarded: forwarded.promise,
    state: () => ({ settled, rejected }),
    async close() {
      client.destroy();
      for (const socket of sockets) socket.destroy();
      await Promise.all(
        [own, target].map((server) => new Promise<void>((done) => server.close(() => done()))),
      );
      rmSync(data, { recursive: true, force: true });
    },
  };
}

it('ends or aborts the downstream response and settles forwarding when the target dies after headers', async () => {
  let targetSocket: Socket | undefined;
  const ended = signal();
  let downstreamClosed = false;
  const test = await fixture((req, res) => {
    targetSocket = req.socket;
    res.writeHead(200, { 'content-length': '100' });
    res.write('partial');
  });
  test.client.on('response', (res) => {
    res.on('error', () => {});
    res.on('close', () => {
      downstreamClosed = true;
      ended.resolve();
    });
    // Destroy only after the proxy has delivered headers and body to the client.
    res.once('data', () => targetSocket!.destroy());
    res.resume();
  });
  try {
    test.client.end();
    await within(Promise.all([ended.promise, test.forwarded]));
    expect({ downstreamClosed, ...test.state() }).toEqual({
      downstreamClosed: true,
      settled: true,
      rejected: false,
    });
  } finally {
    await test.close();
  }
});

it('closes the target socket and settles forwarding when the client disconnects', async () => {
  const closed = signal();
  let targetClosed = false;
  const test = await fixture((req, res) => {
    req.socket.on('close', () => {
      targetClosed = true;
      closed.resolve();
    });
    res.writeHead(200);
    res.write('still streaming');
  });
  test.client.on('response', (res) => {
    res.on('error', () => {});
    res.once('data', () => test.client.destroy());
    res.resume();
  });
  try {
    test.client.end();
    await within(Promise.all([closed.promise, test.forwarded]));
    expect({ targetClosed, ...test.state() }).toEqual({
      targetClosed: true,
      settled: true,
      rejected: false,
    });
  } finally {
    await test.close();
  }
});

it('bounds a hung target with the configured timeout and settles forwarding', async () => {
  const closed = signal();
  const ended = signal();
  let targetClosed = false;
  let downstreamClosed = false;
  const test = await fixture((req) => {
    req.socket.on('close', () => {
      targetClosed = true;
      closed.resolve();
    });
    req.resume();
    // Intentionally never send response headers or a response body.
  }, 80);
  test.client.on('error', () => {
    downstreamClosed = true;
    ended.resolve();
  });
  test.client.on('response', (res) => {
    res.on('error', () => {});
    res.on('close', () => {
      downstreamClosed = true;
      ended.resolve();
    });
    res.resume();
  });
  try {
    test.client.end();
    await within(Promise.all([closed.promise, ended.promise, test.forwarded]), 500);
    expect({ targetClosed, downstreamClosed, ...test.state() }).toEqual({
      targetClosed: true,
      downstreamClosed: true,
      settled: true,
      rejected: false,
    });
  } finally {
    await test.close();
  }
});
