import { describe, expect, it } from 'vitest';
import {
  buildTicketProgress,
  currentTicketProgress,
  type TicketProgress,
} from '../src/core/ticket-progress.ts';
import { sectionScores, type UnitScore, type UnitScoreEntry } from '../src/core/unit-scores.ts';
import type { WorkIssue } from '../src/core/work.ts';
import type { Project } from '../src/readers/project.ts';

// #215: a map with no build units keeps one score per section, and Progress takes it.
const project: Project = {
  version: 1,
  id: 'synthetic',
  title: 'Synthetic',
  roadmapRepo: 'Example/plan',
  productRepo: 'Example/app',
  repos: ['Example/app', 'Example/site'],
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
    specLabels: [],
    specPattern: '^Spec',
  },
  progress: {
    basis: 'ticket-count',
    repositories: { 'Example/app': 'build', 'Example/site': 'site' },
    bugLabels: ['bug'],
    recheck: { enabled: true, dailyCalls: 20, confidence: 0.6, deepCalls: 40 },
  },
};
const issue = (repo: string, n: number, patch: Partial<WorkIssue> = {}): WorkIssue => ({
  key: `Example/${repo}#${n}`,
  title: 'Task',
  body: '',
  url: `https://github.com/Example/${repo}/issues/${n}`,
  state: 'OPEN',
  stateReason: null,
  parent: null,
  labels: [],
  blockedBy: [],
  contextComplete: true,
  ...patch,
});
const closed = { state: 'CLOSED', stateReason: 'COMPLETED', closedAt: '2026-10-16T02:00:00Z' };
// build: 2 of 5 closed, a bug. site: 1 of 2 closed, no score.
const issues: WorkIssue[] = [
  issue('app', 1, closed),
  issue('app', 2, closed),
  issue('app', 3),
  issue('app', 4),
  issue('app', 5),
  issue('app', 6, { labels: ['bug'] }),
  issue('site', 1, closed),
  issue('site', 2),
];
const entry = (patch: Partial<UnitScoreEntry>): UnitScoreEntry => ({
  built: 0.7,
  live: 0.5,
  confidence: 0.8,
  reason: 'Section read in full',
  at: '2026-10-18T00:00:00Z',
  by: 'deep',
  ...patch,
});
const build = (scores: Readonly<Record<string, UnitScore>> | undefined): TicketProgress =>
  buildTicketProgress({
    project,
    plan: { units: {}, tickets: {}, unitIssues: {} },
    nodes: [
      { id: 'build', units: [] },
      { id: 'site', units: [] },
    ],
    maps: {},
    issues: Object.fromEntries(issues.map((i) => [i.key, i])),
    at: '2026-10-18T00:00:00Z',
    complete: true,
    error: null,
    sectionScores: scores,
  })!;

describe('section scores in the store (#215)', () => {
  it('reads section:<id> entries from nothing, keeps by, and applies the floor and drop rules', () => {
    const scores = sectionScores({ 'section:build': [entry({})], U01: [entry({})] }, [
      'build',
      'site',
    ]);
    expect(Object.keys(scores)).toEqual(['build']);
    expect(scores['build']).toMatchObject({ built: 0.7, live: 0.5, by: 'deep' });
    expect(sectionScores({ 'section:build': [entry({ confidence: 0.5 })] }, ['build'])).toEqual({});
    const later = sectionScores(
      {
        'section:build': [
          entry({}),
          entry({ at: '2026-10-19T00:00:00Z', built: 0.4, live: 0.2, by: 'luna' }),
        ],
      },
      ['build'],
    );
    expect(later['build']).toMatchObject({ built: 0.7, by: 'deep' });
  });
});

describe('Progress from section scores (#215)', () => {
  it('takes the score when it is above the ticket count, with live from the score', () => {
    const g = build(sectionScores({ 'section:build': [entry({})] }, ['build'])).byNode['build']!;
    expect(g.weight).toBe(5);
    expect(g.pct).toBeCloseTo(70);
    expect(g.livePct).toBeCloseTo(50);
    expect(g.fromLuna).toBeCloseTo(1.5);
    for (const t of g.tickets) expect(t.share!.unit).toBe('section:build');
  });
  it('never goes below the ticket count, and live is never above built', () => {
    const g = build(
      sectionScores({ 'section:build': [entry({ built: 0.2, live: 0.2 })] }, ['build']),
    ).byNode['build']!;
    expect(g.pct).toBeCloseTo(40);
    expect(g.livePct).toBeCloseTo(20);
    const high = build(
      sectionScores({ 'section:build': [entry({ built: 0.5, live: 0.5 })] }, ['build']),
    ).byNode['build']!;
    expect(high.pct).toBeCloseTo(50);
    expect(high.livePct).toBeCloseTo(50);
    for (const t of high.tickets) expect(t.share!.live).toBeLessThanOrEqual(t.share!.built);
  });
  it('a section with no score counts tickets and reads live unknown; bugs carry no share', () => {
    const p = build(sectionScores({ 'section:build': [entry({})] }, ['build']));
    expect(p.byNode['site']!.livePct).toBeNull();
    expect(p.byNode['site']!.pct).toBeCloseTo(50);
    expect(p.byNode['site']!.tickets.some((t) => t.share)).toBe(false);
    expect(p.bugs!.byNode['build']!.tickets[0]!.share).toBeUndefined();
    // The header weighs sections by counted tickets: (3.5 + 1) / 7.
    expect(p.totals.pct).toBeCloseTo((4.5 / 7) * 100);
    expect(build(undefined).byNode['build']!.livePct).toBeNull();
  });
  it('the browser and server check accept section shares and refuse tampered ones', () => {
    const p = build(sectionScores({ 'section:build': [entry({})] }, ['build']));
    const round = JSON.parse(JSON.stringify(p));
    expect(currentTicketProgress(round, ['build', 'site'])).not.toBeNull();
    const moved = JSON.parse(JSON.stringify(p));
    for (const g of [moved.byNode.build, moved.totals])
      for (const t of g.tickets) if (t.share) t.share.unit = 'section:site';
    expect(currentTicketProgress(moved, ['build', 'site'])).toBeNull();
    const split = JSON.parse(JSON.stringify(p));
    for (const g of [split.byNode.build, split.totals]) {
      const open = g.tickets.find((t: { key: string }) => t.key === 'Example/app#3');
      open.share.built = 0.1;
    }
    expect(currentTicketProgress(split, ['build', 'site'])).toBeNull();
  });
});
