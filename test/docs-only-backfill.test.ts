// The docs-only flag backfill for cached merged PRs is optional: it runs after every required read,
// at most four batches of twenty a run, resuming on the next.
import { expect, it } from 'vitest';
import { emptyWorkCache, refreshWork } from '../src/readers/work-github.ts';
import type { Project } from '../src/readers/project.ts';
import type { OpenPr } from '../src/core/work.ts';

const project: Project = {
  version: 1,
  id: 'backfill',
  title: 'Backfill',
  roadmapRepo: 'Acme/app',
  productRepo: 'Acme/app',
  repos: ['Acme/app'],
  files: { flow: 'a', audit: 'b', plan: 'c', mapping: 'd', sections: 'e' },
  lanePrefix: 'AC-',
  laneRules: [],
  ticketConventions: {
    readyLabel: 'ready',
    ticketLabels: [],
    mapLabel: 'map',
    ideaLabels: [],
    ideaPattern: '^Idea:',
    specLabels: [],
    specPattern: '^Spec:',
  },
  dependencies: [],
};
const withMembership: Project = {
  ...project,
  specMembership: [
    {
      section: 'tasks',
      complete: true,
      specs: [{ key: 'Acme/app#1', complete: true, tickets: ['Acme/app#2'] }],
    },
  ],
};
const cachedPr = (number: number): OpenPr => ({
  key: `Acme/app#${number}`,
  number,
  title: 'Cached merged PR',
  body: '',
  url: `https://github.com/Acme/app/pull/${number}`,
  headRefName: 'work',
  issueKeys: [],
  state: 'MERGED',
});
const now = new Date('2026-10-16T01:00:00.000Z');

/** A scripted GitHub with `start` calls of reserve: empty lists, closed member issues, docs-only files. */
function github(start: number) {
  let remaining = start;
  const calls: string[] = [];
  const run = async (args: readonly string[]): Promise<string> => {
    if (args[1] === 'rate_limit')
      return JSON.stringify({
        resources: { core: { remaining: start }, graphql: { remaining: start } },
      });
    const query = args.find((arg) => arg.startsWith('query=')) ?? '';
    calls.push(query);
    const numbers = [...query.matchAll(/p(\d+): pullRequest\(number: (\d+)\)/g)].map((m) =>
      Number(m[2]),
    );
    if (numbers.length) {
      remaining -= numbers.length + 1;
      return JSON.stringify({
        data: {
          rateLimit: { remaining },
          repository: Object.fromEntries(
            numbers.map((n) => [
              `p${n}`,
              { files: { totalCount: 1, nodes: [{ path: 'docs/plan.md' }] } },
            ]),
          ),
        },
      });
    }
    remaining--;
    const member = /member: issue\(number:(\d+)\)/.exec(query);
    if (member) {
      const number = Number(member[1]);
      return JSON.stringify({
        data: {
          rateLimit: { remaining },
          repository: {
            member: {
              number,
              title: `Issue ${number}`,
              body: 'Section: tasks',
              url: `https://github.com/Acme/app/issues/${number}`,
              repository: { nameWithOwner: 'Acme/app' },
              state: 'CLOSED',
              updatedAt: now.toISOString(),
              parent: null,
              labels: { totalCount: 0, nodes: [] },
              blockedBy: { totalCount: 0, nodes: [] },
            },
          },
        },
      });
    }
    return JSON.stringify({
      data: {
        rateLimit: { remaining },
        repository: {
          [query.includes('issues(first') ? 'issues' : 'pullRequests']: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    });
  };
  return { run, calls };
}

it('reads spec membership before the backfill can spend the reserve', async () => {
  const mergedPrs = Array.from({ length: 20 }, (_, i) => cachedPr(100 + i));
  const effects = github(1010);
  const result = await refreshWork({
    project: withMembership,
    cache: { ...emptyWorkCache(project.id), mergedPrs },
    now,
    run: effects.run,
  });
  expect(effects.calls.some((query) => query.includes('pullRequest(number:'))).toBe(true);
  expect(result.error).toBeNull();
  expect(result.complete).toBe(true);
  expect(Object.keys(result.issues)).toEqual(['Acme/app#1', 'Acme/app#2']);
});

it('backfills at most four batches of twenty a run and resumes on the next', async () => {
  const effects = github(5000);
  const result = await refreshWork({
    project,
    cache: {
      ...emptyWorkCache(project.id),
      mergedPrs: Array.from({ length: 101 }, (_, i) => cachedPr(100 + i)),
    },
    now,
    run: effects.run,
  });
  expect(result.complete).toBe(true);
  const backfills = effects.calls.filter((query) => query.includes('pullRequest(number:'));
  expect(backfills.map((query) => [...query.matchAll(/pullRequest\(/g)].length)).toEqual([
    20, 20, 20, 20,
  ]);
  expect(result.mergedPrs?.filter((pr) => pr.docsOnly === undefined)).toHaveLength(21);
  const next = await refreshWork({ project, cache: result, now, run: github(5000).run });
  expect(next.mergedPrs?.filter((pr) => pr.docsOnly === undefined)).toHaveLength(0);
});
