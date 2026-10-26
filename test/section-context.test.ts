import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import { buildSectionBrief, sectionBriefMarkdown } from '../src/web/sectionBrief.ts';
import type { Snapshot } from '../src/core/contract.ts';
import { scopeView, reviewView } from '../src/core/scope.ts';

const fixture = (name: string): string =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');

it('copies dated section context and leaves unknown scope pending', () => {
  const node = {
    id: 'new',
    title: 'New section',
    repo: 'Acme/plan',
    text: 'Diagram estimate: 40%, dated yesterday. Not a live audit.',
    stage: 1,
    row: 1,
    units: [],
  };
  const snapshot = buildSnapshot({
    audit: { ...(JSON.parse(fixture('audit.json')) as Audit), units: {} },
    flow: { ...(JSON.parse(fixture('flow.json')) as Flow), nodes: [node] },
    plan: parseBuildUnits('\n## Units by wave\n'),
    generatedAt: '2026-10-15T04:00:00Z',
  });
  const section = snapshot.stages[0]!.nodes[0]!;
  const scope = scopeView(section, []);
  const review = reviewView([], true);
  const populated: Snapshot = {
    ...snapshot,
    work: {
      at: snapshot.generatedAt,
      complete: true,
      error: null,
      byNode: {
        new: {
          state: 'planned',
          shares: scope.shares,
          scope,
          review,
          openPrs: [],
          planning: { idea: [], map: [], tickets: [], spec: [], build: [] },
          missing: [],
          blockers: [],
        },
      },
      review,
      unplacedPrs: [],
      wires: [],
    },
  };
  const brief = sectionBriefMarkdown(buildSectionBrief(populated, section));
  expect(brief).toContain(node.text);
  expect(brief).toContain('Scope: pending');
  expect(brief).toContain('Review collection: complete');
  expect(brief).not.toContain('Scope: live 0%');
});

it('dates the section snapshot source in AEST', () => {
  const snapshot = buildSnapshot({
    audit: JSON.parse(fixture('audit.json')) as Audit,
    flow: JSON.parse(fixture('flow.json')) as Flow,
    plan: parseBuildUnits(fixture('build-units.md')),
    generatedAt: '2026-10-17T01:00:00.000Z',
  });
  const node = snapshot.stages.flatMap((stage) => stage.nodes)[0]!;
  const source = buildSectionBrief(snapshot, node, false).source.find((line) =>
    line.startsWith('Snapshot:'),
  );
  expect(source).toMatch(/11:00(?::00)?\s*am/i);
});

it('lists a reviewed PR that still carries a review-debt label under both lists', () => {
  const snapshot = buildSnapshot({
    audit: JSON.parse(fixture('audit.json')) as Audit,
    flow: JSON.parse(fixture('flow.json')) as Flow,
    plan: parseBuildUnits(fixture('build-units.md')),
    generatedAt: '2026-10-17T01:00:00.000Z',
  });
  const node = snapshot.stages.flatMap((stage) => stage.nodes)[0]!;
  const scope = scopeView(node, []);
  const review = reviewView(
    [
      {
        key: 'Acme/app#7',
        title: 'Tidy the form',
        url: 'https://example.com/7',
        state: 'MERGED',
        review: 'reviewed',
        marked: true,
        receiptUrl: null,
        reason: 'Approved on the current head',
        labels: ['needs-review'],
        changedLines: 12,
      },
    ],
    true,
  );
  const brief = buildSectionBrief(
    {
      ...snapshot,
      work: {
        at: snapshot.generatedAt,
        complete: true,
        error: null,
        byNode: {
          [node.id]: {
            state: 'planned',
            shares: scope.shares,
            scope,
            review,
            openPrs: [],
            planning: { idea: [], map: [], tickets: [], spec: [], build: [] },
            missing: [],
            blockers: [],
          },
        },
        review,
        unplacedPrs: [],
        wires: [],
      },
    },
    node,
  );
  const rows = (id: string) =>
    brief.groups.find((group) => group.id === id)?.rows.map((row) => row.key);
  expect(rows('marked')).toEqual(['Acme/app#7']);
  expect(rows('reviewed')).toEqual(['Acme/app#7']);
});
