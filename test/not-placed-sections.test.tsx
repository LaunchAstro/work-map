// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only
// A map whose config sets `progress.notPlaced: "sections"` counts what it really places: tickets on
// no section, open and merged PRs on no section and the map-gap files, each on its own. The plan-unit
// count is left out. Every other map keeps its single "Not placed" figure.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { Snapshot } from '../src/core/contract.ts';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import { pendingTicketProgress, type TicketProgress } from '../src/core/ticket-progress.ts';
import { buildWork, withWork, type OpenPr } from '../src/core/work.ts';
import { readProject, type Project } from '../src/readers/project.ts';
import { Overview } from '../src/web/Overview.tsx';
import { currentSnapshot } from '../src/web/snapshot.ts';

const at = '2026-10-26T00:00:00.000Z';
const now = Date.parse(at);
const fx = (s: string): string => readFileSync(join(import.meta.dirname, 'fixtures', s), 'utf8');
const plan = parseBuildUnits(fx('build-units.md'));
const snap = buildSnapshot({
  audit: JSON.parse(fx('audit.json')) as Audit,
  flow: JSON.parse(fx('flow.json')) as Flow,
  plan,
  generatedAt: at,
  github: {
    repo: 'Acme/app',
    prsThrough: null,
    issuesThrough: null,
    lastRun: { at, skipped: null, partial: false },
  },
  openState: { at, queued: 0 },
});
const base: Project = {
  version: 1,
  id: 'acme',
  title: 'Acme',
  roadmapRepo: 'Acme/plan',
  productRepo: 'Acme/app',
  repos: ['Acme/app'],
  files: {
    audit: 'audit.json',
    flow: 'flow.json',
    plan: 'units.md',
    mapping: 'mapping.json',
    sections: 'sections.json',
  },
  lanePrefix: 'AC-',
  laneRules: [],
  ticketConventions: {
    mapLabel: 'roadmap:map',
    ideaLabels: [],
    ideaPattern: '^Idea:',
    specLabels: [],
    readyLabel: 'ready-for-agent',
    ticketLabels: [],
    specPattern: '^Spec:',
  },
  dependencies: [],
};
const sections: Project = {
  ...base,
  progress: { basis: 'ticket-count', repositories: {}, notPlaced: 'sections' },
};
const pr = (n: number, body: string, state: 'OPEN' | 'MERGED'): OpenPr => ({
  key: `Acme/app#${n}`,
  number: n,
  title: `PR ${n}`,
  body,
  url: `https://github.com/Acme/app/pull/${n}`,
  headRefName: `b${n}`,
  issueKeys: [],
  state,
});
const open = [pr(10, 'Section: tasks', 'OPEN'), pr(11, 'No section', 'OPEN')];
const merged = [
  pr(20, 'Section: fix', 'MERGED'),
  pr(21, 'Nothing to place it', 'MERGED'),
  pr(22, 'Ticket: none', 'MERGED'),
];
const ticket = {
  key: 'Acme/app#5',
  title: 'Loose ticket',
  url: 'https://github.com/Acme/app/issues/5',
};
const tickets: TicketProgress = {
  ...pendingTicketProgress(),
  at,
  complete: true,
  reason: null,
  unplaced: [{ ...ticket, state: 'OPEN', stateReason: null, section: null, mapping: 'none' }],
};
const work = (project: Project, issues: Parameters<typeof buildWork>[0]['issues'] = {}) =>
  buildWork({
    project,
    ticketProgress: tickets,
    plan,
    nodes: snap.stages.flatMap((s) => s.nodes),
    issues,
    prs: open,
    trackedMergedPrs: merged,
    maps: {},
    at,
    complete: true,
    error: null,
  });
const header = (s: Snapshot, t: TicketProgress | undefined, showUnmapped = false): string =>
  renderToStaticMarkup(
    <Overview
      s={s}
      tickets={t}
      snapFailed={null}
      now={now}
      statsTab="merges"
      setStatsTab={() => {}}
      setTip={() => {}}
      tip={null}
      showTip={() => {}}
      hideTip={() => {}}
      showUnmapped={showUnmapped}
      setShowUnmapped={() => {}}
    />,
  );
const count = (html: string, label: string): string | undefined =>
  new RegExp(`${label}</span><span class="big">([^<]*)<`).exec(html)?.[1];

it('a project opts in with progress.notPlaced "sections" on a ticket-count map only', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'not-placed-')), 'project.json');
  const read = (progress: unknown) => {
    writeFileSync(path, JSON.stringify({ ...base, progress }));
    return readProject(path).project.progress;
  };
  expect(read({ basis: 'ticket-count', repositories: {}, notPlaced: 'sections' })).toMatchObject({
    notPlaced: 'sections',
  });
  expect(() => read({ basis: 'ticket-count', repositories: {}, notPlaced: 'units' })).toThrow();
  expect(() =>
    read({ basis: 'estimated-scope', scope: 's.json', notPlaced: 'sections' }),
  ).toThrow();
});

it('lists open and merged PRs no section places, leaving out PRs declared outside the plan', () => {
  expect(work(sections).offMap?.prs).toEqual([
    {
      key: 'Acme/app#11',
      title: 'PR 11',
      url: 'https://github.com/Acme/app/pull/11',
      state: 'OPEN',
    },
    {
      key: 'Acme/app#21',
      title: 'PR 21',
      url: 'https://github.com/Acme/app/pull/21',
      state: 'MERGED',
    },
  ]);
  // Without the setting the work view keeps its old shape exactly.
  expect(work(base)).not.toHaveProperty('offMap');
});

it('a loose ticket whose labels were cut short holds the ticket count pending where labels decide its kind', () => {
  const loose = {
    key: 'Acme/app#5',
    title: 'Loose ticket',
    body: '',
    url: 'https://github.com/Acme/app/issues/5',
    state: 'OPEN' as const,
    parent: null,
    labels: [],
    blockedBy: [],
    contextComplete: false,
  };
  const labelled: Project = {
    ...sections,
    progress: {
      basis: 'ticket-count',
      repositories: {},
      notPlaced: 'sections',
      skipLabels: ['question'],
    },
  };
  expect(work(labelled, { [loose.key]: loose }).offMap?.unreadLabels).toEqual(['Acme/app#5']);
  // Without label lists a ticket's labels can't change its kind, so nothing waits.
  expect(work(sections, { [loose.key]: loose }).offMap?.unreadLabels).toEqual([]);
  const s = withWork(snap, work(labelled, { [loose.key]: loose }));
  expect(count(header(s, tickets), 'Tickets not placed')).toBe('—');
});

const issue = (n: number) => ({
  key: `Acme/app#${n}`,
  title: `Question ${n}`,
  body: '',
  url: `https://github.com/Acme/app/issues/${n}`,
  state: 'OPEN' as const,
  parent: null,
  labels: ['question'],
  blockedBy: [],
  contextComplete: false,
});
const question = (n: number, section: string | null) => ({
  key: `Acme/app#${n}`,
  title: `Question ${n}`,
  url: `https://github.com/Acme/app/issues/${n}`,
  state: 'OPEN',
  stateReason: null,
  section,
  mapping: 'none',
});

it('a sectionless question whose labels were cut short holds the count too: a hidden bug label would make it count', () => {
  const labelled: Project = {
    ...sections,
    progress: {
      basis: 'ticket-count',
      repositories: {},
      notPlaced: 'sections',
      bugLabels: ['bug'],
      skipLabels: ['question'],
    },
  };
  const progress: TicketProgress = {
    ...tickets,
    unplaced: [],
    // A loose one, one placed in a section (its section waits in ticket progress) and one outside.
    skipped: [question(6, null), question(7, 'tasks'), question(8, 'outside')],
  };
  const w = buildWork({
    project: labelled,
    ticketProgress: progress,
    plan,
    nodes: snap.stages.flatMap((n) => n.nodes),
    issues: { 'Acme/app#6': issue(6), 'Acme/app#7': issue(7), 'Acme/app#8': issue(8) },
    prs: [],
    maps: {},
    at,
    complete: true,
    error: null,
  });
  expect(w.offMap?.unreadLabels).toEqual(['Acme/app#6']);
  expect(count(header(withWork(snap, w), progress), 'Tickets not placed')).toBe('—');
  // Read in full, the question counts nowhere and the count shows.
  const read = buildWork({
    project: labelled,
    ticketProgress: progress,
    plan,
    nodes: snap.stages.flatMap((n) => n.nodes),
    issues: { 'Acme/app#6': { ...issue(6), contextComplete: true } },
    prs: [],
    maps: {},
    at,
    complete: true,
    error: null,
  });
  expect(read.offMap?.unreadLabels).toEqual([]);
  expect(count(header(withWork(snap, read), progress), 'Tickets not placed')).toBe('0');
});

it('the PR count waits for its own read: a future or never-read work time shows pending', () => {
  const later = { ...work(sections), at: '2026-10-27T00:00:00.000Z' };
  expect(count(header(withWork(snap, later), tickets), 'PRs not placed')).toBe('—');
  expect(count(header(withWork(snap, { ...later, at: '' }), tickets), 'PRs not placed')).toBe('—');
});

it('the header shows tickets, PRs and files not placed, each apart, and never the plan-unit count', () => {
  const s = { ...withWork(snap, work(sections)), unmapped: { ...snap.unmapped, count: 139 } };
  const html = header(s, tickets);
  expect(count(html, 'Tickets not placed')).toBe('1');
  expect(count(html, 'PRs not placed')).toBe('2');
  expect(count(html, 'Files not placed')).toBe('—');
  expect(html).not.toContain('>Not placed<');
  expect(html).not.toContain('139');
  const list = header(s, tickets, true);
  expect(list).toContain('Acme/app#5');
  expect(list).toContain('Acme/app#11');
  expect(list).toContain('Acme/app#21');
  // A ticket census that is not complete shows pending, not a count.
  expect(count(header(s, pendingTicketProgress()), 'Tickets not placed')).toBe('—');
});

it('a map without the setting keeps one Not placed figure: plan units plus open PRs', () => {
  const s = { ...withWork(snap, work(base)), unmapped: { ...snap.unmapped, count: 139 } };
  const html = header(s, tickets);
  expect(count(html, 'Not placed')).toBe('140');
  expect(html).not.toContain('Tickets not placed');
  expect(html).toContain('Map gaps');
});

it('the screen refuses a snapshot whose off-map lists are malformed', () => {
  const s = withWork(snap, work(sections));
  const json = JSON.parse(JSON.stringify(s)) as Snapshot;
  expect(currentSnapshot(json)).not.toBeNull();
  const first = json.work!.offMap!.prs[0]!;
  for (const offMap of [
    'none',
    { prs: [null], unreadLabels: [] },
    { prs: [{ ...first, url: 7 }], unreadLabels: [] },
    { prs: [{ ...first, state: 'CLOSED' }], unreadLabels: [] },
    { prs: [first] },
    { prs: [first], unreadLabels: [5] },
  ])
    expect(currentSnapshot({ ...json, work: { ...json.work!, offMap } })).toBeNull();
});
