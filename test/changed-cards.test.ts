// SPDX-License-Identifier: AGPL-3.0-only
// #242: a Sync re-reads only the repositories and kinds that changed; a failed read keeps the last values
// with their time. #245: only Sync reads the cards; the timer and the post-merge kick never do.
import { describe, expect, it } from 'vitest';
import { emptyWorkCache, refreshWork, type WorkCache } from '../src/readers/work-github.ts';
import { LIGHT_FLOOR } from '../src/readers/github.ts';
import { githubScope, mergedSince, readsCards } from '../src/core/refresh-scope.ts';
import type { Project } from '../src/readers/project.ts';

const base: Project = {
  version: 1,
  id: 'demo',
  title: 'Demo',
  roadmapRepo: 'Acme/roadmap',
  productRepo: 'Acme/app',
  repos: ['Acme/app', 'Acme/other'],
  files: { flow: 'a', audit: 'b', plan: 'c', mapping: 'd', sections: 'e' },
  lanePrefix: 'L-',
  laneRules: [],
  ticketConventions: {
    readyLabel: 'merge-ready',
    ticketLabels: [],
    mapLabel: 'map',
    ideaLabels: [],
    ideaPattern: 'idea',
    specLabels: [],
    specPattern: 'spec',
  },
  dependencies: [],
};
const projects: readonly [string, Project][] = [
  ['estimated scope', base],
  [
    'ticket count',
    {
      ...base,
      progress: { basis: 'ticket-count', repositories: { 'Acme/app': 'app', 'Acme/other': 'app' } },
    },
  ],
];

type State = 'OPEN' | 'MERGED' | 'CLOSED';
interface Item {
  repo: string;
  number: number;
  kind: 'Issue' | 'PullRequest';
  state: State | 'CLOSED_ISSUE' | 'OPEN_ISSUE';
  title: string;
  updatedAt: string;
  /** Labels on an issue or PR; above 100, GitHub sends the first 100 and the full count. */
  labels?: number;
}
const t0 = Date.parse('2026-10-19T00:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();
const link = (repo: string, n: number, kind: string): string =>
  `https://github.com/${repo}/${kind === 'Issue' ? 'issues' : 'pull'}/${n}`;

const labels = (i: Item) => ({
  totalCount: i.labels ?? 0,
  nodes: Array.from({ length: Math.min(i.labels ?? 0, 100) }, (_, n) => ({ name: `l${n}` })),
});
/** A fake GitHub over several repositories: paged reads, the search probe, and a log of each call. */
function fakeGithub(items: Item[], remaining = 5000) {
  const log: string[] = [];
  const run = async (args: readonly string[]): Promise<string> => {
    if (args[1] === 'rate_limit') {
      log.push('rate_limit');
      return JSON.stringify({ resources: { core: { remaining }, graphql: { remaining } } });
    }
    const query = args.find((a) => a.startsWith('query=')) ?? '';
    const name = args.find((a) => a.startsWith('name='))?.slice(5);
    const repo = name ? `Acme/${name}` : null;
    if (query.includes('search(query:$q')) {
      const q = args.find((a) => a.startsWith('q=')) ?? '';
      const since = Date.parse(/updated:>=(\S+)/.exec(q)?.[1] ?? '');
      // The probe names the configured repositories, so the owner's other repositories add no noise.
      expect(q).toMatch(/^q=repo:Acme\/app repo:Acme\/other updated:>=\S+ sort:updated-desc$/);
      log.push('probe');
      const nodes = items
        .filter((i) => Date.parse(i.updatedAt) >= since)
        .map((i) =>
          i.kind === 'Issue'
            ? { kind: 'Issue', updatedAt: i.updatedAt, repository: { nameWithOwner: i.repo } }
            : {
                kind: 'PullRequest',
                state: i.state,
                updatedAt: i.updatedAt,
                repository: { nameWithOwner: i.repo },
              },
        );
      return JSON.stringify({
        data: {
          rateLimit: { cost: 1, remaining },
          search: {
            issueCount: nodes.length,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes,
          },
        },
      });
    }
    const state = /pullRequests\(states:(\w+)/.exec(query)?.[1];
    log.push(`${repo}:${state ?? 'issues'}`);
    // Pages hold 25 PRs or 100 issues, as the reader asks.
    const size = state ? 25 : 100;
    const offset = Number(args.find((a) => a.startsWith('cursor='))?.slice(7) ?? 0);
    const all = items
      .filter((i) => i.repo === repo)
      .filter((i) => (state ? i.kind === 'PullRequest' && i.state === state : i.kind === 'Issue'))
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const mine = all.slice(offset, offset + size);
    const more = offset + size < all.length;
    const nodes = mine.map((i) =>
      state
        ? {
            number: i.number,
            title: i.title,
            body: null,
            url: link(i.repo, i.number, i.kind),
            createdAt: iso(t0 - 30 * 86_400_000),
            updatedAt: i.updatedAt,
            headRefName: `b-${i.number}`,
            headRepository: { nameWithOwner: i.repo },
            labels: labels(i),
            latestOpinionatedReviews: { totalCount: 0, nodes: [] },
            comments: { totalCount: 0, nodes: [] },
            closingIssuesReferences: { totalCount: 0, nodes: [] },
            timelineItems: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
            files: { totalCount: 1, nodes: [{ path: 'src/app.ts' }] },
          }
        : {
            number: i.number,
            title: i.title,
            body: '',
            url: link(i.repo, i.number, i.kind),
            state: i.state === 'CLOSED_ISSUE' ? 'CLOSED' : 'OPEN',
            stateReason: i.state === 'CLOSED_ISSUE' ? 'COMPLETED' : null,
            updatedAt: i.updatedAt,
            closedAt: i.state === 'CLOSED_ISSUE' ? i.updatedAt : null,
            repository: { nameWithOwner: i.repo },
            parent: null,
            labels: labels(i),
            blockedBy: { totalCount: 0, nodes: [] },
            duplicateOf: null,
            comments: { totalCount: 0, nodes: [] },
          },
    );
    return JSON.stringify({
      data: {
        rateLimit: { cost: 2, remaining },
        repository: {
          [state ? 'pullRequests' : 'issues']: {
            pageInfo: { hasNextPage: more, endCursor: more ? String(offset + size) : null },
            nodes,
          },
        },
      },
    });
  };
  return { run, log };
}

const seed: Item[] = [
  {
    repo: 'Acme/app',
    number: 1,
    kind: 'Issue',
    state: 'OPEN_ISSUE',
    title: 'A1',
    updatedAt: iso(t0 - 9e6),
  },
  {
    repo: 'Acme/app',
    number: 2,
    kind: 'PullRequest',
    state: 'OPEN',
    title: 'A2',
    updatedAt: iso(t0 - 9e6),
  },
  {
    repo: 'Acme/other',
    number: 3,
    kind: 'Issue',
    state: 'OPEN_ISSUE',
    title: 'O3',
    updatedAt: iso(t0 - 9e6),
  },
  {
    repo: 'Acme/other',
    number: 4,
    kind: 'PullRequest',
    state: 'MERGED',
    title: 'O4',
    updatedAt: iso(t0 - 9e6),
  },
];

async function read(
  project: Project,
  items: Item[],
  cache: WorkCache,
  at: number,
  scope: 'all' | 'changed' = 'changed',
  remaining = 5000,
): Promise<{ cache: WorkCache; log: string[] }> {
  const github = fakeGithub(items, remaining);
  const next = await refreshWork({ project, cache, run: github.run, now: new Date(at), scope });
  return { cache: next, log: github.log };
}

describe.each(projects)('changed-only card reads (%s)', (_, project) => {
  it('reads every repository once when the cards were never read', async () => {
    const first = await read(project, seed, emptyWorkCache('demo'), t0);
    expect(first.log).not.toContain('probe');
    expect(first.log.filter((l) => l.startsWith('Acme/'))).toHaveLength(8);
    expect(first.cache.complete).toBe(true);
  });

  it('an unchanged Sync makes one probe and no repository reads, and keeps every card value', async () => {
    const first = await read(project, seed, emptyWorkCache('demo'), t0);
    const second = await read(project, seed, first.cache, t0 + 2 * 3_600_000);
    expect(second.log).toEqual(['rate_limit', 'probe']);
    expect(second.cache.issues).toEqual(first.cache.issues);
    expect(second.cache.prs).toEqual(first.cache.prs);
    expect(second.cache.mergedPrs).toEqual(first.cache.mergedPrs);
    expect(second.cache.lastScope?.reread).toEqual([]);
    // The probe proved nothing changed, so the cards are current as of this Sync.
    expect(second.cache.at).toBe(iso(t0 + 2 * 3_600_000));
  });

  it('re-reads only the repository and PR state that changed', async () => {
    const first = await read(project, seed, emptyWorkCache('demo'), t0);
    const changed = structuredClone(seed);
    changed[3] = { ...changed[3]!, title: 'O4 merged again', updatedAt: iso(t0 + 60_000) };
    changed.push({
      repo: 'Acme/other',
      number: 5,
      kind: 'PullRequest',
      state: 'OPEN',
      title: 'O5',
      updatedAt: iso(t0 + 60_000),
    });
    const next = await read(project, changed, first.cache, t0 + 120_000);
    expect(next.log).toEqual(['rate_limit', 'probe', 'Acme/other:MERGED', 'Acme/other:OPEN']);
    expect(next.cache.prs.map((p) => p.key).toSorted()).toEqual(['Acme/app#2', 'Acme/other#5']);
    expect(next.cache.mergedPrs?.find((p) => p.key === 'Acme/other#4')?.title).toBe(
      'O4 merged again',
    );
    expect(next.cache.issues).toEqual(first.cache.issues);
    // A full read gives the same cards.
    const full = await read(project, changed, emptyWorkCache('demo'), t0 + 120_000, 'all');
    expect(next.cache.prs.toSorted((a, b) => a.key.localeCompare(b.key))).toEqual(
      full.cache.prs.toSorted((a, b) => a.key.localeCompare(b.key)),
    );
    expect(Object.keys(next.cache.issues).toSorted()).toEqual(
      Object.keys(full.cache.issues).toSorted(),
    );
  });

  it('a changed issue re-reads only that repository’s issues', async () => {
    const first = await read(project, seed, emptyWorkCache('demo'), t0);
    const changed = structuredClone(seed);
    changed[0] = { ...changed[0]!, state: 'CLOSED_ISSUE', updatedAt: iso(t0 + 60_000) };
    const next = await read(project, changed, first.cache, t0 + 120_000);
    expect(next.log).toEqual(['rate_limit', 'probe', 'Acme/app:issues']);
    expect(next.cache.issues['Acme/app#1']?.state).toBe('CLOSED');
  });

  it('a read stopped at the light floor keeps the last values with their time', async () => {
    const first = await read(project, seed, emptyWorkCache('demo'), t0);
    const github = fakeGithub(seed, LIGHT_FLOOR - 1);
    const stopped = await refreshWork({
      project,
      cache: first.cache,
      run: github.run,
      now: new Date(t0 + 3_600_000),
      scope: 'changed',
      floor: LIGHT_FLOOR,
    });
    expect(github.log).toEqual(['rate_limit']);
    expect(stopped.at).toBe(first.cache.at);
    expect(stopped.complete).toBe(true);
    expect(stopped.error).toBeNull();
    expect(stopped.prs).toEqual(first.cache.prs);
    expect(stopped.lastFailure).toEqual({
      at: iso(t0 + 3_600_000),
      error: `GitHub reserve reached (${LIGHT_FLOOR - 1} left)`,
    });
    if (project.progress?.basis === 'ticket-count')
      expect(stopped.issueCensus).toEqual(first.cache.issueCensus);
  });
});

// TN-37: 60 merged PRs, one of them with 101 labels, so GitHub cuts its label list short.
const merged: Item[] = Array.from({ length: 60 }, (_, n) => ({
  repo: 'Acme/app',
  number: 100 + n,
  kind: 'PullRequest' as const,
  state: 'MERGED' as const,
  title: `M${n}`,
  updatedAt: iso(t0 - 9e6 - n * 1000),
  ...(n === 7 ? { labels: 101 } : {}),
}));
const long = [...seed, ...merged];

describe.each(projects)('one item cut short (%s)', (_, project) => {
  it('the read stays complete, the truncation is recorded, and an unchanged Sync makes one probe', async () => {
    const first = await read(project, long, emptyWorkCache('demo'), t0);
    expect(first.log.filter((l) => l === 'Acme/app:MERGED')).toHaveLength(3);
    const second = await read(project, long, first.cache, t0 + 2 * 3_600_000);
    expect(second.log).toEqual(['rate_limit', 'probe']);
    expect(first.cache).toMatchObject({ complete: true, error: null, truncated: true });
    // The PR itself still says its labels were cut short.
    expect(first.cache.mergedPrs?.find((p) => p.key === 'Acme/app#107')?.labelsComplete).toBe(
      false,
    );
    expect(second.cache.lastScope?.scope).toBe('changed');
    expect(second.cache.mergedPrs).toEqual(first.cache.mergedPrs);
    // The cut-short PR is still in the cache, so the flag stays.
    expect(second.cache).toMatchObject({ complete: true, error: null, truncated: true });
  });

  it('reads a cache written before the truncation flag', async () => {
    const first = await read(project, seed, emptyWorkCache('demo'), t0);
    // Today's cache shape: no `truncated` field. It reads as not truncated and builds on as before.
    const { truncated: _truncated, ...today } = first.cache;
    expect(today).not.toHaveProperty('truncated');
    const second = await read(project, seed, today, t0 + 3_600_000);
    expect(second.log).toEqual(['rate_limit', 'probe']);
    expect(second.cache).toMatchObject({ complete: true, error: null, truncated: false });
    // Today's truncated cache (complete false) gets one full read, then builds on it.
    const cut = await read(project, long, emptyWorkCache('demo'), t0);
    const { truncated: _cut, ...old } = cut.cache;
    const stale = { ...old, complete: false, error: 'Some GitHub context was truncated' };
    const full = await read(project, long, stale, t0 + 3_600_000);
    expect(full.log).not.toContain('probe');
    expect(full.cache).toMatchObject({ complete: true, error: null, truncated: true });
    const after = await read(project, long, full.cache, t0 + 2 * 3_600_000);
    expect(after.log).toEqual(['rate_limit', 'probe']);
  });
});

describe('truncation follows the stored items (ticket count)', () => {
  const project = projects[1]![1];
  it('keeps a cut-short issue recorded when a cache from before the flag is read on', async () => {
    const cut = seed.map((i) => (i.number === 1 ? { ...i, labels: 101 } : i));
    const first = await read(project, cut, emptyWorkCache('demo'), t0);
    const { truncated: _truncated, ...today } = first.cache;
    const stale = { ...today, complete: false, error: 'Some GitHub context was truncated' };
    // The census builds on the old issues, so the cut-short one is kept, not read again.
    const next = await read(project, cut, stale, t0 + 3_600_000);
    expect(next.cache.issues['Acme/app#1']?.contextComplete).toBe(false);
    expect(next.cache).toMatchObject({ complete: true, truncated: true });
  });

  it('records a cut-short issue that a failed read keeps', async () => {
    const first = await read(project, seed, emptyWorkCache('demo'), t0);
    expect(first.cache.truncated).toBe(false);
    const cut = seed.map((i) =>
      i.number === 1 ? { ...i, labels: 101, updatedAt: iso(t0 + 60_000) } : i,
    );
    const github = fakeGithub(cut);
    const failed = await refreshWork({
      project,
      cache: first.cache,
      run: async (args) => {
        if (args.some((a) => a.includes('states:MERGED'))) throw new Error('GitHub went away');
        return github.run(args);
      },
      now: new Date(t0 + 120_000),
      scope: 'all',
    });
    expect(failed.lastFailure?.error).toBe('GitHub went away');
    expect(failed.issues['Acme/app#1']?.contextComplete).toBe(false);
    expect(failed.truncated).toBe(true);
  });
});

describe.each(projects)('post-merge and daily reads (%s)', (_, project) => {
  it('reads a named repository in every kind even when the probe has not caught up', async () => {
    const first = await read(project, seed, emptyWorkCache('demo'), t0);
    const github = fakeGithub(seed);
    await refreshWork({
      project,
      cache: first.cache,
      run: github.run,
      now: new Date(t0 + 3_600_000),
      scope: 'changed',
      alwaysRead: ['Acme/app'],
    });
    expect(github.log).toEqual([
      'rate_limit',
      'probe',
      'Acme/app:issues',
      'Acme/app:MERGED',
      'Acme/app:OPEN',
      'Acme/app:CLOSED',
    ]);
  });
  it('once a day it reads every repository incrementally without the probe', async () => {
    const first = await read(project, seed, emptyWorkCache('demo'), t0);
    expect(first.cache.allReadAt).toBe(iso(t0));
    const day = await read(project, seed, first.cache, t0 + 86_400_000);
    expect(day.log).not.toContain('probe');
    expect(day.log.filter((l) => l.startsWith('Acme/'))).toHaveLength(8);
    expect(day.cache.allReadAt).toBe(iso(t0 + 86_400_000));
    expect(day.cache.issues).toEqual(first.cache.issues);
    const next = await read(project, seed, day.cache, t0 + 86_400_000 + 60_000);
    expect(next.log).toEqual(['rate_limit', 'probe']);
  });
});

describe('collector scopes', () => {
  it('the timer is the default; Sync and full are explicit', () => {
    expect(githubScope({})).toBe('timer');
    expect(githubScope({ sync: true })).toBe('sync');
    expect(githubScope({ sync: true, full: true })).toBe('full');
  });
  it('finds a merge after the cards’ last read, so Sync reads the product repository directly', () => {
    const prs = { 1: { mergedAt: iso(t0) } };
    expect(mergedSince(prs, iso(t0 - 1))).toBe(true);
    expect(mergedSince(prs, iso(t0))).toBe(false);
    expect(mergedSince(prs, '')).toBe(true);
  });
  it('the timer reads the cards only when they were never read; Sync and full always do', () => {
    const last = { at: iso(t0), project: 'demo' };
    expect(readsCards('timer', last, 'demo')).toBe(false);
    expect(readsCards('timer', { at: '', project: 'demo' }, 'demo')).toBe(true);
    expect(readsCards('timer', { at: iso(t0), project: 'other' }, 'demo')).toBe(true);
    expect(readsCards('sync', last, 'demo')).toBe(true);
    expect(readsCards('full', last, 'demo')).toBe(true);
  });
});
