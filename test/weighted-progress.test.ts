import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildTicketProgress,
  currentTicketProgress,
  type TicketProgress,
} from '../src/core/ticket-progress.ts';
import {
  auditBaseline,
  effectiveScore,
  type UnitScoreEntry,
  type UnitScores,
} from '../src/core/unit-scores.ts';
import type { WorkIssue } from '../src/core/work.ts';
import type { Project } from '../src/readers/project.ts';
import { readUnitScores } from '../src/readers/unit-audit.ts';

// #204: Progress weighs each build unit by its audit days, and carries built and live.
const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `Example/app#${n}`);
const project = (unitAudit = true): Project => ({
  version: 1,
  id: 'synthetic',
  title: 'Synthetic',
  roadmapRepo: 'Example/plan',
  productRepo: 'Example/app',
  repos: ['Example/app'],
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
    repositories: { 'Example/app': 'build' },
    bugLabels: ['bug'],
    ...(unitAudit ? { unitAudit: { file: 'audit.json', unitPattern: '^(U\\d+):' } } : {}),
  },
});
const issue = (n: number, patch: Partial<WorkIssue> = {}): WorkIssue => ({
  key: `Example/app#${n}`,
  title: 'Task',
  body: '',
  url: `https://github.com/Example/app/issues/${n}`,
  state: 'OPEN',
  stateReason: null,
  parent: null,
  labels: [],
  blockedBy: [],
  contextComplete: true,
  ...patch,
});
const closed = { state: 'CLOSED', stateReason: 'COMPLETED', closedAt: '2026-10-16T02:00:00Z' };
const aside = (parent: number) => ({
  state: 'CLOSED',
  stateReason: 'NOT_PLANNED',
  absorbedInto: `Example/app#${parent}`,
});
// U01 (8 days): its open unit ticket and three absorbed into it. U02 (6 days): one ticket, closed.
// Loose: two open, one closed. U09 is not in the audit. A bug is never weighed.
const issues: WorkIssue[] = [
  issue(1, { title: 'U01: Design kit' }),
  issue(2, aside(1)),
  issue(3, aside(1)),
  issue(4, aside(1)),
  issue(5, { title: 'U02: Sidebar', ...closed }),
  issue(6),
  issue(7),
  issue(8, closed),
  issue(9, { title: 'U09: Not audited' }),
  issue(10, { labels: ['bug'] }),
];
const asAt = '13 October 2026, about 8:45 pm AEST';
const audit: UnitScores = {
  asAt,
  units: {
    U01: auditBaseline({ days: 8, code: 0.25, live: 'partly' }, asAt),
    U02: auditBaseline({ days: 6, code: 1, live: 'yes' }, asAt),
  },
};
const build = (scores: UnitScores | undefined = audit, p: Project = project()): TicketProgress =>
  buildTicketProgress({
    project: p,
    plan: { units: {}, tickets: {}, unitIssues: {} },
    nodes: [{ id: 'build', units: [] }],
    maps: {},
    issues: Object.fromEntries(issues.map((i) => [i.key, i])),
    at: '2026-10-18T00:00:00Z',
    complete: true,
    error: null,
    unitScores: scores,
  })!;

describe('progress weighted by unit size (#204)', () => {
  it('weighs units by audit days and loose tickets by the average days per unit ticket', () => {
    const g = build().byNode['build']!;
    // Average = (8 + 6) / 5 unit tickets = 2.8. Weights: U01 4 × 2, U02 6, loose 3 × 2.8, U09 2.8.
    expect(g.weight).toBeCloseTo(25.2);
    // Built: U01 8 × 0.25, U02 closed 6, closed loose 2.8.
    expect(g.built).toBeCloseTo(10.8);
    expect(g.pct).toBeCloseTo((10.8 / 25.2) * 100);
    // By count it would read (2 done + 4 × 0.25) / 9.
    expect(g.pct).not.toBeCloseTo((3 / 9) * 100);
    expect(g.fromAudit).toBeCloseTo(2);
    expect(g.fromLuna).toBe(0);
    expect(build().totals.pct).toBe(g.pct);
  });
  it('reads live from the audit: partly is half the built share, yes all of it; live never passes built', () => {
    const g = build().byNode['build']!;
    expect(g.live).toBeCloseTo(8 * 0.125 + 6);
    expect(g.livePct).toBeCloseTo((7 / 25.2) * 100);
    for (const t of g.tickets) if (t.share) expect(t.share.live).toBeLessThanOrEqual(t.share.built);
    expect(g.livePct!).toBeLessThanOrEqual(g.pct!);
  });
  it('a closed ticket counts fully built whatever its unit says', () => {
    const scores: UnitScores = {
      asAt,
      units: { ...audit.units, U02: auditBaseline({ days: 6, code: 0.4, live: 'no' }, asAt) },
    };
    expect(build(scores).byNode['build']!.built).toBeCloseTo(10.8);
  });
  it('a map with no unit audit shows live unknown, not 0, and counts by tickets', () => {
    const g = build(undefined, project(false)).byNode['build']!;
    expect(g.live).toBeNull();
    expect(g.livePct).toBeNull();
    expect(g.tickets.some((t) => t.share)).toBe(false);
    expect(g.pct).toBeCloseTo((2 / 9) * 100);
  });
  it('keeps each ticket close time and leaves bugs unweighed', () => {
    const p = build();
    expect(p.byNode['build']!.tickets.find((t) => t.key === keys[7])!.closedAt).toBe(
      '2026-10-16T02:00:00Z',
    );
    expect(p.bugs!.byNode['build']!.tickets[0]!.share).toBeUndefined();
  });
});

const check = (patch: Partial<UnitScoreEntry>): UnitScoreEntry => ({
  built: 0.75,
  live: 0.5,
  confidence: 0.8,
  reason: 'Kit merged',
  at: '2026-10-17T00:00:00Z',
  ...patch,
});
describe('the unit score store (#204)', () => {
  const base = auditBaseline({ days: 8, code: 0.25, live: 'partly' }, asAt);
  it('a newer, confident check that does not drop replaces the audit', () => {
    expect(effectiveScore(base, [check({})])).toMatchObject({
      built: 0.75,
      live: 0.5,
      by: 'luna',
      reason: 'Kit merged',
      days: 8,
    });
  });
  it('refuses a check under the floor, an older one, or a drop without a reason', () => {
    for (const entry of [
      check({ confidence: 0.59 }),
      check({ at: '2026-10-12T00:00:00Z' }),
      check({ built: 0.2, live: 0.1 }),
    ])
      expect(effectiveScore(base, [entry])).toEqual(base);
  });
  it('takes a drop that says why, and later checks build on the one that stands', () => {
    const after = effectiveScore(base, [
      check({ at: '2026-10-18T00:00:00Z', built: 0.6, live: 0.3, drop: 'Reverted #12' }),
      check({}),
    ]);
    expect(after).toMatchObject({ built: 0.6, live: 0.3 });
    expect(after.reason).toContain('Reverted #12');
  });
  it('a deep sync entry stands as deep, keeps the unit days, and may lower with a reason (#216)', () => {
    const high = auditBaseline({ days: 8, code: 0.5, live: 'partly' }, '13 October 2026');
    expect(
      effectiveScore(high, [check({ built: 0.2, live: 0, by: 'deep', drop: 'Read in full' })]),
    ).toMatchObject({ days: 8, built: 0.2, live: 0, by: 'deep' });
  });
  it('moves the section through the reader: store checks over the audit file', () => {
    const root = mkdtempSync(join(tmpdir(), 'unit-scores-'));
    writeFileSync(
      join(root, 'audit.json'),
      JSON.stringify({
        asAt,
        units: {
          U01: { days: 8, code: 0.25, live: 'partly' },
          U02: { days: 6, code: 1, live: 'yes' },
        },
      }),
    );
    const store = join(root, 'unit-scores.json');
    writeFileSync(
      store,
      JSON.stringify({ schema: 'work-map-unit-scores/1', units: { U01: [check({})] } }),
    );
    const scores = readUnitScores(root, 'audit.json', { store })!;
    expect(scores.units['U01']).toMatchObject({ built: 0.75, by: 'luna' });
    const g = build(scores).byNode['build']!;
    expect(g.built).toBeCloseTo(8 * 0.75 + 6 + 2.8);
    expect(g.fromLuna).toBeCloseTo(6);
    expect(g.fromAudit).toBe(0);
    expect(readUnitScores(root, 'audit.json', { store, floor: 0.9 })!.units['U01']!.by).toBe(
      'audit',
    );
    writeFileSync(store, '{"schema":"other"}');
    expect(readUnitScores(root, 'audit.json', { store })!.units['U01']!.by).toBe('audit');
  });
});

const changed = (t: Record<string, unknown>) => (t['share'] as { unit: string }).unit === 'U01';
const strip = (g: Record<string, unknown>) => {
  for (const k of ['weight', 'built', 'live', 'livePct', 'fromAudit', 'fromLuna']) delete g[k];
  for (const t of g['tickets'] as Record<string, unknown>[]) delete t['closedAt'];
};
describe('ticket progress version 3 in the browser and server check (#204)', () => {
  const stored = (): TicketProgress => JSON.parse(JSON.stringify(build())) as TicketProgress;
  type Loose = {
    byNode: Record<string, Record<string, unknown> & { tickets: Record<string, unknown>[] }>;
    totals: Record<string, unknown>;
  };
  it('accepts the stored census as version 3', () => {
    expect(stored().schema).toBe('work-map-ticket-progress/3');
    expect(currentTicketProgress(stored(), ['build'])).not.toBeNull();
  });
  it('refuses an altered weight, live total or unit score', () => {
    const weight = stored() as unknown as Loose;
    (weight.byNode['build']!.tickets[0]!['share'] as { weight: number }).weight = 50;
    expect(currentTicketProgress(weight, ['build'])).toBeNull();
    const live = stored() as unknown as Loose;
    live.byNode['build']!['livePct'] = 90;
    expect(currentTicketProgress(live, ['build'])).toBeNull();
    const split = stored() as unknown as Loose;
    const tickets = split.byNode['build']!.tickets;
    (tickets.find(changed)!['share'] as { built: number }).built = 0.9;
    expect(currentTicketProgress(split, ['build'])).toBeNull();
    const over = stored() as unknown as Loose;
    (over.byNode['build']!.tickets.find(changed)!['share'] as { live: number }).live = 0.3;
    expect(currentTicketProgress(over, ['build'])).toBeNull();
  });
  it('still accepts a version 2 snapshot and reads it as version 3', () => {
    const old = JSON.parse(JSON.stringify(build(undefined, project(false)))) as Record<
      string,
      unknown
    >;
    old['schema'] = 'work-map-ticket-progress/2';
    for (const g of Object.values(old['byNode'] as Record<string, Record<string, unknown>>))
      strip(g);
    strip(old['totals'] as Record<string, unknown>);
    const bugs = old['bugs'] as { byNode: Record<string, Record<string, unknown>>; totals: never };
    for (const g of Object.values(bugs.byNode)) strip(g);
    strip(bugs.totals);
    const read = currentTicketProgress(old, ['build'])!;
    expect(read.schema).toBe('work-map-ticket-progress/3');
    expect(read.byNode['build']!.pct).toBeCloseTo((2 / 9) * 100);
    expect(read.byNode['build']!.live).toBeNull();
    const shared = structuredClone(old) as unknown as Loose;
    shared.byNode['build']!.tickets[0]!['share'] = stored().byNode['build']!.tickets[0]!.share;
    expect(currentTicketProgress(shared, ['build'])).toBeNull();
  });
});
