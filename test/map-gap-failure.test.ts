import { expect, it } from 'vitest';
import { currentMapGapReport, mapGapCollectionFailure } from '../src/core/map-gaps.ts';
import type { MapGapReport } from '../src/core/map-gaps.ts';
import { previousMapGapReport } from './previous-screen.ts';
const prior: MapGapReport = {
  schema: 'work-map-gaps/1',
  repo: 'Demo/product',
  mapDigest: 'a'.repeat(64),
  checkedAt: '2026-10-15T00:00:00.000Z',
  at: '2026-10-15T00:00:00.000Z',
  complete: true,
  reason: 'Complete',
  prsExpected: 1,
  prsRead: 1,
  filesSeen: 2,
  gapFiles: 1,
  prsWithGaps: 1,
  topGapFolders: [],
  lastKnown: null,
};
it('a collector failure marks even recent coverage pending and preserves its dated observation', () => {
  const failed = mapGapCollectionFailure(prior, 'Demo/product', new Date('2026-10-15T00:01:00Z'));
  expect(failed).toMatchObject({
    complete: false,
    prsRead: 0,
    checkedAt: '2026-10-15T00:01:00.000Z',
    lastKnown: { at: prior.at, gapFiles: 1 },
  });
  expect(previousMapGapReport(failed)).toBe(true);
  expect(
    mapGapCollectionFailure(failed, 'Demo/product', new Date('2026-10-15T00:02:00Z'))?.lastKnown,
  ).toEqual(failed?.lastKnown);
});
it('invalid, future or foreign prior reports cannot survive a failed collection', () => {
  expect(mapGapCollectionFailure({}, 'Demo/product', new Date())).toBeNull();
  expect(mapGapCollectionFailure(prior, 'Other/product', new Date())).toBeNull();
  expect(
    mapGapCollectionFailure(prior, 'Demo/product', new Date('2026-10-14T00:00:00Z')),
  ).toBeNull();
});
it('reads a report with real census fields, and keeps only fixed ones the previous screen accepts', () => {
  const older = {
    ...prior,
    topGapFolders: [{ folder: 'src', files: 1 }],
    lastKnown: { at: prior.at, filesSeen: 2, gapFiles: 1, prsWithGaps: 1, topGapFolders: [] },
  };
  const fixed = { filesSeen: 1, gapFiles: 1, prsWithGaps: 0, topGapFolders: [] };
  expect(currentMapGapReport(older)).toEqual({
    ...prior,
    ...fixed,
    lastKnown: { at: prior.at, ...fixed },
  });
  expect(previousMapGapReport(currentMapGapReport(older))).toBe(true);
});
