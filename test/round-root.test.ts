// The agents job reads the newest round log under WORK_MAP_ROUND_ROOT, or OA_ROUND_ROOT for jobs installed
// before that name existed, or else the roadmap's .local folder.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import type { AgentsSnapshot } from '../src/core/contract.ts';

const roadmap = resolve('examples/demo/roadmap');

function rounds(root: string, name: string): string {
  const dir = join(root, name, 'round-1');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'events.log');
  writeFileSync(file, '2026-10-20T05:00:00Z KT-Basket BOOTED Section: basket\n');
  return file;
}

function agents(root: string, env: Record<string, string>): AgentsSnapshot {
  const data = mkdtempSync(join(root, 'data-'));
  const run = spawnSync(
    process.execPath,
    [
      resolve('src/cli/generate.ts'),
      'agents',
      '--project',
      join(roadmap, 'project.json'),
      '--repo-root',
      roadmap,
      '--data',
      data,
    ],
    { env: { PATH: process.env['PATH'], HOME: root, ...env }, encoding: 'utf8', timeout: 15_000 },
  );
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(readFileSync(join(data, 'agents.json'), 'utf8')) as AgentsSnapshot;
}

it('reads round logs from WORK_MAP_ROUND_ROOT before OA_ROUND_ROOT', () => {
  const root = mkdtempSync(join(tmpdir(), 'work-map-rounds-'));
  const named = rounds(root, 'named');
  const old = rounds(root, 'old');
  // agents.json writes the home folder as ~.
  const shown = (file: string) => file.replace(root, '~');
  expect(
    agents(root, { WORK_MAP_ROUND_ROOT: join(root, 'named'), OA_ROUND_ROOT: join(root, 'old') })
      .round?.events,
  ).toBe(shown(named));
  expect(agents(root, { OA_ROUND_ROOT: join(root, 'old') }).round?.events).toBe(shown(old));
});

it('treats an empty WORK_MAP_ROUND_ROOT as unset and reads OA_ROUND_ROOT', () => {
  const root = mkdtempSync(join(tmpdir(), 'work-map-rounds-'));
  const old = rounds(root, 'old');
  expect(
    agents(root, { WORK_MAP_ROUND_ROOT: '', OA_ROUND_ROOT: join(root, 'old') }).round?.events,
  ).toBe(old.replace(root, '~'));
});
