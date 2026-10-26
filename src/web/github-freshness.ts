// SPDX-License-Identifier: AGPL-3.0-only
import type { GithubRunLog } from '../core/contract.ts';
import { fresh, readOnce } from '../core/freshness.ts';

export function githubMetricsCurrent(
  run: GithubRunLog | null | undefined,
  failed: boolean,
  at: string,
  now: number,
): boolean {
  return Boolean(
    run &&
    !failed &&
    !run.error &&
    !run.partial &&
    !run.skipped &&
    fresh(run.at, now) &&
    Date.parse(run.at) === Date.parse(at),
  );
}

/**
 * #242: whether the merge panel has figures to show: the current read's, or the last good read's when a
 * newer one was skipped at the reserve or failed. The caller labels the second with its time.
 */
export function githubMetricsShown(
  run: GithubRunLog | null | undefined,
  failed: boolean,
  at: string,
  now: number,
): boolean {
  if (githubMetricsCurrent(run, failed, at, now)) return true;
  return Boolean(
    run &&
    !failed &&
    readOnce(at, now) &&
    readOnce(run.at, now) &&
    Date.parse(at) <= Date.parse(run.at) &&
    (Date.parse(at) < Date.parse(run.at) || (!run.error && !run.partial && !run.skipped)),
  );
}
