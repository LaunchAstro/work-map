// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Audit, Flow } from '../src/core/plan.ts';
import { checkTables, parseAsAt, parseBuildUnits } from '../src/core/plan.ts';
import { idMatcher, refsFor, type PrInput } from '../src/core/refs.ts';
import { buildSnapshot } from '../src/core/snapshot.ts';

const fx = (name: string): string =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const plan = parseBuildUnits(fx('build-units.md'));
const audit = JSON.parse(fx('audit.json')) as Audit;
const flow = JSON.parse(fx('flow.json')) as Flow;
const matcher = idMatcher([...Object.keys(plan.tickets), ...Object.keys(plan.units)]);

it('retains explicit sections awaiting scope while omitting non-section diagram annotations', () => {
  const pendingFlow: Flow = {
    ...flow,
    nodes: [
      ...flow.nodes,
      {
        id: 'pending',
        title: 'Pending scope',
        repo: '',
        text: 'Not yet audited',
        stage: 1,
        row: 2,
        units: [],
      },
      { id: 'annotation', title: 'Annotation', repo: '', text: '', stage: 1, row: 3 },
    ],
  };
  const result = buildSnapshot({
    audit,
    flow: pendingFlow,
    plan,
    generatedAt: '2026-10-15T04:00:00Z',
  });
  const nodes = result.stages.flatMap((stage) => stage.nodes);
  expect(nodes.find((node) => node.id === 'pending')?.units).toEqual([]);
  expect(nodes.some((node) => node.id === 'annotation')).toBe(false);
});

let n = 100;
const pr = (over: Partial<PrInput>): PrInput => ({
  number: n++,
  title: 'chore: something',
  body: '',
  url: 'https://github.com/example-org/example-app/pull/1',
  mergedAt: '2026-10-13T00:00:00Z',
  updatedAt: '2026-10-13T00:00:00Z',
  headRefName: 'branch',
  labels: [],
  ...over,
});

describe('the plan table', () => {
  it('reads only the unit rows under "Units by wave", with notes stripped from ticket ids', () => {
    expect(Object.keys(plan.units)).toEqual(['U01', 'U02', 'U03', 'U04']);
    expect(plan.units['U01']?.tickets).toEqual(['S0-1', 'S0-2', 'S0-6']);
    expect(plan.units['U03']?.tickets).toEqual(['MP-4-12', 'C71-D']);
    expect(plan.tickets['X-1']).toBeUndefined();
    expect(plan.tickets['C99']).toBeUndefined();
    expect(plan.unitIssues).toEqual({ '671': 'U01' });
  });

  it('refuses a ticket placed in two units', () => {
    const md = '\n## Units by wave\n| U01 | a | b | C1 | d | 1 |\n| U02 | a | b | C1 | d | 1 |\n';
    expect(() => parseBuildUnits(md)).toThrow('C1 is in two units');
  });

  it('checks every unit sits in exactly one box, as render.mjs does', () => {
    const twice: Flow = {
      ...flow,
      nodes: [
        ...flow.nodes,
        { id: 'dup', title: '', repo: '', text: '', stage: 1, row: 2, units: ['U01'] },
      ],
    };
    expect(() => checkTables(audit, twice, plan)).toThrow('U01 is in two boxes');
    const none: Flow = { ...flow, nodes: flow.nodes.filter((x) => x.id !== 'fix') };
    expect(() => checkTables(audit, none, plan)).toThrow('U04 is in no box');
  });

  it('reads the audit time in AEST, and takes the end of the day when no time is given', () => {
    expect(parseAsAt('13 October 2026, about 8:45 pm AEST')).toEqual({
      at: '2026-10-13T10:45:00.000Z',
      exact: true,
    });
    expect(parseAsAt('13 October 2026')).toEqual({ at: '2026-10-13T13:59:59.999Z', exact: false });
    expect(() => parseAsAt('last Tuesday')).toThrow('cannot read the audit date');
  });
});

describe('mapping a pull request, without guessing', () => {
  const refs = (p: PrInput, backfill = {}): ReturnType<typeof refsFor> =>
    refsFor(p, plan, matcher, backfill);

  it('takes a ticket or unit named in the title or branch', () => {
    expect(refs(pr({ title: 'feat(site): the About page (C80)' })).links).toEqual([
      { unit: 'U04', ticket: 'C80', via: 'title', complete: false },
    ]);
    expect(refs(pr({ headRefName: 'feat/u02-x', title: 'x U02' })).links).toEqual([
      { unit: 'U02', ticket: null, via: 'title', complete: false },
    ]);
  });

  it('never matches inside a longer id', () => {
    expect(refs(pr({ title: 'feat(chat): part 3 (C71-D-CHAIN-3)' })).links).toEqual([]);
    expect(refs(pr({ title: 'C800 and MP-1-70' })).links).toEqual([]);
  });

  it('takes a declared line over the title, and reads words around the ids', () => {
    const r = refs(
      pr({
        title: 'C80 in the title',
        body: 'What changed\n\nTicket: S0-1, the staging alerts\nUnit: U02',
      }),
    );
    expect(r.links).toEqual([
      { unit: 'U01', ticket: 'S0-1', via: 'declared', complete: false },
      { unit: 'U02', ticket: null, via: 'declared', complete: false },
    ]);
  });

  it('never matches across an underscore', () => {
    expect(refs(pr({ title: 'C80_CHAIN_3 and NOT_C80' })).links).toEqual([]);
  });

  it('reads only the leading ID list of a declaration', () => {
    expect(refs(pr({ body: 'Ticket: C80, regression coverage for C81' })).links).toEqual([
      { unit: 'U04', ticket: 'C80', via: 'declared', complete: false },
    ]);
    const none = refs(pr({ body: 'Ticket: none, fixed a C80 test flake' }));
    expect([none.outside, none.links]).toEqual([true, []]);
  });

  it('reads an ID in brackets or before a colon', () => {
    for (const body of ['Ticket: (S0-1)', 'Ticket: [S0-1]', 'Ticket: S0-1: the alerts'])
      expect(refs(pr({ title: 'C80', body })).links).toEqual([
        { unit: 'U01', ticket: 'S0-1', via: 'declared', complete: false },
      ]);
    expect(
      refs(pr({ body: 'https://github.com/example-org/example-app-roadmap/issues/671.' })).links,
    ).toHaveLength(1);
  });

  it('places nothing when a body declares both none and a ticket', () => {
    const r = refs(pr({ title: 'C80', body: 'Ticket: none\nTicket: C80' }));
    expect([r.outside, r.links, r.notes]).toEqual([
      false,
      [],
      ['declares both none and C80, so it is not placed'],
    ]);
  });

  it('ignores a "Unit:" line that names no ID, and keeps the title', () => {
    expect(refs(pr({ title: 'C80 fix', body: 'Units: 3 files changed' })).links).toEqual([
      { unit: 'U04', ticket: 'C80', via: 'title', complete: false },
    ]);
  });

  it('notes a declared id the plan does not know, and classes "Ticket: none" as outside the plan', () => {
    expect(refs(pr({ body: 'Ticket: Q42' })).notes).toEqual([
      'declares Q42, which is not a plan ticket or unit',
    ]);
    const r = refs(pr({ body: 'Ticket: none (CI)' }));
    expect(r.outside).toBe(true);
    expect(r.links).toEqual([]);
  });

  it('counts an exact roadmap reference wrapped in formatting or closing punctuation', () => {
    for (const body of [
      '**example-org/example-app-roadmap#671**',
      '_example-org/example-app-roadmap#671_',
      '(example-org/example-app-roadmap#671)',
      '(See https://github.com/example-org/example-app-roadmap/issues/671.)',
      'https://github.com/example-org/example-app-roadmap/issues/671.',
    ])
      expect(refs(pr({ body })).links).toHaveLength(1);
  });

  it('counts only an exact roadmap reference', () => {
    expect(
      refs(pr({ body: 'see https://github.com/example-org/example-app-roadmap/issues/671' })).links,
    ).toEqual([{ unit: 'U01', ticket: null, via: 'roadmap', complete: false }]);
    for (const body of [
      'Notexample-org/example-app-roadmap#671',
      'https://example.invalid/example-org/example-app-roadmap/issues/671',
      'example-org/example-app-roadmap-old#671',
      'https://github.com/example-org/example-app-roadmap/issues/671.5',
      'https://github.com/example-org/example-app-roadmap/issues/671/x',
      'https://github.com/example-org/example-app-roadmap/issues/671/-extra',
      'https://github.com/example-org/example-app-roadmap/issues/671//extra',
      'https://github.com/example-org/example-app-roadmap/issues/671/%78',
      'example-org/example-app-roadmap#671-x',
      'example-org/example-app-roadmap#671_extra',
      'https://github.com/example-org/example-app-roadmap/issues/671_extra',
      'https://github.com/example-org/example-app-roadmap/issues/671?foo=bar',
    ])
      expect(refs(pr({ body })).links).toEqual([]);
  });

  it('counts a roadmap unit issue link, and notes one the plan does not cite', () => {
    const r = refs(
      pr({
        body: 'Part of example-org/example-app-roadmap#671 and example-org/example-app-roadmap#871',
      }),
    );
    expect(r.links).toEqual([{ unit: 'U01', ticket: null, via: 'roadmap', complete: false }]);
    expect(r.notes).toEqual(['links roadmap issue #871, which is not a unit issue the plan cites']);
  });

  it('shows body-only mentions as candidates and never counts them', () => {
    const r = refs(pr({ body: 'Fixes a flake in the MP-1-7 test.' }));
    expect(r.links).toEqual([]);
    expect(r.candidates).toEqual([{ unit: 'U02', ticket: 'MP-1-7' }]);
  });

  it('lets an approved backfill entry replace everything else', () => {
    const p = pr({ title: 'C80', body: 'Ticket: S0-1' });
    expect(refs(p, { [String(p.number)]: { ids: ['MP-1-7'], approvedBy: 'owner' } }).links).toEqual(
      [{ unit: 'U02', ticket: 'MP-1-7', via: 'backfill', complete: false }],
    );
  });
});

describe('the snapshot', () => {
  const prs = [
    pr({ number: 1, title: 'S0-1 alerts', labels: [], mergedAt: '2026-10-12T00:00:00Z' }),
    pr({
      number: 2,
      title: 'MP-1-7 harness',
      labels: ['unreviewed'],
      mergedAt: '2026-10-12T00:00:00Z',
    }),
    pr({
      number: 3,
      title: 'C71-D chat',
      labels: ['unreviewed', 'ci-next'],
      mergedAt: '2026-10-13T11:00:00Z',
    }),
    pr({
      number: 4,
      title: 'ci: shards',
      body: 'touches MP-4-12 tests',
      labels: ['ci-next'],
      mergedAt: '2026-10-13T12:00:00Z',
    }),
    pr({ number: 5, title: 'deps', body: 'Ticket: none', mergedAt: '2026-10-13T12:00:00Z' }),
  ];
  const snap = buildSnapshot({
    audit,
    flow,
    plan,
    prs,
    switchOns: [
      {
        number: 50,
        title: 'Switch-on: email',
        url: 'u',
        state: 'CLOSED',
        closedAt: '2026-10-13T12:00:00Z',
        updatedAt: '2026-10-13T12:00:00Z',
      },
      {
        number: 51,
        title: 'Switch-on: runner',
        url: 'u',
        state: 'OPEN',
        closedAt: null,
        updatedAt: '2026-10-13T12:00:00Z',
      },
    ],
    mapping: {
      switchOns: {
        '50': { units: ['U02'], approvedBy: 'owner, 14 Oct' },
        '51': { units: ['U03'] },
      },
    },
    generatedAt: '2026-10-14T00:00:00Z',
  });
  const found = snap.stages[0]?.nodes[0];

  it('weights coded and live by estimate-days, as render.mjs does', () => {
    // U01 12 days at 1 (live yes), U02 11 days at 0.5 (partly): coded (12 + 5.5) / 23, live (12 + 2.75) / 23.
    expect(found?.coded.pct).toBeCloseTo(76.09, 2);
    expect(found?.on.pct).toBeCloseTo(64.13, 2);
    expect(found?.status).toBe('in-progress');
    expect(snap.stages[1]?.nodes.find((x) => x.id === 'fix')?.status).toBe('planned');
  });

  it('compares times as times: a PR merged at the audit minute is not after it', () => {
    const at = buildSnapshot({
      audit,
      flow,
      plan,
      prs: [pr({ number: 90, title: 'C80', mergedAt: '2026-10-13T10:45:00Z' })],
      generatedAt: 'now',
    });
    expect(at.prs['90']?.sinceAudit).toBe(false);
  });

  it('shows PRs merged since the audit beside the audit, without moving its percent', () => {
    expect(snap.sources.audit.at).toBe('2026-10-13T10:45:00.000Z');
    expect(snap.stages[1]?.sinceAudit).toEqual({ merged: 1, prs: [3] });
    expect(snap.frontier).toEqual([
      { id: 'U03', key: 'U03', title: 'Task page', type: 'unit', mergedSinceAudit: 1 },
    ]);
    expect(snap.stages[1]?.nodes[0]?.coded.pct).toBe(50);
  });

  it('lists unmapped PRs and unapproved switch-ons in the fog, and never places them', () => {
    expect(snap.unmapped).toEqual({ count: 1, prs: [4], switchOns: [51] });
    expect(snap.totals.prs).toEqual({
      merged: 5,
      mapped: 3,
      outside: 1,
      unmapped: 1,
      sinceAudit: 3,
    });
    expect(snap.prs['4']?.candidates).toEqual([{ unit: 'U03', ticket: 'MP-4-12' }]);
    expect(snap.fog.map((f) => f.id)).toEqual(['unmapped-prs', 'unmapped-switch-ons']);
    expect(snap.sources.mapping).toMatchObject({ approvedSwitchOns: 1, pendingSwitchOns: 1 });
  });

  it('counts a closed switch-on only through an approved mapping', () => {
    expect(found?.on).toMatchObject({ switchOnsClosed: 1, switchOnsOpen: 0 });
    expect(snap.stages[1]?.on).toMatchObject({ switchOnsClosed: 0, switchOnsOpen: 0 });
  });

  it('drills down stage, box, unit, ticket, PR', () => {
    const u01 = found?.units[0];
    expect(u01?.tickets).toEqual([
      { id: 'S0-1', prs: [1] },
      { id: 'S0-2', prs: [] },
      { id: 'S0-6', prs: [] },
    ]);
    expect(snap.stages[1]?.nodes[0]?.units[0]?.candidatePrs).toEqual([4]);
  });

  it('matches the rendered diagram on the example roadmap tables', () => {
    const root = new URL('fixtures/', import.meta.url);
    const real = (p: string): string => readFileSync(new URL(p, root), 'utf8');
    const s = buildSnapshot({
      audit: JSON.parse(real('demo-completion.json')) as Audit,
      flow: JSON.parse(real('demo-flow.json')) as Flow,
      plan: parseBuildUnits(real('demo-units.md')),
      generatedAt: 'now',
    });
    const data = JSON.parse(real('demo-rendered.json')) as {
      overall: { coded: number; live: number; low: number; high: number; stages: number[] };
      nodes: { id: string; percent?: number; live?: number }[];
    };
    expect(Math.round(s.totals.coded.pct)).toBe(data.overall.coded);
    expect(Math.round(s.totals.on.pct)).toBe(data.overall.live);
    expect(s.stages.map((st) => Math.round(st.coded.pct))).toEqual(data.overall.stages);
    for (const node of s.stages.flatMap((st) => st.nodes)) {
      const drawn = data.nodes.find((x) => x.id === node.id);
      expect([node.id, Math.round(node.coded.pct), Math.round(node.on.pct)]).toEqual([
        node.id,
        drawn?.percent,
        drawn?.live,
      ]);
    }
  });
});
