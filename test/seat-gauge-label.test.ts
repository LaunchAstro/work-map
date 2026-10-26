import { expect, it } from 'vitest';
import {
  buildSeatGauge,
  seatGaugeFailure,
  type SeatGaugePlacements,
} from '../src/core/seat-gauge.ts';
import type { Project } from '../src/readers/project.ts';

// Workspace labels read `<REPO>-<Section>-<Seat>`, and many carry a ticket number before the seat:
// `LBL-Fix-27-Seat`. Seat Gauge splits a label from the right, so that one arrives as repo `LBL-Fix`
// and section `27` (#313).
const now = Date.parse('2026-10-26T01:00:00Z');
const at = new Date(now).toISOString();
/** Seat Gauge's split: the last part is the seat, the one before it the section, the rest the repo. */
function split(workspace: string) {
  const parts = workspace.split('-');
  return parts.length < 3
    ? { repo: null, section: null, seat: null }
    : {
        repo: parts.slice(0, -2).join('-'),
        section: parts.at(-2)!,
        seat: parts.at(-1)!,
      };
}
function fixture(workspace: string, seatGauge: Record<string, unknown> = {}) {
  const project = {
    version: 1,
    id: 'proof',
    title: 'Proof',
    roadmapRepo: 'Example/plan',
    productRepo: 'Example/product',
    repos: ['Example/product', 'Example/other'],
    files: { audit: '', flow: '', plan: '', mapping: '', sections: '' },
    lanePrefix: '',
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
    seatGauge: {
      repositories: { LBL: 'Example/product', 'SITE-2': 'Example/other' },
      ...seatGauge,
    },
  } as unknown as Project;
  const row = {
    machine: 'machine',
    session_id: 'id',
    workspace,
    pane: 'pane',
    tool: 'claude',
    ...split(workspace),
    branch: null,
    started_at: new Date(now - 60_000).toISOString(),
    status: 'working',
    as_of: at,
    stale: false,
    tokens: null,
    usd: null,
  };
  const log = { version: 1, updated: at, sessions: [row], problems: {} };
  // Example/product#12 is an open PR; #27 is a ticket the map placed on `build`.
  const cache = {
    project: 'proof',
    at,
    complete: true,
    error: null,
    prs: [
      {
        key: 'Example/product#12',
        headRepository: 'Example/product',
        headRefName: 'lane',
        issueKeys: [],
        state: 'OPEN',
      },
    ],
  };
  const placements: SeatGaugePlacements = {
    at,
    tickets: new Map([['example/product#27', 'build']]),
    prs: new Map([['example/product#12', 'review']]),
  };
  const sections = new Set(['tasks', 'Fix', 'Director', 'build', 'review']);
  return {
    project,
    sections,
    placements,
    build: () => buildSeatGauge(log, project, sections, cache, new Date(now), null, placements),
  };
}
function mapped(workspace: string, seatGauge?: Record<string, unknown>) {
  const report = fixture(workspace, seatGauge).build();
  const session = report.sessions[0];
  return session
    ? {
        repository: session.repository,
        section: session.section,
        prs: session.prs,
        tickets: session.tickets,
      }
    : { unmapped: report.unmapped };
}

it('reads a number before the seat as a ticket, with the repo and section before it', () => {
  expect(mapped('LBL-Fix-27-Seat')).toEqual({
    repository: 'Example/product',
    section: 'build',
    prs: [],
    tickets: ['Example/product#27'],
  });
});
it('takes the section from the label when the ticket is not placed', () => {
  expect(mapped('LBL-tasks-31-Seat')).toEqual({
    repository: 'Example/product',
    section: 'tasks',
    prs: [],
    tickets: [],
  });
});
it('joins an open PR the label number names', () => {
  expect(mapped('LBL-Fix-12-Seat')).toEqual({
    repository: 'Example/product',
    section: 'review',
    prs: ['Example/product#12'],
    tickets: [],
  });
});
it.each(['LBL-Fix-27-4-Seat', 'LBL-Fix-27-US-Seat', 'LBL-Fix-27a-Seat'])(
  'reads the first number in %s, ignoring what follows it',
  (workspace) => {
    expect(mapped(workspace)).toMatchObject({
      repository: 'Example/product',
      section: 'build',
      tickets: ['Example/product#27'],
    });
  },
);
it('reads a label with no section before its number', () => {
  expect(mapped('LBL-27-Seat')).toMatchObject({
    repository: 'Example/product',
    section: 'build',
    tickets: ['Example/product#27'],
  });
});
it('places the ticket under a branch pattern, which needs a placed ticket or a PR', () => {
  expect(mapped('LBL-Fix-27-Seat', { branchTicket: '^[a-z]+/([1-9][0-9]*)-' })).toMatchObject({
    section: 'build',
    tickets: ['Example/product#27'],
  });
  expect(mapped('LBL-Fix-31-Seat', { branchTicket: '^[a-z]+/([1-9][0-9]*)-' })).toEqual({
    unmapped: 1,
  });
});
it.each([
  ['a label with no number', 'LBL-tasks-Seat'],
  ['a number in the seat slot', 'LBL-Director-10'],
])('leaves %s as Seat Gauge split it', (_, workspace) => {
  expect(mapped(workspace)).toEqual({
    repository: 'Example/product',
    section: workspace.split('-')[1],
    prs: [],
    tickets: [],
  });
});
it('reads no ticket from a zero-led number, so the label stays as Seat Gauge split it', () => {
  expect(mapped('LBL-tasks-027-Seat')).toEqual({ unmapped: 1 });
});
it('keeps a multi-part repo label whole when the number follows it directly', () => {
  expect(
    mapped('LBL-TWO-27-Seat', { repositories: { 'LBL-TWO': 'Example/product' } }),
  ).toMatchObject({
    repository: 'Example/product',
    section: 'build',
    tickets: ['Example/product#27'],
  });
});
it('leaves a label whose repo part is already a mapped label, numbers and all', () => {
  expect(mapped('SITE-2-tasks-Seat')).toEqual({
    repository: 'Example/other',
    section: 'tasks',
    prs: [],
    tickets: [],
  });
});
it("lets the project's own workspace pattern decide its labels' numbers", () => {
  const rule = { pattern: '^LBL-Fix-([1-9][0-9]*)-Seat$', repository: 'Example/product' };
  expect(mapped('LBL-Fix-27-Seat', { workspace: rule })).toMatchObject({
    tickets: ['Example/product#27'],
  });
  // The pattern does not match, so this label names no ticket, and under a workspace pattern a
  // session with no PR or placed ticket stays anonymous.
  expect(mapped('LBL-tasks-27-Seat', { workspace: rule })).toEqual({ unmapped: 1 });
});
function placedSession(workspace: string, seatGauge?: Record<string, unknown>) {
  const f = fixture(workspace, seatGauge);
  (f.placements.tickets as Map<string, string>).set('example/other#27', 'build');
  return f.build();
}
it('skips mapped repository numbers before finding the ticket', () => {
  const report = placedSession('SITE-2-Fix-27-Seat');
  expect(report.sessions).toHaveLength(1);
  expect(report.sessions[0]).toMatchObject({
    repository: 'Example/other',
    section: 'build',
    tickets: ['Example/other#27'],
  });
});
it('keeps the repository a workspace pattern supplies', () => {
  const rule = { pattern: '^LBL-Fix-([1-9][0-9]*)-Seat$', repository: 'Example/other' };
  const report = placedSession('LBL-Fix-27-Seat', { workspace: rule });
  expect(report.sessions[0]).toMatchObject({
    repository: 'Example/other',
    section: 'build',
    tickets: ['Example/other#27'],
  });
});
it('keeps the label section for a retained row whose ticket is not placed', () => {
  const f = fixture('LBL-tasks-31-Seat');
  const after = seatGaugeFailure(f.build(), f.project, new Date(now), f.sections, f.placements);
  expect(after.sessions[0]).toMatchObject({ repository: 'Example/product', section: 'tasks' });
});
it('keeps the label reading for a row retained after a failed read', () => {
  const f = fixture('LBL-Fix-27-Seat');
  const before = f.build();
  const after = seatGaugeFailure(before, f.project, new Date(now), f.sections, f.placements);
  expect(after.sessions).toHaveLength(1);
  expect(after.sessions[0]).toMatchObject({
    repository: 'Example/product',
    section: 'build',
    tickets: ['Example/product#27'],
  });
});
