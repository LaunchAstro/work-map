import { expect, it } from 'vitest';
import { githubMetricsCurrent } from '../src/web/github-freshness.ts';
const now = Date.parse('2026-10-15T00:00:00.000Z');
const at = new Date(now - 60_000).toISOString();
it('only a fresh complete read establishes current merge and queue figures', () => {
  expect(githubMetricsCurrent({ at, partial: false, skipped: null }, false, at, now)).toBe(true);
});
it.each([
  null,
  { at, partial: true },
  { at, error: 'failed' },
  { at, skipped: 'reserve' },
  { at: new Date(now - 600_001).toISOString() },
  { at: new Date(now + 1).toISOString() },
])('missing or unhealthy evidence leaves current figures pending', (run) => {
  expect(githubMetricsCurrent(run, false, at, now)).toBe(false);
});
it('retained browser data and a mismatching observation cannot become current', () => {
  expect(githubMetricsCurrent({ at }, true, at, now)).toBe(false);
  expect(githubMetricsCurrent({ at }, false, new Date(now - 700_000).toISOString(), now)).toBe(
    false,
  );
});
