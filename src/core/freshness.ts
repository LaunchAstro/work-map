// SPDX-License-Identifier: AGPL-3.0-only

/** How long GitHub-derived evidence stays current: ten minutes. */
export const EVIDENCE_MAX_AGE = 600_000;

/** Whether `at` is no later than `now` and at most `max` old; false for a missing or unreadable time. */
export function fresh(
  at: string | null | undefined,
  now: number,
  max: number = EVIDENCE_MAX_AGE,
): boolean {
  const time = at ? Date.parse(at) : NaN;
  return Number.isFinite(time) && time <= now && now - time <= max;
}

/**
 * #242: whether card evidence was read at all: a readable time no later than `now`. Section cards and the
 * header call-outs read from GitHub only on Sync (#245), so between reads they show their last
 * good values with this time and its age; only evidence never read is pending.
 */
export function readOnce(at: string | null | undefined, now: number): boolean {
  return fresh(at, now, Number.POSITIVE_INFINITY);
}
