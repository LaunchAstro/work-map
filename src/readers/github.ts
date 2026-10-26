// SPDX-License-Identifier: AGPL-3.0-only
//
// Incremental, read-only GitHub reader. Nothing in src/core depends on it, so another source of records can
// replace it.
//
// The whole fleet shares one GitHub account's limit (5,000 an hour), so each run:
//   1. reads the limit from GET /rate_limit, which GitHub does not count against it;
//   2. stops there if the REST or the GraphQL budget has fewer than `floor` (1,000) left;
//   3. otherwise asks GraphQL only for merged pull requests and Switch-on issues updated since the last run,
//      newest first, stopping at the watermark: one call when little has changed.
// `gh` is passed in as `run(args) -> stdout`, so the tests use a fake.

import type { GithubRunLog } from '../core/contract.ts';
import type { PrInput } from '../core/refs.ts';
import type { SwitchOnInput } from '../core/snapshot.ts';

export const OVERLAP_MS: number = 10 * 60 * 1000;

export interface GithubCache {
  /** A version 1 cache keeps its records but is read afresh (about 9 calls, once). */
  version: 2;
  prs: Record<string, PrInput>;
  switchOns: Record<string, SwitchOnInput>;
  prsWatermark: string | null;
  issuesWatermark: string | null;
  lastRun: GithubRunLog | null;
  /** The switch-on title the issues and their watermark were read under; absent, Switch-on. */
  switchOnTitle?: string;
  /** The merge queue's length and its first entries, at the last good read. */
  openState?: {
    queued: number | null;
    at: string;
    entries?: QueueEntry[];
  };
}
export const emptyCache = (): GithubCache => ({
  version: 2,
  prs: {},
  switchOns: {},
  prsWatermark: null,
  issuesWatermark: null,
  lastRun: null,
});

/** A cache read from disk, brought up to the current version. */
export function currentCache(raw: unknown): GithubCache {
  if (typeof raw !== 'object' || raw === null) return emptyCache();
  const c = raw as Partial<GithubCache> & { version?: unknown };
  if (c.version === 2) return c as GithubCache;
  // An older cache keeps its records, so nothing vanishes while a run is skipped, but its watermarks are
  // cleared, so the next run reads everything afresh.
  return {
    ...emptyCache(),
    prs: c.prs ?? {},
    switchOns: c.switchOns ?? {},
    lastRun: c.lastRun ?? null,
  };
}

type Run = (args: readonly string[]) => Promise<string>;

/** One merge-queue entry, as the merge panel lists it. */
export interface QueueEntry {
  position: number;
  number: number;
  title: string;
  url: string;
  enqueuedAt: string;
}

interface RateLimits {
  resources?: Record<string, { remaining?: number; reset?: number } | undefined>;
}
interface GqlPr {
  number: number;
  title: string;
  body: string | null;
  url: string;
  mergedAt: string;
  updatedAt: string;
  headRefName: string;
  labels: { nodes: { name: string }[] };
}
interface GqlIssue {
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  closedAt?: string | null;
  updatedAt?: string;
}
interface Page<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}
interface GqlAnswer {
  errors?: { message: string }[];
  data?: {
    rateLimit?: { cost: number; remaining: number };
    repository?: { pullRequests: Page<GqlPr> };
    search?: Page<GqlIssue | null>;
    queue?: {
      mergeQueue: {
        entries: {
          totalCount: number;
          nodes?: ({
            position: number;
            enqueuedAt: string;
            pullRequest: { number: number; title: string; url: string } | null;
          } | null)[];
        };
      } | null;
    };
  };
}

const PR_PAGE =
  'repository(owner: $owner, name: $name) { pullRequests(states: MERGED, orderBy: {field: UPDATED_AT, direction: DESC}, first: $n, after: $prCursor) { pageInfo { hasNextPage endCursor } nodes { number title body url mergedAt updatedAt headRefName labels(first: 100) { nodes { name } } } } }';
// On the first call only, at no extra call: the merge queue's length and first entries.
export const QUEUE_ENTRIES = 20;
const OPEN_STATE = `queue: repository(owner: $owner, name: $name) { mergeQueue(branch: "main") { entries(first: ${QUEUE_ENTRIES}) { totalCount nodes { position enqueuedAt pullRequest { number title url } } } } }`;
const ISSUE_SEARCH =
  'search(query: $q, type: ISSUE, first: 100, after: $issueCursor) { pageInfo { hasNextPage endCursor } nodes { ... on Issue { number title url state closedAt updatedAt } } }';
const minus = (iso: string, ms: number): string =>
  new Date(Date.parse(iso) - ms).toISOString().replace(/\.\d+Z$/, 'Z');

/** The reserve every run leaves for the rest of the fleet; a lower floor asked for is raised to it. */
export const MIN_FLOOR = 1000;
/**
 * The higher floor for the automatic refresh (the five-minute timer and the post-merge kick): it stops
 * well before the fleet's reserve, so a busy hour leaves the shared budget to the agents.
 */
export const LIGHT_FLOOR = 1500;

export interface RefreshInput {
  readonly cache: GithubCache;
  readonly run: Run;
  readonly repo?: string;
  readonly floor?: number;
  readonly pageSize?: number;
  readonly now: Date;
  /** The title switch-on issues start with; unset, Switch-on. */
  readonly switchOnTitle?: string | undefined;
}

/**
 * One run. It never throws: a failure is in the log (with every call it made), the watermarks stay where they
 * were so the next run reads the same stretch again, and what did arrive is kept.
 */
export async function refresh(
  input: RefreshInput,
): Promise<{ cache: GithubCache; log: GithubRunLog }> {
  const { run, repo = '', pageSize = 50, switchOnTitle = 'Switch-on' } = input;
  // Issues read under another title are dropped, and the new title is searched from the start.
  const cache =
    (input.cache.switchOnTitle ?? 'Switch-on') === switchOnTitle
      ? input.cache
      : { ...input.cache, switchOns: {}, issuesWatermark: null };
  const escaped = switchOnTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const switchOn = new RegExp(`^${escaped}(?!\\w)`, 'i');
  const floor = Math.max(MIN_FLOOR, Number.isFinite(input.floor) ? (input.floor ?? 0) : 0);
  const [owner = '', name = ''] = repo.split('/');
  const next: GithubCache = structuredClone(cache);
  const calls = { restRateLimit: 0, graphql: 0 };
  const remaining: { core: number | null; graphql: number | null } = { core: null, graphql: null };
  let cost = 0;
  let prsChanged = 0;
  let switchOnsChanged = 0;
  let skipped: string | null = null;
  let partial = false;
  let error: string | undefined;
  // TN-46: held until the read ends; a part-read keeps the last figures and their time, if there are any.
  let openState: GithubCache['openState'];
  const base = {
    at: input.now.toISOString(),
    mode: cache.prsWatermark ? ('incremental' as const) : ('full' as const),
  };

  try {
    calls.restRateLimit++;
    const limits = JSON.parse(await run(['api', 'rate_limit'])) as RateLimits;
    remaining.core = limits.resources?.['core']?.remaining ?? null;
    remaining.graphql = limits.resources?.['graphql']?.remaining ?? null;
    const low = (['core', 'graphql'] as const).find(
      (k) => remaining[k] === null || (remaining[k] ?? 0) < floor,
    );
    if (low) {
      const reset = limits.resources?.[low]?.reset;
      skipped = `rate limit: ${low} has ${remaining[low] ?? 'unknown'} left, under ${floor}; resets ${reset ? new Date(reset * 1000).toISOString() : 'unknown'}`;
    } else {
      const prSince = cache.prsWatermark ? minus(cache.prsWatermark, OVERLAP_MS) : null;
      const issueSince = cache.issuesWatermark ? minus(cache.issuesWatermark, OVERLAP_MS) : null;
      const q = `repo:${repo} is:issue in:title "${switchOnTitle}"${issueSince ? ` updated:>=${issueSince}` : ''}`;
      let prCursor: string | null = null;
      let issueCursor: string | null = null;
      let prsDone = false;
      let issuesDone = false;
      let newestPr = cache.prsWatermark;
      let newestIssue = cache.issuesWatermark;
      // The first call asks for both; later calls ask only for whichever still has pages.
      while (!prsDone || !issuesDone) {
        if (calls.graphql > 0 && (remaining.graphql ?? 0) < floor) {
          // Out of budget part-way: keep what came, and leave the watermarks so the next run reads this again.
          partial = true;
          skipped = `rate limit fell under ${floor} part-way; the rest waits for the next run`;
          break;
        }
        const vars: string[] = [];
        const args = ['api', 'graphql'];
        if (!prsDone) {
          vars.push('$owner: String!', '$name: String!', '$n: Int!', '$prCursor: String');
          args.push('-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `n=${pageSize}`);
          if (prCursor) args.push('-f', `prCursor=${prCursor}`);
        }
        if (!issuesDone) {
          vars.push('$q: String!', '$issueCursor: String');
          args.push('-f', `q=${q}`);
          if (issueCursor) args.push('-f', `issueCursor=${issueCursor}`);
        }
        const first = calls.graphql === 0;
        const query = `query(${vars.join(', ')}) { rateLimit { cost remaining } ${prsDone ? '' : PR_PAGE} ${issuesDone ? '' : ISSUE_SEARCH} ${first ? OPEN_STATE : ''} }`;
        args.splice(2, 0, '-f', `query=${query}`);
        calls.graphql++;
        // oxlint-disable-next-line no-await-in-loop -- each page needs the cursor the one before it returned
        const res = JSON.parse(await run(args)) as GqlAnswer;
        if (res.errors?.length)
          throw new Error(`GitHub GraphQL: ${res.errors.map((e) => e.message).join('; ')}`);
        if (!res.data) throw new Error('GitHub GraphQL answered no data');
        cost += res.data.rateLimit?.cost ?? 0;
        remaining.graphql = res.data.rateLimit?.remaining ?? remaining.graphql;
        if (first)
          openState = {
            queued: res.data.queue?.mergeQueue?.entries.totalCount ?? null,
            at: input.now.toISOString(),
            entries: (res.data.queue?.mergeQueue?.entries.nodes ?? []).flatMap((e) =>
              e?.pullRequest
                ? [
                    {
                      position: e.position,
                      number: e.pullRequest.number,
                      title: e.pullRequest.title,
                      url: e.pullRequest.url,
                      enqueuedAt: e.enqueuedAt,
                    },
                  ]
                : [],
            ),
          };

        if (!issuesDone) {
          const page = res.data.search;
          if (!page) throw new Error('GitHub GraphQL answered no search');
          for (const i of page.nodes) {
            if (!i?.number || !i.title || !switchOn.test(i.title)) continue;
            const updatedAt = i.updatedAt ?? '';
            next.switchOns[String(i.number)] = {
              number: i.number,
              title: i.title,
              url: i.url ?? '',
              state: i.state ?? 'OPEN',
              closedAt: i.closedAt ?? null,
              updatedAt,
            };
            switchOnsChanged++;
            if (!newestIssue || updatedAt > newestIssue) newestIssue = updatedAt;
          }
          issueCursor = page.pageInfo.endCursor;
          issuesDone = !page.pageInfo.hasNextPage;
        }
        if (!prsDone) {
          const page = res.data.repository?.pullRequests;
          if (!page) throw new Error('GitHub GraphQL answered no pull requests');
          for (const p of page.nodes) {
            if (prSince && p.updatedAt < prSince) {
              prsDone = true;
              break;
            }
            next.prs[String(p.number)] = {
              number: p.number,
              title: p.title,
              body: p.body,
              url: p.url,
              mergedAt: p.mergedAt,
              updatedAt: p.updatedAt,
              headRefName: p.headRefName,
              labels: p.labels.nodes.map((l) => l.name),
            };
            prsChanged++;
            if (!newestPr || p.updatedAt > newestPr) newestPr = p.updatedAt;
          }
          prCursor = page.pageInfo.endCursor;
          if (!page.pageInfo.hasNextPage) prsDone = true;
        }
      }
      if (prsDone) next.prsWatermark = newestPr;
      if (issuesDone) next.issuesWatermark = newestIssue;
    }
  } catch (caught) {
    error = (caught instanceof Error ? caught.message : String(caught)).slice(0, 500);
    partial = true;
  }
  if (openState && (!partial || !cache.openState)) next.openState = openState;
  const log: GithubRunLog = {
    ...base,
    calls,
    cost,
    remaining,
    prsChanged,
    switchOnsChanged,
    skipped,
    partial,
    ...(error === undefined ? {} : { error }),
  };
  next.lastRun = log;
  next.switchOnTitle = switchOnTitle;
  return { cache: next, log };
}
