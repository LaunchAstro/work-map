import { readFileSync, existsSync } from 'node:fs';
import { expect, it } from 'vitest';

it('has no direct herdr reader or session ledger readers', () => {
  const local = readFileSync('src/readers/local.ts', 'utf8');
  const collector = readFileSync('src/cli/generate-run.ts', 'utf8');
  expect(local).not.toContain('readHerdr');
  expect(collector).not.toContain('readHerdr');
  for (const path of [
    'src/readers/ledger-panes.ts',
    'src/readers/ledger-remote.ts',
    'src/cli/ledger-source.ts',
    'src/readers/ledger.ts',
  ])
    expect(existsSync(path)).toBe(false);
});

it('publishes pending agents without executing herdr or inventing a vanished-pane stop', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { currentAgents } = await import('../src/web/snapshot.ts');
  const { SEAT_GAUGE_PENDING } = await import('../src/core/loading-bay.ts');
  const root = mkdtempSync(join(tmpdir(), 'contained-sources-'));
  const data = join(root, 'data');
  const round = join(root, 'round');
  mkdirSync(data);
  mkdirSync(round);
  const at = new Date().toISOString();
  const oldStop = '2026-10-14T00:00:00.000Z';
  writeFileSync(
    join(round, 'events.log'),
    `${at} L-New BOOTED Section: tasks\n${at} L-New WRAPPED done\n`,
  );
  const before = {
    schema: 'work-map-agents/2',
    generatedAt: at,
    round: null,
    herdr: { ok: true, error: null },
    lanes: [
      {
        lane: 'L-Working',
        state: 'working',
        nodes: ['tasks'],
        seen: { herdr: true, events: true },
        closedAt: null,
      },
    ],
    history: { found: { lane: 'L-Previous', stoppedAt: oldStop, via: 'section' } },
    byNode: {},
    fog: [],
  };
  writeFileSync(join(data, 'agents.json'), JSON.stringify(before));
  const herdr = join(root, 'herdr');
  const probe = join(root, 'invoked');
  writeFileSync(herdr, '#!/bin/sh\necho called > "$PROBE_FILE"\nexit 1\n', { mode: 0o755 });
  const project = join(root, 'project.json');
  writeFileSync(
    project,
    JSON.stringify({
      version: 1,
      id: 'proof',
      title: 'Proof',
      roadmapRepo: 'Demo/plan',
      productRepo: 'Demo/product',
      repos: ['Demo/product'],
      files: {
        audit: 'audit.json',
        flow: 'flow.json',
        plan: 'build-units.md',
        mapping: 'mapping.json',
        sections: 'sections.json',
      },
      lanePrefix: 'L-',
      laneRules: [],
      dependencies: [],
      ticketConventions: {
        mapLabel: 'map',
        ideaLabels: [],
        ideaPattern: '^Idea:',
        specLabels: [],
        specPattern: '^Spec:',
        readyLabel: 'ready',
        ticketLabels: [],
      },
    }),
  );
  try {
    const run = spawnSync(
      process.execPath,
      [
        resolve('src/cli/generate.ts'),
        'agents',
        '--project',
        project,
        '--repo-root',
        resolve('test/fixtures'),
        '--data',
        data,
        '--round',
        round,
      ],
      {
        env: { ...process.env, HOME: root, HERDR_BIN: herdr, PROBE_FILE: probe },
        encoding: 'utf8',
        timeout: 15_000,
      },
    );
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(probe)).toBe(false);
    const result = currentAgents(JSON.parse(readFileSync(join(data, 'agents.json'), 'utf8')));
    expect(result?.agentSource).toEqual({ state: 'pending', reason: SEAT_GAUGE_PENDING });
    expect(result?.herdr?.ok).toBe(false);
    expect(result?.lanes.map((lane) => lane.state)).toEqual(['unknown']);
    expect(result).not.toHaveProperty('history');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
