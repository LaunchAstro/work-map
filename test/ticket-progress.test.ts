import { describe, expect, it } from 'vitest';
import {
  buildTicketProgress,
  currentTicketProgress,
  selectedTicketCounts,
  ticketCounts,
  ticketProgressCurrent,
} from '../src/core/ticket-progress.ts';
import type { WorkIssue } from '../src/core/work.ts';
import type { Project } from '../src/readers/project.ts';
import type { Plan } from '../src/core/plan.ts';

export const project: Project = {
  version: 1,
  id: 'synthetic',
  title: 'Synthetic',
  roadmapRepo: 'Example/plan',
  productRepo: 'Example/app',
  repos: ['Example/app', 'Example/plan'],
  files: { flow: 'f', audit: 'a', plan: 'p', mapping: 'm', sections: 's' },
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
  progress: { basis: 'ticket-count', repositories: { 'Example/app': 'build' }, issues: {} },
};
const overridden: Project = {
  ...project,
  progress: {
    basis: 'ticket-count',
    repositories: { 'Example/app': 'build' },
    issues: { 'Example/app#4': 'design', 'Example/app#5': 'outside' },
  },
};
const plan: Plan = { units: {}, tickets: {}, unitIssues: {} };
const at = '2026-10-16T01:00:00Z';
const now = Date.parse(at);
const issue = (n: number, patch: Partial<WorkIssue> = {}): WorkIssue => ({
  key: `Example/app#${n}`,
  title: 'Spec task',
  body: '',
  url: `https://github.com/Example/app/issues/${n}`,
  state: 'OPEN',
  parent: null,
  labels: ['spec'],
  blockedBy: [],
  contextComplete: true,
  ...patch,
});
const build = (
  issues: WorkIssue[],
  patch: Partial<Parameters<typeof buildTicketProgress>[0]> = {},
) =>
  buildTicketProgress({
    project,
    plan,
    nodes: [
      { id: 'build', units: [] },
      { id: 'design', units: [] },
      { id: 'empty', units: [] },
    ],
    maps: {},
    issues: Object.fromEntries(issues.map((i) => [i.key, i])),
    at,
    complete: true,
    error: null,
    ...patch,
  })!;

describe('ticket completion is an independent issue count', () => {
  it('includes specs and umbrella issues once, drops a parentless not-planned ticket from the total (#189) and never treats an empty section as finished', () => {
    const p = build(
      [
        issue(1, { state: 'CLOSED', stateReason: 'COMPLETED' }),
        issue(2, { state: 'CLOSED', stateReason: 'NOT_PLANNED' }),
        issue(3),
        issue(4, { body: 'Section: build', state: 'CLOSED', stateReason: 'COMPLETED' }),
        issue(5),
      ],
      { project: overridden },
    );
    expect(p.byNode['build']).toMatchObject({ completed: 1, total: 2, dropped: 1, unknown: 0 });
    expect(p.byNode['build']?.pct).toBe(50);
    expect(p.byNode['design']).toMatchObject({ completed: 1, total: 1, pct: 100 });
    expect(p.byNode['empty']).toMatchObject({ completed: 0, total: 0, pct: null });
    expect(p.totals).toMatchObject({ completed: 2, total: 3, dropped: 1 });
    expect(p.totals.pct).toBeCloseTo(200 / 3);
    expect(p.outside.map((i) => i.key)).toEqual(['Example/app#5']);
    expect(p.byNode['design']?.tickets[0]?.mapping).toContain('override');
    expect(ticketCounts([...p.totals.tickets, ...p.totals.tickets], true)).toEqual(p.totals);
  });
  it('reopening, unknown legacy reasons and failures cannot claim complete', () => {
    expect(build([issue(1, { state: 'OPEN', stateReason: 'REOPENED' })]).totals).toMatchObject({
      completed: 0,
      total: 1,
      pct: 0,
    });
    expect(build([issue(1, { state: 'CLOSED' })]).totals).toMatchObject({
      completed: 0,
      unknown: 1,
      pct: null,
    });
    expect(
      build([issue(1, { state: 'CLOSED', stateReason: 'COMPLETED' })], { complete: false }).totals
        .pct,
    ).toBeNull();
  });
  it('uses own evidence, parent ownership, explicit maps and repository defaults in order and exposes missing mappings', () => {
    const p = build(
      [
        issue(1, { body: 'Section: design' }),
        issue(2, { parent: 'Example/app#1' }),
        issue(3),
        issue(4),
        issue(5),
        issue(6, { key: 'Example/plan#6' }),
      ],
      { project: overridden, maps: { 'Example/app#3': 'design' } },
    );
    expect(p.byNode['design']?.tickets.map((i) => i.key)).toEqual([
      'Example/app#1',
      'Example/app#2',
      'Example/app#3',
      'Example/app#4',
    ]);
    expect(p.unplaced.map((i) => i.key)).toEqual(['Example/plan#6']);
    // A card no section owns is listed as not on the map; it no longer holds every percentage (#88).
    expect(p.complete).toBe(true);
    expect(p.totals.pct).toBe(0);
    const moved = build([issue(1)], {
      project: {
        ...project,
        progress: { basis: 'ticket-count', repositories: { 'Example/app': 'design' } },
      },
    });
    expect(moved.byNode['design']?.total).toBe(1);
    expect(moved.byNode['build']?.total).toBe(0);
    expect(build([], { project: overridden }).missing).toEqual(['Example/app#4', 'Example/app#5']);
    expect(() =>
      build([], {
        project: {
          ...project,
          progress: { basis: 'ticket-count', repositories: { 'Example/app': 'typo' } },
        },
      }),
    ).toThrow('section');
  });
  // #242: a complete census stays current between Syncs, whatever its age; it is shown with its time.
  it('requires complete browser evidence, keeps it past ten minutes and rejects future dates', () => {
    const p = build([issue(1), issue(4), issue(5)]);
    expect(ticketProgressCurrent(p, now)).toBe(true);
    expect(ticketProgressCurrent(p, now + 86_400_000)).toBe(true);
    expect(ticketProgressCurrent({ ...p, complete: false }, now)).toBe(false);
    expect(ticketProgressCurrent(p, now, true)).toBe(false);
    expect(ticketProgressCurrent({ ...p, at: '2026-10-17T00:00:00Z' }, now)).toBe(false);
  });
});

it('follows nested and cross-repository evidence without inheriting a parent repository default', () => {
  const p = build(
    [
      issue(1, { key: 'Example/plan#1', parent: 'Example/app#3' }),
      issue(2, { parent: 'Example/plan#1' }),
      issue(3, { body: 'Section: design' }),
      issue(6, { parent: 'Example/plan#99' }),
    ],
    { maps: { 'Example/plan#99': 'design' } },
  );
  expect(p.byNode['design']?.total).toBe(4);
  expect(
    p.byNode['design']?.tickets.find((ticket) => ticket.key === 'Example/app#2')?.mapping,
  ).toContain('parent:');
  const cycle = build([
    issue(1, { key: 'Example/plan#1', parent: 'Example/plan#2' }),
    issue(2, { key: 'Example/plan#2', parent: 'Example/plan#1' }),
  ]);
  expect(cycle.unplaced).toHaveLength(2);
  const noDefaultInheritance = build([
    issue(1),
    issue(2, { key: 'Example/plan#2', parent: 'Example/app#1' }),
  ]);
  expect(noDefaultInheritance.unplaced.map((ticket) => ticket.key)).toEqual(['Example/plan#2']);
});

describe('Progress counts work cards; bugs and questions are kept apart (#88)', () => {
  const labelled: Project = {
    ...project,
    progress: {
      basis: 'ticket-count',
      repositories: { 'Example/app': 'build' },
      bugLabels: ['bug', 'sweep-found', 'severity:*'],
      skipLabels: ['roadmap:grilling', 'roadmap:research'],
    },
  };
  const done = { state: 'CLOSED', stateReason: 'COMPLETED' } as const;
  const cards = [
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => issue(n, { labels: ['roadmap:task'], ...done })),
    ...[8, 9, 10].map((n) => issue(n, { labels: ['roadmap:task', 'follow-up'] })),
    issue(11, { labels: ['sweep-found'], ...done }),
    issue(12, { labels: ['sweep-found'] }),
    issue(13, { labels: ['severity:major', 'roadmap:task'] }),
    issue(14, { labels: ['bug'] }),
    issue(15, { labels: ['roadmap:grilling'], ...done }),
    issue(16, { labels: ['roadmap:research'] }),
  ];
  it('a section with 10 work cards (7 closed), 4 bug cards and 2 questions reads 7/10 and bugs 1/4', () => {
    const p = build(cards, { project: labelled });
    expect(p.byNode['build']).toMatchObject({ completed: 7, total: 10, pct: 70 });
    expect(p.bugs?.byNode['build']).toMatchObject({ completed: 1, total: 4, pct: 25 });
    expect(p.bugs?.totals).toMatchObject({ completed: 1, total: 4 });
    expect(p.skipped?.map((t) => t.key)).toEqual(['Example/app#15', 'Example/app#16']);
    expect(p.totals.tickets.map((t) => t.key)).not.toContain('Example/app#13');
    expect(selectedTicketCounts(p, ['build'], 'bugs')).toMatchObject({ completed: 1, total: 4 });
  });
  it('the same cards with no label lists all count as work, as before', () => {
    expect(build(cards).byNode['build']).toMatchObject({ completed: 9, total: 16 });
  });
  it('a card no section owns is listed, not counted, and percentages stay current', () => {
    const p = build([...cards, issue(17, { key: 'Example/plan#17', labels: ['bug'] })], {
      project: labelled,
    });
    expect(p.unplaced.map((t) => t.key)).toEqual(['Example/plan#17']);
    expect(p.complete).toBe(true);
    expect(p.reason).toBeNull();
    expect(p.byNode['build']?.pct).toBe(70);
  });
  it('a placed card whose labels GitHub cut short holds only its own section; an unplaced one holds nothing (#157)', () => {
    const cut = { labels: [], contextComplete: false };
    const p = build(
      [
        issue(1, { ...cut, ...done }),
        issue(2, done),
        issue(3, {
          ...cut,
          key: 'Example/plan#3',
          url: 'https://github.com/Example/plan/issues/3',
        }),
      ],
      {
        project: {
          ...project,
          progress: {
            basis: 'ticket-count',
            repositories: { 'Example/app': 'build' },
            issues: { 'Example/app#2': 'design' },
            bugLabels: ['bug'],
          },
        },
      },
    );
    expect(p.unplaced.map((t) => t.key)).toEqual(['Example/plan#3']);
    const read = currentTicketProgress(p, ['build', 'design', 'empty'])!;
    expect(read.pendingSections).toEqual(['build']);
    expect(read.byNode['build']?.pct).toBeNull();
    expect(read.byNode['design']?.pct).toBe(100);
    expect(selectedTicketCounts(read, ['design']).pct).toBe(100);
    expect(selectedTicketCounts(read, ['build', 'design']).pct).toBeNull();
    expect(read.totals.pct).toBeNull();
  });
  it('a question card not read in full holds its section too', () => {
    const p = build(
      [
        issue(1, { labels: ['roadmap:task'], ...done }),
        issue(2, { labels: ['roadmap:grilling'], contextComplete: false }),
      ],
      { project: labelled },
    );
    expect(p.pendingSections).toEqual(['build']);
    expect(p.byNode['build']?.pct).toBeNull();
  });
  it('the browser accepts the built counts and refuses a bug card counted as work too', () => {
    const p = build(cards, { project: labelled });
    expect(currentTicketProgress(p, ['build', 'design', 'empty'])).not.toBeNull();
    const bug = p.bugs!.byNode['build']!.tickets[0]!;
    const doubled = {
      ...p,
      byNode: {
        ...p.byNode,
        build: ticketCounts([...p.byNode['build']!.tickets, bug], true),
      },
      totals: ticketCounts([...p.totals.tickets, bug], true),
    };
    expect(currentTicketProgress(doubled, ['build', 'design', 'empty'])).toBeNull();
    const wrongBugs = {
      ...p,
      bugs: { ...p.bugs!, totals: ticketCounts([], true) },
    };
    expect(currentTicketProgress(wrongBugs, ['build', 'design', 'empty'])).toBeNull();
  });
});

// A parent's progress override, not its superseded section map, places its children.
it("a child follows its parent's progress override, not the parent's section map", () => {
  for (const destination of ['design', 'outside']) {
    const p = build(
      [issue(1, { key: 'Example/plan#9' }), issue(10, { parent: 'Example/plan#9' })],
      {
        project: {
          ...project,
          progress: {
            basis: 'ticket-count',
            repositories: { 'Example/app': 'build' },
            issues: { 'Example/plan#9': destination },
          },
        },
        maps: { 'Example/plan#9': 'build' },
      },
    );
    const tickets = [...p.totals.tickets, ...p.outside];
    expect(tickets.find((t) => t.key === 'Example/plan#9')?.section).toBe(destination);
    expect(tickets.find((t) => t.key === 'Example/app#10')?.section).toBe(destination);
    expect(p.byNode['build']?.total).toBe(0);
  }
});
