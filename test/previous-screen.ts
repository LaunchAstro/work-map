// The previous screen's input checks, copied from 7ab0a88 (src/core/map-gaps.ts currentMapGapReport and the
// shape part of src/web/snapshot.ts currentSnapshot). A window left open keeps that code until it reloads, so
// what the collector writes now must still pass them. The rest of the old snapshot check (ticket progress,
// spec progress, the loading bay) reads parts this cleanup did not change.
import { z } from 'zod';

const counts = {
  filesSeen: z.number().int().nonnegative(),
  gapFiles: z.number().int().nonnegative(),
  prsWithGaps: z.number().int().nonnegative(),
  topGapFolders: z
    .array(z.strictObject({ folder: z.string(), files: z.number().int().nonnegative() }))
    .max(15),
};
const observation = z.strictObject({ at: z.iso.datetime(), ...counts });
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

/** Whether the previous screen accepts a map-gap report, as written to disk (JSON). */
export function previousMapGapReport(value: unknown): boolean {
  const parsed = reportSchema.safeParse(JSON.parse(JSON.stringify(value)));
  if (!parsed.success) return false;
  const report = parsed.data;
  return !(
    (report.at && Date.parse(report.at) > Date.parse(report.checkedAt)) ||
    (report.lastKnown && Date.parse(report.lastKnown.at) > Date.parse(report.checkedAt)) ||
    (report.complete &&
      (!report.at ||
        report.at !== report.checkedAt ||
        report.prsRead !== report.prsExpected ||
        report.prsWithGaps > report.prsExpected ||
        report.gapFiles > report.filesSeen)) ||
    (report.lastKnown && report.lastKnown.gapFiles > report.lastKnown.filesSeen)
  );
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function measured(value: unknown): boolean {
  return (
    object(value) &&
    object(value['coded']) &&
    object(value['on']) &&
    object(value['estimate']) &&
    object(value['reviewed']) &&
    object(value['sinceAudit'])
  );
}
function planning(value: unknown): boolean {
  return (
    object(value) &&
    ['idea', 'map', 'tickets', 'spec', 'build'].every((step) => Array.isArray(value[step]))
  );
}
function date(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/** Whether the previous screen accepts a snapshot's shape, as written to disk (JSON). */
export function previousSnapshotShape(snapshot: unknown): boolean {
  const value: unknown = JSON.parse(JSON.stringify(snapshot));
  if (
    !object(value) ||
    value['schema'] !== 'work-map/4' ||
    typeof value['title'] !== 'string' ||
    typeof value['id'] !== 'string' ||
    !date(value['generatedAt']) ||
    !measured(value['totals']) ||
    !Array.isArray(value['stages']) ||
    !object(value['prs']) ||
    !object(value['sources']) ||
    !object(value['sources']['audit']) ||
    !object(value['view']) ||
    !Array.isArray(value['view']['wires']) ||
    !object(value['stats']) ||
    !date(value['stats']['at']) ||
    !object(value['sweep']) ||
    !object(value['unmapped']) ||
    !Array.isArray(value['unmapped']['prs'])
  )
    return false;
  if (
    !value['stages'].every(
      (stage) =>
        object(stage) &&
        measured(stage) &&
        typeof stage['name'] === 'string' &&
        typeof stage['index'] === 'number' &&
        Array.isArray(stage['nodes']) &&
        stage['nodes'].every(
          (node) =>
            object(node) &&
            measured(node) &&
            typeof node['id'] === 'string' &&
            typeof node['title'] === 'string' &&
            typeof node['row'] === 'number' &&
            Array.isArray(node['units']),
        ),
    )
  )
    return false;
  const work = value['work'];
  if (work !== undefined) {
    if (
      !object(work) ||
      !object(work['byNode']) ||
      !object(work['review']) ||
      !Array.isArray(work['unplacedPrs'])
    )
      return false;
    if (
      !Object.values(work['byNode']).every(
        (node) =>
          object(node) &&
          object(node['scope']) &&
          object(node['scope']['shares']) &&
          object(node['scope']['display']) &&
          object(node['review']) &&
          Array.isArray(node['review']['prs']) &&
          Array.isArray(node['openPrs']) &&
          Array.isArray(node['missing']) &&
          Array.isArray(node['blockers']) &&
          planning(node['planning']),
      )
    )
      return false;
  }
  // The previous Overview runs its map-gap check on `mapGaps` before showing the count.
  return value['mapGaps'] == null || previousMapGapReport(value['mapGaps']);
}

// The previous screen's agents check, copied from 84ac529 (src/web/snapshot.ts currentAgents, without the
// optional seatGauge part, which drops a bad gauge rather than refusing the file). It requires herdr and
// seen.herdr, so the collector keeps writing them until #310.
/** Whether the previous screen accepts an agents file's shape, as written to disk (JSON). */
export function previousAgentsShape(agents: unknown): boolean {
  const value: unknown = JSON.parse(JSON.stringify(agents));
  if (
    !object(value) ||
    value['schema'] !== 'work-map-agents/2' ||
    !date(value['generatedAt']) ||
    !object(value['herdr']) ||
    typeof value['herdr']['ok'] !== 'boolean' ||
    !Array.isArray(value['lanes']) ||
    !object(value['byNode']) ||
    !Array.isArray(value['fog'])
  )
    return false;
  return value['lanes'].every(
    (lane) =>
      object(lane) &&
      typeof lane['lane'] === 'string' &&
      ['working', 'idle', 'blocked', 'done', 'unknown'].includes(String(lane['state'])) &&
      Array.isArray(lane['nodes']) &&
      Array.isArray(lane['tickets']) &&
      Array.isArray(lane['units']) &&
      object(lane['seen']) &&
      typeof lane['seen']['herdr'] === 'boolean' &&
      typeof lane['seen']['events'] === 'boolean' &&
      (lane['last'] === null ||
        (object(lane['last']) &&
          date(lane['last']['at']) &&
          typeof lane['last']['verb'] === 'string' &&
          typeof lane['last']['text'] === 'string')),
  );
}
