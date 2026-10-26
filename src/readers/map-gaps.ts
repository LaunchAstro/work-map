import { createHash } from 'node:crypto';
import { z } from 'zod';
import { compileSectionMap, ownerOf, type SectionMapFile } from '../core/sections.ts';
import { currentMapGapReport, gapCounts, type MapGapReport } from '../core/map-gaps.ts';
import type { OpenPr } from '../core/work.ts';
import { MIN_FLOOR } from './github.ts';

const revision = z.string().regex(/^[a-f0-9]{40}$/);
const repository = z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/);
const key = z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+#[1-9]\d*$/);
const path = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => [...value].every((character) => character.charCodeAt(0) >= 32));
interface FileInventory {
  readonly head: string;
  readonly base: string;
  readonly files: readonly string[];
  /** Complete pages were rechecked after the PR was declared merged. */
  readonly mergedVerified?: boolean | undefined;
}
export interface MapGapCache {
  readonly schema: 'work-map-gap-cache/1';
  readonly repo: string;
  readonly entries: Record<string, FileInventory>;
}
const inventory = z
  .strictObject({
    head: revision,
    base: revision,
    files: z.array(path).max(1000),
    mergedVerified: z.boolean().optional(),
  })
  .refine((value) => new Set(value.files).size === value.files.length);
const cacheSchema: z.ZodType<MapGapCache> = z.strictObject({
  schema: z.literal('work-map-gap-cache/1'),
  repo: repository,
  entries: z.record(key, inventory),
});
type Pr = Pick<OpenPr, 'key' | 'number' | 'headRefOid' | 'state'>;
const answerSchema = z.object({
  errors: z.array(z.unknown()).optional(),
  data: z.object({
    rateLimit: z.object({ remaining: z.number().int().nonnegative() }),
    repository: z.record(
      z.string(),
      z
        .object({
          headRefOid: revision,
          baseRefOid: revision,
          files: z
            .object({
              totalCount: z.number().int().nonnegative(),
              pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
              nodes: z.array(z.object({ path })),
            })
            .optional(),
        })
        .nullable(),
    ),
  }),
});
type QueryNode = NonNullable<z.infer<typeof answerSchema>['data']['repository'][string]>;
type FilePage = NonNullable<QueryNode['files']>;

/** Complete PR-file census for the section map's repository, without inference or publication effects.
 * The caller must also bound its read transport; this reader permits at most 45 seconds overall.
 */
export async function refreshMapGaps(input: {
  readonly map: SectionMapFile;
  readonly prs: readonly Pr[];
  readonly inventoryComplete: boolean;
  readonly run: (args: readonly string[], timeoutMs: number) => Promise<string>;
  readonly now: Date;
  readonly previousCache?: unknown;
  readonly previousReport?: unknown;
  readonly clock?: () => number;
}): Promise<{ report: MapGapReport; cache: MapGapCache }> {
  const { map, now, run } = input;
  const clock = input.clock ?? Date.now;
  const deadline = clock() + 45_000;
  const checkedAt = now.toISOString();
  const mapDigest = createHash('sha256').update(JSON.stringify(map)).digest('hex');
  const priorCache = cacheSchema.safeParse(input.previousCache);
  const priorReport = currentMapGapReport(input.previousReport);
  const previous =
    priorReport &&
    priorReport.repo === map.repo &&
    priorReport.mapDigest === mapDigest &&
    Date.parse(priorReport.checkedAt) <= now.getTime()
      ? priorReport
      : null;
  const lastKnown =
    previous?.complete && previous.at
      ? { at: previous.at, ...gapCounts(previous.gapFiles) }
      : (previous?.lastKnown ?? null);
  const unique = new Map<string, Pr>();
  const ambiguousStates = new Set<string>();
  let invalid = false;
  for (const pr of input.prs) {
    if (pr.key.split('#')[0] !== map.repo) continue;
    const existing = unique.get(pr.key);
    if (existing && existing.state !== pr.state) ambiguousStates.add(pr.key);
    if (
      !key.safeParse(pr.key).success ||
      !Number.isSafeInteger(pr.number) ||
      pr.number <= 0 ||
      pr.key !== `${map.repo}#${pr.number}` ||
      !revision.safeParse(pr.headRefOid).success ||
      (existing && existing.headRefOid !== pr.headRefOid)
    )
      invalid = true;
    unique.set(pr.key, pr);
  }
  const entries: MapGapCache['entries'] = {};
  if (priorCache.success && priorCache.data.repo === map.repo)
    for (const [name, value] of Object.entries(priorCache.data.entries))
      if (unique.get(name)?.headRefOid === value.head)
        entries[name] = { ...value, mergedVerified: value.mergedVerified ?? false };
  const cache: MapGapCache = { schema: 'work-map-gap-cache/1', repo: map.repo, entries };
  let prsRead = 0;
  const pending = (reason: string): { report: MapGapReport; cache: MapGapCache } => ({
    cache,
    report: {
      schema: 'work-map-gaps/1',
      repo: map.repo,
      mapDigest,
      checkedAt,
      at: lastKnown?.at ?? null,
      complete: false,
      reason,
      prsExpected: unique.size,
      prsRead,
      ...gapCounts(lastKnown?.gapFiles ?? 0),
      lastKnown,
    },
  });
  if (
    !repository.safeParse(map.repo).success ||
    invalid ||
    unique.size > 2000 ||
    !input.inventoryComplete
  )
    return pending('PR inventory is incomplete or lacks exact revisions; map gaps are pending');
  let remaining = 0;
  const checkedRead = async (args: readonly string[]): Promise<string> => {
    const milliseconds = Math.floor(Math.min(5000, deadline - clock()));
    if (milliseconds <= 0) throw new Error('deadline');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('deadline')), milliseconds);
      });
      const result = await Promise.race([
        timeout,
        Promise.resolve().then(() => run(args, milliseconds)),
      ]);
      if (clock() >= deadline) throw new Error('deadline');
      return result;
    } finally {
      clearTimeout(timer);
    }
  };
  const [owner = '', name = ''] = map.repo.split('/');
  const query = async (
    prs: readonly Pr[],
    fileKeys: ReadonlySet<string>,
    cursors: ReadonlyMap<string, string> = new Map(),
  ) => {
    // At most twenty 100-file connections, or one hundred metadata-only PRs: leave room
    // for the batch's cost above the reserve before sending a query.
    if (remaining < MIN_FLOOR + 100) throw new Error('reserve');
    const fields = prs
      .map(
        (pr) =>
          `p${pr.number}: pullRequest(number: ${pr.number}) { headRefOid baseRefOid ${fileKeys.has(pr.key) ? `files(first:100${cursors.has(pr.key) ? `,after:${JSON.stringify(cursors.get(pr.key))}` : ''}) { totalCount pageInfo { hasNextPage endCursor } nodes { path } }` : ''} }`,
      )
      .join(' ');
    const raw = await checkedRead([
      'api',
      'graphql',
      '-f',
      `query=query($owner:String!,$name:String!) { rateLimit { cost remaining } repository(owner:$owner,name:$name) { ${fields} } }`,
      '-f',
      `owner=${owner}`,
      '-f',
      `name=${name}`,
    ]);
    const result = answerSchema.parse(JSON.parse(raw));
    if (result.errors?.length) throw new Error('read');
    remaining = result.data.rateLimit.remaining;
    if (remaining < MIN_FLOOR) throw new Error('reserve');
    for (const pr of prs) {
      const value = result.data.repository[`p${pr.number}`];
      if (!value || value.headRefOid !== pr.headRefOid) throw new Error('revision');
    }
    return result.data.repository;
  };
  try {
    const sectionMap = compileSectionMap(map);
    const prs = [...unique.values()];
    // A merged PR's comparison never changes, so its inventory is reused once rechecked in full.
    // PRs still open, or whose state is unknown or conflicting, are read again.
    const toRead = prs.filter(
      (pr) =>
        pr.state !== 'MERGED' ||
        ambiguousStates.has(pr.key) ||
        entries[pr.key]?.mergedVerified !== true,
    );
    prsRead = prs.length - toRead.length;
    if (toRead.length) {
      const limits = z
        .object({
          resources: z.object({
            core: z.object({ remaining: z.number() }),
            graphql: z.object({ remaining: z.number() }),
          }),
        })
        .parse(JSON.parse(await checkedRead(['api', 'rate_limit'])));
      remaining = Math.min(limits.resources.core.remaining, limits.resources.graphql.remaining);
    }
    const observed = new Map<string, { head: string; base: string }>();
    for (let start = 0; start < toRead.length; start += 20) {
      const batch = toRead.slice(start, start + 20);
      const need = new Set(batch.filter((pr) => !entries[pr.key]).map((pr) => pr.key));
      // oxlint-disable-next-line no-await-in-loop -- bounded pages use the preceding revision and budget
      let nodes = await query(batch, need);
      const changed = batch.filter(
        (pr) => entries[pr.key] && entries[pr.key]!.base !== nodes[`p${pr.number}`]!.baseRefOid,
      );
      if (changed.length) {
        for (const pr of changed) {
          delete entries[pr.key];
          need.add(pr.key);
        }
        // oxlint-disable-next-line no-await-in-loop -- a changed comparison base requires its own fresh file list
        const fresh = await query(changed, new Set(changed.map((pr) => pr.key)));
        nodes = { ...nodes, ...fresh };
      }
      for (const pr of batch) {
        const node = nodes[`p${pr.number}`]!;
        observed.set(pr.key, { head: node.headRefOid, base: node.baseRefOid });
        if (need.has(pr.key)) {
          if (!node.files) throw new Error('files');
          let page: FilePage = node.files;
          const total = page.totalCount;
          if (total > 1000) throw new Error('files');
          const paths: string[] = [];
          const seenCursors = new Set<string>();
          while (true) {
            if (page.totalCount !== total || paths.length + page.nodes.length > total)
              throw new Error('files');
            paths.push(...page.nodes.map((file) => file.path));
            if (!page.pageInfo.hasNextPage) break;
            const cursor: string | null = page.pageInfo.endCursor;
            if (
              !cursor ||
              seenCursors.has(cursor) ||
              page.nodes.length === 0 ||
              paths.length >= total
            )
              throw new Error('files');
            seenCursors.add(cursor);
            // oxlint-disable-next-line no-await-in-loop -- file pagination is tied to the observed exact comparison
            const pageResult = await query([pr], new Set([pr.key]), new Map([[pr.key, cursor]]));
            const next: QueryNode = pageResult[`p${pr.number}`]!;
            if (next.baseRefOid !== node.baseRefOid || !next.files) throw new Error('revision');
            page = next.files;
          }
          if (paths.length !== total || new Set(paths).size !== total) throw new Error('files');
          entries[pr.key] = {
            head: node.headRefOid,
            base: node.baseRefOid,
            files: paths,
            mergedVerified: false,
          };
        }
        prsRead++;
      }
    }
    for (let start = 0; start < toRead.length; start += 100) {
      const batch = toRead.slice(start, start + 100);
      // oxlint-disable-next-line no-await-in-loop -- recheck the entire observed inventory before a current result
      const nodes = await query(batch, new Set());
      for (const pr of batch) {
        const final = nodes[`p${pr.number}`]!;
        if (observed.get(pr.key)?.base !== final.baseRefOid) {
          delete entries[pr.key];
          throw new Error('revision');
        }
        entries[pr.key] = {
          ...entries[pr.key]!,
          mergedVerified: pr.state === 'MERGED' && !ambiguousStates.has(pr.key),
        };
      }
    }
    if (clock() > deadline) throw new Error('deadline');
    const gaps = new Set<string>();
    for (const pr of prs)
      for (const file of entries[pr.key]!.files)
        if (ownerOf(sectionMap, file) === null) gaps.add(file);
    const current = { at: checkedAt, ...gapCounts(gaps.size) };
    return {
      cache,
      report: {
        schema: 'work-map-gaps/1',
        repo: map.repo,
        mapDigest,
        checkedAt,
        ...current,
        complete: true,
        reason:
          'Complete changed-file census of tracked merged and open PRs in the mapped repository',
        prsExpected: prs.length,
        prsRead,
        lastKnown: current,
      },
    };
  } catch {
    return pending(
      'Map-gap read was incomplete, changed or reached its bound; last-known coverage is retained',
    );
  }
}
