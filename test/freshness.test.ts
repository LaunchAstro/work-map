import { expect, it } from 'vitest';
import { EVIDENCE_MAX_AGE, fresh } from '../src/core/freshness.ts';

it('evidence is fresh from its own time to exactly ten minutes old; future or unreadable times are not', () => {
  const now = Date.parse('2026-10-17T01:00:00Z');
  const aged = (ms: number) => new Date(now - ms).toISOString();
  expect(EVIDENCE_MAX_AGE).toBe(600_000);
  for (const ms of [0, 1, 599_999, 600_000]) expect(fresh(aged(ms), now), String(ms)).toBe(true);
  for (const ms of [-1, 600_001]) expect(fresh(aged(ms), now), String(ms)).toBe(false);
  for (const at of [undefined, null, '', 'unreadable']) expect(fresh(at, now)).toBe(false);
});
