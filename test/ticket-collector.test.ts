import { expect, it } from 'vitest';
import { emptyWorkCache, refreshWork } from '../src/readers/work-github.ts';
import type { Project } from '../src/readers/project.ts';
import type { WorkIssue } from '../src/core/work.ts';

const project: Project = {
  version: 1,
  id: 'synthetic',
  title: 'Synthetic map',
  roadmapRepo: 'Example/plan',
  productRepo: 'Example/app',
  repos: ['Example/app'],
  files: {
    flow: 'flow.json',
    audit: 'audit.json',
    plan: 'plan.md',
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
    specLabels: ['spec'],
    specPattern: '^Spec',
  },
  progress: { basis: 'ticket-count', repositories: { 'Example/app': 'build' } },
};
const now = new Date('2026-10-16T01:00:00Z');
function reader(fail = false): {
  run: (args: readonly string[]) => Promise<string>;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    run: async (args) => {
      const query = args.join(' ');
      calls.push(query);
      if (args[1] === 'rate_limit')
        return JSON.stringify({
          resources: { core: { remaining: 5000 }, graphql: { remaining: 5000 } },
        });
      const issues = query.includes('issues(first');
      const second = query.includes('cursor=second');
      if (fail && second) throw new Error('Issue page unavailable');
      return JSON.stringify({
        data: {
          rateLimit: { remaining: 4000 },
          repository: {
            [issues ? 'issues' : 'pullRequests']: {
              pageInfo: {
                hasNextPage: issues && !second,
                endCursor: issues && !second ? 'second' : null,
              },
              nodes: issues
                ? [
                    {
                      number: second ? 2 : 1,
                      title: 'Spec task',
                      body: '',
                      url: `https://github.com/Example/app/issues/${second ? 2 : 1}`,
                      state: second ? 'OPEN' : 'CLOSED',
                      stateReason: second ? 'REOPENED' : 'COMPLETED',
                      updatedAt: '2020-01-01T00:00:00Z',
                      repository: { nameWithOwner: 'Example/app' },
                      parent: null,
                      labels: { totalCount: 0, nodes: [] },
                      blockedBy: { totalCount: 0, nodes: [] },
                    },
                  ]
                : [],
            },
          },
        },
      });
    },
  };
}

it('fully backfills closure reasons and removes disappeared issues despite a recent cache watermark', async () => {
  const old = {
    ...emptyWorkCache(project.id),
    at: '2026-10-16T00:59:00Z',
    complete: true,
    reposThrough: { 'Example/app': '2026-10-16T00:59:00Z' },
    issues: {
      'Example/app#99': {
        key: 'Example/app#99',
        title: 'Transferred',
        body: '',
        url: 'https://github.com/Example/app/issues/99',
        state: 'CLOSED',
        parent: null,
        labels: [],
        blockedBy: [],
        contextComplete: true,
      },
    },
  };
  const { run, calls } = reader();
  const result = await refreshWork({ project, cache: old, run, now });
  expect(Object.keys(result.issues)).toEqual(['Example/app#1', 'Example/app#2']);
  expect(result.issues['Example/app#1']).toHaveProperty('stateReason', 'COMPLETED');
  expect(result.issues['Example/app#2']).toHaveProperty('stateReason', 'REOPENED');
  expect(calls.some((call) => call.includes('cursor=second'))).toBe(true);
  const failed = await refreshWork({
    project,
    cache: result,
    run: reader(true).run,
    now: new Date(now.getTime() + 86_400_000),
  });
  expect(failed.issues).toEqual(result.issues);
  expect(failed.at).toBe(result.at);
  // #242: a failed read keeps the last good census and records the failure.
  expect(failed.complete).toBe(result.complete);
  expect(failed.lastFailure).toBeDefined();
});

it('reads one issue page per repository on a second unchanged sync and retains the whole census', async () => {
  const multi = { ...project, repos: ['Example/app', 'Example/other'] };
  const source = reader();
  const run = async (args: readonly string[]): Promise<string> => {
    const raw = await source.run(args);
    return args.includes('name=other') ? raw.replaceAll('Example/app', 'Example/other') : raw;
  };
  const first = await refreshWork({ project: multi, cache: emptyWorkCache(project.id), run, now });
  expect(source.calls.filter((c) => c.includes('issues(first'))).toHaveLength(4);
  source.calls.length = 0;
  const second = await refreshWork({
    project: multi,
    cache: first,
    run,
    now: new Date(now.getTime() + 300_000),
  });
  expect(source.calls.filter((c) => c.includes('issues(first'))).toHaveLength(2);
  expect(second.issues).toEqual(first.issues);
  expect(second.issueCensus).toMatchObject({ complete: true, at: '2026-10-16T01:05:00.000Z' });
});

it('applies overlap updates and reopenings without losing older issues', async () => {
  const first = await refreshWork({
    project,
    cache: emptyWorkCache(project.id),
    run: reader().run,
    now,
  });
  const source = reader();
  const next = await refreshWork({
    project,
    cache: first,
    now: new Date(now.getTime() + 300_000),
    run: async (args) => {
      const raw = await source.run(args);
      return args.join(' ').includes('issues(first') && !args.includes('cursor=second')
        ? raw
            .replace('2020-01-01T00:00:00Z', '2026-10-16T00:55:00Z')
            .replace('CLOSED', 'OPEN')
            .replace('COMPLETED', 'REOPENED')
        : raw;
    },
  });
  expect(next.issues['Example/app#1']?.state).toBe('OPEN');
  expect(next.issues['Example/app#1']?.stateReason).toBe('REOPENED');
  expect(next.issues['Example/app#2']).toEqual(first.issues['Example/app#2']);
});

it('reconciles deleted issues daily without postponing the full read on each incremental sync', async () => {
  const first = await refreshWork({
    project,
    cache: emptyWorkCache(project.id),
    run: reader().run,
    now,
  });
  const absent = reader();
  const run = async (args: readonly string[]): Promise<string> => {
    const answer = JSON.parse(await absent.run(args));
    const page = answer.data?.repository.issues;
    if (page && args.includes('cursor=second')) page.nodes = [];
    return JSON.stringify(answer);
  };
  const midday = await refreshWork({
    project,
    cache: first,
    run,
    now: new Date(now.getTime() + 43_200_000),
  });
  expect(midday.issues['Example/app#2']).toBeDefined();
  absent.calls.length = 0;
  const daily = await refreshWork({
    project,
    cache: midday,
    run,
    now: new Date(now.getTime() + 86_400_000),
  });
  expect(absent.calls.filter((c) => c.includes('issues(first'))).toHaveLength(2);
  expect(Object.keys(daily.issues)).toEqual(['Example/app#1']);
});

it('fully reads a new repository while existing repositories keep their own incremental watermark', async () => {
  const first = await refreshWork({
    project,
    cache: emptyWorkCache(project.id),
    run: reader().run,
    now,
  });
  const source = reader();
  const result = await refreshWork({
    project: { ...project, repos: ['Example/app', 'Example/new'] },
    cache: first,
    now: new Date(now.getTime() + 300_000),
    run: async (args) => {
      const raw = await source.run(args);
      return args.includes('name=new') ? raw.replaceAll('Example/app', 'Example/new') : raw;
    },
  });
  expect(
    source.calls.filter((c) => c.includes('issues(first') && c.includes('name=app')),
  ).toHaveLength(1);
  expect(
    source.calls.filter((c) => c.includes('issues(first') && c.includes('name=new')),
  ).toHaveLength(2);
  expect(Object.keys(result.issues)).toHaveLength(4);
});

it('retains the census and watermark after a failed incremental issue page', async () => {
  const first = await refreshWork({
    project,
    cache: emptyWorkCache(project.id),
    run: reader().run,
    now,
  });
  const source = reader(true);
  const failed = await refreshWork({
    project,
    cache: first,
    now: new Date(now.getTime() + 300_000),
    run: async (args) =>
      (await source.run(args)).replaceAll('2020-01-01T00:00:00Z', now.toISOString()),
  });
  expect(failed.issues).toEqual(first.issues);
  expect(failed.issueCensus?.at).toBe(first.issueCensus?.at);
  // #242: the last complete census stays complete, with its own time; the failure is recorded beside it.
  expect(failed.issueCensus?.complete).toBe(true);
  expect(failed.lastFailure).toBeDefined();
  expect(failed.reposThrough).toEqual(first.reposThrough);
});

it('keeps completed census watermarks when a later PR read fails', async () => {
  const source = reader();
  const first = await refreshWork({
    project,
    cache: emptyWorkCache(project.id),
    now,
    run: async (args) => {
      if (args.join(' ').includes('pullRequests')) throw new Error('PR read unavailable');
      return source.run(args);
    },
  });
  source.calls.length = 0;
  const second = await refreshWork({
    project,
    cache: first,
    run: source.run,
    now: new Date(now.getTime() + 300_000),
  });
  expect(first.complete).toBe(false);
  expect(first.issueCensus?.complete).toBe(true);
  expect(source.calls.filter((c) => c.includes('issues(first'))).toHaveLength(1);
  expect(second.issues).toEqual(first.issues);
});

it.each(['missing', 'invalid', 'future'])(
  'does a full census with %s census timestamps',
  async (kind) => {
    const first = await refreshWork({
      project,
      cache: emptyWorkCache(project.id),
      now,
      run: reader().run,
    });
    const { repositories: _repositories, ...legacy } = first.issueCensus!;
    const issueCensus =
      kind === 'missing'
        ? legacy
        : {
            ...legacy,
            repositories: {
              'Example/app': {
                through: kind === 'invalid' ? 'bad date' : '2026-10-17T00:00:00Z',
                fullAt: kind === 'invalid' ? 'bad date' : '2026-10-17T00:00:00Z',
              },
            },
          };
    const source = reader();
    await refreshWork({
      project,
      cache: { ...first, issueCensus },
      run: source.run,
      now: new Date(now.getTime() + 300_000),
    });
    expect(source.calls.filter((c) => c.includes('issues(first'))).toHaveLength(2);
  },
);

it('keeps a complete issue census when later PR reads fail and leaves ordinary progress incremental', async () => {
  const source = reader();
  const result = await refreshWork({
    project,
    cache: emptyWorkCache(project.id),
    now,
    run: async (args) => {
      if (args.join(' ').includes('pullRequests')) throw new Error('PR review unavailable');
      return source.run(args);
    },
  });
  expect(result.complete).toBe(false);
  expect(result.issueCensus).toMatchObject({ at: now.toISOString(), complete: true, error: null });
  expect(Object.keys(result.issues)).toEqual(['Example/app#1', 'Example/app#2']);
  const { progress: _progress, ...ordinary } = project;
  const initial = { ...result, complete: true, reposThrough: { 'Example/app': now.toISOString() } };
  const calls = reader();
  const incremental = await refreshWork({ project: ordinary, cache: initial, run: calls.run, now });
  expect(incremental.issues).toEqual(result.issues);
  expect(calls.calls.filter((query) => query.includes('issues(first'))).toHaveLength(1);
});

it('reads the parent an issue was absorbed into from the same census pages, with no extra calls (#189)', async () => {
  const source = reader();
  const run = async (args: readonly string[]): Promise<string> => {
    const answer = JSON.parse(await source.run(args));
    const node = answer.data?.repository.issues?.nodes[0];
    if (node && !args.includes('cursor=second'))
      Object.assign(node, {
        state: 'CLOSED',
        stateReason: 'NOT_PLANNED',
        closedAt: '2026-09-27T15:59:50Z',
        duplicateOf: null,
        comments: {
          totalCount: 1,
          nodes: [
            { body: 'Absorbed into #2 (U00). Carried there.', createdAt: '2026-09-27T15:59:49Z' },
          ],
        },
      });
    return JSON.stringify(answer);
  };
  const result = await refreshWork({ project, cache: emptyWorkCache(project.id), run, now });
  expect(source.calls.filter((c) => c.includes('issues(first'))).toHaveLength(2);
  expect(
    source.calls.every((c) => !c.includes('issues(first') || c.includes('comments(last:')),
  ).toBe(true);
  expect(result.issues['Example/app#1']?.absorbedInto).toBe('Example/app#2');
  expect(result.issues['Example/app#2']?.absorbedInto).toBeNull();
});

const legacyIssue = (issue: WorkIssue): WorkIssue => {
  const copy: { -readonly [K in keyof WorkIssue]: WorkIssue[K] } = {
    ...issue,
    stateReason: 'NOT_PLANNED',
  };
  delete copy.absorbedInto;
  return copy;
};
it('reads the whole census again once when cached closed issues predate the parent field (#189)', async () => {
  const first = await refreshWork({
    project,
    cache: emptyWorkCache(project.id),
    run: reader().run,
    now,
  });
  const legacy = {
    ...first,
    issues: {
      ...first.issues,
      'Example/app#1': legacyIssue(first.issues['Example/app#1']!),
    },
  };
  const source = reader();
  await refreshWork({
    project,
    cache: legacy,
    run: source.run,
    now: new Date(now.getTime() + 300_000),
  });
  expect(source.calls.filter((c) => c.includes('issues(first'))).toHaveLength(2);
});

it('a card whose labels GitHub cut short is read as unsettled, and the census stays complete (#157)', async () => {
  const cut = {
    totalCount: 101,
    nodes: Array.from({ length: 100 }, (_, n) => ({ name: `tag-${n}` })),
  };
  const source = reader();
  const run = async (args: readonly string[]): Promise<string> => {
    const raw = await source.run(args);
    return args.join(' ').includes('cursor=second')
      ? raw
      : raw.replace('"labels":{"totalCount":0,"nodes":[]}', `"labels":${JSON.stringify(cut)}`);
  };
  const result = await refreshWork({ project, cache: emptyWorkCache(project.id), run, now });
  expect(result.issues['Example/app#1']?.contextComplete).toBe(false);
  expect(result.issues['Example/app#2']?.contextComplete).toBe(true);
  expect(result.issueCensus?.complete).toBe(true);
});
