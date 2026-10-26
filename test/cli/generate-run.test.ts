import { afterEach, expect, it, vi } from 'vitest';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { currentVersions } from '../../src/core/versions.ts';

const effects = vi.hoisted(() => ({
  values: {} as Record<string, string | boolean>,
  gh: [] as string[][],
  versionsThrow: false,
  versionsRateLimitFails: false,
  versionsGh: [] as string[][],
}));
vi.mock('node:util', async (original) => ({
  ...(await original<typeof import('node:util')>()),
  parseArgs: () => ({ values: effects.values, positionals: ['github'] }),
}));
vi.mock('node:child_process', () => ({
  execFileSync: (command: string, args: string[], options?: { timeout?: number }) => {
    if (command === 'git') return 'a'.repeat(40);
    if (command !== 'gh') throw new Error(`Unexpected command: ${command}`);
    effects.gh.push(args);
    // Only the version reader passes gh a five-second limit here (no section map, no gap read).
    if (options?.timeout === 5_000) {
      effects.versionsGh.push(args);
      if (effects.versionsRateLimitFails && args[1] === 'rate_limit')
        throw new Error('gh: network unavailable');
    }
    if (args[1] === 'rate_limit')
      return JSON.stringify({
        resources: { core: { remaining: 5000 }, graphql: { remaining: 5000 } },
      });
    if (args[1] !== 'graphql') throw new Error(`Unexpected gh call: ${args.join(' ')}`);
    const page = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
    return JSON.stringify({
      data: {
        rateLimit: { remaining: 4000, cost: 1 },
        repository: { issues: page, pullRequests: page },
        search: page,
        queue: { mergeQueue: null },
      },
    });
  },
}));
vi.mock('../../src/readers/versions.ts', async (original) => {
  const real = await original<typeof import('../../src/readers/versions.ts')>();
  return {
    ...real,
    refreshVersions: (input: Parameters<typeof real.refreshVersions>[0]) =>
      effects.versionsThrow
        ? Promise.reject(new Error('Acme version read broke'))
        : real.refreshVersions(input),
  };
});
let root = '';
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  effects.versionsThrow = false;
  effects.versionsRateLimitFails = false;
  vi.unstubAllGlobals();
  vi.resetModules();
});

function project(prefix: string): (name: string, value: unknown) => void {
  root = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  const write = (name: string, value: unknown) =>
    writeFileSync(join(root, name), JSON.stringify(value), { mode: 0o600 });
  for (const name of ['audit.json', 'flow.json', 'build-units.md'])
    copyFileSync(new URL(`../fixtures/${name}`, import.meta.url), join(root, name));
  write('project.json', {
    version: 1,
    id: 'synthetic',
    title: 'Synthetic',
    roadmapRepo: 'Example/app',
    productRepo: 'Example/app',
    repos: ['Example/app'],
    files: {
      flow: 'flow.json',
      audit: 'audit.json',
      plan: 'build-units.md',
      mapping: 'mapping.json',
      sections: 'sections.json',
    },
    lanePrefix: '',
    laneRules: [],
    dependencies: [],
    ticketConventions: {
      readyLabel: 'ready',
      ticketLabels: [],
      mapLabel: 'map',
      ideaLabels: [],
      ideaPattern: '^Idea',
      specLabels: [],
      specPattern: '^Spec',
    },
  });
  effects.values = {
    project: join(root, 'project.json'),
    data: root,
    'repo-root': root,
    floor: '1000',
  };
  effects.gh = [];
  effects.versionsGh = [];
  return write;
}

it('the github run log counts every GitHub request the collector makes, by kind', async () => {
  project('generate-run-calls-');
  await import('../../src/cli/generate-run.ts');
  const log = JSON.parse(readFileSync(join(root, 'runs.jsonl'), 'utf8'));
  expect(log.snapshotError).toBeUndefined();
  expect(effects.gh.length).toBeGreaterThan(0);
  expect(log.githubCalls).toEqual({
    restRateLimit: effects.gh.filter((args) => args[1] === 'rate_limit').length,
    graphql: effects.gh.filter((args) => args[1] === 'graphql').length,
    restOther: effects.gh.filter((args) => args[1] !== 'rate_limit' && args[1] !== 'graphql')
      .length,
  });
});

it("searches for the project's switch-on title", async () => {
  const write = project('generate-run-switch-on-');
  const base = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'));
  write('project.json', { ...base, switchOnTitle: 'Go-live' });
  await import('../../src/cli/generate-run.ts');
  // The card read's own search names no issues; the switch-on search is the issue one.
  const searches = effects.gh
    .flat()
    .filter((arg) => arg.startsWith('q=') && arg.includes('is:issue'));
  expect(searches.length).toBeGreaterThan(0);
  for (const q of searches) expect(q).toContain('in:title "Go-live"');
});

// TN-50: Sync's version step tells a bad configuration apart from a read that breaks.
const sha = (c: string): string => c.repeat(40);
const acmeWeb = {
  name: 'Acme web',
  origin: 'https://web.acme.example',
  buildUrl: 'https://web.acme.example/build.json',
  state: 'current',
  build: 'aaaaaaaaaaaa',
  sha: sha('a'),
  merges: 2,
  reason: 'Verified served web build; API revision is not reported',
  lastKnown: null,
};
const earlier = {
  schema: 'work-map-versions/1',
  repo: 'Example/app',
  checkedAt: '2026-10-20T01:00:00.000Z',
  main: sha('d'),
  sites: [acmeWeb],
};
const acmeSite = {
  name: 'Acme web',
  origin: 'https://web.acme.example',
  buildPath: '/build.json',
  metaName: 'acme-build',
};

it('keeps the last site versions, pending with their date, when the version read breaks', async () => {
  const write = project('generate-run-versions-');
  write('versions.config.json', [acmeSite]);
  write('versions.json', earlier);
  effects.values['sync'] = true;
  effects.versionsThrow = true;
  await import('../../src/cli/generate-run.ts');
  const versions = JSON.parse(readFileSync(join(root, 'versions.json'), 'utf8'));
  expect(currentVersions(versions)).not.toBeNull();
  expect(versions.error).toBe('Version read failed; site comparison is pending');
  expect(versions.main).toBeNull();
  expect(versions.sites).toEqual([
    {
      ...earlier.sites[0],
      state: 'pending',
      build: null,
      sha: null,
      merges: null,
      reason: 'Version read failed; site comparison is pending',
      lastKnown: {
        at: earlier.checkedAt,
        build: 'aaaaaaaaaaaa',
        sha: sha('a'),
        main: sha('d'),
        merges: 2,
      },
    },
  ]);
  // Keeping the last sites reads nothing more from GitHub.
  expect(effects.gh.filter((args) => /\/(commits|compare)\//.test(args[1] ?? ''))).toEqual([]);
});

// Guards kept behaviour (passes on main too): a bad configuration is still reported as invalid.
it('still reports a bad version configuration as invalid, with no sites', async () => {
  const write = project('generate-run-versions-');
  write('versions.config.json', [{ ...acmeSite, origin: 'http://web.acme.example' }]);
  write('versions.json', earlier);
  effects.values['sync'] = true;
  await import('../../src/cli/generate-run.ts');
  const versions = JSON.parse(readFileSync(join(root, 'versions.json'), 'utf8'));
  expect(versions).toMatchObject({
    sites: [],
    main: null,
    error: 'Version configuration is invalid; site comparison is pending',
  });
  expect(effects.gh.filter((args) => /\/(commits|compare)\//.test(args[1] ?? ''))).toEqual([]);
});

it('keeps the last sites, pending with their date, when the version setup read fails', async () => {
  const write = project('generate-run-versions-');
  const acmeAdmin = {
    ...acmeWeb,
    name: 'Acme admin',
    origin: 'https://admin.acme.example',
    buildUrl: 'https://admin.acme.example/build.json',
    build: 'bbbbbbbbbbbb',
    sha: sha('b'),
    merges: 5,
  };
  write('versions.config.json', [acmeSite]);
  write('versions.json', { ...earlier, sites: [...earlier.sites, acmeAdmin] });
  effects.values['sync'] = true;
  effects.versionsRateLimitFails = true;
  const fetch = vi.fn(() => Promise.reject(new Error('Acme site read')));
  vi.stubGlobal('fetch', fetch);
  await import('../../src/cli/generate-run.ts');
  const versions = JSON.parse(readFileSync(join(root, 'versions.json'), 'utf8'));
  const reason = 'Repository revision is unavailable or GitHub read reserve reached';
  expect(currentVersions(versions)).not.toBeNull();
  expect(versions.error).toBe(reason);
  expect(versions.main).toBeNull();
  const kept = (row: typeof acmeWeb) => ({
    ...row,
    state: 'pending',
    build: null,
    sha: null,
    merges: null,
    reason,
    lastKnown: {
      at: earlier.checkedAt,
      build: row.build,
      sha: row.sha,
      main: sha('d'),
      merges: row.merges,
    },
  });
  expect(versions.sites).toEqual([kept(acmeWeb), kept(acmeAdmin)]);
  expect(effects.versionsGh).toEqual([['api', 'rate_limit']]);
  expect(fetch).not.toHaveBeenCalled();
});
