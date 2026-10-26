// Next up per section (#231): open tickets in build order with state, labels
// and open blockers, in the section's pop-up.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildWork, type WorkIssue } from '../src/core/work.ts';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import { buildSectionBrief } from '../src/web/sectionBrief.ts';
import { withWork } from '../src/core/work.ts';
import type { Project } from '../src/readers/project.ts';
const fx = (s: string): string => readFileSync(new URL(`fixtures/${s}`, import.meta.url), 'utf8');
const plan = parseBuildUnits(fx('build-units.md'));
const snap = buildSnapshot({
  audit: JSON.parse(fx('audit.json')) as Audit,
  flow: JSON.parse(fx('flow.json')) as Flow,
  plan,
  generatedAt: '2026-10-14T01:00:00Z',
});
const project: Project = {
  version: 1,
  id: 'other',
  title: 'Other project',
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
    ideaLabels: ['idea'],
    ideaPattern: '^Idea:',
    specLabels: ['spec'],
    readyLabel: 'ready-for-agent',
    ticketLabels: ['roadmap:task'],
    specPattern: '^Spec:',
  },
  dependencies: [{ from: 'tasks', to: 'fix', label: 'waits for tasks' }],
};
const issue = (key: string, body: string, patch: Partial<WorkIssue> = {}): WorkIssue => ({
  key,
  title: key,
  body,
  url: `https://github.com/${key.replace('#', '/issues/')}`,
  state: 'OPEN',
  parent: null,
  labels: [],
  blockedBy: [],
  contextComplete: true,
  ...patch,
});
const work = (
  issues: Record<string, WorkIssue>,
  prs: Parameters<typeof buildWork>[0]['prs'] = [],
  extra: Partial<Parameters<typeof buildWork>[0]> = {},
): ReturnType<typeof buildWork> =>
  buildWork({
    project,
    plan,
    nodes: snap.stages.flatMap((s) => s.nodes),
    issues,
    prs,
    maps: { 'Acme/plan#1': 'tasks' },
    at: 'now',
    complete: true,
    error: null,
    ...extra,
  });

const tasks = snap.stages.flatMap((s) => s.nodes).find((n) => n.id === 'tasks')!;
const nextUp = (w: ReturnType<typeof buildWork>) =>
  buildSectionBrief(withWork(snap, w), tasks).groups.find((g) => g.id === 'next-up');
const ready = (n: number, patch: Partial<WorkIssue> = {}) =>
  issue(`Acme/app#${n}`, 'Section: tasks', { labels: ['ready-for-agent'], ...patch });

it('ticket entries carry state, labels and whether an open PR names them', () => {
  const w = work({ 'Acme/app#5': ready(5), 'Acme/app#6': ready(6, { state: 'CLOSED' }) }, [
    {
      key: 'Acme/app#50',
      number: 50,
      title: 'Builds five',
      body: 'Closes #5\nSection: tasks',
      url: 'https://github.com/Acme/app/pull/50',
      headRefName: 'five',
      issueKeys: ['Acme/app#5'],
    },
  ]);
  expect(w.byNode['tasks']?.planning.tickets).toEqual([
    expect.objectContaining({
      key: 'Acme/app#5',
      state: 'OPEN',
      labels: ['ready-for-agent'],
      inPr: true,
    }),
    expect.objectContaining({ key: 'Acme/app#6', state: 'CLOSED', inPr: false }),
  ]);
});

it('lists open tickets: in a PR first, then unblocked, then blocked, each by number', () => {
  const blocker = issue('Acme/app#2', 'Section: fix');
  const w = work(
    {
      'Acme/app#2': blocker,
      'Acme/app#9': ready(9),
      'Acme/app#7': ready(7, {
        blockedBy: [{ key: 'Acme/app#2', title: 'Acme/app#2', url: blocker.url, state: 'OPEN' }],
      }),
      'Acme/app#8': ready(8, { labels: ['ready-for-agent', 'later'] }),
      'Acme/app#4': ready(4, { state: 'CLOSED' }),
      'Acme/app#12': ready(12),
    },
    [
      {
        key: 'Acme/app#60',
        number: 60,
        title: 'Builds twelve',
        body: 'Closes #12\nSection: tasks',
        url: 'https://github.com/Acme/app/pull/60',
        headRefName: 'twelve',
        issueKeys: ['Acme/app#12'],
      },
    ],
  );
  const group = nextUp(w)!;
  expect(group.title).toBe('Next up');
  expect(group.rows.map((r) => r.key)).toEqual([
    'Acme/app#12',
    'Acme/app#8',
    'Acme/app#9',
    'Acme/app#7',
  ]);
  expect(group.rows[0]!.details).toContain('In a pull request');
  expect(group.rows[1]!.details).toEqual(['Ready', 'Labels: ready-for-agent, later']);
  expect(group.rows[3]!.details).toContain('Blocked by Acme/app#2');
});

it('says so when a section has no open tickets', () => {
  const group = nextUp(work({ 'Acme/app#4': ready(4, { state: 'CLOSED' }) }))!;
  expect(group.rows).toEqual([
    { key: 'none', title: 'No open tickets in this section', url: null, details: [], links: [] },
  ]);
});
