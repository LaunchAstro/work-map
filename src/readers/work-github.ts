import { SpecMembershipSchema } from '../core/spec-progress.ts';
import { z } from 'zod';
import type { OpenPr, WorkIssue } from '../core/work.ts';
import type { Project } from './project.ts';
import { MIN_FLOOR, OVERLAP_MS } from './github.ts';
import type { LedgerPr, Lifecycle } from '../core/loading-bay.ts';
import { absorptionOf, closedAside } from '../core/absorption.ts';

const TimelineEvent = z.object({
  kind: z.string(),
  id: z.string(),
  createdAt: z.string(),
  reason: z.string().nullable().optional(),
  label: z.object({ name: z.string() }).nullable().optional(),
});

const repoNode = z.object({ nameWithOwner: z.string() });
const issueLink = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  repository: repoNode,
});
const IssueSchema = issueLink.extend({
  body: z.string().nullable(),
  stateReason: z.string().nullable().optional(),
  updatedAt: z.string(),
  parent: issueLink.nullable(),
  labels: z.object({ totalCount: z.number(), nodes: z.array(z.object({ name: z.string() })) }),
  blockedBy: z.object({ totalCount: z.number(), nodes: z.array(issueLink) }),
  closedAt: z.string().nullable().optional(),
  duplicateOf: z.object({ number: z.number(), repository: repoNode }).nullable().optional(),
  comments: z
    .object({
      totalCount: z.number(),
      nodes: z.array(z.object({ body: z.string(), createdAt: z.string() })),
    })
    .optional(),
});
const FilesSchema = z.object({
  totalCount: z.number(),
  nodes: z.array(z.object({ path: z.string() })),
});
/** Every changed path is documentation (under docs/ or Markdown); unread or partly read lists are not. */
const docsOnlyOf = (files: z.infer<typeof FilesSchema>): boolean =>
  files.totalCount === files.nodes.length &&
  files.nodes.every((f) => f.path.startsWith('docs/') || /\.md$/i.test(f.path));
const BACKFILL_QUERIES = 4;
/** Open PRs are read since the last Sync, and in full again once this long has passed (#233). */
const OPEN_FULL_MS = 3_600_000;
const BACKFILL_PRS = 20;
const PrSchema = z.object({
  createdAt: z.string().optional(),
  timelineItems: z
    .object({
      totalCount: z.number(),
      pageInfo: z.object({ hasNextPage: z.boolean() }),
      nodes: z.array(TimelineEvent),
    })
    .optional(),
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  url: z.string(),
  headRefName: z.string(),
  headRepository: repoNode.nullable().optional(),
  headRefOid: z.string().optional(),
  additions: z.number().nonnegative().optional(),
  deletions: z.number().nonnegative().optional(),
  updatedAt: z.string().optional(),
  labels: z
    .object({ totalCount: z.number(), nodes: z.array(z.object({ name: z.string() })) })
    .optional(),
  reviewDecision: z.string().nullable().optional(),
  latestOpinionatedReviews: z
    .object({
      totalCount: z.number(),
      nodes: z.array(
        z.object({
          state: z.string(),
          commit: z.object({ oid: z.string() }).nullable(),
        }),
      ),
    })
    .optional(),
  comments: z
    .object({
      totalCount: z.number(),
      nodes: z.array(
        z.object({
          author: z.object({ login: z.string() }).nullable(),
          body: z.string(),
          createdAt: z.string(),
          updatedAt: z.string(),
          url: z.string(),
        }),
      ),
    })
    .optional(),
  closingIssuesReferences: z.object({ nodes: z.array(issueLink), totalCount: z.number() }),
  files: FilesSchema.optional(),
});
const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
const Answer = z.object({
  data: z.object({
    rateLimit: z.object({ remaining: z.number() }),
    repository: z.object({
      issues: z.object({ pageInfo, nodes: z.array(IssueSchema) }).optional(),
      pullRequests: z.object({ pageInfo, nodes: z.array(PrSchema) }).optional(),
    }),
  }),
});
export interface SpecDocumentRead {
  readonly found: boolean;
  /** The default branch read; null for a repository without one (empty). */
  readonly branch: string | null;
  readonly url: string;
  readonly at: string;
}
export interface WorkCache {
  readonly issueCensus?: {
    readonly at: string;
    readonly complete: boolean;
    readonly error: string | null;
    readonly repositories?: Readonly<
      Record<string, { readonly through: string; readonly fullAt: string }>
    >;
  };
  readonly ledgerPrs?: readonly LedgerPr[];
  readonly ledgerComplete?: boolean;
  readonly closedThrough?: Readonly<Record<string, string>>;
  readonly version: 1 | 2;
  readonly project: string;
  readonly at: string;
  /** The last read finished without error. An item GitHub cut short does not clear it (TN-37). */
  readonly complete: boolean;
  /**
   * TN-37: some stored item was cut short (an issue's context, or a PR's labels, reviews or closing
   * references); each item's own completeness says which, and the flag is worked out from them at every write.
   * Caches written before this field read as not truncated.
   */
  readonly truncated?: boolean;
  readonly error: string | null;
  readonly issues: Readonly<Record<string, WorkIssue>>;
  readonly prs: readonly OpenPr[];
  readonly mergedPrs?: readonly OpenPr[];
  readonly mergedThrough?: Readonly<Record<string, string>>;
  readonly openThrough?: Readonly<
    Record<string, { readonly through: string; readonly fullAt: string }>
  >;
  readonly reposThrough?: Readonly<Record<string, string>>;
  readonly specDocuments?: Readonly<Record<string, SpecDocumentRead>>;
  /**
   * #242: the newest failed or stopped read. The values above stay those of the last good read, with its
   * `at`, so a card keeps its numbers and its age instead of turning pending.
   */
  readonly lastFailure?: { readonly at: string; readonly error: string };
  /**
   * #242: the last read of every repository (incremental or full), spec members and documents included.
   * A changed-only read does one without the probe once a day, as a backstop for changes search missed.
   */
  readonly allReadAt?: string;
  /** #242: which repositories the newest read touched. */
  readonly lastScope?: {
    readonly at: string;
    readonly scope: 'all' | 'changed';
    readonly reread: readonly string[];
  };
}
export const emptyWorkCache = (project: string): WorkCache => ({
  version: 2,
  project,
  at: '',
  complete: false,
  error: null,
  issues: {},
  prs: [],
  mergedPrs: [],
});
/** TN-37: read from the stored items themselves, so it cannot drift from them. */
const truncatedOf = (
  issues: Readonly<Record<string, WorkIssue>>,
  prs: readonly OpenPr[],
): boolean =>
  Object.values(issues).some((i) => i.contextComplete === false) ||
  prs.some(
    (p) => p.labelsComplete === false || p.reviewsComplete === false || p.closingComplete === false,
  );
const keyOf = (i: z.infer<typeof issueLink>): string => `${i.repository.nameWithOwner}#${i.number}`;
const ISSUE_FIELDS = `number title body url state stateReason updatedAt repository { nameWithOwner } parent { number title url state repository { nameWithOwner } } labels(first:100) { totalCount nodes { name } } blockedBy(first:100) { totalCount nodes { number title url state repository { nameWithOwner } } } closedAt duplicateOf { number repository { nameWithOwner } } comments(last:10) { totalCount nodes { body createdAt } }`;
function workIssue(i: z.infer<typeof IssueSchema>): WorkIssue {
  const key = keyOf(i);
  // The closing comment comes with the census page, so finding the parent costs no extra call (#189).
  const absorption = absorptionOf({
    key,
    state: i.state,
    stateReason: i.stateReason ?? null,
    closedAt: i.closedAt ?? null,
    duplicateOf: i.duplicateOf
      ? `${i.duplicateOf.repository.nameWithOwner}#${i.duplicateOf.number}`
      : null,
    comments: i.comments?.nodes ?? [],
    commentsTotal: i.comments?.totalCount ?? 0,
  });
  return {
    key,
    title: i.title,
    body: i.body ?? '',
    url: i.url,
    state: i.state,
    stateReason: i.stateReason ?? null,
    updatedAt: i.updatedAt,
    labels: i.labels.nodes.map((l) => l.name),
    parent: i.parent ? keyOf(i.parent) : null,
    blockedBy: i.blockedBy.nodes.map((d) => ({
      key: keyOf(d),
      title: d.title,
      url: d.url,
      state: d.state,
    })),
    contextComplete:
      i.labels.totalCount === i.labels.nodes.length &&
      i.blockedBy.totalCount === i.blockedBy.nodes.length &&
      absorption.read,
    absorbedInto: absorption.parent,
    closedAt: i.closedAt ?? null,
  };
}
const PR_FIELDS = `number title body url createdAt headRefName headRepository { nameWithOwner } headRefOid additions deletions updatedAt labels(first:100) { totalCount nodes { name } } reviewDecision latestOpinionatedReviews(first:100,writersOnly:true) { totalCount nodes { state commit { oid } } } comments(last:100) { totalCount nodes { author { login } body createdAt updatedAt url } } closingIssuesReferences(first:100) { totalCount nodes { number title url state repository { nameWithOwner } } } timelineItems(first:100,itemTypes:[ADDED_TO_MERGE_QUEUE_EVENT,REMOVED_FROM_MERGE_QUEUE_EVENT,LABELED_EVENT,UNLABELED_EVENT,MERGED_EVENT,CLOSED_EVENT]) { totalCount pageInfo { hasNextPage } nodes { kind:__typename ... on AddedToMergeQueueEvent { id createdAt } ... on RemovedFromMergeQueueEvent { id createdAt reason } ... on LabeledEvent { id createdAt label { name } } ... on UnlabeledEvent { id createdAt label { name } } ... on MergedEvent { id createdAt } ... on ClosedEvent { id createdAt } } } files(first:100) { totalCount nodes { path } }`;
function ledgerPr(
  p: z.infer<typeof PrSchema>,
  repository: string,
  readyLabel: string | null,
  checkedAt: string,
  state: 'OPEN' | 'MERGED' | 'CLOSED',
): LedgerPr {
  const events: Lifecycle[] = [];
  if (p.createdAt)
    events.push({
      id: `${repository}#${p.number}:opened`,
      kind: 'opened',
      at: p.createdAt,
      reason: null,
    });
  for (const event of p.timelineItems?.nodes ?? []) {
    const kind =
      event.kind === 'AddedToMergeQueueEvent'
        ? 'queued'
        : event.kind === 'RemovedFromMergeQueueEvent'
          ? 'dropped'
          : event.kind === 'MergedEvent'
            ? 'merged'
            : event.kind === 'LabeledEvent' && event.label?.name === readyLabel
              ? 'ready'
              : null;
    if (kind)
      events.push({
        id: event.id,
        kind,
        at: event.createdAt,
        reason:
          kind === 'dropped'
            ? (event.reason ?? 'GitHub supplied no removal reason')
            : kind === 'ready'
              ? `Label: ${readyLabel}`
              : null,
      });
  }
  const ordered = [...new Map(events.map((event) => [event.id, event])).values()].toSorted((a, b) =>
    a.at.localeCompare(b.at),
  );
  const last = ordered.at(-1);
  const queue = ordered.findLast((event) => event.kind === 'queued' || event.kind === 'dropped');
  const complete = !!p.createdAt && !!p.timelineItems && !p.timelineItems.pageInfo.hasNextPage;
  const status: LedgerPr['status'] =
    state === 'MERGED'
      ? 'merged'
      : state === 'CLOSED' || !complete
        ? 'pending'
        : queue?.kind === 'queued'
          ? 'queued'
          : last?.kind === 'dropped'
            ? 'dropped'
            : readyLabel && p.labels?.nodes.some((l) => l.name === readyLabel)
              ? 'ready'
              : 'opened';
  return {
    key: `${repository}#${p.number}`,
    title: p.title,
    url: p.url,
    checkedAt,
    complete,
    status,
    reason:
      state === 'CLOSED'
        ? 'Closed without merge; no queue drop inferred'
        : status === 'dropped'
          ? (last?.reason ?? null)
          : !complete
            ? 'Lifecycle history incomplete'
            : null,
    events: ordered,
  };
}
const trackedPr = (
  p: z.infer<typeof PrSchema>,
  repository: string,
  state: 'OPEN' | 'MERGED',
): OpenPr => ({
  key: `${repository}#${p.number}`,
  number: p.number,
  title: p.title,
  body: p.body,
  url: p.url,
  headRefName: p.headRefName,
  headRepository: p.headRepository?.nameWithOwner ?? null,
  state,
  ...(p.headRefOid === undefined ? {} : { headRefOid: p.headRefOid }),
  ...(p.updatedAt === undefined ? {} : { updatedAt: p.updatedAt }),
  ...(p.additions === undefined ? {} : { additions: p.additions }),
  ...(p.deletions === undefined ? {} : { deletions: p.deletions }),
  labels: p.labels?.nodes.map((l) => l.name) ?? [],
  labelsComplete: !!p.labels && p.labels.totalCount === p.labels.nodes.length,
  reviewDecision: p.reviewDecision ?? null,
  reviews:
    p.latestOpinionatedReviews?.nodes.map((r) => ({
      state: r.state,
      head: r.commit?.oid ?? null,
    })) ?? [],
  reviewsComplete:
    !!p.latestOpinionatedReviews &&
    p.latestOpinionatedReviews.totalCount === p.latestOpinionatedReviews.nodes.length,
  comments: p.comments?.nodes.map((c) => ({ ...c, author: c.author?.login ?? null })) ?? [],
  commentsComplete: !!p.comments && p.comments.totalCount === p.comments.nodes.length,
  issueKeys: p.closingIssuesReferences.nodes.map(keyOf),
  closingComplete: p.closingIssuesReferences.totalCount === p.closingIssuesReferences.nodes.length,
  ...(p.files ? { docsOnly: docsOnlyOf(p.files) } : {}),
});
/** What a changes probe found in one repository: issues, and the PR states with updated PRs. */
export interface RepoChanges {
  issues: boolean;
  states: Set<'OPEN' | 'MERGED' | 'CLOSED'>;
}
const PROBE_PAGES = 3;
const BACKSTOP_MS = 86_400_000;
/** Repositories per probe query; fifteen `repo:` qualifiers were checked against single-repository counts. */
const PROBE_REPOS = 15;
const ProbeAnswer = z.object({
  data: z.object({
    rateLimit: z.object({ remaining: z.number() }),
    search: z.object({
      issueCount: z.number(),
      pageInfo,
      nodes: z.array(
        z
          .object({
            kind: z.string(),
            state: z.string().optional(),
            updatedAt: z.string().optional(),
            repository: repoNode.optional(),
          })
          .nullable(),
      ),
    }),
  }),
});

/**
 * #242: one search per fifteen configured repositories (`repo:` qualifiers, so other repositories of the same
 * owner add no noise) for issues and PRs updated since `since`, newest first, at one point a page.
 * Returns the repositories that changed and what changed in them, or null when the answer is too long to
 * trust (more than three pages): the caller then re-reads every repository incrementally.
 */
export async function probeChanges(input: {
  repos: readonly string[];
  since: number;
  run: (args: readonly string[]) => Promise<string>;
  remaining: number;
  floor: number;
}): Promise<{ changes: Map<string, RepoChanges> | null; remaining: number; calls: number }> {
  const groups: string[][] = [];
  for (let i = 0; i < input.repos.length; i += PROBE_REPOS)
    groups.push(input.repos.slice(i, i + PROBE_REPOS));
  const wanted = new Map(input.repos.map((r) => [r.toLowerCase(), r]));
  const changes = new Map<string, RepoChanges>();
  let { remaining } = input;
  let calls = 0;
  const since = new Date(input.since).toISOString().replace(/\.\d+Z$/, 'Z');
  for (const group of groups) {
    let cursor: string | null = null;
    for (let page = 0; ; page++) {
      if (page >= PROBE_PAGES) return { changes: null, remaining, calls };
      if (remaining < input.floor) throw new Error(`GitHub reserve reached (${remaining} left)`);
      const query = `query($q:String!,$cursor:String) { rateLimit { cost remaining } search(query:$q,type:ISSUE,first:100,after:$cursor) { issueCount pageInfo { hasNextPage endCursor } nodes { kind:__typename ... on Issue { updatedAt repository { nameWithOwner } } ... on PullRequest { state updatedAt repository { nameWithOwner } } } } }`;
      const args = [
        'api',
        'graphql',
        '-f',
        `query=${query}`,
        '-f',
        `q=${group.map((r) => `repo:${r}`).join(' ')} updated:>=${since} sort:updated-desc`,
      ];
      if (cursor) args.push('-f', `cursor=${cursor}`);
      calls++;
      // oxlint-disable-next-line no-await-in-loop -- each page needs the cursor and the reserve the last one left
      const answer = ProbeAnswer.parse(JSON.parse(await input.run(args))).data;
      remaining = answer.rateLimit.remaining;
      for (const node of answer.search.nodes) {
        const repo = node?.repository
          ? wanted.get(node.repository.nameWithOwner.toLowerCase())
          : null;
        if (!node || !repo) continue;
        const entry = changes.get(repo) ?? { issues: false, states: new Set() };
        if (node.kind === 'Issue') entry.issues = true;
        else if (node.state === 'OPEN' || node.state === 'MERGED' || node.state === 'CLOSED')
          entry.states.add(node.state);
        else return { changes: null, remaining, calls };
        changes.set(repo, entry);
      }
      if (!answer.search.pageInfo.hasNextPage) break;
      if (!answer.search.pageInfo.endCursor || answer.search.pageInfo.endCursor === cursor)
        return { changes: null, remaining, calls };
      cursor = answer.search.pageInfo.endCursor;
    }
  }
  return { changes, remaining, calls };
}

export async function refreshWork(input: {
  project: Project;
  cache: WorkCache;
  run: (args: readonly string[]) => Promise<string>;
  now: Date;
  /**
   * #242: 'changed' (what the collector asks for) first asks a one-point probe (per fifteen repositories) what changed since
   * the last read, then re-reads only those repositories and kinds, with no time-based full reads. 'all', the
   * default, reads every repository, with its hourly open-PR and daily census full reads. A cache that was
   * never read completely is always read in full.
   */
  scope?: 'all' | 'changed';
  /** Reads stop below this many points left; never under MIN_FLOOR. */
  floor?: number;
  /**
   * #242: repositories read in every kind whatever the probe says. When a merge is newer than the cards'
   * last read, Sync names the product repository: GitHub's search index can lag the merge by seconds, its direct reads do not.
   */
  alwaysRead?: readonly string[];
}): Promise<WorkCache> {
  const { project, run, now } = input;
  const floor = Math.max(MIN_FLOOR, input.floor ?? MIN_FLOOR);
  const old = input.cache.project === project.id ? input.cache : emptyWorkCache(project.id);
  const ticketCount = project.progress?.basis === 'ticket-count';
  // A changed-only read needs a complete earlier read of every repository to build on.
  const marked = (repository: string): boolean =>
    Number.isFinite(Date.parse(old.reposThrough?.[repository] ?? '')) &&
    Number.isFinite(Date.parse(old.openThrough?.[repository]?.through ?? '')) &&
    Number.isFinite(Date.parse(old.mergedThrough?.[repository] ?? '')) &&
    Number.isFinite(Date.parse(old.closedThrough?.[repository] ?? '')) &&
    (!ticketCount ||
      Number.isFinite(Date.parse(old.issueCensus?.repositories?.[repository]?.through ?? '')));
  const changedOnly =
    input.scope === 'changed' &&
    old.version === 2 &&
    old.complete &&
    !!old.ledgerPrs &&
    (!ticketCount || !!old.issueCensus?.complete) &&
    project.repos.every(marked);
  const issues: Record<string, WorkIssue> = Object.fromEntries(
    Object.entries(old.issues).filter(([key]) => project.repos.includes(key.split('#')[0] ?? '')),
  );
  const censusRepositories: Record<string, { through: string; fullAt: string }> = {};
  const reposThrough: Record<string, string> = {};
  const prs: OpenPr[] = [];
  const mergedPrs = new Map(
    (old.mergedPrs ?? [])
      .filter((p) => project.repos.includes(p.key.split('#')[0] ?? ''))
      .map((p) => [p.key, p]),
  );
  const mergedThrough: Record<string, string> = {};
  const closedThrough: Record<string, string> = {};
  const openThrough: Record<string, { through: string; fullAt: string }> = {};
  const ledgerPrs = new Map(
    (old.ledgerPrs ?? [])
      .filter((p) => project.repos.includes(p.key.split('#')[0] ?? ''))
      .map((p) => [p.key, p]),
  );
  const specDocuments: Record<string, SpecDocumentRead> = Object.fromEntries(
    Object.entries(old.specDocuments ?? {}).filter(([key]) =>
      Object.values(project.specDocuments ?? {}).some((documents) => documents.includes(key)),
    ),
  );
  let ledgerComplete = true;
  let censusFinished = false;
  let pages = 0;
  try {
    const limits = z
      .object({
        resources: z.object({
          core: z.object({ remaining: z.number() }),
          graphql: z.object({ remaining: z.number() }),
        }),
      })
      .parse(JSON.parse(await run(['api', 'rate_limit'])));
    let remaining = Math.min(limits.resources.core.remaining, limits.resources.graphql.remaining);
    if (remaining < floor) throw new Error(`GitHub reserve reached (${remaining} left)`);
    // #242: what changed since the oldest repository mark, less the usual overlap for search-index lag.
    let changes: Map<string, RepoChanges> | null = null;
    // Once a day the changed-only read skips the probe and reads every repository incrementally.
    const backstop =
      changedOnly && !(now.getTime() - Date.parse(old.allReadAt ?? '') < BACKSTOP_MS);
    if (changedOnly && !backstop) {
      const since =
        Math.min(...project.repos.map((r) => Date.parse(old.reposThrough?.[r] ?? ''))) - OVERLAP_MS;
      const probe = await probeChanges({ repos: project.repos, since, run, remaining, floor });
      remaining = probe.remaining;
      changes =
        probe.changes ??
        new Map(
          project.repos.map((r) => [
            r,
            { issues: true, states: new Set(['OPEN', 'MERGED', 'CLOSED'] as const) },
          ]),
        );
      for (const repository of input.alwaysRead ?? [])
        if (project.repos.includes(repository))
          changes.set(repository, {
            issues: true,
            states: new Set(['OPEN', 'MERGED', 'CLOSED'] as const),
          });
    }
    const readsIssues = (repository: string): boolean =>
      !changes || !!changes.get(repository)?.issues;
    const readsPrs = (repository: string, state: 'OPEN' | 'MERGED' | 'CLOSED'): boolean =>
      !changes || !!changes.get(repository)?.states.has(state);
    for (const repository of project.repos) {
      const [owner = '', name = ''] = repository.split('/');
      let cursor: string | null = null;
      let done = false;
      const through = old.reposThrough?.[repository];
      const census = old.issueCensus?.repositories?.[repository];
      const fullAt = Date.parse(census?.fullAt ?? '');
      const issueThrough = Date.parse(census?.through ?? '');
      const incrementalCensus =
        old.issueCensus?.complete &&
        Number.isFinite(fullAt) &&
        Number.isFinite(issueThrough) &&
        fullAt <= issueThrough &&
        issueThrough <= now.getTime() &&
        (changedOnly || now.getTime() - fullAt < BACKSTOP_MS) &&
        // A cached issue closed aside without its parent read predates #189: read it all again once.
        Object.values(issues).every(
          (i) =>
            !i.key.startsWith(`${repository}#`) ||
            !closedAside(i.state, i.stateReason) ||
            i.absorbedInto !== undefined,
        );
      const since = ticketCount
        ? incrementalCensus
          ? issueThrough - OVERLAP_MS
          : null
        : old.complete && through
          ? Date.parse(through) - OVERLAP_MS
          : null;
      if (ticketCount && since === null)
        for (const key of Object.keys(issues))
          if (key.startsWith(`${repository}#`)) delete issues[key];
      // #242: an incremental read of issues the probe saw no change in would find nothing; skip it.
      if (since !== null && !readsIssues(repository)) done = true;
      while (!done) {
        if (++pages > 300) throw new Error('GitHub collection page limit reached');
        if (remaining < floor) throw new Error(`GitHub reserve reached (${remaining} left)`);
        const query = `query($owner:String!,$name:String!,$cursor:String) { rateLimit { cost remaining } repository(owner:$owner,name:$name) { issues(first:100,after:$cursor,orderBy:{field:UPDATED_AT,direction:DESC}) { pageInfo { hasNextPage endCursor } nodes { ${ISSUE_FIELDS} } } } }`;
        const args = [
          'api',
          'graphql',
          '-f',
          `query=${query}`,
          '-f',
          `owner=${owner}`,
          '-f',
          `name=${name}`,
        ];
        if (cursor) args.push('-f', `cursor=${cursor}`);
        // oxlint-disable-next-line no-await-in-loop -- pagination needs the preceding cursor and remaining budget
        const answer = Answer.parse(JSON.parse(await run(args))).data;
        remaining = answer.rateLimit.remaining;
        const page = answer.repository.issues;
        if (!page) throw new Error('GitHub answered no issues');
        for (const i of page.nodes) {
          if (since !== null && Date.parse(i.updatedAt) < since) {
            done = true;
            break;
          }
          const key = keyOf(i);
          issues[key] = workIssue(i);
        }
        if (
          page.pageInfo.hasNextPage &&
          (!page.pageInfo.endCursor || page.pageInfo.endCursor === cursor)
        )
          throw new Error('GitHub issue pagination did not advance');
        cursor = page.pageInfo.endCursor;
        done ||= !page.pageInfo.hasNextPage;
      }
      reposThrough[repository] = now.toISOString();
      censusRepositories[repository] = {
        through: now.toISOString(),
        fullAt:
          ticketCount && incrementalCensus ? new Date(fullAt).toISOString() : now.toISOString(),
      };
    }
    censusFinished = true;
    for (const repository of project.repos) {
      const [owner = '', name = ''] = repository.split('/');
      let cursor: string | null = null;
      let done = false;
      const open = old.version === 2 ? old.openThrough?.[repository] : undefined;
      const openFullAt = Date.parse(open?.fullAt ?? '');
      const openThroughAt = Date.parse(open?.through ?? '');
      const incrementalOpen =
        old.complete &&
        Number.isFinite(openFullAt) &&
        Number.isFinite(openThroughAt) &&
        openFullAt <= openThroughAt &&
        openThroughAt <= now.getTime() &&
        (changedOnly || now.getTime() - openFullAt < OPEN_FULL_MS);
      // An incremental read sees only PRs updated since; a PR that merged or closed leaves the list.
      const freshOpen: OpenPr[] = [];
      const leftOpen = new Set<string>();
      for (const state of ['MERGED', 'OPEN', 'CLOSED'] as const) {
        cursor = null;
        done = false;
        const previous =
          old.version === 2 && old.ledgerPrs
            ? state === 'CLOSED'
              ? old.closedThrough?.[repository]
              : old.mergedThrough?.[repository]
            : undefined;
        const mergedSince =
          state === 'OPEN'
            ? incrementalOpen
              ? openThroughAt - OVERLAP_MS
              : null
            : old.complete && previous
              ? Date.parse(previous) - OVERLAP_MS
              : null;
        // #242: an incremental read of a state the probe saw no change in would find nothing; skip it.
        if (mergedSince !== null && !readsPrs(repository, state)) done = true;
        while (!done) {
          if (++pages > 300) throw new Error('GitHub collection page limit reached');
          if (remaining < floor) throw new Error(`GitHub reserve reached (${remaining} left)`);
          const query = `query($owner:String!,$name:String!,$cursor:String) { rateLimit { cost remaining } repository(owner:$owner,name:$name) { pullRequests(states:${state},first:25,after:$cursor,orderBy:{field:UPDATED_AT,direction:DESC}) { pageInfo { hasNextPage endCursor } nodes { ${PR_FIELDS} } } } }`;
          const args = [
            'api',
            'graphql',
            '-f',
            `query=${query}`,
            '-f',
            `owner=${owner}`,
            '-f',
            `name=${name}`,
          ];
          if (cursor) args.push('-f', `cursor=${cursor}`);
          // oxlint-disable-next-line no-await-in-loop -- pagination needs its cursor and current reserve
          const answer = Answer.parse(JSON.parse(await run(args))).data;
          remaining = answer.rateLimit.remaining;
          const page = answer.repository.pullRequests;
          if (!page) throw new Error(`GitHub answered no ${state.toLowerCase()} PRs`);
          for (const p of page.nodes) {
            if (mergedSince !== null && p.updatedAt && Date.parse(p.updatedAt) < mergedSince) {
              done = true;
              break;
            }
            const lifecycle = ledgerPr(
              p,
              repository,
              project.ledgerPrReadyLabel ?? null,
              now.toISOString(),
              state,
            );
            ledgerPrs.set(lifecycle.key, lifecycle);
            if (!lifecycle.complete) ledgerComplete = false;
            if (state !== 'OPEN') leftOpen.add(lifecycle.key);
            if (state === 'CLOSED') continue;
            const pr = trackedPr(p, repository, state);
            if (state === 'MERGED') mergedPrs.set(pr.key, pr);
            else freshOpen.push(pr);
          }
          cursor = page.pageInfo.endCursor;
          done ||= !page.pageInfo.hasNextPage;
        }
      }
      const reread = new Set(freshOpen.map((p) => p.key));
      prs.push(
        ...freshOpen,
        ...(incrementalOpen
          ? old.prs.filter(
              (p) =>
                p.key.startsWith(`${repository}#`) && !reread.has(p.key) && !leftOpen.has(p.key),
            )
          : []),
      );
      openThrough[repository] = {
        through: now.toISOString(),
        fullAt: incrementalOpen ? new Date(openFullAt).toISOString() : now.toISOString(),
      };
      mergedThrough[repository] = now.toISOString();
      closedThrough[repository] = now.toISOString();
      reposThrough[repository] = now.toISOString();
    }
    // Incremental lists cannot prove that an old closed issue still exists.
    // Read the configured membership again, within the call and page reserve.
    const membership = SpecMembershipSchema.parse(project.specMembership ?? []);
    const members = new Set(
      membership.flatMap((section) => section.specs.flatMap((spec) => [spec.key, ...spec.tickets])),
    );
    for (const key of members) {
      const [repository = '', number = ''] = key.split('#');
      if (!project.repos.includes(repository))
        throw new Error('Spec membership repository is not configured');
      // #242: a member in a repository with no changed issues keeps its cached read.
      if (changes && !readsIssues(repository) && issues[key]) continue;
      if (++pages > 300 || remaining < floor)
        throw new Error('Spec membership read reserve reached');
      const [owner = '', name = ''] = repository.split('/');
      const query = `query($owner:String!,$name:String!) { rateLimit { cost remaining } repository(owner:$owner,name:$name) { member: issue(number:${number}) { ${ISSUE_FIELDS} } } }`;
      const raw = JSON.parse(
        // oxlint-disable-next-line no-await-in-loop -- each read checks the remaining reserve
        await run([
          'api',
          'graphql',
          '-f',
          `query=${query}`,
          '-f',
          `owner=${owner}`,
          '-f',
          `name=${name}`,
        ]),
      );
      const answer = z
        .object({
          data: z.object({
            rateLimit: z.object({ remaining: z.number() }),
            repository: z.object({ member: IssueSchema.nullable() }),
          }),
        })
        .parse(raw).data;
      remaining = answer.rateLimit.remaining;
      if (answer.repository.member === null) delete issues[key];
      else {
        if (keyOf(answer.repository.member) !== key)
          throw new Error('Spec member identity changed');
        issues[key] = workIssue(answer.repository.member);
      }
    }
    // Configured spec documents are confirmed on each repository's default branch, one query per
    // repository. A failed read keeps the last confirmation (or none), and the read itself stands.
    const documents = [...new Set(Object.values(project.specDocuments ?? {}).flat())];
    for (const repository of new Set(documents.map((d) => d.slice(0, d.indexOf(':'))))) {
      // #242: documents in a repository with no changes keep their last confirmation.
      const known = documents
        .filter((d) => d.startsWith(`${repository}:`))
        .every((d) => specDocuments[d]);
      if (changes && !changes.has(repository) && known) continue;
      if (++pages > 300 || remaining < floor) break;
      const paths = documents
        .filter((d) => d.startsWith(`${repository}:`))
        .map((d) => d.slice(repository.length + 1));
      const [owner = '', name = ''] = repository.split('/');
      const fields = paths
        // object(expression:) answers null for a missing path; Commit.file errors, failing the read.
        .map(
          (path, i) =>
            `d${i}: object(expression: ${JSON.stringify(`HEAD:${path}`)}) { kind: __typename }`,
        )
        .join(' ');
      try {
        const answer = z
          .object({
            data: z.object({
              rateLimit: z.object({ remaining: z.number() }),
              repository: z.object({
                defaultBranchRef: z.object({ name: z.string() }).nullable(),
                ...Object.fromEntries(
                  paths.map((_, i) => [`d${i}`, z.object({ kind: z.string() }).nullable()]),
                ),
              }),
            }),
          })
          .parse(
            JSON.parse(
              // oxlint-disable-next-line no-await-in-loop -- each read spends the reserve the last one reported
              await run([
                'api',
                'graphql',
                '-f',
                `query=query($owner:String!,$name:String!) { rateLimit { cost remaining } repository(owner:$owner,name:$name) { defaultBranchRef { name } ${fields} } }`,
                '-f',
                `owner=${owner}`,
                '-f',
                `name=${name}`,
              ]),
            ),
          ).data;
        remaining = answer.rateLimit.remaining;
        const { defaultBranchRef, ...rest } = answer.repository;
        const objects: Record<string, { kind: string } | null> = rest;
        // An empty repository has no default branch, so none of its documents exist.
        const branch = defaultBranchRef?.name ?? null;
        for (const [i, path] of paths.entries())
          specDocuments[`${repository}:${path}`] = {
            found: branch !== null && objects[`d${i}`]?.kind === 'Blob',
            branch,
            url:
              branch === null
                ? `https://github.com/${repository}`
                : `https://github.com/${repository}/blob/${[branch, ...path.split('/')].map(encodeURIComponent).join('/')}`,
            at: now.toISOString(),
          };
      } catch {
        // Retried on the next run.
      }
    }
    // Merged PRs cached before file lists were read get their docs-only flag a few queries per run,
    // after every required read, so it only spends reserve those reads left.
    // A failed backfill only leaves flags unread (counted as build); the read itself stands.
    try {
      const unread = [...mergedPrs.values()].filter((p) => p.docsOnly === undefined);
      for (let query = 0; query < BACKFILL_QUERIES && unread.length > 0; query++) {
        if (++pages > 300 || remaining < floor) break;
        const repository = unread[0]!.key.split('#')[0] ?? '';
        const batch = unread
          .filter((p) => p.key.split('#')[0] === repository)
          .slice(0, BACKFILL_PRS);
        for (const p of batch) unread.splice(unread.indexOf(p), 1);
        const [owner = '', name = ''] = repository.split('/');
        const fields = batch
          .map(
            (p) =>
              `p${p.number}: pullRequest(number: ${p.number}) { files(first:100) { totalCount nodes { path } } }`,
          )
          .join(' ');
        const answer = z
          .object({
            data: z.object({
              rateLimit: z.object({ remaining: z.number() }),
              repository: z.record(z.string(), z.object({ files: FilesSchema }).nullable()),
            }),
          })
          .parse(
            JSON.parse(
              // oxlint-disable-next-line no-await-in-loop -- each batch spends the reserve the last one reported
              await run([
                'api',
                'graphql',
                '-f',
                `query=query($owner:String!,$name:String!) { rateLimit { cost remaining } repository(owner:$owner,name:$name) { ${fields} } }`,
                '-f',
                `owner=${owner}`,
                '-f',
                `name=${name}`,
              ]),
            ),
          ).data;
        remaining = answer.rateLimit.remaining;
        for (const p of batch) {
          const read = answer.repository[`p${p.number}`];
          if (read) mergedPrs.set(p.key, { ...p, docsOnly: docsOnlyOf(read.files) });
        }
      }
    } catch {
      // Retried on the next run.
    }
    return {
      version: 2,
      project: project.id,
      at: now.toISOString(),
      complete: true,
      truncated: truncatedOf(issues, [...prs, ...mergedPrs.values()]),
      ...(project.progress?.basis === 'ticket-count'
        ? {
            issueCensus: {
              at: now.toISOString(),
              complete: true,
              error: null,
              repositories: censusRepositories,
            },
          }
        : {}),
      error: null,
      issues,
      prs,
      mergedPrs: [...mergedPrs.values()],
      mergedThrough,
      openThrough,
      reposThrough,
      ledgerPrs: [...ledgerPrs.values()],
      ledgerComplete: ledgerComplete && [...ledgerPrs.values()].every((pr) => pr.complete),
      closedThrough,
      specDocuments,
      ...(changes
        ? old.allReadAt
          ? { allReadAt: old.allReadAt }
          : {}
        : { allReadAt: now.toISOString() }),
      lastScope: {
        at: now.toISOString(),
        scope: changes ? 'changed' : 'all',
        reread: changes ? [...changes.keys()] : [...project.repos],
      },
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // #242: a failed or stopped read keeps the last good values with their time, and says what failed.
    // Only a cache that was never read completely reports the failure as its state.
    const read = !!old.at && old.complete;
    const inRepos = (key: string): boolean => project.repos.includes(key.split('#')[0] ?? '');
    const kept = {
      issues:
        censusFinished && project.progress?.basis === 'ticket-count'
          ? issues
          : Object.fromEntries(Object.entries(old.issues).filter(([key]) => inRepos(key))),
      prs: old.prs.filter((p) => inRepos(p.key)),
      mergedPrs: (old.mergedPrs ?? []).filter((p) => inRepos(p.key)),
    };
    return {
      ...old,
      ...(project.progress?.basis === 'ticket-count'
        ? {
            issueCensus: censusFinished
              ? {
                  at: now.toISOString(),
                  complete: true,
                  error: null,
                  repositories: censusRepositories,
                }
              : old.issueCensus?.complete
                ? old.issueCensus
                : {
                    at: old.issueCensus?.at ?? old.at,
                    complete: false,
                    error: 'GitHub issue census incomplete',
                    repositories: old.issueCensus?.repositories ?? {},
                  },
          }
        : {}),
      ...kept,
      truncated: truncatedOf(kept.issues, [...kept.prs, ...kept.mergedPrs]),
      complete: read,
      ledgerPrs: (old.ledgerPrs ?? []).filter((p) => inRepos(p.key)),
      ledgerComplete: read && (old.ledgerComplete ?? false),
      error: read ? old.error : error,
      lastFailure: { at: now.toISOString(), error: error.slice(0, 300) },
    };
  }
}
