import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildSnapshot } from '../../src/core/snapshot.ts';
import { parseBuildUnits, type Audit, type Flow } from '../../src/core/plan.ts';
import { buildWork, type OpenPr } from '../../src/core/work.ts';
import { buildSectionBrief, sectionBriefMarkdown } from '../../src/web/sectionBrief.ts';
import type { Project } from '../../src/readers/project.ts';

const fx = (s: string): string =>
  readFileSync(new URL(`../fixtures/${s}`, import.meta.url), 'utf8');
const plan = parseBuildUnits(fx('build-units.md'));
const snap = buildSnapshot({
  audit: JSON.parse(fx('audit.json')) as Audit,
  flow: JSON.parse(fx('flow.json')) as Flow,
  plan,
  generatedAt: '2026-10-16T01:00:00Z',
});
const nodes = snap.stages.flatMap((s) => s.nodes);
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
    ideaLabels: [],
    ideaPattern: '^Idea:',
    specLabels: [],
    readyLabel: 'ready-for-agent',
    ticketLabels: [],
    specPattern: '^Spec:',
  },
  dependencies: [],
};
const pr = (number: number, body: string, docsOnly: boolean, state: 'OPEN' | 'MERGED'): OpenPr => ({
  key: `Acme/app#${number}`,
  number,
  title: `Change ${number}`,
  body,
  headRefName: 'work',
  url: `https://github.com/Acme/app/pull/${number}`,
  issueKeys: number === 6 ? ['Acme/app#60'] : [],
  state,
  docsOnly,
});
const run = (ownedSections?: readonly string[]) =>
  buildWork({
    project,
    plan,
    nodes,
    issues: {
      'Acme/app#60': {
        key: 'Acme/app#60',
        title: 'A fix ticket',
        body: 'Section: fix',
        url: 'https://github.com/Acme/app/issues/60',
        state: 'OPEN',
        parent: null,
        labels: [],
        blockedBy: [],
        contextComplete: true,
      },
    },
    prs: [
      // Agent docs declared into a product section that owns no paths.
      pr(1, 'Section: fix', true, 'OPEN'),
      // A real change to that section is fine.
      pr(2, 'Section: fix', false, 'OPEN'),
      // Docs declared into a section that does own paths are fine.
      pr(3, 'Section: tasks', true, 'OPEN'),
      // Placed by its ticket, not a Section line: nothing was declared, so nothing is flagged.
      pr(6, 'Closes #60', true, 'OPEN'),
    ],
    trackedMergedPrs: [pr(4, 'Section: fix', true, 'MERGED')],
    maps: {},
    at: '2026-10-16T01:00:00Z',
    complete: true,
    error: null,
    ...(ownedSections ? { ownedSections } : {}),
  });

it('a docs-only PR declaring an empty product section is flagged', () => {
  const work = run(['found', 'tasks']);
  expect(work.byNode['fix']?.warnings?.map((w) => w.key)).toEqual(['Acme/app#1', 'Acme/app#4']);
  expect(work.byNode['fix']?.warnings?.[0]?.reason).toBe(
    'Declares Section: fix but only changes documentation, and fix owns no product paths in the section map. Tooling and agent docs belong to Section: outside.',
  );
  expect(work.byNode['tasks']?.warnings).toEqual([]);
  expect(work.byNode['found']?.warnings).toEqual([]);
  // The section details show it.
  const node = nodes.find((n) => n.id === 'fix')!;
  const text = sectionBriefMarkdown(buildSectionBrief({ ...snap, work }, node));
  expect(text).toContain('Placement warnings');
  expect(text).toContain('(https://github.com/Acme/app/pull/1)');
  // Without a section map there is nothing to compare against, so nothing is flagged.
  expect(Object.values(run().byNode).flatMap((n) => n.warnings)).toEqual([]);
});
