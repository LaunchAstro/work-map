import { z } from 'zod';
import { MIN_FLOOR } from './github.ts';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import {
  VersionSitesSchema,
  type VersionSite,
  type VersionObservation,
  type SiteVersion,
  type VersionsSnapshot,
} from '../core/versions.ts';

const CommitSchema = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) });
const CompareSchema = z.object({
  status: z.enum(['ahead', 'identical', 'behind', 'diverged']),
  ahead_by: z.number().int().nonnegative(),
  total_commits: z.number().int().nonnegative(),
  base_commit: CommitSchema,
  merge_base_commit: CommitSchema,
  commits: z.array(CommitSchema),
});
const AssociatedSchema = z.object({
  associatedPullRequests: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean() }),
    nodes: z.array(
      z.object({
        number: z.number().int().positive(),
        merged: z.boolean(),
        mergeCommit: z.object({ oid: z.string().regex(/^[a-f0-9]{40}$/) }).nullable(),
      }),
    ),
  }),
});
const GraphqlSchema = z.object({
  errors: z.array(z.unknown()).optional(),
  data: z
    .object({
      rateLimit: z.object({ remaining: z.number().int().nonnegative() }),
      repository: z.record(z.string(), z.unknown()),
    })
    .optional(),
});
const StampSchema = z.object({ build: z.string().regex(/^[a-f0-9]{12}(?:-dirty)?$/) });
const LimitsSchema = z.object({
  resources: z.object({
    core: z.object({ remaining: z.number().int().nonnegative() }),
    graphql: z.object({ remaining: z.number().int().nonnegative() }),
  }),
});

async function body(
  url: string,
  limit: number,
  request: (url: string, init: RequestInit) => Promise<Response>,
): Promise<string> {
  const response = await request(url, {
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok || response.redirected || !response.body)
    throw new Error('Public build evidence is unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new Error('Public build evidence is oversized');
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
function pageStamp(page: string, name: string): string {
  const stamps: string[] = [];
  const visit = (node: DefaultTreeAdapterMap['node']): void => {
    if (
      'tagName' in node &&
      node.tagName === 'meta' &&
      node.namespaceURI === 'http://www.w3.org/1999/xhtml'
    ) {
      const attrs = new Map(node.attrs.map((a) => [a.name, a.value]));
      if (attrs.get('name') === name) stamps.push(attrs.get('content') ?? '');
    }
    if ('childNodes' in node) node.childNodes.forEach(visit);
  };
  visit(parse(page));
  if (stamps.length !== 1) throw new Error('Served page build stamp is missing or ambiguous');
  return StampSchema.parse({ build: stamps[0] }).build;
}
export async function refreshVersions(input: {
  repo: string;
  sites: readonly VersionSite[];
  run: (args: readonly string[]) => Promise<string>;
  request?: (url: string, init: RequestInit) => Promise<Response>;
  now: Date;
  previous?: VersionsSnapshot | null;
}): Promise<VersionsSnapshot> {
  const sites = VersionSitesSchema.parse(input.sites);
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(input.repo))
    throw new Error('Invalid product repository');
  const checkedAt = input.now.toISOString();
  const prefix = `repos/${input.repo}`;
  let main: string | null = null;
  let remaining = 0;
  let graphqlRemaining = 0;
  const stopAt = Date.now() + 45_000;
  const checkBudget = (): void => {
    if (Date.now() > stopAt) throw new Error('Version read deadline reached');
  };
  let setupError = '';
  const api = async (route: string): Promise<unknown> => {
    checkBudget();
    if (remaining <= MIN_FLOOR) throw new Error('GitHub read reserve reached');
    --remaining;
    const value: unknown = JSON.parse(await input.run(['api', route]));
    checkBudget();
    return value;
  };
  try {
    const limits = LimitsSchema.parse(JSON.parse(await input.run(['api', 'rate_limit']))).resources;
    remaining = limits.core.remaining;
    graphqlRemaining = limits.graphql.remaining;
    main = CommitSchema.parse(await api(`${prefix}/commits/main`)).sha;
  } catch {
    setupError = 'Repository revision is unavailable or GitHub read reserve reached';
  }
  // TN-50: with no revision to compare against, the last publication's sites stay, pending with their dates.
  if (setupError && input.previous?.repo === input.repo && input.previous.sites.length > 0)
    return failedVersions(input.repo, input.previous, input.now, setupError);
  const views: SiteVersion[] = [];
  for (const site of sites) {
    let build: string | null = null;
    let sha: string | null = null;
    let merges: number | null = null;
    let reason = setupError;
    try {
      checkBudget();
      if (!main) throw new Error(setupError);
      const request = input.request ?? fetch;
      build = StampSchema.parse(
        JSON.parse(await body(site.origin + site.buildPath, 4096, request)),
      ).build;
      const servedPageStamp = pageStamp(
        await body(site.origin + '/', 262144, request),
        site.metaName,
      );
      if (servedPageStamp !== build) throw new Error('Served page and build artefact disagree');
      if (build.endsWith('-dirty')) throw new Error('Dirty build cannot establish merge distance');
      sha = CommitSchema.parse(await api(`${prefix}/commits/${build}`)).sha;
      if (!sha.startsWith(build))
        throw new Error('Served revision does not resolve to the reported build');
      const commits = new Set<string>();
      let total: number | null = null;
      for (let page = 1; page <= 10; ++page) {
        const comparison = CompareSchema.parse(
          await api(`${prefix}/compare/${sha}...${main}?per_page=100&page=${page}`),
        );
        if (
          !['ahead', 'identical'].includes(comparison.status) ||
          comparison.base_commit.sha !== sha ||
          comparison.merge_base_commit.sha !== sha
        )
          throw new Error('Served revision is not an ancestor of main');
        if (
          comparison.total_commits > 1000 ||
          comparison.total_commits !== comparison.ahead_by ||
          (comparison.status === 'identical' && (sha !== main || comparison.total_commits !== 0)) ||
          (comparison.status === 'ahead' && (sha === main || comparison.total_commits === 0)) ||
          (total !== null && total !== comparison.total_commits)
        )
          throw new Error('Commit comparison is incomplete');
        total = comparison.total_commits;
        for (const c of comparison.commits) {
          if (commits.has(c.sha) || c.sha === sha)
            throw new Error('Commit comparison is inconsistent');
          commits.add(c.sha);
        }
        if (commits.size === total) break;
        if (comparison.commits.length !== 100) throw new Error('Commit comparison is incomplete');
      }
      if (commits.size !== total || (total !== 0 && !commits.has(main)))
        throw new Error('Commit comparison is incomplete');
      const prs = new Set<number>();
      const allCommits = [...commits];
      const [owner, name] = input.repo.split('/');
      for (let start = 0; start < allCommits.length; start += 25) {
        checkBudget();
        if (graphqlRemaining < MIN_FLOOR + 100) throw new Error('GitHub read reserve reached');
        const batch = allCommits.slice(start, start + 25);
        const objects = batch
          .map(
            (oid, i) =>
              `c${i}: object(oid:"${oid}") { ... on Commit { associatedPullRequests(first:100) { pageInfo { hasNextPage } nodes { number merged mergeCommit { oid } } } } }`,
          )
          .join(' ');
        const query = `query { rateLimit { cost remaining } repository(owner:"${owner}",name:"${name}") { ${objects} } }`;
        const response = GraphqlSchema.parse(
          JSON.parse(await input.run(['api', 'graphql', '-f', `query=${query}`])),
        );
        checkBudget();
        if (response.errors?.length || !response.data)
          throw new Error('Associated PR history is incomplete');
        graphqlRemaining = response.data.rateLimit.remaining;
        for (const [index, commit] of batch.entries()) {
          const associated = AssociatedSchema.parse(
            response.data.repository[`c${index}`],
          ).associatedPullRequests;
          if (associated.pageInfo.hasNextPage)
            throw new Error('Associated PR history is incomplete');
          for (const p of associated.nodes) {
            if (p.merged && p.mergeCommit === null)
              throw new Error('Associated PR merge identity is unavailable');
            if (p.merged && p.mergeCommit?.oid === commit) prs.add(p.number);
          }
        }
      }
      merges = prs.size;
      reason = 'Verified served web build; API revision is not reported';
    } catch (error) {
      reason =
        error instanceof z.ZodError || error instanceof SyntaxError
          ? 'Version evidence has an invalid shape'
          : error instanceof Error &&
              [
                'Served',
                'Public',
                'Dirty',
                'Commit',
                'Associated',
                'GitHub',
                'Repository',
                'Version read deadline',
              ].some((s) => error.message.startsWith(s))
            ? error.message
            : 'Version evidence is unavailable';
    }
    const previous =
      input.previous?.repo === input.repo
        ? input.previous.sites.find(
            (s) => s.origin === site.origin && s.buildUrl === site.origin + site.buildPath,
          )
        : undefined;
    const lastKnown = lastKnownOf(input.previous, previous);
    views.push({
      name: site.name,
      origin: site.origin,
      buildUrl: site.origin + site.buildPath,
      state: merges === null ? 'pending' : 'current',
      build,
      sha,
      merges,
      reason,
      lastKnown,
    });
  }
  return {
    schema: 'work-map-versions/1',
    repo: input.repo,
    checkedAt,
    main,
    sites: views,
    ...(setupError ? { error: setupError } : {}),
  };
}

/** A site's last verified observation: its row in `snapshot` when that was current, else the one it kept. */
function lastKnownOf(
  snapshot: VersionsSnapshot | null | undefined,
  row: SiteVersion | undefined,
): VersionObservation | null {
  return row?.state === 'current' && row.build && row.sha && row.merges !== null && snapshot?.main
    ? {
        at: snapshot.checkedAt,
        build: row.build,
        sha: row.sha,
        main: snapshot.main,
        merges: row.merges,
      }
    : (row?.lastKnown ?? null);
}

/**
 * TN-50: a version read that broke outright. The last publication's sites stay, pending with `reason` and
 * their dated last-known observation, so the card never shows an old backlog as current.
 */
export function failedVersions(
  repo: string,
  previous: VersionsSnapshot | null,
  checkedAt: Date,
  reason: string,
): VersionsSnapshot {
  return {
    schema: 'work-map-versions/1',
    repo,
    checkedAt: checkedAt.toISOString(),
    main: null,
    sites: (previous?.repo === repo ? previous.sites : []).map((site) => ({
      name: site.name,
      origin: site.origin,
      buildUrl: site.buildUrl,
      state: 'pending',
      build: null,
      sha: null,
      merges: null,
      reason,
      lastKnown: lastKnownOf(previous, site),
    })),
    error: reason,
  };
}
