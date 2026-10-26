import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import type { Snapshot } from '../src/core/contract.ts';
import { seed } from '../examples/demo/seed.ts';

const roadmap = join(import.meta.dirname, '../examples/demo/roadmap');
const now = new Date('2026-10-20T06:00:00Z');
let snapshot: Snapshot;

// The example builds its map offline: the seeded GitHub read, then the snapshot command, no login or network.
beforeAll(() => {
  const data = mkdtempSync(join(tmpdir(), 'work-map-demo-'));
  seed(data, now);
  execFileSync(
    process.execPath,
    [
      'src/cli/generate.ts',
      'snapshot',
      '--project',
      join(roadmap, 'project.json'),
      '--repo-root',
      roadmap,
      '--data',
      data,
    ],
    {
      stdio: 'ignore',
      env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '', PATH: process.env['PATH'] },
    },
  );
  snapshot = JSON.parse(readFileSync(join(data, 'snapshot.json'), 'utf8')) as Snapshot;
});

it('draws every section of the example diagram on its stage', () => {
  expect(snapshot.title).toBe('Kettle work map');
  expect(snapshot.stages.map((stage) => [stage.name, stage.nodes.map((node) => node.id)])).toEqual([
    ['Groundwork', ['accounts', 'catalogue']],
    ['Ordering', ['basket', 'checkout']],
    ['Repeat orders', ['subscriptions']],
    ['Fulfilment', ['dispatch']],
    ['Launch', ['launch']],
  ]);
});

it('places every ticket and pull request on a section', () => {
  const work = snapshot.work!;
  expect(work.complete).toBe(true);
  expect(work.unplacedPrs).toEqual([]);
  const tickets = snapshot.ticketProgress!;
  expect(tickets.complete).toBe(true);
  expect([tickets.unplaced, tickets.outside, tickets.missing]).toEqual([[], [], []]);
  expect(tickets.totals).toMatchObject({ completed: 11, total: 26, dropped: 1 });
  expect(tickets.byNode['accounts']).toMatchObject({ completed: 4, total: 5, pct: 80 });
});

it('shows started sections with ticket progress, review and open work', () => {
  const byNode = snapshot.work!.byNode;
  expect(byNode['accounts']!.review.pct).toBeGreaterThan(0);
  expect(byNode['basket']!.openPrs).toHaveLength(1);
  expect(byNode['launch']!.review.prs).toEqual([]);
  expect(snapshot.work!.wires.map((wire) => `${wire.from[0]}>${wire.to[0]}`)).toEqual([
    'checkout>subscriptions',
    'checkout>dispatch',
    'dispatch>launch',
  ]);
});

// run.sh serves the example alone: a project set in the caller's environment must not switch on Sync, which would
// read GitHub and put that project's map in place of the example.
it('serves the example offline even when the environment names another project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'work-map-demo-run-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho "$@" >> ${join(root, 'gh-calls')}\nexit 1\n`, {
    mode: 0o755,
  });
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist/index.html'), 'page');
  const port = await new Promise<number>((done) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => done(typeof address === 'object' && address ? address.port : 0));
    });
  });
  const server = spawn('sh', ['examples/demo/run.sh', join(root, 'data')], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env['PATH']}`,
      WORK_MAP_PORT: String(port),
      WORK_MAP_NODE: process.execPath,
      WORK_MAP_DIST: join(root, 'dist'),
      WORK_MAP_PROJECT: join(roadmap, 'project.json'),
      WORK_MAP_ROADMAP: roadmap,
    },
    stdio: 'ignore',
  });
  try {
    const url = `http://127.0.0.1:${port}`;
    const ready = async (tries: number): Promise<void> => {
      const ok = await fetch(`${url}/data/snapshot.json`).then(
        (r) => r.ok,
        () => false,
      );
      if (ok) return;
      if (!tries) throw new Error('The example server did not start');
      await new Promise((done) => setTimeout(done, 100));
      return ready(tries - 1);
    };
    await ready(100);
    const sync = await fetch(`${url}/sync`, {
      method: 'POST',
      headers: { Origin: url, 'X-Work-Map-Sync': '1', 'Content-Type': 'application/json' },
    }).then((r) => r.json() as Promise<{ status: string; reason: string }>);
    expect(sync).toMatchObject({
      status: 'failed',
      reason: 'Refresh configuration is unavailable',
    });
    expect(existsSync(join(root, 'gh-calls'))).toBe(false);
    const served = (await fetch(`${url}/data/snapshot.json`).then((r) => r.json())) as Snapshot;
    expect(served.id).toBe('kettle');
  } finally {
    server.kill();
  }
});

// pnpm installs dependencies before it runs a package script, so a quick start step before the install must not be one.
it('quick start runs no package script before installing', () => {
  const readme = readFileSync(join(import.meta.dirname, '../examples/demo/README.md'), 'utf8');
  const steps = readme
    .match(/```sh\n([\s\S]*?)```/)![1]!
    .trim()
    .split('\n');
  const install = steps.indexOf('pnpm install --frozen-lockfile');
  expect(install).toBeGreaterThanOrEqual(0);
  expect(steps.slice(0, install).filter((step) => step.startsWith('pnpm '))).toEqual([]);
  for (const step of steps.filter((line) => line.startsWith('sh '))) {
    expect(existsSync(join(import.meta.dirname, '..', step.split(' ')[1]!))).toBe(true);
  }
});
