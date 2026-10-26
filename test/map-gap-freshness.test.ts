import { expect, it } from 'vitest';
import { mapGapsCurrent } from '../src/web/map-gap-freshness.ts';
import type { MapGapReport } from '../src/core/map-gaps.ts';
const now = Date.parse('2026-10-15T00:00:00.000Z');
const report: MapGapReport = {
  schema: 'work-map-gaps/1',
  repo: 'Demo/product',
  mapDigest: 'a'.repeat(64),
  at: new Date(now).toISOString(),
  checkedAt: new Date(now).toISOString(),
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
// #242: map gaps are read on Sync; the last complete census stands, with its time, until the next one.
it('a complete census stays shown past ten minutes', () => {
  expect(mapGapsCurrent(report, false, 'Demo/product', now + 600_000)).toBe(true);
  expect(mapGapsCurrent(report, false, 'Demo/product', now + 86_400_000)).toBe(true);
});
it('partial, failed, future, foreign and missing reports do not establish current coverage', () => {
  expect(mapGapsCurrent({ ...report, complete: false }, false, 'Demo/product', now)).toBe(false);
  expect(mapGapsCurrent(report, true, 'Demo/product', now)).toBe(false);
  expect(mapGapsCurrent(report, false, 'Demo/product', now - 1)).toBe(false);
  expect(mapGapsCurrent(report, false, 'Other/product', now)).toBe(false);
  expect(mapGapsCurrent(null, false, 'Demo/product', now)).toBe(false);
});
