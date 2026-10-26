// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyEventsState, foldEvents as foldEventsCore, laneBox } from '../src/core/agents.ts';
import { laneNameBox as laneNameCore, sectionOf } from '../src/core/infer.ts';
import { checkTables, parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import type { PrInput } from '../src/core/refs.ts';
import {
  compileSectionMap,
  globToRegExp,
  ownerOf,
  type SectionMapFile,
} from '../src/core/sections.ts';
import { buildSnapshot, mergeStats } from '../src/core/snapshot.ts';

const foldEvents: typeof foldEventsCore = (state, file, text, plan, repo) =>
  foldEventsCore(state, file, text, plan, repo ?? 'example-org/example-app');
const rules = JSON.parse(
  readFileSync(new URL('fixtures/lane-rules.json', import.meta.url), 'utf8'),
) as { pattern: string; box: string }[];
const laneNameBox: typeof laneNameCore = (lane) => laneNameCore(lane, rules, 'LN-');
const fx = (name: string): string =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const plan = parseBuildUnits(fx('build-units.md'));
const audit = JSON.parse(fx('audit.json')) as Audit;
const flow = JSON.parse(fx('flow.json')) as Flow;
const { owner } = checkTables(audit, flow, plan);
const boxes = new Set(flow.nodes.map((n) => n.id));
const map = compileSectionMap({
  repo: 'x',
  shared: ['pnpm-lock.yaml', 'docs/**'],
  boxes: {
    found: ['packages/core/**', 'tests/**/*alert*'],
    tasks: ['packages/core/src/tasks/**', 'apps/web/src/screens/Task*.tsx'],
    fix: [],
  },
});
const pr = (over: Partial<PrInput>): PrInput => ({
  number: 1,
  title: 't',
  body: '',
  url: 'https://github.com/example-org/example-app/pull/1',
  mergedAt: '2026-10-13T12:00:00Z',
  updatedAt: '2026-10-13T12:00:00Z',
  headRefName: 'b',
  labels: [],
  ...over,
});

describe('the section map', () => {
  it('reads globs: ** spans folders, * stays in one', () => {
    expect(globToRegExp('packages/ui/**').test('packages/ui/src/kit/a.tsx')).toBe(true);
    expect(globToRegExp('tests/**/*task*').test('tests/task-page.test.ts')).toBe(true);
    expect(globToRegExp('apps/api/model-*.ts').test('apps/api/sub/model-x.ts')).toBe(false);
  });

  it('gives a file to its most specific glob, marks shared files, and leaves gaps unowned', () => {
    expect(ownerOf(map, 'packages/core/src/tasks/board.ts')).toBe('tasks');
    expect(ownerOf(map, 'packages/core/src/records/a.ts')).toBe('found');
    expect(ownerOf(map, 'docs/x.md')).toBe('shared');
    expect(ownerOf(map, 'apps/cli/main.ts')).toBeNull();
  });

  it('the drafted map names only diagram boxes, and every box', () => {
    const real = JSON.parse(
      readFileSync(new URL('fixtures/demo-sections.json', import.meta.url), 'utf8'),
    ) as SectionMapFile;
    const nodes = (
      JSON.parse(readFileSync(new URL('fixtures/demo-flow.json', import.meta.url), 'utf8')) as Flow
    ).nodes.map((n) => n.id);
    expect(Object.keys(real.boxes).toSorted()).toEqual(nodes.toSorted());
    const m = compileSectionMap(real);
    expect(ownerOf(m, 'packages/core-records/src/tasks/x.ts')).toBe('tasks');
    expect(ownerOf(m, 'packages/core-records/src/site/x.ts')).toBe('sitefix');
    expect(ownerOf(m, '.github/workflows/ci.yml')).toBe('checks');
  });
});

describe('a section line and a lane name', () => {
  it('ignores a Section line naming no box', () => {
    expect(sectionOf('Section: nowhere', boxes)).toBeNull();
  });

  it('maps lane names to boxes', () => {
    expect(laneNameBox('LN-ChatPricedB2')).toBe('chat');
    expect(laneNameBox('LN-OnInvites3')).toBe('people');
    expect(laneNameBox('LN-Rebase3')).toBeNull();
  });

  it('strips no lane prefix unless the project names one', () => {
    const chat = [{ pattern: '^Chat', box: 'chat' }];
    expect(laneNameCore('LN-ChatPriced', chat)).toBeNull();
    expect(laneNameCore('EX-ChatPriced', chat, 'EX-')).toBe('chat');
  });
});

describe('lanes and their box', () => {
  const ev = foldEvents(
    emptyEventsState(),
    'f',
    [
      '2026-10-13T10:00:00Z LN-Kappa BOOTED Section: tasks',
      '2026-10-13T10:01:00Z LN-Kappa PR-OPENED #1562 (part 1)',
      '2026-10-13T10:02:00Z LN-Kappa FIX-PUSHED #1562 head=abc; see #1500 too',
      '2026-10-13T10:03:00Z LN-Kappa NOTE mentions #1999',
      '',
    ].join('\n'),
    plan,
  );
  const kappa = ev.lanes['LN-Kappa'];

  it('records the box a lane names and the PRs it opened or pushed', () => {
    expect(kappa?.section).toBe('tasks');
    expect(kappa?.prs).toEqual([1562, 1500]);
  });

  it('prefers what a lane names, then its brief, name and PRs, flagging the inferred ones', () => {
    const at = (x: Partial<Parameters<typeof laneBox>[0]>) =>
      laneBox({
        name: 'LN-Kappa',
        ev: kappa,
        units: [],
        owner,
        boxes,
        briefBox: undefined,
        prBox: undefined,
        ...x,
      });
    expect(at({})).toEqual({ box: 'tasks', via: 'section' });
    const plain = { ...kappa!, section: null };
    expect(at({ ev: plain, units: ['U04'] })).toEqual({ box: 'fix', via: 'ticket' });
    expect(at({ ev: plain, briefBox: new Map([['LN-Kappa', 'found']]) })).toEqual({
      box: 'found',
      via: 'brief',
    });
    expect(
      at({
        ev: plain,
        prBox: new Map([
          [1562, 'fix'],
          [1500, 'fix'],
        ]),
      }),
    ).toEqual({ box: 'fix', via: 'prs' });
    expect(at({ ev: plain })).toBeNull();
  });
});

describe('merge pace and live estimates', () => {
  it('dates the merge queue at the last read, and keeps its entries', () => {
    const entries = [
      { position: 1, number: 9, title: 'Nine', url: 'u', enqueuedAt: '2026-10-14T07:00:00Z' },
    ];
    expect(mergeStats('2026-10-14T08:00:00Z', { queued: 2, entries })).toEqual({
      at: '2026-10-14T08:00:00Z',
      queued: 2,
      queueEntries: entries,
    });
    expect(mergeStats('2026-10-14T08:00:00Z', null)).toEqual({
      at: '2026-10-14T08:00:00Z',
      queued: null,
    });
  });

  it('moves a box by tickets a merged PR names complete, and by a newer section estimate, flagged', () => {
    const snap = buildSnapshot({
      audit,
      flow,
      plan,
      generatedAt: '2026-10-14T08:00:00Z',
      prs: [pr({ number: 7, body: 'Ticket: MP-4-12 complete', mergedAt: '2026-10-13T12:00:00Z' })],
      estimates: {
        found: {
          at: '2026-10-14T01:00:00Z',
          model: 'example-model',
          reason: 'checks done',
          prs: [],
          units: { U02: { coded: 0.8, reason: 'harness merged' } },
        },
      },
    });
    const tasks = snap.stages[1]?.nodes.find((n) => n.id === 'tasks');
    // U03 has two tickets; one named complete beats the audit's 0.5? No: 1 of 2 is 0.5, not above it.
    expect(tasks?.estimate.source).toBe('audit');
    const found = snap.stages[0]?.nodes[0];
    expect(found?.estimate.source).toBe('sol');
    expect(found?.estimate.pct).toBeCloseTo((12 * 100 + 11 * 80) / 23, 5);
    expect(found?.coded.pct).toBeCloseTo((12 * 100 + 11 * 50) / 23, 5);
    const done = buildSnapshot({
      audit,
      flow,
      plan,
      generatedAt: 'now',
      prs: [pr({ number: 8, body: 'Ticket: C80 (done)' })],
    });
    const fix = done.stages[1]?.nodes.find((n) => n.id === 'fix');
    expect([fix?.estimate.source, fix?.estimate.pct, fix?.coded.pct]).toEqual(['tickets', 100, 0]);
  });
});

describe('tickets filed as issues', () => {
  const matcher = new RegExp('(?<![A-Za-z0-9_-])(C80|U04|S0-1)(?![A-Za-z0-9_]|-[A-Za-z0-9])', 'g');
  const issues = {
    'example-org/example-app#1613': {
      title: 'Remove the trigger (cut C2)',
      body: '',
      parent: 'example-org/example-app-roadmap#918',
    },
    'example-org/example-app-roadmap#918': { title: 'Map: bed layout', body: '', parent: null },
    'example-org/example-app#1620': { title: 'The About page, C80', body: '', parent: null },
    'example-org/example-app#1621': { title: 'x', body: 'Section: found', parent: null },
  };
  const maps = {
    'example-org/example-app-roadmap#918': 'tasks',
    'example-org/tools#121': 'outside',
  };

  it('reads Refs, Closes and Ticket lines, lists and other repos, as Owner/repo#n', async () => {
    const { issueRefs, issueKey } = await import('../src/core/issues.ts');
    expect(
      issueRefs(
        'Refs #1613. Closes #1614, #1615 and example-org/tools#121',
        'example-org/example-app',
      ),
    ).toEqual([
      'example-org/example-app#1613',
      'example-org/example-app#1614',
      'example-org/example-app#1615',
      'example-org/tools#121',
    ]);
    expect(issueRefs('see #1613 and PR #99', 'example-org/example-app')).toEqual([]);
    expect(issueKey('tools#121', 'example-org/example-app')).toBe('example-org/tools#121');
    const { refsFor, idMatcher } = await import('../src/core/refs.ts');
    const r = refsFor(
      pr({ body: 'Ticket: #1613\nRefs example-app-roadmap#918' }),
      plan,
      idMatcher(Object.keys(plan.tickets)),
      {},
    );
    expect(r.issues.toSorted()).toEqual([
      'example-org/example-app#1613',
      'example-org/example-app-roadmap#918',
    ]);
    expect(r.links).toEqual([]);
  });

  it('places a ticket issue by its own Section or ticket ID, else its parent map', async () => {
    const { issueBox } = await import('../src/core/issues.ts');
    const at = (k: string) => issueBox(k, issues, maps, boxes, plan, owner, matcher)?.box ?? null;
    expect(at('example-org/example-app#1613')).toBe('tasks');
    expect(at('example-org/example-app#1620')).toBe('fix');
    expect(at('example-org/example-app#1621')).toBe('found');
    expect(at('example-org/tools#121')).toBe('outside');
    expect(at('example-org/example-app#9999')).toBeNull();
  });

  it("skips a parent map whose box is no longer on the diagram and places by the ticket's title", async () => {
    const { issueBox } = await import('../src/core/issues.ts');
    const placed = issueBox(
      'example-org/example-app#1630',
      {
        'example-org/example-app#1630': {
          title: 'The About page, C80',
          body: '',
          parent: 'example-org/example-app-roadmap#950',
        },
      },
      { 'example-org/example-app-roadmap#950': 'retired' },
      boxes,
      plan,
      owner,
      matcher,
    );
    expect(placed?.box).toBe('fix');
  });

  it("a retired parent map falls back to the parent's own Section line; an outside parent map still wins", async () => {
    const { issueBox } = await import('../src/core/issues.ts');
    const tree = {
      'A/b#1': { title: 'No ticket ID', body: '', parent: 'A/b#2' },
      'A/b#2': { title: 'Parent', body: 'Section: tasks', parent: null },
    };
    const at = (parentMap: string) =>
      issueBox('A/b#1', tree, { 'A/b#2': parentMap }, boxes, plan, owner, matcher)?.box;
    expect(at('retired')).toBe('tasks');
    expect(at('outside')).toBe('outside');
  });

  it("puts a lane that names a ticket issue on that issue's box", () => {
    const ev = foldEvents(
      emptyEventsState(),
      'f',
      '2026-10-14T01:00:00Z LN-Mu BOOTED Ticket: #1613 (seat a)\n',
      plan,
    );
    expect(ev.lanes['LN-Mu']?.issues).toEqual(['example-org/example-app#1613']);
    const box = laneBox({
      name: 'LN-Mu',
      ev: ev.lanes['LN-Mu'],
      units: [],
      owner,
      boxes,
      briefBox: undefined,
      prBox: undefined,
      issueBox: new Map([
        [
          'example-org/example-app#1613',
          { box: 'tasks', reason: 'Section: tasks', inferred: false },
        ],
      ]),
    });
    expect(box).toEqual({ box: 'tasks', via: 'ticket' });
  });
});

describe('review fixes (version 2 round 1)', () => {
  it('reads a whole box id after Section:, b2 included, and nothing longer', () => {
    const all = new Set(['b2', 'tasks']);
    expect(sectionOf('Section: b2', all)).toBe('b2');
    expect(sectionOf('Section: tasks-other', all)).toBeNull();
    expect(sectionOf('Section: tasks_other', all)).toBeNull();
    const ev = foldEvents(
      emptyEventsState(),
      'f',
      '2026-10-14T01:00:00Z LN-Nu BOOTED Section: b2\n',
      plan,
    );
    expect(ev.lanes['LN-Nu']?.section).toBe('b2');
  });

  it('places an issue by a Ticket: line in its body before its parent map', async () => {
    const { issueBox } = await import('../src/core/issues.ts');
    const { idMatcher } = await import('../src/core/refs.ts');
    const issues = { 'A/b#1': { title: 'About page', body: 'Ticket: C80', parent: 'A/b#9' } };
    expect(
      issueBox(
        'A/b#1',
        issues,
        { 'A/b#9': 'tasks' },
        boxes,
        plan,
        owner,
        idMatcher(Object.keys(plan.tickets)),
      )?.box,
    ).toBe('fix');
  });

  it("a mapped parent beats a bare title ID such as 'cut C80'", async () => {
    const { issueBox } = await import('../src/core/issues.ts');
    const { idMatcher } = await import('../src/core/refs.ts');
    const issues = {
      'A/b#1': { title: 'cut C80: tidy the about page', body: '', parent: 'A/b#9' },
      'A/b#2': { title: 'cut C80: tidy', body: 'Ticket: C80', parent: 'A/b#9' },
    };
    const at = (k: string) =>
      issueBox(
        k,
        issues,
        { 'A/b#9': 'tasks' },
        boxes,
        plan,
        owner,
        idMatcher(Object.keys(plan.tickets)),
      )?.box;
    expect(at('A/b#1')).toBe('tasks');
    expect(at('A/b#2')).toBe('fix');
  });

  it('never shows a section estimate below the audit as it stands', () => {
    const snap = buildSnapshot({
      audit,
      flow,
      plan,
      generatedAt: 'now',
      estimates: {
        found: {
          at: '2026-10-14T01:00:00Z',
          model: 'example-model',
          reason: 'r',
          prs: [],
          units: { U02: { coded: 0.1, reason: 'low' } },
        },
      },
    });
    expect(snap.stages[0]?.nodes[0]?.units.find((u) => u.id === 'U02')?.estimate.pct).toBe(50);
  });
});
