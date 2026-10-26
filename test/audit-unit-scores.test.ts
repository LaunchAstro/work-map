import { describe, expect, it } from 'vitest';
import {
  asideWords,
  buildTicketProgress,
  currentTicketProgress,
  type TicketProgress,
} from '../src/core/ticket-progress.ts';
import type { WorkIssue } from '../src/core/work.ts';
import { auditBaseline, type UnitScores } from '../src/core/unit-scores.ts';
import type { Project } from '../src/readers/project.ts';

// #194: a build unit still open on GitHub, and every ticket absorbed into it, earn the unit's
// audited code score, so Progress shows how far along the build is without closing anything.
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
    specLabels: [],
    specPattern: '^Spec',
  },
  progress: {
    basis: 'ticket-count',
    repositories: {},
    issues: {
      'Example/plan#1': 'build',
      'Example/plan#2': 'build',
      'Example/plan#3': 'build',
      'Example/app#4': 'build',
      'Example/app#5': 'build',
      'Example/app#6': 'build',
    },
    unitAudit: { file: 'docs/completion.json', unitPattern: '^(U\\d+):' },
  },
};
const issue = (key: string, patch: Partial<WorkIssue> = {}): WorkIssue => ({
  key,
  title: 'Task',
  body: '',
  url: `https://github.com/${key.replace('#', '/issues/')}`,
  state: 'OPEN',
  stateReason: null,
  parent: null,
  labels: [],
  blockedBy: [],
  contextComplete: true,
  ...patch,
});
const issues = [
  issue('Example/plan#1', { title: 'U00: The first slice' }),
  issue('Example/plan#2', {
    state: 'CLOSED',
    stateReason: 'NOT_PLANNED',
    absorbedInto: 'Example/plan#1',
  }),
  issue('Example/plan#3', {
    state: 'CLOSED',
    stateReason: 'NOT_PLANNED',
    absorbedInto: 'Example/plan#1',
  }),
  issue('Example/app#4', { state: 'CLOSED', stateReason: 'COMPLETED' }),
  issue('Example/app#5', { title: 'New engine cut' }),
  issue('Example/app#6', { title: 'U09: not in the audit' }),
];
const build = (scores?: UnitScores, p: Project = project) =>
  buildTicketProgress({
    project: p,
    plan: { units: {}, tickets: {}, unitIssues: {} },
    nodes: [{ id: 'build', units: [] }],
    maps: {},
    issues: Object.fromEntries(issues.map((i) => [i.key, i])),
    at: '2026-10-18T00:00:00Z',
    complete: true,
    error: null,
    ...(scores ? { unitScores: scores } : {}),
  })!;
// Three days over U00's three tickets: each weighs 1, as does a loose ticket, so the counts read as before.
const scores: UnitScores = {
  asAt: '13 October 2026',
  units: { U00: auditBaseline({ days: 3, code: 0.9, live: 'no' }, '13 October 2026') },
};

describe('an open build unit and its absorbed tickets earn the unit audit score (#194)', () => {
  it('credits the open unit ticket and each ticket absorbed into it, nothing else', () => {
    const p = build(scores);
    const g = p.byNode['build']!;
    expect(g).toMatchObject({ completed: 1, total: 6, absorbed: 2 });
    expect(g.audited).toBeCloseTo(2.7);
    expect(g.pct).toBeCloseTo(((1 + 2.7) / 6) * 100);
    expect(p.totals.pct).toBe(g.pct);
    const share = (key: string) => g.tickets.find((t) => t.key === key)!.share;
    const u00 = { unit: 'U00', weight: 1, built: 0.9, live: 0, by: 'audit', at: '13 October 2026' };
    expect(share('Example/plan#1')).toEqual(u00);
    expect(share('Example/plan#3')).toEqual(u00);
    expect(share('Example/app#4')).toMatchObject({ unit: null, built: 0 });
    expect(share('Example/app#5')).toMatchObject({ unit: null, built: 0 });
    expect(share('Example/app#6')).toMatchObject({ unit: 'U09', built: 0, by: null });
  });
  it('counts by tickets alone without scores or without the setting', () => {
    const { unitAudit: _, ...rest } = project.progress as Extract<
      Project['progress'],
      { basis: 'ticket-count' }
    >;
    for (const p of [build(), build(scores, { ...project, progress: rest })]) {
      expect(p.byNode['build']).toMatchObject({ completed: 1, total: 6, audited: 0 });
      expect(p.byNode['build']!.pct).toBeCloseTo(100 / 6);
    }
  });
  it('a closed completed unit counts once, whatever its score', () => {
    const closed = [
      issue('Example/plan#1', {
        title: 'U00: The first slice',
        state: 'CLOSED',
        stateReason: 'COMPLETED',
      }),
      ...issues.slice(1),
    ];
    const p = buildTicketProgress({
      project,
      plan: { units: {}, tickets: {}, unitIssues: {} },
      nodes: [{ id: 'build', units: [] }],
      maps: {},
      issues: Object.fromEntries(closed.map((i) => [i.key, i])),
      at: '2026-10-18T00:00:00Z',
      complete: true,
      error: null,
      unitScores: scores,
    })!;
    expect(p.byNode['build']).toMatchObject({ completed: 4, total: 6, audited: 0 });
  });
  it('the hover says how much the audit adds', () => {
    expect(asideWords(build(scores).byNode['build'])).toContain('2.7 by audit');
    expect(asideWords(build().byNode['build'])).not.toContain('audit');
  });
  it('the browser accepts the stored census and refuses an altered credit', () => {
    const stored = JSON.parse(JSON.stringify(build(scores))) as TicketProgress;
    expect(currentTicketProgress(stored, ['build'])).not.toBeNull();
    const more = structuredClone(stored) as { byNode: Record<string, { audited: number }> };
    more.byNode['build']!.audited = 4;
    expect(currentTicketProgress(more, ['build'])).toBeNull();
    const done = structuredClone(stored) as unknown as {
      byNode: Record<string, { tickets: { key: string; audit?: unknown }[] }>;
    };
    done.byNode['build']!.tickets.find((t) => t.key === 'Example/app#4')!.audit = {
      unit: 'U00',
      code: 0.9,
      asAt: '13 October 2026',
    };
    expect(currentTicketProgress(done, ['build'])).toBeNull();
  });
});
