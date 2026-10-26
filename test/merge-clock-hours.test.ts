// SPDX-License-Identifier: AGPL-3.0-only
// #257: the merge chart's bars are clock hours, labelled by the hour, the newest one the hour so far.
import { expect, it } from 'vitest';
import type { PrView } from '../src/core/contract.ts';
import { hourLabel, hourSpan } from '../src/core/time.ts';
import { clockHours } from '../src/web/activity.ts';

const merged = (...times: string[]): Record<string, PrView> =>
  Object.fromEntries(
    times.map((time, i) => [String(i), { mergedAt: `2026-10-19T${time}Z` } as PrView]),
  );

it('ends on the hour so far and starts each earlier bar on the hour', () => {
  // 03:30Z is 1:30 pm AEST. A merge on the hour belongs to the bar that hour starts; one at the
  // moment of the read is in the hour so far.
  const hours = clockHours(
    merged('03:30:00', '03:10:00', '02:59:59', '02:00:00', '01:30:00', '01:00:00', '00:59:59'),
    '2026-10-19T03:30:00Z',
    3,
  );
  expect(hours.map((h) => [h.start, h.end, h.count])).toEqual([
    ['2026-10-19T01:00:00.000Z', '2026-10-19T02:00:00.000Z', 2],
    ['2026-10-19T02:00:00.000Z', '2026-10-19T03:00:00.000Z', 2],
    ['2026-10-19T03:00:00.000Z', '2026-10-19T03:30:00.000Z', 2],
  ]);
  // Read exactly on the hour, a merge at that moment is counted once, in the new hour.
  expect(clockHours(merged('03:00:00'), '2026-10-19T03:00:00Z', 2).map((h) => h.count)).toEqual([
    0, 1,
  ]);
  expect(clockHours({}, 'unknown', 3)).toEqual([]);
});

it('labels a bar by its starting hour and spans it start to finish, in AEST', () => {
  expect(hourLabel('2026-10-19T03:00:00.000Z')).toBe('1 pm');
  expect(hourLabel('2026-10-19T14:00:00.000Z')).toBe('12 am');
  expect(hourSpan('2026-10-19T03:00:00.000Z', '2026-10-19T03:30:00.000Z')).toBe(
    '1:00 pm – 1:30 pm',
  );
});
