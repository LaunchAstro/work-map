import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { buildWork, withWork } from '../src/core/work.ts';
import { currentMapGapReport, mapGapCollectionFailure } from '../src/core/map-gaps.ts';
import { parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import type { Project } from '../src/readers/project.ts';
import { currentSnapshot } from '../src/web/snapshot.ts';
import { previousMapGapReport, previousSnapshotShape } from './previous-screen.ts';

const fx = (s: string): string => readFileSync(new URL(`fixtures/${s}`, import.meta.url), 'utf8');
const plan = parseBuildUnits(fx('build-units.md'));
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
  dependencies: [],
};
const at = '2026-10-14T01:00:00.000Z';
const report = {
  schema: 'work-map-gaps/1',
  repo: 'Acme/app',
  mapDigest: 'a'.repeat(64),
  checkedAt: at,
  at,
  complete: true,
  reason: 'Complete',
  prsExpected: 2,
  prsRead: 2,
  filesSeen: 40,
  gapFiles: 3,
  prsWithGaps: 2,
  topGapFolders: [{ folder: 'src', files: 3 }],
  lastKnown: null,
};

it('a snapshot the collector writes now still passes the previous screen’s check', () => {
  const snap = buildSnapshot({
    audit: JSON.parse(fx('audit.json')) as Audit,
    flow: JSON.parse(fx('flow.json')) as Flow,
    plan,
    prs: [
      {
        number: 7,
        title: 'C80 done',
        body: 'Ticket: C80',
        url: 'https://github.com/Acme/app/pull/7',
        mergedAt: '2026-10-14T00:00:00Z',
        updatedAt: '2026-10-14T00:00:00Z',
        headRefName: 'c80',
        labels: ['unreviewed'],
      },
    ],
    generatedAt: at,
    openState: { at, queued: 1 },
  });
  const work = buildWork({
    project,
    plan,
    nodes: snap.stages.flatMap((s) => s.nodes),
    issues: {},
    prs: [],
    maps: {},
    at,
    complete: true,
    error: null,
  });
  for (const mapGaps of [
    currentMapGapReport(report),
    mapGapCollectionFailure(report, 'Acme/app', new Date('2026-10-14T02:00:00Z')),
    null,
  ]) {
    const written = { ...withWork(snap, work), mapGaps };
    expect(previousSnapshotShape(written)).toBe(true);
    expect(currentSnapshot(JSON.parse(JSON.stringify(written)))).not.toBeNull();
  }
  expect(previousMapGapReport(currentMapGapReport(report))).toBe(true);
});
