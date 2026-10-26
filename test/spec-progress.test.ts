import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildWork, type WorkIssue } from '../src/core/work.ts';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits } from '../src/core/plan.ts';
import type { Project } from '../src/readers/project.ts';

const at = '2026-10-15T02:00:00.000Z';
const fx = (name: string): string =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const plan = parseBuildUnits(fx('build-units.md'));
const snapshot = buildSnapshot({
  audit: JSON.parse(fx('audit.json')),
  flow: JSON.parse(fx('flow.json')),
  plan,
  generatedAt: at,
});
const membership = () => [
  {
    section: 'tasks',
    complete: true,
    specs: [{ key: 'Acme/plan#1', complete: true, tickets: ['Acme/app#2', 'Acme/app#3'] }],
  },
];
const project: Project = {
  version: 1,
  id: 'different-project',
  title: 'Example',
  roadmapRepo: 'Acme/plan',
  productRepo: 'Acme/app',
  repos: ['Acme/plan', 'Acme/app'],
  files: { audit: '', flow: '', plan: '', mapping: '', sections: '' },
  lanePrefix: 'AC-',
  laneRules: [],
  dependencies: [],
  ticketConventions: {
    readyLabel: 'ready',
    ticketLabels: [],
    mapLabel: 'map',
    ideaLabels: [],
    ideaPattern: '^Idea:',
    specLabels: ['spec'],
    specPattern: '^Spec:',
  },
};
function issue(key: string, state = 'CLOSED', stateReason: string | null = null): WorkIssue {
  return {
    key,
    title: key,
    body: '',
    state,
    stateReason,
    url: `https://github.com/${key.replace('#', '/issues/')}`,
    parent: null,
    labels: [],
    blockedBy: [],
    contextComplete: true,
  };
}
const input = () => ({
  project: { ...project, specMembership: membership() },
  plan,
  nodes: snapshot.stages.flatMap((s) => s.nodes),
  issues: Object.fromEntries(
    ['Acme/plan#1', 'Acme/app#2', 'Acme/app#3'].map((key) => [key, issue(key)]),
  ),
  prs: [],
  maps: {},
  at,
  complete: true,
  error: null as string | null,
});
const expected = (state: string, built: number, pct: number | null) => ({
  specProgress: {
    source: 'github-ticket-closure',
    at,
    specs: [expect.objectContaining({ key: 'Acme/plan#1', section: 'tasks', state })],
    bySection: { tasks: expect.objectContaining({ built, pct }) },
  },
});
afterEach(() => vi.useRealTimers());
describe('explicit spec ticket closure', () => {
  it('marks a non-empty complete mapped set built and reopening removes built', () => {
    vi.setSystemTime(new Date(at));
    const x = input();
    expect(buildWork(x)).toMatchObject(expected('built', 1, 100));
    x.issues['Acme/app#3'] = issue('Acme/app#3', 'OPEN');
    expect(buildWork(x)).toMatchObject(expected('open', 0, 0));
  });
  // TN-40: tickets closed as not planned or duplicate are left out of the built test.
  it('leaves tickets closed as not planned out of built', () => {
    vi.setSystemTime(new Date(at));
    const x = input();
    x.issues['Acme/app#2'] = issue('Acme/app#2', 'CLOSED', 'NOT_PLANNED');
    x.issues['Acme/app#3'] = issue('Acme/app#3', 'CLOSED', 'NOT_PLANNED');
    const aside = buildWork(x);
    expect(aside).toMatchObject(expected('open', 0, 0));
    expect(currentSpecProgress(aside.specProgress, Date.parse(at))?.specs[0]?.state).toBe('open');
    x.issues['Acme/app#2'] = issue('Acme/app#2', 'CLOSED', 'COMPLETED');
    const built = buildWork(x);
    expect(built).toMatchObject(expected('built', 1, 100));
    expect(currentSpecProgress(built.specProgress, Date.parse(at))?.specs[0]?.state).toBe('built');
  });
  it.each(['missing', 'unknown', 'incomplete-context'])(
    'keeps %s ticket evidence pending',
    (mode) => {
      vi.setSystemTime(new Date(at));
      const x = input();
      if (mode === 'missing') delete x.issues['Acme/app#3'];
      else
        x.issues['Acme/app#3'] = {
          ...issue('Acme/app#3', mode === 'unknown' ? 'UNKNOWN' : 'CLOSED'),
          contextComplete: mode !== 'incomplete-context',
        };
      expect(buildWork(x)).toMatchObject(expected('pending', 0, null));
    },
  );
  it.each(['empty', 'incomplete-spec', 'incomplete-section'])(
    'keeps %s membership pending',
    (mode) => {
      vi.setSystemTime(new Date(at));
      const x = input();
      const section = x.project.specMembership[0]!;
      if (mode === 'empty') section.specs[0]!.tickets = [];
      if (mode === 'incomplete-spec') section.specs[0]!.complete = false;
      if (mode === 'incomplete-section') section.complete = false;
      expect(buildWork(x)).toMatchObject(expected('pending', 0, null));
    },
  );
  // #242: an old complete read keeps its built state between Syncs; it is not in this list.
  it.each(['partial', 'failed', 'future'])(
    'keeps %s GitHub observations pending without redating them',
    (mode) => {
      const x = input();
      vi.setSystemTime(new Date(Date.parse(at) + (mode === 'future' ? -1 : 0)));
      if (mode === 'partial') x.complete = false;
      if (mode === 'failed') x.error = 'read failed';
      expect(buildWork(x)).toMatchObject(expected('pending', 0, null));
    },
  );
  it('moves section membership without retaining the old rollup or changing audit scope', () => {
    vi.setSystemTime(new Date(at));
    const x = input();
    const old = buildWork(x);
    x.project.specMembership[0]!.section = 'fix';
    const moved = buildWork(x);
    expect(moved).toMatchObject({
      specProgress: { bySection: { tasks: { built: 0, pct: null }, fix: { built: 1, pct: 100 } } },
    });
    expect(moved.byNode).toEqual(old.byNode);
  });
  it.each([
    'duplicate-ticket',
    'duplicate-spec',
    'foreign-repo',
    'unknown-section',
    'spec-as-ticket',
  ])('refuses ambiguous %s configuration', (mode) => {
    vi.setSystemTime(new Date(at));
    const x = input();
    const section = x.project.specMembership[0]!;
    if (mode === 'duplicate-ticket') section.specs[0]!.tickets.push('Acme/app#2');
    if (mode === 'duplicate-spec') section.specs.push({ ...section.specs[0]! });
    if (mode === 'foreign-repo') section.specs[0]!.tickets = ['Other/app#2'];
    if (mode === 'unknown-section') section.section = 'not-a-section';
    if (mode === 'spec-as-ticket') section.specs[0]!.tickets = ['Acme/plan#1'];
    expect(buildWork(x)).toMatchObject({
      specProgress: { specs: [], bySection: { tasks: { built: 0, pct: null } } },
    });
  });
  it('keeps unconfigured projects pending without inferring membership from prose or closed specs', () => {
    vi.setSystemTime(new Date(at));
    const x = input();
    x.project.specMembership = [];
    x.issues['Acme/plan#1'] = {
      ...issue('Acme/plan#1'),
      body: 'Closes Acme/app#2',
      labels: ['spec'],
    };
    expect(buildWork(x)).toMatchObject({
      specProgress: { specs: [], bySection: { tasks: { total: 0, built: 0, pct: null } } },
    });
  });
});

import { buildSectionBrief, sectionBriefMarkdown } from '../src/web/sectionBrief.ts';
import { stamp } from '../src/core/time.ts';
import { currentSnapshot } from '../src/web/snapshot.ts';
// #242: the dated evidence stands past ten minutes, with its read time, until the next Sync.
it('shows dated closure evidence and keeps it in the section details without claiming live delivery', () => {
  vi.setSystemTime(new Date(at));
  const w = buildWork(input());
  const s = { ...snapshot, work: w };
  const node = s.stages.flatMap((stage) => stage.nodes).find((n) => n.id === 'tasks')!;
  const text = () => sectionBriefMarkdown(buildSectionBrief(s, node));
  expect(text()).toContain('Ticket closure: 1/1 specs built');
  expect(text()).toContain(`GitHub ticket states read ${stamp(at)}`);
  expect(text()).toContain('Built from ticket closure does not establish merged, deployed or live');
  expect(text()).toContain(`tickets observed closed at ${stamp(at)}`);
  vi.setSystemTime(new Date(Date.parse(at) + 600_001));
  expect(text()).toContain('Ticket closure: 1/1 specs built');
  expect(text()).toContain(`GitHub ticket states read ${stamp(at)}`);
});
it('discards malformed optional progress while retaining the ordinary snapshot', () => {
  const w = buildWork(input());
  const s = { ...snapshot, work: { ...w, specProgress: { arbitrary: true } } };
  const parsed = currentSnapshot(s);
  expect(parsed).not.toBeNull();
  expect(parsed?.work?.specProgress).toBeUndefined();
});

import { emptyWorkCache, refreshWork } from '../src/readers/work-github.ts';
it('revalidates explicit members so a deleted ticket cannot survive in the incremental cache as closed', async () => {
  vi.setSystemTime(new Date(at));
  const x = input();
  const calls: string[] = [];
  const cache = await refreshWork({
    project: x.project,
    now: new Date(at),
    cache: {
      ...emptyWorkCache(project.id),
      at,
      complete: true,
      issues: x.issues,
      reposThrough: { 'Acme/app': at, 'Acme/plan': at },
    },
    run: async (args) => {
      const query = args.join(' ');
      calls.push(query);
      if (args[1] === 'rate_limit')
        return JSON.stringify({
          resources: { core: { remaining: 5000 }, graphql: { remaining: 5000 } },
        });
      // A deleted member is absent even when its old CLOSED row is in the cache.
      if (query.includes('issue(number:'))
        return JSON.stringify({
          data: { rateLimit: { remaining: 4000 }, repository: { member: null } },
        });
      return JSON.stringify({
        data: {
          rateLimit: { remaining: 4000 },
          repository: {
            [query.includes('issues(first:') ? 'issues' : 'pullRequests']: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [],
            },
          },
        },
      });
    },
  });
  expect(
    buildWork({
      ...x,
      issues: cache.issues,
      at: cache.at,
      complete: cache.complete,
      error: cache.error,
    }),
  ).toMatchObject(expected('pending', 0, null));
  expect(calls.some((query) => query.includes('issue(number:'))).toBe(true);
  expect(calls.some((query) => /\bmutation\b/.test(query))).toBe(false);
});

import { currentSpecProgress, type SpecProgress } from '../src/core/spec-progress.ts';
// A published report is checked again before display: one that does not add up, or that counts a
// spec as its own ticket (under any letter case), shows nothing built.
const report = (): SpecProgress => ({
  source: 'github-ticket-closure',
  at,
  reason: 'Synthetic closure evidence',
  specs: [
    {
      key: 'Acme/plan#1',
      section: 'tasks',
      tickets: ['Acme/app#2'],
      closed: 1,
      state: 'built',
      reason: 'All explicitly mapped tickets are closed',
    },
  ],
  bySection: { tasks: { total: 1, built: 1, pending: 0, pct: 100 } },
});
const broken: Record<string, (r: SpecProgress) => void> = {
  'self-reference': (r) => void (r.specs[0]!.tickets = ['Acme/plan#1']),
  'case-alias': (r) => void (r.specs[0]!.tickets = ['acme/PLAN#1']),
  'two-spec-cycle': (r) => {
    r.specs[0]!.tickets = ['Acme/plan#3'];
    r.specs.push({ ...r.specs[0]!, key: 'Acme/plan#3', tickets: ['Acme/plan#1'] });
    r.bySection['tasks'] = { total: 2, built: 2, pending: 0, pct: 100 };
  },
  'duplicate-ticket': (r) => {
    r.specs[0]!.tickets.push('Acme/app#2');
    r.specs[0]!.closed = 2;
  },
  'duplicate-spec': (r) => {
    r.specs.push(structuredClone(r.specs[0]!));
    r.bySection['tasks'] = { total: 2, built: 2, pending: 0, pct: 100 };
  },
  'missing-section': (r) => delete r.bySection['tasks'],
  'over-count': (r) => {
    Object.assign(r.specs[0]!, { state: 'pending', closed: 2 });
    r.bySection['tasks'] = { total: 1, built: 0, pending: 1, pct: null };
  },
  'built-without-tickets': (r) => Object.assign(r.specs[0]!, { tickets: [], closed: 0 }),
  'built-with-open-ticket': (r) => void (r.specs[0]!.closed = 0),
  'open-with-all-closed': (r) => {
    r.specs[0]!.state = 'open';
    r.bySection['tasks'] = { total: 1, built: 0, pending: 0, pct: 0 };
  },
  'open-with-no-tickets': (r) => {
    Object.assign(r.specs[0]!, { state: 'open', tickets: [], closed: 0 });
    r.bySection['tasks'] = { total: 1, built: 0, pending: 0, pct: 0 };
  },
  'wrong-total': (r) => void (r.bySection['tasks']!.total = 2),
  'wrong-built': (r) => {
    Object.assign(r.specs[0]!, { state: 'open', closed: 0 });
    r.bySection['tasks']!.pct = null;
  },
  'wrong-pending': (r) => void (r.bySection['tasks']!.pending = 1),
  'wrong-percent': (r) => void (r.bySection['tasks']!.pct = 0),
  'pending-with-percent': (r) => {
    r.specs[0]!.state = 'pending';
    r.bySection['tasks'] = { total: 1, built: 0, pending: 1, pct: 0 };
  },
};
it.each(Object.keys(broken))('refuses a published closure report with %s', (mode) => {
  const r = report();
  broken[mode]!(r);
  expect(currentSpecProgress(r, Date.parse(at))).toBeNull();
});
it('accepts an open spec whose tickets were all closed as not planned or duplicate (TN-40)', () => {
  const r = report();
  Object.assign(r.specs[0]!, {
    state: 'open',
    reason: 'Every mapped ticket was closed as not planned or duplicate',
  });
  r.bySection['tasks'] = { total: 1, built: 0, pending: 0, pct: 0 };
  expect(currentSpecProgress(r, Date.parse(at))).not.toBeNull();
});
it('accepts a consistent report with mixed and empty sections unchanged', () => {
  const r = report();
  r.specs.push({
    ...r.specs[0]!,
    key: 'Acme/plan#3',
    tickets: ['Acme/app#4'],
    closed: 0,
    state: 'pending',
  });
  r.bySection['tasks'] = { total: 2, built: 1, pending: 1, pct: null };
  r.bySection['fix'] = { total: 0, built: 0, pending: 0, pct: null };
  expect(currentSpecProgress(r, Date.parse(at))).toEqual(r);
});
// #242: old evidence keeps its built counts between Syncs; a failed read or a future time does not.
it('shows closure pending after a failed snapshot read or for future-dated evidence, keeping its time', () => {
  for (const [time, failed] of [
    [Date.parse(at), true],
    [Date.parse(at) - 1, false],
  ] as const) {
    const shown = currentSpecProgress(report(), time, failed)!;
    expect(shown.bySection['tasks']).toMatchObject({ built: 0, pending: 1, pct: null });
    expect(shown.specs[0]!.state).toBe('pending');
    expect(shown.at).toBe(at);
  }
});
it('rereads explicit members on every refresh, so a reopened ticket stops counting as built', async () => {
  vi.setSystemTime(new Date(at));
  const x = input();
  let state = 'CLOSED';
  const run = async (args: readonly string[]): Promise<string> => {
    const query = args.join(' ');
    if (args[1] === 'rate_limit')
      return JSON.stringify({
        resources: { core: { remaining: 5000 }, graphql: { remaining: 5000 } },
      });
    const number = /issue\(number:(\d+)\)/.exec(query)?.[1];
    if (number) {
      const repo = query.includes('name=plan') ? 'Acme/plan' : 'Acme/app';
      return JSON.stringify({
        data: {
          rateLimit: { remaining: 4000 },
          repository: {
            member: {
              number: Number(number),
              title: 'Member',
              body: '',
              url: `https://github.com/${repo}/issues/${number}`,
              state: repo === 'Acme/plan' ? 'OPEN' : state,
              stateReason: null,
              updatedAt: at,
              repository: { nameWithOwner: repo },
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
        rateLimit: { remaining: 4000 },
        repository: {
          [query.includes('issues(first:') ? 'issues' : 'pullRequests']: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [],
          },
        },
      },
    });
  };
  let cache = emptyWorkCache(project.id);
  const seen: string[] = [];
  for (const next of ['CLOSED', 'OPEN']) {
    state = next;
    // oxlint-disable-next-line no-await-in-loop -- each refresh builds on the last cache
    cache = await refreshWork({ project: x.project, cache, run, now: new Date(at) });
    const w = buildWork({
      ...x,
      issues: cache.issues,
      at: cache.at,
      complete: cache.complete,
      error: cache.error,
    });
    seen.push(w.specProgress!.specs[0]!.state);
  }
  expect(seen).toEqual(['built', 'open']);
});
