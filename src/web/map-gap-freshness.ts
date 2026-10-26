import type { MapGapReport } from '../core/map-gaps.ts';
import { readOnce } from '../core/freshness.ts';

export function mapGapsCurrent(
  report: MapGapReport | null,
  failed: boolean,
  repo: string,
  now: number,
): boolean {
  if (!report?.complete || failed || report.repo !== repo) return false;
  // #242: map gaps are read on Sync; between Syncs the last complete census stands, with its time.
  return readOnce(report.checkedAt, now);
}
