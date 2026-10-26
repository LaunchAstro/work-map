import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildWork, type WorkIssue } from '../src/core/work.ts';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import { emptyWorkCache, refreshWork } from '../src/readers/work-github.ts';
import { readProject, type Project } from '../src/readers/project.ts';
import { buildSectionBrief } from '../src/web/sectionBrief.ts';
import { planningStepTip } from '../src/web/stage.ts';

const fx = (s: string): string => readFileSync(new URL(`fixtures/${s}`, import.meta.url), 'utf8');
const plan = parseBuildUnits(fx('build-units.md'));
const snap = buildSnapshot({
  audit: JSON.parse(fx('audit.json')) as Audit,
  flow: JSON.parse(fx('flow.json')) as Flow,
  plan,
  generatedAt: '2026-10-17T01:00:00Z',
});
const nodes = snap.stages.flatMap((s) => s.nodes);
const project: Project = {
  version: 1,
  id: 'other',
  title: 'Other project',
  roadmapRepo: 'Acme/plan',
  productRepo: 'Acme/app',
  repos: ['Acme/app', 'Acme/plan'],
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
  specDocuments: {
    tasks: ['Acme/plan:docs/SPEC.md'],
    fix: ['Acme/plan:research/old spec/SPEC.md'],
  },
  dependencies: [],
};

/** A fake `gh` that answers the work collector, with the given files present on Acme/plan's main. */
const github =
  (files: readonly string[], asked: string[][] = []) =>
  async (args: readonly string[]): Promise<string> => {
    asked.push([...args]);
    if (args[1] === 'rate_limit')
      return JSON.stringify({
        resources: { core: { remaining: 4000 }, graphql: { remaining: 4000 } },
      });
    const query = args.find((a) => a.startsWith('query=')) ?? '';
    // Real GitHub fails the whole call for a missing Commit.file, so only object() is answered.
    if (query.includes('file(path:')) throw new Error('gh: Could not resolve file for path');
    if (query.includes('object(expression:')) {
      const name = args.find((a) => a.startsWith('name='));
      const paths = [...query.matchAll(/(d\d+): object\(expression: ("(?:[^"\\]|\\.)*")\)/g)].map(
        (m) => [m[1]!, (JSON.parse(m[2]!) as string).replace(/^HEAD:/, '')] as const,
      );
      return JSON.stringify({
        data: {
          rateLimit: { remaining: 3990 },
          repository: {
            defaultBranchRef: { name: 'main' },
            ...Object.fromEntries(
              paths.map(([alias, path]) => [
                alias,
                name === 'name=plan' && files.includes(path) ? { kind: 'Blob' } : null,
              ]),
            ),
          },
        },
      });
    }
    return JSON.stringify({
      data: {
        rateLimit: { remaining: 3999 },
        repository: query.includes('issues(first')
          ? { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } }
          : { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
      },
    });
  };

const specIssue: WorkIssue = {
  key: 'Acme/app#3',
  title: 'Spec: task board',
  body: '',
  url: 'https://github.com/Acme/app/issues/3',
  state: 'OPEN',
  parent: 'Acme/plan#1',
  labels: [],
  blockedBy: [],
  contextComplete: true,
};
const mapIssue: WorkIssue = {
  ...specIssue,
  key: 'Acme/plan#1',
  title: 'Task map',
  url: 'https://github.com/Acme/plan/issues/1',
  parent: null,
  labels: ['roadmap:map'],
};

it('a configured spec document on main ticks spec; a deleted one shows ×', async () => {
  // The collector confirms each configured document on the repository's default branch.
  const asked: string[][] = [];
  const first = await refreshWork({
    project,
    cache: emptyWorkCache('other'),
    run: github(['docs/SPEC.md', 'research/old spec/SPEC.md'], asked),
    now: new Date('2026-10-17T01:00:00Z'),
  });
  expect(first.specDocuments).toEqual({
    'Acme/plan:docs/SPEC.md': {
      found: true,
      branch: 'main',
      url: 'https://github.com/Acme/plan/blob/main/docs/SPEC.md',
      at: '2026-10-17T01:00:00.000Z',
    },
    'Acme/plan:research/old spec/SPEC.md': {
      found: true,
      branch: 'main',
      url: 'https://github.com/Acme/plan/blob/main/research/old%20spec/SPEC.md',
      at: '2026-10-17T01:00:00.000Z',
    },
  });
  // One query per repository, only for repositories that name documents.
  expect(asked.filter((a) => a.some((x) => x.includes('object(expression:')))).toHaveLength(1);

  // The old spec is deleted from main.
  const second = await refreshWork({
    project,
    cache: first,
    run: github(['docs/SPEC.md']),
    now: new Date('2026-10-17T02:00:00Z'),
  });
  expect(second.specDocuments?.['Acme/plan:research/old spec/SPEC.md']?.found).toBe(false);
  expect(second.specDocuments?.['Acme/plan:docs/SPEC.md']?.found).toBe(true);

  // A failed read keeps what was last confirmed.
  const failed = await refreshWork({
    project,
    cache: second,
    run: async (args) => {
      if ((args.find((a) => a.startsWith('query=')) ?? '').includes('object(expression:'))
        throw new Error('gh: Could not resolve to a Repository');
      return github([])(args);
    },
    now: new Date('2026-10-17T03:00:00Z'),
  });
  expect(failed.specDocuments).toEqual(second.specDocuments);

  const view = buildWork({
    project,
    plan,
    nodes,
    issues: {},
    prs: [],
    maps: {},
    specDocuments: second.specDocuments,
    at: 'now',
    complete: true,
    error: null,
  });
  // ✓ links to the file.
  expect(view.byNode['tasks']?.planning.spec).toEqual([
    {
      key: 'Acme/plan:docs/SPEC.md',
      title: 'docs/SPEC.md',
      url: 'https://github.com/Acme/plan/blob/main/docs/SPEC.md',
    },
  ]);
  expect(view.byNode['tasks']?.missing).not.toContain('spec');
  // A missing file gives ×.
  expect(view.byNode['fix']?.planning.spec).toEqual([]);
  expect(view.byNode['fix']?.missing).toContain('spec');
  // A document not read yet is no evidence either.
  const unread = buildWork({
    project,
    plan,
    nodes,
    issues: {},
    prs: [],
    maps: {},
    at: 'now',
    complete: true,
    error: null,
  });
  expect(unread.byNode['tasks']?.missing).toContain('spec');

  // The tooltip separates the spec issue from the spec document.
  const both = buildWork({
    project,
    plan,
    nodes,
    issues: { [mapIssue.key]: mapIssue, [specIssue.key]: specIssue },
    prs: [],
    maps: { 'Acme/plan#1': 'tasks' },
    specDocuments: second.specDocuments,
    at: 'now',
    complete: true,
    error: null,
  });
  expect(both.byNode['tasks']?.planning.spec.map((l) => l.key)).toEqual([
    'Acme/app#3',
    'Acme/plan:docs/SPEC.md',
  ]);
  expect(planningStepTip('spec', both.byNode['tasks'])).toBe(
    'Spec issue: Acme/app#3 Spec: task board\nSpec document on main: docs/SPEC.md (Acme/plan)',
  );
  expect(planningStepTip('spec', view.byNode['fix'])).toBe(
    'Spec issue: none\nSpec document missing on main: research/old spec/SPEC.md (Acme/plan)',
  );
  expect(planningStepTip('spec', unread.byNode['tasks'])).toBe(
    'Spec issue: none\nSpec document not checked yet: docs/SPEC.md (Acme/plan)',
  );
  expect(planningStepTip('build', both.byNode['tasks'])).toBeUndefined();
  // The section brief lists them apart too.
  const brief = buildSectionBrief(
    { ...snap, work: both },
    nodes.find((n) => n.id === 'tasks')!,
  );
  expect(
    brief.groups
      .find((s) => s.id === 'spec')
      ?.rows.map((r) => [r.key, r.details.join(' · ')] as const),
  ).toEqual([
    ['Acme/app#3', 'Spec issue'],
    ['Acme/plan:docs/SPEC.md', 'Spec document on main'],
  ]);
});

it('spec documents must name a configured repository and a plain relative path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spec-documents-'));
  const config = (specDocuments: unknown): string => {
    const file = join(dir, 'project.json');
    writeFileSync(file, JSON.stringify({ ...project, specDocuments }));
    return file;
  };
  expect(readProject(config({ tasks: ['Acme/plan:docs/SPEC.md'] })).project.specDocuments).toEqual({
    tasks: ['Acme/plan:docs/SPEC.md'],
  });
  expect(() => readProject(config({ tasks: ['Other/repo:docs/SPEC.md'] }))).toThrow(
    'Spec document repository is not configured: Other/repo',
  );
  for (const bad of ['Acme/plan:../SPEC.md', 'Acme/plan:/SPEC.md', 'Acme/plan:a"b.md', 'SPEC.md'])
    expect(() => readProject(config({ tasks: [bad] })), bad).toThrow();
});

it('a spec document on another default branch names that branch, never main (#139)', async () => {
  const develop = async (args: readonly string[]): Promise<string> =>
    (await github(['docs/SPEC.md'])(args)).replace(
      '"defaultBranchRef":{"name":"main"}',
      '"defaultBranchRef":{"name":"develop"}',
    );
  const read = await refreshWork({
    project,
    cache: emptyWorkCache('other'),
    run: develop,
    now: new Date('2026-10-17T01:00:00Z'),
  });
  const work = buildWork({
    project,
    plan,
    nodes,
    issues: {},
    prs: [],
    maps: {},
    specDocuments: read.specDocuments,
    at: 'now',
    complete: true,
    error: null,
  });
  const url = 'https://github.com/Acme/plan/blob/develop/docs/SPEC.md';
  expect(work.byNode['tasks']?.planning.spec[0]?.url).toBe(url);
  expect(planningStepTip('spec', work.byNode['tasks'])).toContain('Spec document on develop');
  const brief = buildSectionBrief(
    { ...snap, work },
    nodes.find((n) => n.id === 'tasks')!,
  );
  expect(brief.groups.find((s) => s.id === 'spec')?.rows[0]?.details).toEqual([
    'Spec document on develop',
  ]);
});

it('an empty repository has no spec documents, and its read still spends the reserve', async () => {
  const asked: string[] = [];
  const read = await refreshWork({
    project: {
      ...project,
      specDocuments: { tasks: ['Acme/plan:docs/SPEC.md', 'Acme/app:SPEC.md'] },
    },
    cache: emptyWorkCache('other'),
    now: new Date('2026-10-17T01:00:00Z'),
    run: async (args) => {
      if (!(args.find((a) => a.startsWith('query=')) ?? '').includes('object(expression:'))
        return github([])(args);
      asked.push(args.find((a) => a.startsWith('name='))!);
      // No default branch; the reply leaves 999 points, under the 1000 reserve.
      return JSON.stringify({
        data: { rateLimit: { remaining: 999 }, repository: { defaultBranchRef: null, d0: null } },
      });
    },
  });
  expect(read.complete).toBe(true);
  expect(asked).toEqual(['name=plan']);
  expect(read.specDocuments?.['Acme/plan:docs/SPEC.md']).toMatchObject({
    found: false,
    branch: null,
  });
});
