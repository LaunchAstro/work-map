import { describe, expect, it } from 'vitest';
import { emptyWorkCache, refreshWork } from '../src/readers/work-github.ts';
import type { Project } from '../src/readers/project.ts';
const project: Project = {
  version: 1,
  id: 'demo',
  title: 'Demo',
  ledgerPrReadyLabel: 'merge-ready',
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
const now = new Date('2026-10-15T01:00:00.000Z');
const at = now.toISOString();
const event = (
  id: string,
  __typename: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({ id, kind: __typename, createdAt: at, ...extra });
async function collect(
  truncated = false,
  state: 'OPEN' | 'MERGED' | 'CLOSED' = 'OPEN',
  body: string | null = null,
  headRepository: { nameWithOwner: string } | null = null,
): Promise<Awaited<ReturnType<typeof refreshWork>>> {
  return refreshWork({
    project,
    cache: emptyWorkCache('demo'),
    now,
    run: async (args) => {
      if (args[1] === 'rate_limit')
        return JSON.stringify({
          resources: { core: { remaining: 5000 }, graphql: { remaining: 5000 } },
        });
      const query = args.join(' ');
      const requested = /pullRequests\(states:\w+,first:(\d+)/.exec(query);
      if (requested && Number(requested[1]) > 25)
        throw new Error('Resource limits for this query exceeded');
      const events = [
        event('ready', 'LabeledEvent', { label: { name: 'merge-ready' } }),
        event('q1', 'AddedToMergeQueueEvent'),
        event('drop1', 'RemovedFromMergeQueueEvent', { reason: 'Checks failed' }),
        event('q2', 'AddedToMergeQueueEvent'),
        event('drop2', 'RemovedFromMergeQueueEvent', { reason: null }),
        event('wrong', 'LabeledEvent', { label: { name: 'approved' } }),
      ];
      if (requested) expect(query).toContain('headRepository { nameWithOwner }');
      const pr = {
        number: 12,
        title: 'Feature',
        body,
        url: 'https://github.com/Acme/app/pull/12',
        headRefName: 'feature',
        headRepository,
        createdAt: at,
        labels: { totalCount: 0, nodes: [] },
        latestOpinionatedReviews: { totalCount: 0, nodes: [] },
        comments: { totalCount: 0, nodes: [] },
        closingIssuesReferences: { totalCount: 0, nodes: [] },
        timelineItems: {
          totalCount: events.length + 25,
          pageInfo: { hasNextPage: truncated },
          nodes: events,
        },
      };
      return JSON.stringify({
        data: {
          rateLimit: { remaining: 4000 },
          repository: {
            [query.includes('issues(first') ? 'issues' : 'pullRequests']: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: query.includes(`states:${state}`) ? [pr] : [],
            },
          },
        },
      });
    },
  });
}
describe('loading bay evidence from existing GitHub collector', () => {
  it('retains repeated queue cycles and removal reasons, and never treats approval as ready', async () => {
    const cache = await collect();
    expect(cache.ledgerPrs?.[0]?.events.map((e) => e.id)).toEqual([
      'Acme/app#12:opened',
      'ready',
      'q1',
      'drop1',
      'q2',
      'drop2',
    ]);
    expect(
      cache.ledgerPrs?.[0]?.events.filter((e) => e.kind === 'dropped').map((e) => e.reason),
    ).toEqual(['Checks failed', 'GitHub supplied no removal reason']);
    expect(cache.ledgerComplete).toBe(true);
  });
  it('marks bounded truncated lifecycle history pending independently of ordinary map context', async () => {
    const cache = await collect(true);
    expect(cache.complete).toBe(true);
    expect(cache.ledgerComplete).toBe(false);
    expect(cache.ledgerPrs?.[0]?.complete).toBe(false);
  });
});

it('never infers a queue drop from closure and publishes lifecycle evidence only', async () => {
  const closed = await collect(false, 'CLOSED');
  expect(closed.ledgerPrs?.[0]).toMatchObject({
    status: 'pending',
    reason: 'Closed without merge; no queue drop inferred',
  });
  const merged = await collect(
    false,
    'MERGED',
    'Why: Preserve truth.\nLeft undone: none\nCloses #9',
  );
  expect(merged.ledgerPrs?.[0]).toMatchObject({
    status: 'merged',
  });
  for (const cache of [closed, merged]) {
    expect(cache.ledgerPrs?.[0]).not.toHaveProperty('pointers');
    expect(cache.ledgerPrs?.[0]).not.toHaveProperty('terminal');
  }
});
// #242: a failed read keeps the last good history and its dates, and records the failure beside it.
it('preserves old source dates and keeps the last good history on failure', async () => {
  const previous = await collect();
  const next = await refreshWork({
    project,
    cache: previous,
    now: new Date(now.getTime() + 60_000),
    run: async () => {
      throw new Error('unavailable');
    },
  });
  expect(next.at).toBe(previous.at);
  expect(next.ledgerPrs).toEqual(previous.ledgerPrs);
  expect(next.ledgerComplete).toBe(previous.ledgerComplete);
  expect(next.lastFailure?.error).toBe('unavailable');
});
it('stops before querying history when the GitHub reserve is unavailable', async () => {
  const calls: string[][] = [];
  const result = await refreshWork({
    project,
    cache: emptyWorkCache('demo'),
    now,
    run: async (args) => {
      calls.push([...args]);
      return JSON.stringify({
        resources: { core: { remaining: 999 }, graphql: { remaining: 999 } },
      });
    },
  });
  expect(calls).toHaveLength(1);
  expect(result.error).toContain('reserve');
  expect(result.complete).toBe(false);
});

it('retains the actual PR head repository and never substitutes the target for missing heads', async () => {
  const fork = await collect(false, 'OPEN', null, { nameWithOwner: 'Other/fork' });
  expect(fork.prs[0]?.headRepository).toBe('Other/fork');
  const missing = await collect();
  expect(missing.prs[0]?.headRepository).toBeNull();
});
