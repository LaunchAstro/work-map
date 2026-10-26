import { describe, expect, it } from 'vitest';
import { absorptionOf, closingParent } from '../src/core/absorption.ts';
import {
  buildTicketProgress,
  currentTicketProgress,
  ticketCounts,
} from '../src/core/ticket-progress.ts';
import type { WorkIssue } from '../src/core/work.ts';
import type { Plan } from '../src/core/plan.ts';
import { ticketSummary } from '../src/web/TicketProgress.tsx';
import { asideWords } from '../src/core/ticket-progress.ts';
import type { Project } from '../src/readers/project.ts';

// #189: a ticket closed as absorbed into a parent follows that parent; one closed with no parent is
// dropped and leaves the total. Both maps share this code path (#88: one product).
const project: Project = {
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
  progress: {
    basis: 'ticket-count',
    repositories: { 'Example/app': 'build', 'Example/plan': 'design' },
  },
};
const plan: Plan = { units: {}, tickets: {}, unitIssues: {} };
const at = '2026-10-16T01:00:00Z';
const issue = (key: string, patch: Partial<WorkIssue> = {}): WorkIssue => ({
  key,
  title: 'Task',
  body: '',
  url: `https://github.com/${key.replace('#', '/issues/')}`,
  state: 'OPEN',
  parent: null,
  labels: [],
  blockedBy: [],
  contextComplete: true,
  ...patch,
});
const absorbed = (key: string, parent: string | null, patch: Partial<WorkIssue> = {}) =>
  issue(key, { state: 'CLOSED', stateReason: 'NOT_PLANNED', absorbedInto: parent, ...patch });
const done = { state: 'CLOSED', stateReason: 'COMPLETED' } as const;
const sections = ['build', 'design'];
const build = (issues: WorkIssue[]) =>
  buildTicketProgress({
    project,
    plan,
    nodes: sections.map((id) => ({ id, units: [] })),
    maps: {},
    issues: Object.fromEntries(issues.map((i) => [i.key, i])),
    at,
    complete: true,
    error: null,
  })!;

describe('absorbed tickets follow their parent; dropped tickets leave the total (#189)', () => {
  it('absorbed with its parent closed completed counts as done', () => {
    const p = build([issue('Example/app#1', done), absorbed('Example/app#2', 'Example/app#1')]);
    expect(p.byNode['build']).toMatchObject({
      completed: 2,
      total: 2,
      absorbed: 1,
      dropped: 0,
      pct: 100,
    });
  });
  it('absorbed with its parent open counts as open', () => {
    const p = build([issue('Example/app#1'), absorbed('Example/app#2', 'Example/app#1')]);
    expect(p.byNode['build']).toMatchObject({ completed: 0, total: 2, absorbed: 1, pct: 0 });
  });
  it('closed not planned with no parent is dropped: out of the total, still listed', () => {
    const p = build([issue('Example/app#1', done), absorbed('Example/app#2', null)]);
    expect(p.byNode['build']).toMatchObject({ completed: 1, total: 1, dropped: 1, pct: 100 });
    expect(p.byNode['build']?.tickets.map((t) => t.key)).toContain('Example/app#2');
  });
  it('a duplicate with no parent is dropped, not an unknown closure', () => {
    const p = build([absorbed('Example/app#2', null, { stateReason: 'DUPLICATE' })]);
    expect(p.byNode['build']).toMatchObject({ total: 0, dropped: 1, unknown: 0 });
  });
  it('a parent outside the census counts as open, with a note', () => {
    const p = build([absorbed('Example/app#2', 'Elsewhere/repo#9')]);
    expect(p.byNode['build']).toMatchObject({ completed: 0, total: 1, absorbed: 1 });
    expect(p.byNode['build']?.tickets[0]?.follows).toEqual({
      parent: 'Elsewhere/repo#9',
      state: null,
      stateReason: null,
      note: 'Parent outside the issue census',
    });
  });
  it('a chain of absorptions follows the last parent, done, open or dropped', () => {
    const chain = (end: Partial<WorkIssue>) =>
      build([
        absorbed('Example/app#1', 'Example/app#2'),
        absorbed('Example/app#2', 'Example/app#3'),
        issue('Example/app#3', end),
      ]).byNode['build'];
    expect(chain(done)).toMatchObject({ completed: 3, total: 3, absorbed: 2 });
    expect(chain({})).toMatchObject({ completed: 0, total: 3, absorbed: 2 });
    expect(
      chain({ state: 'CLOSED', stateReason: 'NOT_PLANNED', absorbedInto: null }),
    ).toMatchObject({ completed: 0, total: 0, absorbed: 0, dropped: 3 });
    const loop = build([
      absorbed('Example/app#1', 'Example/app#2'),
      absorbed('Example/app#2', 'Example/app#1'),
    ]).byNode['build'];
    expect(loop).toMatchObject({ completed: 0, total: 2, absorbed: 2 });
    expect(loop?.tickets[0]?.follows?.note).toBe('Absorption loop');
  });
  it('a parent in another repository is followed, and each ticket counts once in its own section', () => {
    const p = build([issue('Example/plan#7', done), absorbed('Example/app#2', 'Example/plan#7')]);
    expect(p.byNode['build']).toMatchObject({ completed: 1, total: 1, absorbed: 1 });
    expect(p.byNode['design']).toMatchObject({ completed: 1, total: 1, absorbed: 0 });
    expect(p.totals).toMatchObject({ completed: 2, total: 2 });
  });
  it('the browser accepts the built counts and refuses a dropped ticket counted in the total', () => {
    const p = build([issue('Example/app#1', done), absorbed('Example/app#2', null)]);
    expect(currentTicketProgress(p, sections)).not.toBeNull();
    const inflated = { ...p, totals: { ...p.totals, total: 2, pct: 50 } };
    expect(currentTicketProgress(inflated, sections)).toBeNull();
    // The same absorbed ticket, stripped of the parent it follows, is dropped work.
    const followed = build([
      issue('Example/app#1', done),
      absorbed('Example/app#2', 'Example/app#1'),
    ]);
    const ticket = followed.byNode['build']!.tickets.find((t) => t.key === 'Example/app#2')!;
    expect(ticketCounts([ticket], true)).toMatchObject({ completed: 1, total: 1 });
    expect(ticketCounts([{ ...ticket, follows: null }], true)).toMatchObject({
      total: 0,
      dropped: 1,
    });
  });
  it('the hover and details name absorbed and dropped counts', () => {
    const counts = build([
      issue('Example/app#1', done),
      absorbed('Example/app#2', 'Example/app#1'),
      absorbed('Example/app#3', null),
    ]).byNode['build'];
    expect(asideWords(counts)).toBe(' · 1 absorbed · 1 dropped');
    expect(ticketSummary(counts, true)).toBe('2/2 completed · 1 absorbed · 1 dropped');
    const allDropped = build([absorbed('Example/app#1', null)]).totals;
    expect(ticketSummary(allDropped, true)).toBe('No mapped tickets · 1 dropped');
  });
  it('a section waits while any closed-aside link on a ticket’s chain is unread, label lists or not', () => {
    const unread = { contextComplete: false };
    // The ticket's own closing comment unread: its section waits, the other does not.
    const own = build([absorbed('Example/app#1', null, unread), issue('Example/plan#2', done)]);
    expect(own.pendingSections).toEqual(['build']);
    expect(own.byNode['build']?.pct).toBeNull();
    // An unread link further up the chain, in another section, holds the child's section too.
    const chain = build([
      absorbed('Example/app#1', 'Example/plan#2'),
      absorbed('Example/plan#2', 'Example/plan#3', unread),
      issue('Example/plan#3', done),
    ]);
    expect(chain.pendingSections).toEqual(['build', 'design']);
    expect(chain.byNode['build']?.pct).toBeNull();
    expect(currentTicketProgress(chain, sections)).not.toBeNull();
  });
  it('the browser refuses a stored parent or note that differs from the ticket’s chain', () => {
    const p = build([
      absorbed('Example/app#1', 'Example/app#2'),
      absorbed('Example/app#2', 'Example/plan#3'),
      issue('Example/plan#3'),
    ]);
    expect(currentTicketProgress(p, sections)).not.toBeNull();
    const own = p.byNode['build']!.tickets;
    const first = own.findIndex((t) => t.key === 'Example/app#1');
    for (const note of [null, 'Absorption loop', 'Parent outside the issue census']) {
      // Example/app#1 claims Example/app#2 closed as completed; its chain ends at open Example/plan#3.
      const follows = { parent: 'Example/app#2', state: 'CLOSED', stateReason: 'COMPLETED', note };
      const tickets = own.with(first, { ...own[first]!, follows });
      const forged = {
        ...p,
        byNode: { ...p.byNode, build: ticketCounts(tickets, true) },
        totals: ticketCounts([...tickets, ...p.byNode['design']!.tickets], true),
      };
      expect(currentTicketProgress(forged, sections), String(note)).toBeNull();
    }
  });
  it('loops, dropped chains and outside parents survive the stored round trip', () => {
    for (const issues of [
      [absorbed('Example/app#1', 'Example/app#2'), absorbed('Example/app#2', 'Example/app#1')],
      [absorbed('Example/app#1', 'Example/plan#2'), absorbed('Example/plan#2', null)],
      [absorbed('Example/app#1', 'Elsewhere/repo#9')],
    ])
      expect(
        currentTicketProgress(JSON.parse(JSON.stringify(build(issues))), sections),
      ).not.toBeNull();
  });
});

describe('the parent named at closing (#189)', () => {
  const closed = {
    key: 'example-org/example-roadmap#784',
    state: 'CLOSED',
    stateReason: 'NOT_PLANNED',
    closedAt: '2026-09-27T15:59:50Z',
    duplicateOf: null,
    commentsTotal: 1,
  };
  const said = (body: string, createdAt = '2026-09-27T15:59:49Z') => ({
    ...closed,
    comments: [{ body, createdAt }],
  });
  it('reads "Absorbed into #n" in the closing comment as the same repository', () => {
    expect(
      absorptionOf(said('Absorbed into #670 (U01: beds and rows). Its acceptance ...')),
    ).toEqual({
      parent: 'example-org/example-roadmap#670',
      read: true,
    });
  });
  it('reads another repository by owner/repo#n or issue URL, and "Duplicate of"', () => {
    expect(closingParent('Absorbed into example-org/example-app#12.', 'A/b')).toBe(
      'example-org/example-app#12',
    );
    expect(
      closingParent('Duplicate of https://github.com/example-org/example-app/issues/5', 'A/b'),
    ).toBe('example-org/example-app#5');
    expect(closingParent('  duplicate of #3', 'A/b')).toBe('A/b#3');
  });
  it('every parent phrasing the census reads: absorbed, merged or duplicate, after at most one label', () => {
    expect(closingParent('Merged into #726 after the review (2 March 2026).', 'A/b')).toBe(
      'A/b#726',
    );
    expect(closingParent('Pre-triage: duplicate of #646 (same root cause)', 'A/b')).toBe('A/b#646');
    expect(closingParent('**Absorbed into** #5', 'A/b')).toBeNull();
    expect(closingParent('Note: later: duplicate of #646', 'A/b')).toBeNull();
  });
  it('replaced, superseded or split work names no parent and is dropped', () => {
    expect(closingParent('Superseded by the season planning map #85 (design)', 'A/b')).toBeNull();
    expect(closingParent('Superseded by #85', 'A/b')).toBeNull();
    expect(
      closingParent('Split at the ticket review into one ticket per tab: #623', 'A/b'),
    ).toBeNull();
  });
  it('a ticket that only mentions another one names no parent', () => {
    expect(closingParent('Not doing this; see #670 for the rest.', 'A/b')).toBeNull();
    expect(closingParent('We absorbed into #670 nothing', 'A/b')).toBeNull();
    expect(closingParent('Absorbed into #0', 'A/b')).toBeNull();
  });
  it("GitHub's own duplicate link outranks the comment", () => {
    expect(
      absorptionOf({ ...said('Absorbed into #1'), duplicateOf: 'example-org/example-app#9' }),
    ).toEqual({ parent: 'example-org/example-app#9', read: true });
  });
  it('the closing comment is the last one written by the close; later comments do not count', () => {
    const later = {
      ...closed,
      commentsTotal: 2,
      comments: [
        { body: 'Absorbed into #670', createdAt: '2026-09-27T15:59:49Z' },
        { body: 'Absorbed into #999', createdAt: '2026-10-01T00:00:00Z' },
      ],
    };
    expect(absorptionOf(later).parent).toBe('example-org/example-roadmap#670');
    expect(absorptionOf(said('Absorbed into #670', '2026-10-01T00:00:00Z')).parent).toBeNull();
  });
  it('an open or completed ticket names no parent; an unread closing comment is not read', () => {
    expect(absorptionOf({ ...said('Absorbed into #670'), stateReason: 'COMPLETED' })).toEqual({
      parent: null,
      read: true,
    });
    const crowded = {
      ...closed,
      commentsTotal: 40,
      comments: [{ body: 'later chat', createdAt: '2026-10-01T00:00:00Z' }],
    };
    expect(absorptionOf(crowded)).toEqual({ parent: null, read: false });
  });
});
