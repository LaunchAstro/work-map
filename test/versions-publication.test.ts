import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { currentSnapshot } from '../src/web/snapshot.ts';
import { currentVersions } from '../src/core/versions.ts';

it.each([false, true])(
  'publishes the map after corrupt prior versions, configured=%s',
  (configured) => {
    const root = mkdtempSync(join(tmpdir(), 'map-version-publication-'));
    const data = join(root, 'data');
    const bin = join(root, 'bin');
    mkdirSync(data);
    mkdirSync(bin);
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    writeFileSync(join(data, 'versions.json'), '{broken');
    if (configured)
      writeFileSync(
        join(data, 'versions.config.json'),
        JSON.stringify([
          {
            name: 'Demo',
            origin: 'https://demo.example.com',
            buildPath: '/build.json',
            metaName: 'demo-build',
          },
        ]),
      );
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
        lanePrefix: 'PROOF-',
        laneRules: [],
        dependencies: [],
        ticketConventions: {
          mapLabel: 'map',
          ideaLabels: ['idea'],
          ideaPattern: '^Idea:',
          specLabels: ['spec'],
          readyLabel: 'ready',
          ticketLabels: ['task'],
          specPattern: '^Spec:',
        },
      }),
    );
    try {
      const run = spawnSync(
        process.execPath,
        [
          resolve('src/cli/generate.ts'),
          'github',
          // #242: site versions are read on Sync, not by the five-minute timer.
          '--sync',
          '--project',
          project,
          '--repo-root',
          resolve('test/fixtures'),
          '--data',
          data,
        ],
        {
          env: {
            ...process.env,
            PATH: bin + ':' + process.env['PATH'],
            WORK_MAP_PROJECT: '',
            WORK_MAP_ROADMAP: '',
            WORK_MAP_ROUND_ROOT: join(root, 'empty-round'),
          },
          encoding: 'utf8',
          timeout: 15_000,
        },
      );
      expect(run.error).toBeUndefined();
      expect(
        currentSnapshot(JSON.parse(readFileSync(join(data, 'snapshot.json'), 'utf8'))),
      ).not.toBeNull();
      const versions = currentVersions(
        JSON.parse(readFileSync(join(data, 'versions.json'), 'utf8')),
      );
      expect(versions).not.toBeNull();
      expect(versions?.sites.length).toBe(configured ? 1 : 0);
      if (configured) expect(versions?.sites[0]).toMatchObject({ state: 'pending', merges: null });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
