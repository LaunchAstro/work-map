import { z } from 'zod';

/**
 * The gap count, with the census fields the previous screen's check still requires. Nothing reads
 * them, so they are written fixed: as many files seen as gaps, no PRs, no folders.
 */
interface GapCounts {
  readonly gapFiles: number;
  readonly filesSeen: number;
  readonly prsWithGaps: number;
  readonly topGapFolders: readonly { readonly folder: string; readonly files: number }[];
}
export const gapCounts = (gapFiles: number): GapCounts => ({
  gapFiles,
  filesSeen: gapFiles,
  prsWithGaps: 0,
  topGapFolders: [],
});
interface GapObservation extends GapCounts {
  readonly at: string;
}
export interface MapGapReport extends GapCounts {
  readonly schema: 'work-map-gaps/1';
  readonly repo: string;
  readonly mapDigest: string;
  readonly checkedAt: string;
  readonly at: string | null;
  readonly complete: boolean;
  readonly reason: string;
  readonly prsExpected: number;
  readonly prsRead: number;
  readonly lastKnown: GapObservation | null;
}

const counts = {
  gapFiles: z.number().int().nonnegative(),
  // Read and replaced by the fixed values (gapCounts); older reports carry real ones.
  filesSeen: z.number().int().nonnegative().optional(),
  prsWithGaps: z.number().int().nonnegative().optional(),
  topGapFolders: z
    .array(z.strictObject({ folder: z.string(), files: z.number().int().nonnegative() }))
    .max(15)
    .optional(),
};
const observation = z
  .strictObject({ at: z.iso.datetime(), ...counts })
  .transform(({ at, gapFiles }) => ({ at, ...gapCounts(gapFiles) }));
const reportSchema = z.strictObject({
  schema: z.literal('work-map-gaps/1'),
  repo: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/),
  mapDigest: z.string().regex(/^[a-f0-9]{64}$/),
  checkedAt: z.iso.datetime(),
  at: z.iso.datetime().nullable(),
  complete: z.boolean(),
  reason: z.string(),
  prsExpected: z.number().int().nonnegative(),
  prsRead: z.number().int().nonnegative(),
  ...counts,
  lastKnown: observation.nullable(),
});

export function currentMapGapReport(value: unknown): MapGapReport | null {
  const parsed = reportSchema.safeParse(value);
  if (!parsed.success) return null;
  const { filesSeen: _, prsWithGaps: __, topGapFolders: ___, ...read } = parsed.data;
  const report = { ...read, ...gapCounts(read.gapFiles) };
  if (
    (report.at && Date.parse(report.at) > Date.parse(report.checkedAt)) ||
    (report.lastKnown && Date.parse(report.lastKnown.at) > Date.parse(report.checkedAt)) ||
    (report.complete &&
      (!report.at || report.at !== report.checkedAt || report.prsRead !== report.prsExpected))
  )
    return null;
  return report;
}

export function mapGapCollectionFailure(
  previous: unknown,
  repo: string,
  now: Date,
): MapGapReport | null {
  const report = currentMapGapReport(previous);
  if (!report || report.repo !== repo || Date.parse(report.checkedAt) > now.getTime()) return null;
  const { at, gapFiles } = report;
  return {
    ...report,
    checkedAt: now.toISOString(),
    complete: false,
    reason: 'Map-gap collection failed; fresh coverage pending',
    prsRead: 0,
    lastKnown: report.complete && at ? { at, ...gapCounts(gapFiles) } : report.lastKnown,
  };
}
