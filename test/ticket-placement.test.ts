import { describe, expect, it } from 'vitest';
import { buildTicketProgress } from '../src/core/ticket-progress.ts';
import { closingIssueKeys } from '../src/core/prose-links.ts';
import { closingFrom, type OpenPr, type WorkIssue } from '../src/core/work.ts';
import type { Project } from '../src/readers/project.ts';

// #191: a ticket no section map places follows the merged PR that closed it, then the project's
// label or title-prefix rule for its repository; otherwise it stays unplaced and listed.
const project: Project = {
  version: 1,
  id: 'synthetic',
  title: 'Synthetic',
  roadmapRepo: 'Example/plan',
  productRepo: 'Example/app',
  repos: ['Example/app', 'Example/plan', 'Example/tools'],
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
    bugLabels: ['bug'],
    placement: {
      'Example/app': {
        labels: { 'area:design': 'design' },
        titlePrefixes: { ui: 'design', 'core-commands': 'build' },
      },
    },
  },
};
const issue = (key: string, patch: Partial<WorkIssue> = {}): WorkIssue => ({
  key,
  title: 'Task',
  body: '',
  url: `https://github.com/${key.replace('#', '/issues/')}`,
  state: 'CLOSED',
  stateReason: 'COMPLETED',
  parent: null,
  labels: [],
  blockedBy: [],
  contextComplete: true,
  ...patch,
});
type Closing = NonNullable<Parameters<typeof buildTicketProgress>[0]['closing']>;
const build = (issues: WorkIssue[], closing?: Closing, maps: Record<string, string> = {}) =>
  buildTicketProgress({
    project,
    plan: { units: {}, tickets: {}, unitIssues: {} },
    nodes: [
      { id: 'build', units: [] },
      { id: 'design', units: [] },
    ],
    maps,
    issues: Object.fromEntries(issues.map((i) => [i.key, i])),
    at: '2026-10-17T12:00:00Z',
    complete: true,
    error: null,
    ...(closing ? { closing } : {}),
  })!;
/** PRs placed by a fixed table, as `placePr` would place them. */
const prs = (
  table: Record<string, { closes: string[]; section: string | null | undefined }>,
): Closing => ({
  prs: Object.entries(table).map(([key, pr]) => ({ key, closes: pr.closes })),
  place: (key) => table[key]?.section,
});
const where = (p: ReturnType<typeof build>, key: string) =>
  [
    ...Object.entries(p.byNode).flatMap(([id, g]) => g.tickets.map((t) => [t.key, id])),
    ...Object.entries(p.bugs?.byNode ?? {}).flatMap(([id, g]) =>
      g.tickets.map((t) => [t.key, `bugs:${id}`]),
    ),
    ...p.unplaced.map((t) => [t.key, 'unplaced']),
    ...p.outside.map((t) => [t.key, 'outside']),
  ].find(([k]) => k === key)?.[1];

describe('a ticket no map places follows its closing PR, then its label or title prefix (#191)', () => {
  it('places a closed ticket in the section of the merged PR that closed it', () => {
    const p = build(
      [issue('Example/app#10', { title: 'chore: tidy' })],
      prs({ 'Example/app#900': { closes: ['Example/app#10'], section: 'design' } }),
    );
    expect(where(p, 'Example/app#10')).toBe('design');
    expect(p.byNode['design']).toMatchObject({ completed: 1, total: 1, pct: 100 });
    expect(p.byNode['design']!.tickets[0]!.mapping).toContain('closed by Example/app#900');
  });
  it('places by label first, then by title prefix, for the configured repository only', () => {
    const p = build([
      issue('Example/app#11', { labels: ['area:design'], title: 'core-commands: read' }),
      issue('Example/app#12', { title: 'UI: the sidebar' }),
      issue('Example/app#13', { title: 'core-commands reads: x' }),
      issue('Example/tools#14', { title: 'ui: not this repository' }),
    ]);
    expect(where(p, 'Example/app#11')).toBe('design');
    expect(where(p, 'Example/app#12')).toBe('design');
    expect(where(p, 'Example/app#13')).toBe('unplaced');
    expect(where(p, 'Example/tools#14')).toBe('unplaced');
    expect(p.byNode['design']!.tickets.find((t) => t.key === 'Example/app#11')!.mapping).toContain(
      'label area:design',
    );
    expect(p.byNode['design']!.tickets.find((t) => t.key === 'Example/app#12')!.mapping).toContain(
      'title prefix ui',
    );
  });
  it('counts a bug-labelled ticket placed by its closing PR in Bugs, never in Progress', () => {
    const p = build(
      [issue('Example/app#15', { labels: ['bug'] })],
      prs({ 'Example/app#901': { closes: ['Example/app#15'], section: 'build' } }),
    );
    expect(where(p, 'Example/app#15')).toBe('bugs:build');
    expect(p.byNode['build']!.total).toBe(0);
  });
  it('leaves a ticket unplaced when its closing PR is unplaced and no rule matches', () => {
    const p = build(
      [issue('Example/tools#16'), issue('Example/tools#17')],
      prs({
        'Example/tools#902': { closes: ['Example/tools#16'], section: undefined },
        'Example/tools#903': { closes: ['Example/tools#17'], section: null },
      }),
    );
    expect(where(p, 'Example/tools#16')).toBe('unplaced');
    expect(where(p, 'Example/tools#17')).toBe('outside');
    expect(p.unplaced[0]!.mapping).toBe('No section mapping');
  });
  it('places open tickets the same way', () => {
    const p = build(
      [
        issue('Example/app#18', { state: 'OPEN', stateReason: null, title: 'ui: open card' }),
        issue('Example/plan#19', { state: 'OPEN', stateReason: null }),
      ],
      prs({ 'Example/app#904': { closes: ['Example/plan#19'], section: 'build' } }),
    );
    expect(where(p, 'Example/app#18')).toBe('design');
    expect(where(p, 'Example/plan#19')).toBe('build');
    expect(p.byNode['design']).toMatchObject({ completed: 0, total: 1 });
  });
  it('keeps a section map ahead of the closing PR, and the closing PR ahead of the label', () => {
    const p = build(
      [
        issue('Example/app#20', { title: 'ui: mapped elsewhere' }),
        issue('Example/app#21', { title: 'ui: closed by a build PR' }),
      ],
      prs({
        'Example/app#905': { closes: ['Example/app#20', 'Example/app#21'], section: 'build' },
      }),
      { 'Example/app#20': 'design' },
    );
    expect(where(p, 'Example/app#20')).toBe('design');
    expect(where(p, 'Example/app#21')).toBe('build');
  });
  it('gives the PR placer each ticket section the maps decided, so a PR follows its mapped ticket', () => {
    const seen: (string | null)[] = [];
    const p = build(
      [issue('Example/app#22'), issue('Example/app#23')],
      {
        prs: [{ key: 'Example/app#906', closes: ['Example/app#22', 'Example/app#23'] }],
        place: (_key, placement) => {
          seen.push(placement('Example/app#22'), placement('Example/app#23'));
          return placement('Example/app#22') ?? placement('Example/app#23') ?? undefined;
        },
      },
      { 'Example/app#22': 'design' },
    );
    expect(seen).toEqual(['design', null]);
    expect(where(p, 'Example/app#23')).toBe('design');
  });
  it('leaves a ticket whose closing PRs disagree on its section unplaced, saying so', () => {
    const p = build(
      [issue('Example/tools#24')],
      prs({
        'Example/tools#907': { closes: ['Example/tools#24'], section: 'build' },
        'Example/tools#908': { closes: ['Example/tools#24'], section: 'design' },
      }),
    );
    expect(where(p, 'Example/tools#24')).toBe('unplaced');
    expect(p.unplaced[0]!.mapping).toContain('closing PRs disagree');
  });
  it('refuses a placement rule naming an unknown section or repository', () => {
    const bad = (placement: object) => () =>
      buildTicketProgress({
        project: { ...project, progress: { ...project.progress!, placement } as never },
        plan: { units: {}, tickets: {}, unitIssues: {} },
        nodes: [{ id: 'build', units: [] }],
        maps: {},
        issues: {},
        at: '2026-10-17T12:00:00Z',
        complete: true,
        error: null,
      });
    expect(bad({ 'Example/app': { labels: { x: 'nowhere' } } })).toThrow(/section: nowhere/);
    expect(bad({ 'Example/other': { titlePrefixes: { x: 'build' } } })).toThrow(/repository/);
  });
});

describe('a PR body closes the tickets its closing keywords name (#191)', () => {
  it('reads hostile forms: case, tabs, quotes and lists count; comments and lookalike words do not', () => {
    expect(
      closingIssueKeys(
        'CLOSES\t#9\n\n<!-- Closes #10 -->\n\n> Fixes #11\n\n- resolved #12\n\nunclosed #13, prefixes #14, fixed-up #15\n\n<details>Closes #16</details>',
        'Example/app',
      ).toSorted(),
    ).toEqual(['Example/app#11', 'Example/app#12', 'Example/app#9']);
  });
  it('reads every ticket in a closing list, across repositories, outside code', () => {
    expect(
      closingIssueKeys(
        'Closes #1, #2 and Example/plan#3. Fixes: https://github.com/Example/tools/issues/4\n\n`Closes #5`\n\n```\nresolves #6\n```\nRefs #7; also discloses #8',
        'Example/app',
      ).toSorted(),
    ).toEqual(['Example/app#1', 'Example/app#2', 'Example/plan#3', 'Example/tools#4']);
  });
});

describe('closing lists from #193', () => {
  it('a serial comma keeps the last ticket', () => {
    expect(closingIssueKeys('Closes #1, #2, and #3', 'Example/app').toSorted()).toEqual([
      'Example/app#1',
      'Example/app#2',
      'Example/app#3',
    ]);
    expect(closingIssueKeys('Fixes #4, & #5', 'Example/app').toSorted()).toEqual([
      'Example/app#4',
      'Example/app#5',
    ]);
  });
  it('separate list items and blocks never run together into one ticket', () => {
    for (const body of ['- Closes #1\n- 2 bugs', 'Closes #1\n\n2 bugs', '# Closes #1\n2 bugs'])
      expect(closingIssueKeys(body, 'Example/app'), body).toEqual(['Example/app#1']);
  });
  it('a ticket whose only closing PR is outside shows outside; outside and placed PRs disagree', () => {
    const only = build(
      [issue('Example/tools#40')],
      prs({ 'Example/tools#960': { closes: ['Example/tools#40'], section: null } }),
    );
    expect(where(only, 'Example/tools#40')).toBe('outside');
    const both = build(
      [issue('Example/tools#41')],
      prs({
        'Example/tools#961': { closes: ['Example/tools#41'], section: null },
        'Example/tools#962': { closes: ['Example/tools#41'], section: 'build' },
      }),
    );
    expect(where(both, 'Example/tools#41')).toBe('unplaced');
    expect(both.unplaced[0]!.mapping).toContain(
      'closing PRs disagree: Example/tools#961 outside, Example/tools#962 build',
    );
  });
});

const merged = (key: string, body: string, issueKeys: string[] = []): OpenPr => ({
  key,
  number: Number(key.split('#')[1]),
  title: 'Merged work',
  body,
  url: `https://github.com/${key.replace('#', '/pull/')}`,
  headRefName: 'work',
  issueKeys,
  state: 'MERGED',
});
describe('Sync places tickets by the merged PRs in the work cache (#191)', () => {
  const nodes = [
    { id: 'build', units: [] },
    { id: 'design', units: [] },
  ];
  const plan = { units: {}, tickets: {}, unitIssues: {} };
  it('places each closed ticket by its PR: declared section, body closing list, mapped ticket', () => {
    const p = build(
      [
        issue('Example/app#30'),
        issue('Example/app#31'),
        issue('Example/app#32'),
        issue('Example/app#33'),
        issue('Example/app#34'),
        issue('Example/tools#35'),
      ],
      closingFrom({
        project,
        plan,
        nodes,
        closedBy: [
          // GitHub links only the first ticket of a closing list.
          merged('Example/app#950', 'Section: build\n\nCloses #30, #31', ['Example/app#30']),
          // No section: the PR follows the mapped ticket it also closes.
          merged('Example/app#951', 'Closes #32 and #33', ['Example/app#32']),
          merged('Example/tools#952', 'Fixes #35'),
        ],
      }),
      { 'Example/app#32': 'design' },
    );
    expect(where(p, 'Example/app#30')).toBe('build');
    expect(where(p, 'Example/app#31')).toBe('build');
    expect(where(p, 'Example/app#33')).toBe('design');
    expect(where(p, 'Example/app#34')).toBe('unplaced');
    expect(where(p, 'Example/tools#35')).toBe('unplaced');
  });
});
