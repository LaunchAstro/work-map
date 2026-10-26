import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWork, type OpenPr, type WorkIssue } from '../src/core/work.ts';
import { lanePrBoxes, laneBox, emptyEventsState, type EventLane } from '../src/core/agents.ts';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import { currentSnapshot } from '../src/web/snapshot.ts';
import { buildSectionBrief, sectionBriefMarkdown } from '../src/web/sectionBrief.ts';
import { buildTicketProgress } from '../src/core/ticket-progress.ts';
import { issueBox } from '../src/core/issues.ts';
import { idMatcher } from '../src/core/refs.ts';
import { emptyWorkCache, refreshWork } from '../src/readers/work-github.ts';
import { readProject, type Project } from '../src/readers/project.ts';
import type { NodeView } from '../src/core/contract.ts';
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

describe('project evidence on a generic work map', () => {
  it('names the configured mapping source after the app moves out of the roadmap repository', () => {
    const s = buildSnapshot({
      project: {
        ...project,
        files: { ...project.files, mapping: 'project/evidence/approved-mapping.json' },
      },
      audit: JSON.parse(fx('audit.json')) as Audit,
      flow: JSON.parse(fx('flow.json')) as Flow,
      plan,
      generatedAt: '2026-10-14T01:00:00Z',
    });
    expect(s.sources.mapping.file).toBe('project/evidence/approved-mapping.json');
  });
  it('places an open PR by Section before its ticket and marks parent-map placement inferred', () => {
    const issues = { 'Acme/app#3': issue('Acme/app#3', '', { parent: 'Acme/plan#1' }) };
    const w = work(issues, [
      {
        key: 'Acme/app#9',
        number: 9,
        title: 'Work',
        body: 'Section: fix\nTicket: #3',
        headRefName: 'work',
        url: 'https://github.com/Acme/app/pull/9',
        issueKeys: ['Acme/app#3'],
      },
    ]);
    expect(w.byNode['fix']?.state).toBe('built');
    expect(w.byNode['tasks']?.openPrs).toHaveLength(0);
    expect(w.byNode['fix']?.openPrs[0]?.inferred).toBe(false);
    const mapped = work(issues, [
      {
        key: 'Acme/app#9',
        number: 9,
        title: 'Work',
        body: 'Ticket: #3',
        headRefName: 'work',
        url: 'https://github.com/Acme/app/pull/9',
        issueKeys: [],
      },
    ]);
    expect(mapped.byNode['tasks']?.openPrs[0]?.inferred).toBe(true);
  });
  it('keeps closed dependencies out of blocked markers, including ones closed after the parent last changed', () => {
    const w = work({
      'Acme/app#1': issue('Acme/app#1', 'Section: tasks', {
        blockedBy: [
          { key: 'Acme/app#2', title: 'Still open', url: 'x', state: 'OPEN' },
          { key: 'Acme/app#3', title: 'Closed later', url: 'x', state: 'OPEN' },
        ],
      }),
      'Acme/app#2': issue('Acme/app#2', 'Section: found'),
      'Acme/app#3': issue('Acme/app#3', '', { state: 'CLOSED' }),
    });
    expect(w.byNode['tasks']?.blockers.map((b) => b.key)).toEqual(['Acme/app#2']);
    expect(w.wires).toContainEqual({
      from: ['found', 'r'],
      to: ['tasks', 'l'],
      kind: 'blocked',
      label: 'waits on',
    });
  });
  it('finds the map through ancestors and specs as sibling context, and never counts a spec as a build ticket', () => {
    const w = work({
      'Acme/plan#1': issue('Acme/plan#1', '', { labels: ['roadmap:map'] }),
      'Acme/app#2': issue('Acme/app#2', 'Section: tasks', {
        labels: ['ready-for-agent'],
        parent: 'Acme/plan#1',
      }),
      'Acme/app#3': issue('Acme/app#3', '', {
        title: 'Spec: the work',
        labels: ['ready-for-agent'],
        parent: 'Acme/plan#1',
      }),
    });
    expect(w.byNode['tasks']?.planning.map.map((i) => i.key)).toEqual(['Acme/plan#1']);
    expect(w.byNode['tasks']?.planning.spec).toHaveLength(1);
    expect(w.byNode['tasks']?.planning.tickets.map((i) => i.key)).toEqual(['Acme/app#2']);
    expect(w.byNode['fix']?.missing).toContain('map');
  });
  it("an umbrella map alone does not tick a section's map, and lends it no spec", () => {
    const w = work({
      'Acme/plan#9': issue('Acme/plan#9', '', { labels: ['roadmap:map'] }),
      'Acme/app#10': issue('Acme/app#10', 'Section: tasks', { parent: 'Acme/plan#9' }),
      'Acme/app#11': issue('Acme/app#11', 'Section: fix', { parent: 'Acme/plan#9' }),
      'Acme/app#12': issue('Acme/app#12', '', { title: 'Spec: everything', parent: 'Acme/plan#9' }),
    });
    for (const section of ['tasks', 'fix']) {
      expect(w.byNode[section]?.planning.map.map((i) => i.key)).not.toContain('Acme/plan#9');
      expect(w.byNode[section]?.planning.spec.map((i) => i.key)).not.toContain('Acme/app#12');
    }
  });
  it('a spec under a shared map ticks only its own section', () => {
    const w = work({
      'Acme/plan#9': issue('Acme/plan#9', '', { labels: ['roadmap:map'] }),
      'Acme/app#10': issue('Acme/app#10', 'Section: tasks', { parent: 'Acme/plan#9' }),
      'Acme/app#11': issue('Acme/app#11', 'Section: fix', {
        title: 'Spec: the fix',
        parent: 'Acme/plan#9',
      }),
    });
    expect(w.byNode['fix']?.planning.spec.map((i) => i.key)).toEqual(['Acme/app#11']);
    expect(w.byNode['tasks']?.planning.spec).toEqual([]);
  });
  it('shows merged code and live shares separately, without turning an open PR into a percentage', () => {
    const w = work({});
    expect(w.byNode['tasks']?.shares).toEqual({
      live: 0,
      merged: 50,
      built: 0,
      planned: 50,
    });
    expect(w.byNode['tasks']?.state).toBe('merged');
    expect(w.byNode['fix']?.state).toBe('planned');
  });
  it('honours a Section line before a configured parent-map guess', () => {
    expect(
      issueBox(
        'Acme/plan#1',
        { 'Acme/plan#1': issue('Acme/plan#1', 'Section: fix') },
        { 'Acme/plan#1': 'tasks' },
        new Set(['tasks', 'fix']),
        plan,
        new Map(),
        idMatcher([]),
      )?.box,
    ).toBe('fix');
  });
  it('does not turn historical merged PRs into unswitched work', () => {
    const nodes: NodeView[] = [];
    for (const n of snap.stages.flatMap((s) => s.nodes))
      nodes.push({
        ...n,
        on: { ...n.on, pct: n.coded.pct },
        estimate: { ...n.estimate, pct: n.coded.pct },
        sinceAudit: { merged: 0, prs: [] },
      });
    const w = work({}, [], { nodes });
    expect(w.byNode['tasks']?.state).toBe('live');
    expect(w.byNode['tasks']?.shares.merged).toBe(0);
    expect(w.byNode['fix']?.state).toBe('planned');
  });
  it('reads multiline blocker lists and markdown links, stops at the next heading and deduplicates', () => {
    const w = work({
      'Acme/app#1': issue(
        'Acme/app#1',
        'Section: tasks\n## Blocked by\n- #2\n- [Need](https://github.com/Acme/app/issues/3)\n## Notes\nRefs #4',
      ),
      'Acme/app#5': issue('Acme/app#5', 'Section: tasks\nBlocked by: #2'),
      'Acme/app#2': issue('Acme/app#2', 'Section: found'),
      'Acme/app#3': issue('Acme/app#3', 'Section: tasks'),
      'Acme/app#4': issue('Acme/app#4', 'Section: fix'),
    });
    expect(w.byNode['tasks']?.blockers.map((b) => b.key)).toEqual(['Acme/app#2', 'Acme/app#3']);
    expect(w.wires.filter((wire) => wire.kind === 'blocked')).toHaveLength(1);
  });
  it('uses lane evidence for open PRs, keeps it inferred and reports remaining unplaced work', () => {
    const p = {
      key: 'Acme/app#9',
      number: 9,
      title: 'Build',
      body: '',
      url: 'https://github.com/Acme/app/pull/9',
      headRefName: 'work',
      issueKeys: [],
    };
    const w = work({}, [p, { ...p, key: 'Acme/app#10', number: 10 }], {
      prLanes: { 'Acme/app#9': 'tasks' },
    });
    expect(w.byNode['tasks']?.openPrs[0]?.inferred).toBe(true);
    expect(w.byNode['tasks']?.state).toBe('built');
    expect(w.unplacedPrs.map((pr) => pr.key)).toEqual(['Acme/app#10']);
    expect(
      work({}, [{ ...p, body: 'Section: fix' }], { prLanes: { 'Acme/app#9': 'tasks' } }).byNode[
        'fix'
      ]?.openPrs,
    ).toHaveLength(1);
  });
  it('does not claim that a map proves a separate idea issue, and accepts configured spec labels', () => {
    const w = work({
      'Acme/plan#1': issue('Acme/plan#1', '', { labels: ['roadmap:map'] }),
      'Acme/app#2': issue('Acme/app#2', 'Section: tasks', {
        labels: ['spec', 'ready-for-agent'],
        parent: 'Acme/plan#1',
      }),
    });
    expect(w.byNode['tasks']?.planning.idea).toHaveLength(0);
    expect(w.byNode['tasks']?.planning.spec).toHaveLength(1);
    expect(w.byNode['tasks']?.planning.tickets).toHaveLength(0);
  });
});

describe('stopped lane history', () => {
  it('keeps parent-map placement marked inferred and keys lane PRs to their repository', () => {
    const ev: EventLane = {
      lane: 'AC-Work',
      bootedAt: null,
      closedAt: null,
      machine: null,
      tickets: [],
      issues: ['Acme/app#2'],
      section: null,
      prs: [9],
      last: null,
    };
    const placed = laneBox({
      name: ev.lane,
      ev,
      units: [],
      owner: new Map(),
      boxes: new Set(['tasks']),
      briefBox: undefined,
      prBox: undefined,
      issueBox: new Map([['Acme/app#2', { box: 'tasks', reason: 'parent map', inferred: true }]]),
    });
    expect(placed).toEqual({ box: 'tasks', via: 'issue' });
    const events = { ...emptyEventsState(), lanes: { 'AC-Work': ev } };
    expect(
      lanePrBoxes({
        events,
        plan,
        owner: new Map(),
        boxes: new Set(['tasks']),
        briefBox: new Map(),
        issueBox: new Map([['Acme/app#2', { box: 'tasks', reason: 'parent map', inferred: true }]]),
        laneRules: [],
        lanePrefix: 'AC-',
        repository: 'Acme/app',
      }),
    ).toEqual({ 'Acme/app#9': 'tasks' });
  });
});

describe('GitHub planning read failures', () => {
  // #242: the last complete read stays complete with its time; the failure is recorded beside it.
  it('keeps the last complete data and time when GitHub fails, and records the failure', async () => {
    const cache = {
      ...emptyWorkCache('other'),
      complete: true,
      at: '2026-10-14T00:00:00Z',
      issues: { 'Acme/app#2': issue('Acme/app#2', 'Section: tasks') },
    };
    const result = await refreshWork({
      project,
      cache,
      now: new Date(),
      run: async () => {
        throw new Error('offline');
      },
    });
    expect(result.at).toBe(cache.at);
    expect(result.issues).toEqual(cache.issues);
    expect(result.complete).toBe(true);
    expect(result.error).toBeNull();
    expect(result.lastFailure?.error).toBe('offline');
  });
  it('stops before reading GitHub data when the shared API reserve is reached', async () => {
    let calls = 0;
    const result = await refreshWork({
      project,
      cache: emptyWorkCache('other'),
      now: new Date(),
      run: async () => {
        calls++;
        return JSON.stringify({
          resources: { core: { remaining: 999 }, graphql: { remaining: 2000 } },
        });
      },
    });
    expect(calls).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.error).toContain('reserve');
  });
  it('fully pages a newly configured repo even when existing repo watermarks are recent', async () => {
    const made: string[][] = [];
    const old = {
      ...emptyWorkCache('other'),
      complete: true,
      at: '2026-10-14T01:00:00Z',
      reposThrough: { 'Acme/app': '2026-10-14T01:00:00Z' },
    };
    const result = await refreshWork({
      project: { ...project, repos: ['Acme/app', 'Acme/new'] },
      cache: old,
      now: new Date('2026-10-14T01:05:00Z'),
      run: async (args) => {
        made.push([...args]);
        if (args[1] === 'rate_limit')
          return JSON.stringify({
            resources: { core: { remaining: 4000 }, graphql: { remaining: 4000 } },
          });
        const name = args.find((a) => a.startsWith('name='))?.slice(5) ?? '';
        const query = args.find((a) => a.startsWith('query=')) ?? '';
        const isIssues = query.includes('issues(first');
        const next = args.includes('cursor=next');
        const issueNode = {
          number: next ? 2 : 1,
          title: 'Old issue',
          body: 'Section: tasks',
          url: `https://github.com/Acme/${name}/issues/${next ? 2 : 1}`,
          state: 'OPEN',
          updatedAt: '2020-01-01T00:00:00Z',
          repository: { nameWithOwner: `Acme/${name}` },
          parent: null,
          labels: { totalCount: 0, nodes: [] },
          blockedBy: { totalCount: 0, nodes: [] },
        };
        return JSON.stringify({
          data: {
            rateLimit: { remaining: 3999 },
            repository: {
              [isIssues ? 'issues' : 'pullRequests']: {
                pageInfo: { hasNextPage: isIssues && name === 'new' && !next, endCursor: 'next' },
                nodes: isIssues ? [issueNode] : [],
              },
            },
          },
        });
      },
    });
    expect(Object.keys(result.issues).toSorted()).toEqual(['Acme/new#1', 'Acme/new#2']);
    expect(
      made.filter((a) => a.includes('name=new') && a.some((x) => x.includes('issues(first'))),
    ).toHaveLength(2);
    expect(result.reposThrough?.['Acme/new']).toBe('2026-10-14T01:05:00.000Z');
  });
});

it('uses ticket ownership for linked PRs without applying repository defaults to PR own keys', () => {
  const ticketProject: Project = {
    ...project,
    progress: {
      basis: 'ticket-count',
      repositories: { 'Acme/app': 'fix' },
      issues: { 'Acme/app#3': 'tasks' },
    },
  };
  const issues = { 'Acme/app#3': issue('Acme/app#3', '') };
  const ticketProgress = buildTicketProgress({
    project: ticketProject,
    issues,
    plan,
    nodes: snap.stages.flatMap((stage) => stage.nodes),
    maps: {},
    at: '2026-10-16T01:00:00Z',
    complete: true,
    error: null,
  });
  const result = work(
    issues,
    [
      {
        key: 'Acme/app#99',
        number: 99,
        title: 'Linked build',
        body: 'Closes #3',
        headRefName: 'work',
        url: 'https://github.com/Acme/app/pull/99',
        issueKeys: ['Acme/app#3'],
      },
    ],
    { project: ticketProject, ticketProgress },
  );
  expect(result.byNode['tasks']?.openPrs.map((pr) => pr.key)).toEqual(['Acme/app#99']);
  expect(result.byNode['fix']?.openPrs).toHaveLength(0);
  const outsidePr = {
    key: 'Acme/app#99',
    number: 99,
    title: 'Outside work',
    body: 'Ticket: none\nCloses #3',
    headRefName: 'work',
    url: 'https://github.com/Acme/app/pull/99',
    issueKeys: ['Acme/app#3'],
  };
  const outside = work(issues, [outsidePr], { project: ticketProject, ticketProgress });
  expect(outside.byNode['tasks']?.openPrs).toHaveLength(0);
  expect(outside.byNode['fix']?.openPrs).toHaveLength(0);
  expect(outside.unplacedPrs.map((pr) => pr.key)).toEqual(['Acme/app#99']);
  const node = snap.stages.flatMap((stage) => stage.nodes).find((entry) => entry.id === 'tasks')!;
  const copied = sectionBriefMarkdown(
    buildSectionBrief({ ...snap, work: result, ticketProgress }, node),
  );
  expect(copied).toContain('Ticket completion: 0/1');
  expect(copied).toContain('project progress override');
  expect(copied).toContain('does not establish reviewed, merged, deployed or live scope');
});

it('keeps ticket mode pending when optional ticket evidence is malformed', () => {
  const parsed = currentSnapshot({
    ...snap,
    progressBasis: 'ticket-count',
    ticketProgress: { schema: 'invalid' },
  });
  expect(parsed?.progressBasis).toBe('ticket-count');
  expect(parsed?.ticketProgress).toBeUndefined();
});

it('the Audit source line shows an ISO time in AEST and any other text as written', () => {
  const node = snap.stages[0]!.nodes[0]!;
  const line = (asAt: string) =>
    buildSectionBrief(
      { ...snap, sources: { ...snap.sources, audit: { ...snap.sources.audit!, asAt } } },
      node,
    ).source.find((l) => l.startsWith('Audit:'));
  expect(line('2026-10-17T01:00:00Z')).toBe('Audit: 17/10/2026, 11:00:00 am');
  expect(line('13 October 2026')).toBe('Audit: 13 October 2026');
});

it('loads a snapshot with or without the retired sweep and audit source fields', () => {
  expect(currentSnapshot(snap)).not.toBeNull();
  const { sweep: _sweep, ...rest } = snap;
  const { audit: _audit, ...sources } = snap.sources;
  const parsed = currentSnapshot({ ...rest, sources });
  expect(parsed).not.toBeNull();
  const node = parsed!.stages[0]!.nodes[0]!;
  expect(sectionBriefMarkdown(buildSectionBrief(parsed!, node))).not.toContain('Audit:');
});

type Level = Record<string, unknown>;
const drop = (level: Level, key: string): Level => {
  const { [key]: _dropped, ...rest } = level;
  return rest;
};
it('loads a snapshot without the empty review measures, and still needs the coded ones', () => {
  const without = (key: string) => ({
    ...snap,
    totals: drop(snap.totals as unknown as Level, key),
    stages: snap.stages.map((stage) => ({
      ...drop(stage as unknown as Level, key),
      nodes: stage.nodes.map((node) => drop(node as unknown as Level, key)),
    })),
  });
  expect(currentSnapshot(without('reviewed'))).not.toBeNull();
  expect(currentSnapshot(without('coded'))).toBeNull();
});

const prFrom = (key: string, body: string): Parameters<typeof buildWork>[0]['prs'][number] => {
  const [repo, number] = key.split('#') as [string, string];
  return {
    key,
    number: Number(number),
    title: `Work ${key}`,
    body,
    headRefName: 'work',
    url: `https://github.com/${repo}/pull/${number}`,
    issueKeys: [],
  };
};

it("a PR linking a placed ticket in prose counts as that section's build", () => {
  const ticketProject: Project = {
    ...project,
    repos: ['Acme/app', 'Acme/site'],
    progress: {
      basis: 'ticket-count',
      repositories: { 'Acme/site': 'fix' },
      issues: { 'Acme/app#49': 'tasks', 'Acme/app#50': 'fix', 'Acme/site#49': 'fix' },
    },
  };
  const issues = {
    'Acme/app#49': issue('Acme/app#49', ''),
    'Acme/app#50': issue('Acme/app#50', ''),
    'Acme/site#49': issue('Acme/site#49', ''),
  };
  const ticketProgress = buildTicketProgress({
    project: ticketProject,
    issues,
    plan,
    nodes: snap.stages.flatMap((stage) => stage.nodes),
    maps: {},
    at: '2026-10-16T01:00:00Z',
    complete: true,
    error: null,
  });
  const result = work(
    issues,
    [
      // A bare "#49" in prose, like an issue body's "For #49".
      prFrom('Acme/app#5', 'Booking component v1. For #49, the slot picker.'),
      // A full reference from another repository.
      prFrom('Acme/site#6', 'Consent banner, see https://github.com/Acme/app/issues/49.'),
      // An explicit Section line still wins over prose.
      prFrom('Acme/app#7', 'Section: fix\nFor #49.'),
      // Prose links that disagree place nothing by prose; the repository default applies.
      prFrom('Acme/site#8', 'Touches Acme/app#49 and Acme/app#50.'),
      // No link at all: the section's own repository places it.
      prFrom('Acme/site#9', 'Measurement allowlist.'),
      // Ticket: none still keeps a PR outside, whatever its repository.
      prFrom('Acme/site#10', 'Ticket: none\nFor #49.'),
      // Markdown links count by destination only, never also as a local "#49".
      prFrom('Acme/site#12', 'For [#49](https://github.com/Acme/app/issues/49 "Booking").'),
      prFrom('Acme/site#13', 'For [#49][t].\n\n[t]: https://github.com/Acme/app/issues/49'),
      // A product-repo PR with neither a link nor a repository default stays unplaced.
      prFrom('Acme/app#11', 'Tidy.'),
    ],
    { project: ticketProject, ticketProgress },
  );
  const keys = (id: string): string[] =>
    (result.byNode[id]?.openPrs ?? []).map((p) => p.key).toSorted();
  expect(keys('tasks')).toEqual(['Acme/app#5', 'Acme/site#12', 'Acme/site#13', 'Acme/site#6']);
  expect(keys('fix')).toEqual(['Acme/app#7', 'Acme/site#8', 'Acme/site#9']);
  expect(result.unplacedPrs.map((p) => p.key).toSorted()).toEqual(['Acme/app#11', 'Acme/site#10']);
  expect(result.byNode['tasks']?.openPrs.every((p) => p.inferred)).toBe(true);
  expect(result.byNode['tasks']?.missing).not.toContain('build');
  // Merged PRs from the section's own repository tick build the same way.
  const merged = work(issues, [], {
    project: ticketProject,
    ticketProgress,
    trackedMergedPrs: [{ ...prFrom('Acme/site#15', 'Consent before tracking.'), state: 'MERGED' }],
  });
  expect(merged.byNode['fix']?.planning.build.map((p) => p.key)).toEqual(['Acme/site#15']);
  expect(merged.byNode['fix']?.missing).not.toContain('build');
});

const file = (path: string): { path: string } => ({ path });
const docsPr = (number: number, body: string, docsOnly?: boolean): OpenPr => ({
  key: `Acme/app#${number}`,
  number,
  title: `Change ${number}`,
  body,
  headRefName: 'work',
  url: `https://github.com/Acme/app/pull/${number}`,
  issueKeys: [],
  state: 'MERGED',
  ...(docsOnly === undefined ? {} : { docsOnly }),
});

it('a docs-only PR does not tick build', () => {
  const planningProject: Project = { ...project, planningSections: ['fix'] };
  const result = work({}, [{ ...docsPr(40, 'Section: tasks', true), state: 'OPEN' }], {
    project: planningProject,
    trackedMergedPrs: [
      // Like a roadmap PR touching docs/candidates.md, or a product PR touching docs/agents/….
      docsPr(41, 'Section: tasks', true),
      // A configured planning section's own work is documents, so they count there.
      docsPr(42, 'Section: fix', true),
    ],
  });
  expect(result.byNode['tasks']?.planning.build).toEqual([]);
  expect(result.byNode['tasks']?.missing).toContain('build');
  // Still listed as an open PR in its section; it just isn't build work.
  expect(result.byNode['tasks']?.openPrs.map((p) => p.key)).toEqual(['Acme/app#40']);
  expect(result.byNode['fix']?.planning.build.map((p) => p.key)).toEqual(['Acme/app#42']);
  // A product change, or a PR whose files were never read, still counts as build.
  const product = work({}, [], {
    project: planningProject,
    trackedMergedPrs: [docsPr(43, 'Section: tasks', false), docsPr(44, 'Section: tasks')],
  });
  expect(product.byNode['tasks']?.planning.build.map((p) => p.key)).toEqual([
    'Acme/app#43',
    'Acme/app#44',
  ]);
});

it('reads each PR’s files into a docs-only flag and backfills cached merged PRs a few at a time', async () => {
  const made: string[][] = [];
  const node = (number: number, paths: string[], total = paths.length) => ({
    number,
    title: `PR ${number}`,
    body: '',
    url: `https://github.com/Acme/app/pull/${number}`,
    headRefName: 'work',
    updatedAt: '2026-10-14T01:00:00Z',
    closingIssuesReferences: { totalCount: 0, nodes: [] },
    files: { totalCount: total, nodes: paths.map(file) },
  });
  const cached = Array.from({ length: 30 }, (_, i) => docsPr(100 + i, ''));
  const result = await refreshWork({
    project,
    cache: { ...emptyWorkCache('other'), mergedPrs: cached },
    now: new Date('2026-10-14T01:05:00Z'),
    run: async (args) => {
      made.push([...args]);
      if (args[1] === 'rate_limit')
        return JSON.stringify({
          resources: { core: { remaining: 4000 }, graphql: { remaining: 4000 } },
        });
      const query = args.find((a) => a.startsWith('query=')) ?? '';
      if (query.includes('pullRequest(number:')) {
        const numbers = [...query.matchAll(/p(\d+): pullRequest\(number: (\d+)\)/g)].map((m) =>
          Number(m[2]),
        );
        return JSON.stringify({
          data: {
            rateLimit: { remaining: 3990 },
            repository: Object.fromEntries(
              numbers.map((n) => [
                `p${n}`,
                { files: { totalCount: 1, nodes: [file(n % 2 ? 'README.md' : 'src/a.ts')] } },
              ]),
            ),
          },
        });
      }
      const merged = query.includes('states:MERGED');
      return JSON.stringify({
        data: {
          rateLimit: { remaining: 3999 },
          repository: query.includes('issues(first')
            ? { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } }
            : {
                pullRequests: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: query.includes('states:OPEN')
                    ? [
                        node(1, ['docs/agents/issue-tracker.md']),
                        node(2, ['docs/plan.md', 'apps/web/src/app.ts']),
                        node(3, ['CHANGELOG.md', 'notes/README.md']),
                        // More files than were read: never assumed docs-only.
                        node(4, ['docs/a.md'], 250),
                      ]
                    : merged
                      ? [node(5, ['docs/candidates.md'])]
                      : [],
                },
              },
        },
      });
    },
  });
  const flag = (key: string) =>
    [...result.prs, ...(result.mergedPrs ?? [])].find((p) => p.key === key)?.docsOnly;
  expect([1, 2, 3, 4, 5].map((n) => flag(`Acme/app#${n}`))).toEqual([
    true,
    false,
    true,
    false,
    true,
  ]);
  // Cached merged PRs without a flag are filled 20 per query, at most a few queries per run.
  const backfills = made.filter((a) => a.some((x) => x.includes('pullRequest(number:')));
  expect(backfills.length).toBeGreaterThan(0);
  expect(
    backfills.every(
      (a) => (a.find((x) => x.startsWith('query='))!.match(/pullRequest\(/g) ?? []).length <= 20,
    ),
  ).toBe(true);
  expect(flag('Acme/app#101')).toBe(true);
  expect(flag('Acme/app#100')).toBe(false);
  expect(cached.filter((p) => flag(p.key) === undefined)).toHaveLength(0);
});

it('repository-specific ticket labels count only in their configured repository and never turn specs into tickets', () => {
  const scoped = {
    ...project,
    repos: ['Acme/app', 'Acme/other'],
    ticketConventions: {
      ...project.ticketConventions,
      ticketLabelsByRepository: { 'acme/APP': ['enhancement'] },
    },
  };
  const result = work(
    {
      'Acme/app#901': issue('Acme/app#901', 'Section: tasks', { labels: ['enhancement'] }),
      'Acme/other#902': issue('Acme/other#902', 'Section: tasks', { labels: ['enhancement'] }),
      'Acme/app#903': issue('Acme/app#903', 'Section: tasks', { labels: ['enhancement', 'spec'] }),
      'Acme/other#904': issue('Acme/other#904', 'Section: tasks', { labels: ['roadmap:task'] }),
    },
    [],
    { project: scoped },
  );
  expect(result.byNode['tasks']?.planning.tickets.map((i) => i.key)).toEqual([
    'Acme/app#901',
    'Acme/other#904',
  ]);
  expect(result.byNode['tasks']?.planning.spec.map((i) => i.key)).toContain('Acme/app#903');
});

it('reads repository-specific ticket labels and rejects unconfigured or ambiguous repository identities', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-ticket-label-config-'));
  const config = join(dir, 'project.json');
  const read = (mapping: Record<string, string[]>) => {
    writeFileSync(
      config,
      JSON.stringify({
        ...project,
        ticketConventions: { ...project.ticketConventions, ticketLabelsByRepository: mapping },
      }),
    );
    return readProject(config).project.ticketConventions;
  };
  try {
    expect(read({ 'acme/APP': ['enhancement'] })).toHaveProperty('ticketLabelsByRepository', {
      'acme/APP': ['enhancement'],
    });
    expect(() => read({ 'Acme/foreign': ['enhancement'] })).toThrow(/repository/i);
    expect(() => read({ 'Acme/app': ['enhancement'], 'acme/APP': ['task'] })).toThrow(
      /repository/i,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('repository-specific ticket labels add to the global ready and ticket labels in their repository', () => {
  const scoped = {
    ...project,
    repos: ['Acme/app', 'Acme/other'],
    ticketConventions: {
      ...project.ticketConventions,
      ticketLabelsByRepository: { 'acme/APP': ['enhancement'] },
    },
  };
  const result = work(
    {
      'Acme/app#911': issue('Acme/app#911', 'Section: tasks', { labels: ['ready-for-agent'] }),
      'Acme/app#912': issue('Acme/app#912', 'Section: tasks', { labels: ['roadmap:task'] }),
      'Acme/other#913': issue('Acme/other#913', 'Section: tasks', { labels: ['ready-for-agent'] }),
      // The spec title pattern ignores case, so this stays a spec.
      'Acme/app#914': issue('Acme/app#914', 'Section: tasks', {
        title: 'sPeC: mixed case',
        labels: ['enhancement'],
      }),
    },
    [],
    { project: scoped },
  );
  expect(result.byNode['tasks']?.planning.tickets.map((i) => i.key)).toEqual([
    'Acme/app#911',
    'Acme/app#912',
    'Acme/other#913',
  ]);
  expect(result.byNode['tasks']?.planning.spec.map((i) => i.key)).toEqual(['Acme/app#914']);
});

it('accepts an empty repository-specific label list and rejects an empty label', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-ticket-label-config-'));
  const config = join(dir, 'project.json');
  const read = (mapping: Record<string, string[]>) => {
    writeFileSync(
      config,
      JSON.stringify({
        ...project,
        ticketConventions: { ...project.ticketConventions, ticketLabelsByRepository: mapping },
      }),
    );
    return readProject(config).project.ticketConventions;
  };
  try {
    expect(read({ 'ACME/APP': [] })).toHaveProperty('ticketLabelsByRepository', { 'ACME/APP': [] });
    expect(() => read({ 'Acme/app': [''] })).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A spec ticks a section only where it is placed, or unplaced under that section alone.
it('a spec over a ticket ticks its section only when placed there, and an unplaced spec over two sections ticks neither', () => {
  const placed = work({
    'Acme/plan#9': issue('Acme/plan#9', 'Section: tasks', { labels: ['roadmap:map'] }),
    'Acme/app#11': issue('Acme/app#11', 'Section: fix', {
      title: 'Spec: the fix',
      parent: 'Acme/plan#9',
    }),
    'Acme/app#10': issue('Acme/app#10', 'Section: tasks', { parent: 'Acme/app#11' }),
  });
  expect(placed.byNode['fix']?.planning.spec.map((i) => i.key)).toEqual(['Acme/app#11']);
  expect(placed.byNode['tasks']?.planning.spec).toEqual([]);
  const umbrella = work({
    'Acme/plan#9': issue('Acme/plan#9', '', { labels: ['roadmap:map'] }),
    'Acme/app#12': issue('Acme/app#12', '', { title: 'Spec: everything', parent: 'Acme/plan#9' }),
    'Acme/app#10': issue('Acme/app#10', 'Section: tasks', { parent: 'Acme/app#12' }),
    'Acme/app#11': issue('Acme/app#11', 'Section: fix', { parent: 'Acme/app#12' }),
  });
  for (const section of ['tasks', 'fix'])
    expect(umbrella.byNode[section]?.planning.spec).toEqual([]);
});

// The map's sections are read through every ancestor, not only a ticket's direct parent (#119).
it("a deep umbrella map, over an unplaced spec over two sections, ticks neither section's map", () => {
  const w = work({
    'Acme/plan#9': issue('Acme/plan#9', '', { labels: ['roadmap:map'] }),
    'Acme/app#12': issue('Acme/app#12', '', { title: 'Spec: everything', parent: 'Acme/plan#9' }),
    'Acme/app#10': issue('Acme/app#10', 'Section: tasks', { parent: 'Acme/app#12' }),
    'Acme/app#11': issue('Acme/app#11', 'Section: fix', { parent: 'Acme/app#12' }),
  });
  for (const section of ['tasks', 'fix']) expect(w.byNode[section]?.planning.map).toEqual([]);
});

it('an unplaced map over one section ticks that section, with its unplaced spec', () => {
  const w = work({
    'Acme/plan#9': issue('Acme/plan#9', '', { labels: ['roadmap:map'] }),
    'Acme/app#10': issue('Acme/app#10', 'Section: tasks', { parent: 'Acme/plan#9' }),
    'Acme/app#12': issue('Acme/app#12', '', { title: 'Spec: local', parent: 'Acme/plan#9' }),
  });
  expect(w.byNode['tasks']?.planning.map.map((i) => i.key)).toEqual(['Acme/plan#9']);
  expect(w.byNode['tasks']?.planning.spec.map((i) => i.key)).toEqual(['Acme/app#12']);
  expect(w.byNode['fix']?.planning.map).toEqual([]);
});

it('in ticket-count mode a configured parent map beats a bare title ID', () => {
  const ticketProject: Project = {
    ...project,
    progress: { basis: 'ticket-count', repositories: { 'Acme/app': 'fix' } },
  };
  const issues = {
    'Acme/app#10': issue('Acme/app#10', '', {
      title: 'cut C80: tidy the about page',
      parent: 'Acme/plan#1',
      labels: ['ready-for-agent'],
    }),
  };
  const ticketProgress = buildTicketProgress({
    project: ticketProject,
    issues,
    plan,
    nodes: snap.stages.flatMap((s) => s.nodes),
    maps: { 'Acme/plan#1': 'tasks' },
    at: '2026-10-16T01:00:00Z',
    complete: true,
    error: null,
  })!;
  expect(ticketProgress.totals.tickets.find((i) => i.key === 'Acme/app#10')?.section).toBe('tasks');
  const w = work(issues, [], { project: ticketProject, ticketProgress });
  expect(w.byNode['tasks']?.planning.tickets.map((i) => i.key)).toEqual(['Acme/app#10']);
});
