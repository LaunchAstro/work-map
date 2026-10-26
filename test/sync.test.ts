import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createMapSync,
  isLocalSyncRequest,
  isLocalReadRequest,
  runCollector,
  syncEvidence,
} from '../src/cli/map-sync.ts';
import { SyncResultSchema } from '../src/core/sync.ts';

const now = Date.now();
const at = new Date(now + 1000).toISOString();
const snapshot = {
  schema: 'work-map/4',
  id: 'fixture',
  stages: [],
  prs: {},
  generatedAt: at,
  sources: { github: { lastRun: { at, partial: false, skipped: false } } },
  work: { at, complete: true },
};
const agents = { schema: 'work-map-agents/2', lanes: [], generatedAt: at, herdr: { ok: true } };

describe('manual data sync', () => {
  it('rejects foreign, parameterised, body-carrying and unmarked requests', () => {
    const req = {
      method: 'POST',
      url: '/sync',
      headers: {
        host: '127.0.0.1:4317',
        origin: 'http://127.0.0.1:4317',
        'x-work-map-sync': '1',
        'content-type': 'application/json',
      },
    };
    expect(isLocalSyncRequest(req, 4317)).toBe(true);
    expect(isLocalReadRequest({ headers: { host: '127.0.0.1:4317' } }, 4317)).toBe(true);
    expect(isLocalReadRequest({ headers: { host: 'foreign.test:4317' } }, 4317)).toBe(false);
    expect(
      isLocalReadRequest(
        { headers: { host: '127.0.0.1:4317', origin: 'https://foreign.test' } },
        4317,
      ),
    ).toBe(false);
    for (const changed of [
      { method: 'GET' },
      { url: '/sync?command=anything' },
      { headers: { ...req.headers, origin: 'https://foreign.test' } },
      { headers: { ...req.headers, host: 'foreign.test:4317' } },
      { headers: { ...req.headers, 'content-length': '2' } },
      { headers: { ...req.headers, 'transfer-encoding': 'chunked' } },
      { headers: { ...req.headers, 'x-work-map-sync': undefined } },
      { headers: { ...req.headers, 'sec-fetch-site': 'cross-site' } },
    ])
      expect(isLocalSyncRequest({ ...req, ...changed }, 4317)).toBe(false);
  });
  it('requires fresh complete GitHub, planning and herdr evidence even after exit zero', () => {
    expect(syncEvidence(snapshot, agents, now, now).status).toBe('complete');
    expect(syncEvidence({ ...snapshot, schema: 'old' }, agents, now, now).status).toBe('failed');
    for (const s of [
      { ...snapshot, generatedAt: new Date(now - 1).toISOString() },
      { ...snapshot, sources: { github: { lastRun: { at, skipped: true, partial: false } } } },
      { ...snapshot, sources: { github: { lastRun: { at, partial: true } } } },
      { ...snapshot, work: { at, complete: false, error: 'context unavailable' } },
    ])
      expect(syncEvidence(s, agents, now, now).status).toBe('incomplete');
    expect(syncEvidence(snapshot, { ...agents, herdr: { ok: false } }, now, now).status).toBe(
      'incomplete',
    );
  });
  it('joins concurrent requests, resets after completion and does not invoke inference', async () => {
    const data = mkdtempSync(join(tmpdir(), 'map-sync-'));
    const calls: string[] = [];
    const sync = createMapSync(
      { app: '.', data, node: process.execPath, project: 'fixed', roadmap: 'fixed' },
      async (mode) => {
        calls.push(mode);
        await new Promise((resolve) => setTimeout(resolve, 15));
        const freshAt = new Date().toISOString();
        writeFileSync(
          join(data, 'snapshot.json'),
          JSON.stringify({
            ...snapshot,
            generatedAt: freshAt,
            sources: { github: { lastRun: { at: freshAt, partial: false } } },
            work: { at: freshAt, complete: true },
          }),
        );
        writeFileSync(
          join(data, 'agents.json'),
          JSON.stringify({ ...agents, generatedAt: freshAt }),
        );
      },
    );
    const a = sync.run(),
      b = sync.run();
    expect(a).toBe(b);
    expect((await a).status).toBe('complete');
    expect(calls).toEqual(['github', 'agents']);
    await sync.run();
    expect(calls).toEqual(['github', 'agents', 'github', 'agents']);
  });
  it('fails on a failed GitHub read without reading lanes, and starts nothing else', async () => {
    const calls: string[] = [];
    const sync = createMapSync(
      {
        app: '.',
        data: mkdtempSync(join(tmpdir(), 'map-sync-')),
        node: process.execPath,
        project: 'fixed',
        roadmap: 'fixed',
      },
      async (mode) => {
        calls.push(mode);
        throw new Error('GitHub read failed');
      },
    );
    expect(await sync.run()).toEqual({
      status: 'failed',
      reason: 'GitHub read failed',
      versionsRequired: false,
    });
    expect(calls).toEqual(['github']);
  });
  it.each(['missing', 'malformed', 'pending', 'old', 'current', 'disabled'])(
    'checks configured version publication during Sync: %s',
    async (kind) => {
      const data = mkdtempSync(join(tmpdir(), 'map-version-sync-'));
      if (kind !== 'disabled') writeFileSync(join(data, 'versions.config.json'), '[]');
      const sync = createMapSync(
        { app: '.', data, node: process.execPath, project: 'fixed', roadmap: 'fixed' },
        async () => {
          const freshAt = new Date().toISOString();
          writeFileSync(
            join(data, 'snapshot.json'),
            JSON.stringify({
              ...snapshot,
              generatedAt: freshAt,
              sources: { github: { lastRun: { at: freshAt, partial: false } } },
              work: { at: freshAt, complete: true },
            }),
          );
          writeFileSync(
            join(data, 'agents.json'),
            JSON.stringify({ ...agents, generatedAt: freshAt }),
          );
          if (kind === 'malformed') writeFileSync(join(data, 'versions.json'), '{broken');
          else if (kind !== 'missing' && kind !== 'disabled')
            writeFileSync(
              join(data, 'versions.json'),
              JSON.stringify({
                schema: 'work-map-versions/1',
                repo: 'Demo/product',
                checkedAt: kind === 'old' ? '2020-01-01T00:00:00Z' : freshAt,
                main: 'a'.repeat(40),
                sites: [
                  {
                    name: 'Demo',
                    origin: 'https://demo.example.com',
                    buildUrl: 'https://demo.example.com/build.json',
                    state: kind === 'pending' ? 'pending' : 'current',
                    build: 'a'.repeat(12),
                    sha: 'a'.repeat(40),
                    merges: kind === 'pending' ? null : 0,
                    reason: '',
                    lastKnown: null,
                  },
                ],
              }),
            );
        },
      );
      // #206: a site version fault is a warning beside a complete Sync, never a reason for incomplete.
      const result = await sync.run();
      expect(result).toMatchObject({ status: 'complete', versionsRequired: kind !== 'disabled' });
      expect(result.warnings).toEqual(
        kind === 'current' || kind === 'disabled' ? undefined : ['Site version read is incomplete'],
      );
    },
  );
  it('times out an owned child group including a resistant descendant before allowing another run', async () => {
    const app = mkdtempSync(join(tmpdir(), 'map-sync-child-'));
    const { mkdirSync, existsSync } = await import('node:fs');
    mkdirSync(join(app, 'src/cli'), { recursive: true });
    const marker = join(app, 'orphan');
    const ready = join(app, 'ready');
    writeFileSync(
      join(app, 'src/cli/generate.ts'),
      `import { spawn } from 'node:child_process'; spawn(process.execPath, ['-e', ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(ready)},'ready');process.on('SIGTERM',()=>{});setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'orphan'),900);setInterval(()=>{},100);`)}], {stdio:'ignore'});process.on('SIGTERM',()=>{});setInterval(()=>{},100);`,
    );
    await expect(
      runCollector(
        'github',
        { app, data: app, project: 'fixed', roadmap: 'fixed', node: process.execPath },
        250,
      ),
    ).rejects.toThrow('timed out');
    expect(existsSync(ready)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(existsSync(marker)).toBe(false);
  });
  it('kernel locks serialize publication, allow shared readers and reject checkout mutation while read-owned', async () => {
    const data = mkdtempSync(join(tmpdir(), 'map-lock-'));
    const script = resolvePath('ops/hold-lock.pl');
    const start = (shared: boolean, ms: number): Promise<number> =>
      new Promise((resolve) => {
        const child = spawn('perl', [
          script,
          join(data, 'lock'),
          '0',
          ...(shared ? ['--shared'] : []),
          process.execPath,
          '-e',
          `setTimeout(()=>{},${ms})`,
        ]);
        child.on('exit', (code) => resolve(code ?? 1));
      });
    const held = start(true, 250);
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(await start(true, 20)).toBe(0);
    expect(await start(false, 20)).toBe(75);
    expect(await held).toBe(0);
    expect(await start(false, 20)).toBe(0);
  });
});

it('keeps GitHub Sync independent of intentionally pending Seat Gauge data', async () => {
  const { SEAT_GAUGE_PENDING } = await import('../src/core/loading-bay.ts');
  expect(
    syncEvidence(
      snapshot,
      {
        ...agents,
        herdr: { ok: false, error: SEAT_GAUGE_PENDING },
        agentSource: { state: 'pending', reason: SEAT_GAUGE_PENDING },
      },
      now,
      now,
    ).status,
  ).toBe('complete');
});

it('the shared Sync reply schema refuses unreadable completion times', () => {
  expect(
    SyncResultSchema.safeParse({
      status: 'complete',
      snapshotAt: 'not-a-time',
      agentsAt: 'not-a-time',
      versionsRequired: false,
    }).success,
  ).toBe(false);
});

it('every Sync reply the server builds is one the screen reads', async () => {
  const replies = [
    syncEvidence(snapshot, agents, now, now),
    syncEvidence({ ...snapshot, schema: 'old' }, agents, now, now),
    syncEvidence({ ...snapshot, work: { at, complete: false } }, agents, now, now),
    syncEvidence(snapshot, agents, now, now, { required: true, value: null }),
  ];
  const data = mkdtempSync(join(tmpdir(), 'map-sync-'));
  const sync = createMapSync(
    { app: '.', data, node: process.execPath, project: 'fixed', roadmap: 'fixed' },
    async () => {
      throw new Error('Collector failed');
    },
  );
  replies.push(await sync.run());
  writeFileSync(join(data, 'versions.config.json'), '[]');
  replies.push(await sync.run());
  for (const reply of replies)
    expect(SyncResultSchema.safeParse(reply).success, JSON.stringify(reply)).toBe(true);
});
