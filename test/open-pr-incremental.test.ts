import { describe, expect, it } from 'vitest';
import { emptyWorkCache, refreshWork, type WorkCache } from '../src/readers/work-github.ts';
import type { Project } from '../src/readers/project.ts';

// #233: open PRs are read since the last Sync, not in full every time.
const base: Project = {
  version: 1,
  id: 'demo',
  title: 'Demo',
  roadmapRepo: 'Acme/roadmap',
  productRepo: 'Acme/app',
  repos: ['Acme/app'],
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
// Both project shapes: the estimated-scope map and the ticket-count map.
const projects: readonly [string, Project][] = [
  ['estimated scope', base],
  [
    'ticket count',
    { ...base, progress: { basis: 'ticket-count', repositories: { 'Acme/app': 'app' } } },
  ],
];

interface FakePr {
  number: number;
  title: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  updatedAt: string;
}
const t0 = Date.parse('2026-10-18T00:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();

/** A fake GitHub holding PRs, answering paged GraphQL like the real one, and counting calls. */
function fakeGithub(prs: FakePr[]): {
  calls: () => number;
  run: (args: readonly string[]) => Promise<string>;
} {
  let calls = 0;
  return {
    calls: () => calls,
    run: async (args) => {
      calls++;
      if (args[1] === 'rate_limit')
        return JSON.stringify({
          resources: { core: { remaining: 5000 }, graphql: { remaining: 5000 } },
        });
      const query = args.join(' ');
      const cursorArg = args.find((a) => a.startsWith('cursor='));
      const offset = cursorArg ? Number(cursorArg.slice('cursor='.length)) : 0;
      const state = /pullRequests\(states:(\w+)/.exec(query)?.[1];
      const size = state ? 25 : 100;
      const all = state
        ? prs
            .filter((p) => p.state === state)
            .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map((p) => ({
              number: p.number,
              title: p.title,
              body: null,
              url: `https://github.com/Acme/app/pull/${p.number}`,
              createdAt: iso(t0 - 30 * 86_400_000),
              updatedAt: p.updatedAt,
              headRefName: `branch-${p.number}`,
              headRepository: { nameWithOwner: 'Acme/app' },
              labels: { totalCount: 0, nodes: [] },
              latestOpinionatedReviews: { totalCount: 0, nodes: [] },
              comments: { totalCount: 0, nodes: [] },
              closingIssuesReferences: { totalCount: 0, nodes: [] },
              timelineItems: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
            }))
        : [];
      const nodes = all.slice(offset, offset + size);
      const hasNextPage = offset + size < all.length;
      return JSON.stringify({
        data: {
          rateLimit: { remaining: 4900 },
          repository: {
            [state ? 'pullRequests' : 'issues']: {
              pageInfo: { hasNextPage, endCursor: hasNextPage ? String(offset + size) : null },
              nodes,
            },
          },
        },
      });
    },
  };
}

const sync = async (
  project: Project,
  prs: FakePr[],
  cache: WorkCache,
  at: number,
): Promise<{ cache: WorkCache; calls: number }> => {
  const github = fakeGithub(prs);
  const next = await refreshWork({ project, cache, run: github.run, now: new Date(at) });
  return { cache: next, calls: github.calls() };
};

describe.each(projects)('incremental open-PR reads (%s)', (_, project) => {
  it('spends fewer calls on an unchanged Sync and still matches a full read', async () => {
    const prs: FakePr[] = [
      ...Array.from({ length: 60 }, (_unused, i) => ({
        number: i + 1,
        title: `Open ${i + 1}`,
        state: 'OPEN' as const,
        updatedAt: iso(t0 - (i + 1) * 3_600_000),
      })),
      { number: 100, title: 'Merged long ago', state: 'MERGED', updatedAt: iso(t0 - 9e7) },
      { number: 101, title: 'Closed long ago', state: 'CLOSED', updatedAt: iso(t0 - 9e7) },
    ];
    const first = await sync(project, prs, emptyWorkCache('demo'), t0);
    expect(first.cache.error).toBeNull();
    expect(first.cache.prs).toHaveLength(60);

    const second = await sync(project, prs, first.cache, t0 + 60_000);
    expect(second.cache.prs).toEqual(first.cache.prs);
    expect(second.calls).toBeLessThan(first.calls);

    // Between Syncs: one PR merges, one closes, one is updated and one opens.
    const changedAt = t0 + 90_000;
    const changed = structuredClone(prs);
    const change = (n: number, edit: Partial<FakePr>): void => {
      Object.assign(changed.find((p) => p.number === n) ?? {}, edit, {
        updatedAt: iso(changedAt),
      });
    };
    change(40, { state: 'MERGED' });
    change(50, { state: 'CLOSED' });
    change(55, { title: 'Open 55, revised' });
    changed.push({ number: 61, title: 'New', state: 'OPEN', updatedAt: iso(changedAt) });
    const third = await sync(project, changed, second.cache, t0 + 120_000);
    const full = await sync(project, changed, emptyWorkCache('demo'), t0 + 120_000);
    expect(third.cache.prs).toEqual(full.cache.prs);
    expect(third.calls).toBeLessThan(full.calls);
    const open = third.cache.prs.map((p) => p.number);
    expect(open).not.toContain(40);
    expect(open).not.toContain(50);
    expect(open).toContain(61);
    expect(third.cache.prs.find((p) => p.number === 55)?.title).toBe('Open 55, revised');
    expect(third.cache.mergedPrs?.map((p) => p.number)).toContain(40);

    // The safety net: a full open-PR read again once an hour has passed since the last one.
    const later = await sync(project, changed, third.cache, t0 + 3_600_000 + 1);
    expect(later.cache.prs).toEqual(full.cache.prs);
    const onlyOpenFull = await sync(project, changed, third.cache, t0 + 3_600_000 - 1);
    expect(later.calls).toBeGreaterThan(onlyOpenFull.calls);

    console.log(
      `[${project.progress?.basis ?? 'estimated-scope'}] calls: full ${first.calls}, unchanged ${second.calls}, changed ${third.calls} (full ${full.calls})`,
    );
  });
});
