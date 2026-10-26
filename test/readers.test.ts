// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAgents, emptyEventsState, foldEvents } from '../src/core/agents.ts';
import { checkTables, parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import { currentCache, emptyCache, refresh, type GithubCache } from '../src/readers/github.ts';
import { githubMetricsShown } from '../src/web/github-freshness.ts';
import { stoppedAgo } from '../src/web/words.ts';

describe('stopped lane age', () => {
  const iso = '2026-10-14T00:00:00Z';
  const stopped = Date.parse(iso);
  it('formats exact minute, hour and day boundaries with singular and plural units', () => {
    for (const [elapsed, expected] of [
      [0, 'just now'],
      [59_999, 'just now'],
      [60_000, '1 minute ago'],
      [120_000, '2 minutes ago'],
      [3_599_999, '59 minutes ago'],
      [3_600_000, '1 hour ago'],
      [7_200_000, '2 hours ago'],
      [86_399_999, '23 hours ago'],
      [86_400_000, '1 day ago'],
      [172_800_000, '2 days ago'],
    ] as const)
      expect(stoppedAgo(iso, stopped + elapsed)).toBe(expected);
  });
  it('keeps invalid and future timestamps truthful', () => {
    expect(stoppedAgo('invalid', stopped)).toBe('unknown time');
    expect(stoppedAgo(iso, Number.NaN)).toBe('unknown time');
    expect(stoppedAgo(iso, stopped - 1)).toBe('timestamp ahead of clock');
  });
});

const fx = (name: string): string =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const plan = parseBuildUnits(fx('build-units.md'));
const { owner } = checkTables(
  JSON.parse(fx('audit.json')) as Audit,
  JSON.parse(fx('flow.json')) as Flow,
  plan,
);

// A fake `gh`: answers rate_limit and GraphQL pages (pull requests and the Switch-on search, each with its
// own cursor), and records every call.
interface Fake {
  core?: number;
  graphql?: number;
  prs: { number: number; updatedAt: string; labels?: string[]; totalLabels?: number }[];
  issues?: { number: number; title: string; updatedAt: string }[];
  pageSize?: number;
  issuePage?: number;
  dropTo?: number;
  failOnCall?: number;
  queued?: number;
}
const arg = (args: readonly string[], key: string): string | undefined =>
  args.find((a) => a.startsWith(`${key}=`))?.slice(key.length + 1);
const lines = (...l: string[]): string => `${l.join('\n')}\n`;
function fakeGh(opts: Fake) {
  const calls: string[][] = [];
  const run = (args: readonly string[]): Promise<string> => {
    calls.push([...args]);
    if (args[1] === 'rate_limit')
      return Promise.resolve(
        JSON.stringify({
          resources: {
            core: { remaining: opts.core ?? 4000, reset: 1_800_000_000 },
            graphql: { remaining: opts.graphql ?? 4000, reset: 1_800_000_000 },
          },
        }),
      );
    if (opts.failOnCall === calls.length) return Promise.reject(new Error('network down'));
    const query = arg(args, 'query') ?? '';
    const data: Record<string, unknown> = {
      rateLimit: { cost: 1, remaining: opts.dropTo ?? 3999 },
    };
    if (query.includes('pullRequests')) {
      const size = opts.pageSize ?? 2;
      const at = Number(arg(args, 'prCursor') ?? 0);
      data['repository'] = {
        pullRequests: {
          pageInfo: { hasNextPage: at + size < opts.prs.length, endCursor: String(at + size) },
          nodes: opts.prs.slice(at, at + size).map((p) => ({
            number: p.number,
            title: `PR ${p.number}`,
            body: '',
            url: `u/${p.number}`,
            mergedAt: p.updatedAt,
            updatedAt: p.updatedAt,
            headRefName: 'b',
            labels: {
              totalCount: p.totalLabels ?? (p.labels ?? ['unreviewed']).length,
              nodes: (p.labels ?? ['unreviewed']).map((name) => ({ name })),
            },
          })),
        },
      };
    }
    if (query.includes('queue:'))
      data['queue'] = {
        mergeQueue: {
          entries: {
            totalCount: opts.queued ?? 0,
            nodes: Array.from({ length: opts.queued ?? 0 }, (_, k) => ({
              position: k + 1,
              enqueuedAt: '2026-10-13T12:01:00Z',
              pullRequest: { number: 70 + k, title: `Queued ${k}`, url: `u/${70 + k}` },
            })),
          },
        },
      };
    if (query.includes('search(')) {
      const issues = opts.issues ?? [
        { number: 9, title: 'Switch-on: email', updatedAt: '2026-10-13T09:00:00Z' },
        { number: 8, title: 'web: a switching bug', updatedAt: '2026-10-13T09:00:00Z' },
      ];
      const size = opts.issuePage ?? 100;
      const at = Number(arg(args, 'issueCursor') ?? 0);
      data['search'] = {
        pageInfo: { hasNextPage: at + size < issues.length, endCursor: String(at + size) },
        nodes: issues.slice(at, at + size).map((i) => ({
          number: i.number,
          title: i.title,
          updatedAt: i.updatedAt,
          url: `u/${i.number}`,
          state: 'OPEN',
          closedAt: null,
        })),
      };
    }
    return Promise.resolve(JSON.stringify({ data }));
  };
  return { run, calls };
}
const prs = [
  { number: 5, updatedAt: '2026-10-13T12:00:00Z' },
  { number: 4, updatedAt: '2026-10-13T11:00:00Z' },
  { number: 3, updatedAt: '2026-10-13T08:00:00Z' },
  { number: 2, updatedAt: '2026-10-12T08:00:00Z' },
];
const now = new Date('2026-10-13T12:05:00Z');

describe('the GitHub reader', () => {
  it('reads everything on the first run, page by page, and keeps only Switch-on issues', async () => {
    const gh = fakeGh({ prs });
    const { cache, log } = await refresh({
      repo: 'example-org/example-app',
      cache: emptyCache(),
      run: gh.run,
      now,
    });
    expect(Object.keys(cache.prs).toSorted()).toEqual(['2', '3', '4', '5']);
    expect(Object.keys(cache.switchOns)).toEqual(['9']);
    expect(cache.prsWatermark).toBe('2026-10-13T12:00:00Z');
    expect(log).toMatchObject({
      mode: 'full',
      calls: { restRateLimit: 1, graphql: 2 },
      cost: 2,
      prsChanged: 4,
      skipped: null,
      partial: false,
    });
    // The search rides on the first call only.
    expect(gh.calls[2]?.some((a) => a.startsWith('q='))).toBe(false);
  });

  it("searches for and keeps only issues whose title starts with the project's switch-on title", async () => {
    const gh = fakeGh({
      prs,
      issues: [
        { number: 9, title: 'Go-live: email', updatedAt: '2026-10-13T09:00:00Z' },
        { number: 8, title: 'Switch-on: web', updatedAt: '2026-10-13T09:00:00Z' },
        { number: 7, title: 'Go-lively: a bug', updatedAt: '2026-10-13T09:00:00Z' },
      ],
    });
    const { cache } = await refresh({
      repo: 'Acme/app',
      cache: emptyCache(),
      run: gh.run,
      now,
      switchOnTitle: 'Go-live',
    });
    expect(Object.keys(cache.switchOns)).toEqual(['9']);
    expect(gh.calls.flat().filter((a) => a.startsWith('q='))).toEqual([
      'q=repo:Acme/app is:issue in:title "Go-live"',
    ]);
  });

  it('drops the issues found under an earlier switch-on title and searches afresh under the new one', async () => {
    const issues = [
      { number: 1, title: 'Switch-on: web', updatedAt: '2026-10-13T11:00:00Z' },
      { number: 2, title: 'Go-live: email', updatedAt: '2026-10-01T09:00:00Z' },
    ];
    const first = await refresh({
      repo: 'Acme/app',
      cache: emptyCache(),
      run: fakeGh({ prs, issues }).run,
      now,
    });
    expect(Object.keys(first.cache.switchOns)).toEqual(['1']);
    const gh = fakeGh({ prs, issues });
    const { cache } = await refresh({
      repo: 'Acme/app',
      cache: first.cache,
      run: gh.run,
      now,
      switchOnTitle: 'Go-live',
    });
    expect(Object.keys(cache.switchOns)).toEqual(['2']);
    expect(gh.calls.flat().filter((a) => a.startsWith('q='))).toEqual([
      'q=repo:Acme/app is:issue in:title "Go-live"',
    ]);
  });

  it('then reads only what changed since the watermark, less ten minutes: one call', async () => {
    const before: GithubCache = {
      ...emptyCache(),
      prsWatermark: '2026-10-13T11:00:00Z',
      issuesWatermark: '2026-10-13T09:00:00Z',
    };
    const gh = fakeGh({ prs, pageSize: 10 });
    const { cache, log } = await refresh({
      repo: 'example-org/example-app',
      cache: before,
      run: gh.run,
      now,
    });
    expect(Object.keys(cache.prs).toSorted()).toEqual(['4', '5']);
    expect(log).toMatchObject({ mode: 'incremental', calls: { graphql: 1 } });
    expect(gh.calls[1]?.find((a) => a.startsWith('q='))).toBe(
      'q=repo:example-org/example-app is:issue in:title "Switch-on" updated:>=2026-10-13T08:50:00Z',
    );
  });

  it('pages the Switch-on search past its first hundred', async () => {
    const issues = Array.from({ length: 101 }, (_, k) => ({
      number: 1000 + k,
      title: `Switch-on: thing ${k}`,
      updatedAt: '2026-10-13T09:00:00Z',
    }));
    const gh = fakeGh({ prs: prs.slice(0, 1), pageSize: 10, issues });
    const { cache, log } = await refresh({
      repo: 'example-org/example-app',
      cache: emptyCache(),
      run: gh.run,
      now,
    });
    expect(Object.keys(cache.switchOns)).toHaveLength(101);
    expect(log.calls?.graphql).toBe(2);
    expect(cache.issuesWatermark).toBe('2026-10-13T09:00:00Z');
  });

  it.each([{ core: 999 }, { graphql: 10 }])(
    'makes no GraphQL call when a budget is under the floor: %o',
    async (low) => {
      const gh = fakeGh({ prs, ...low });
      const { cache, log } = await refresh({
        repo: 'example-org/example-app',
        cache: emptyCache(),
        run: gh.run,
        now,
      });
      expect(gh.calls).toHaveLength(1);
      expect(log.calls).toEqual({ restRateLimit: 1, graphql: 0 });
      expect(log.skipped).toMatch(/^rate limit: (core|graphql) has \d+ left, under 1000/);
      expect(cache.prsWatermark).toBeNull();
    },
  );

  it.each([1, Number.NaN])('never lets the floor fall under 1000 (asked for %s)', async (floor) => {
    const gh = fakeGh({ prs, core: 999, graphql: 999 });
    const { log } = await refresh({
      repo: 'example-org/example-app',
      cache: emptyCache(),
      run: gh.run,
      now,
      floor,
    });
    expect(log.calls?.graphql).toBe(0);
  });

  it('stops part-way when the budget falls under the floor, and leaves the watermark to read again', async () => {
    const before: GithubCache = { ...emptyCache(), prsWatermark: '2026-10-01T00:00:00Z' };
    const gh = fakeGh({ prs, dropTo: 900 });
    const { cache, log } = await refresh({
      repo: 'example-org/example-app',
      cache: before,
      run: gh.run,
      now,
    });
    expect(log.calls?.graphql).toBe(1);
    expect(log.partial).toBe(true);
    expect(Object.keys(cache.prs).toSorted()).toEqual(['4', '5']);
    expect(cache.prsWatermark).toBe('2026-10-01T00:00:00Z');
  });

  it('logs every call of a run that fails, keeps what came, and leaves the watermarks', async () => {
    const gh = fakeGh({ prs, failOnCall: 3 });
    const { cache, log } = await refresh({
      repo: 'example-org/example-app',
      cache: emptyCache(),
      run: gh.run,
      now,
    });
    expect(log).toMatchObject({
      calls: { restRateLimit: 1, graphql: 2 },
      cost: 1,
      error: 'network down',
      partial: true,
    });
    expect(Object.keys(cache.prs).toSorted()).toEqual(['4', '5']);
    expect(cache.prsWatermark).toBeNull();
    expect(cache.lastRun?.error).toBe('network down');
  });

  // TN-46: the merge queue figures ride on the first call, so a read that fails or stops after it
  // must not store them under the new time, or the screen takes a part-read as the latest figures.
  const earlier = {
    queued: 1,
    at: '2026-10-13T11:00:00.000Z',
    entries: [
      {
        position: 1,
        number: 60,
        title: 'Acme app',
        url: 'u/60',
        enqueuedAt: '2026-10-13T10:59:00Z',
      },
    ],
  };
  it.each([
    ['fails on its second page', { failOnCall: 3 }],
    ['stops at the reserve after its first page', { dropTo: 900 }],
  ])('keeps the last merge queue figures and their time when a read %s', async (_, how) => {
    const gh = fakeGh({ prs, queued: 2, ...how });
    const { cache, log } = await refresh({
      repo: 'example-org/example-app',
      cache: { ...emptyCache(), openState: earlier },
      run: gh.run,
      now,
    });
    expect(log.partial).toBe(true);
    expect(log.calls).toEqual({ restRateLimit: 1, graphql: 'failOnCall' in how ? 2 : 1 });
    expect(cache.openState).toEqual(earlier);
    const at = cache.openState?.at ?? '';
    expect(githubMetricsShown(log, false, at, now.getTime())).toBe(true);
  });

  // A first-ever read has no older figures to keep, so it stores its first page's, as before.
  it.each([
    ['fails on its second page', { failOnCall: 3 }],
    ['stops at the reserve after its first page', { dropTo: 900 }],
  ])('stores the first page merge queue figures when a first-ever read %s', async (_, how) => {
    const gh = fakeGh({ prs, queued: 2, ...how });
    const { cache, log } = await refresh({
      repo: 'example-org/example-app',
      cache: emptyCache(),
      run: gh.run,
      now,
    });
    expect(log.partial).toBe(true);
    expect(log.calls).toEqual({ restRateLimit: 1, graphql: 'failOnCall' in how ? 2 : 1 });
    expect(cache.openState).toEqual({
      queued: 2,
      at: now.toISOString(),
      entries: [70, 71].map((number, k) => ({
        position: k + 1,
        number,
        title: `Queued ${k}`,
        url: `u/${number}`,
        enqueuedAt: '2026-10-13T12:01:00Z',
      })),
    });
  });

  // Guards kept behaviour (passes on main too): a finished read still stores its figures and time.
  it('stores the merge queue figures with the time of a read that finishes', async () => {
    const gh = fakeGh({ prs, queued: 2 });
    const { cache, log } = await refresh({
      repo: 'example-org/example-app',
      cache: { ...emptyCache(), openState: earlier },
      run: gh.run,
      now,
    });
    expect(log.calls).toEqual({ restRateLimit: 1, graphql: 2 });
    expect(cache.openState?.at).toBe(now.toISOString());
    expect(cache.openState?.queued).toBe(2);
    expect(cache.openState?.entries?.map((e) => e.number)).toEqual([70, 71]);
  });

  it("keeps an older cache's records and reads everything afresh", () => {
    const old = {
      version: 1,
      prs: { '1': { number: 1, labels: [] } },
      switchOns: { '9': { number: 9 } },
      prsWatermark: 'x',
    };
    const c = currentCache(old);
    expect(c.version).toBe(2);
    expect(Object.keys(c.prs)).toEqual(['1']);
    expect(Object.keys(c.switchOns)).toEqual(['9']);
    expect(c.prsWatermark).toBeNull();
    expect(currentCache(null)).toEqual(emptyCache());
    const now2 = { ...emptyCache(), prsWatermark: 'x' };
    expect(currentCache(now2)).toBe(now2);
  });
});

describe('the lanes', () => {
  const file = '/round/events.log';
  const events = foldEvents(emptyEventsState(), file, fx('events.log'), plan);

  it('takes a lane ticket only from its own BOOTED or TICKET line', () => {
    expect(events.lanes['LN-Alpha']?.tickets).toEqual(['C71-D']);
    expect(events.lanes['LN-Beta']?.tickets).toEqual(['U02']);
    expect(events.lanes['LN-Gamma']?.tickets).toEqual(['C80']);
    expect(events.lanes['LN-Beta']?.machine).toBe('box-b');
    expect(events.lanes['LN-Gamma']?.closedAt).toBe('2026-10-13T10:07:00Z');
    expect(events.lanes['LN-Delta']?.closedAt).toBe('2026-10-13T10:06:00Z');
  });

  it('clears a lane ticket on a new boot or a TICKET line with none or only unknown IDs', () => {
    const a = foldEvents(
      emptyEventsState(),
      file,
      lines(
        '2026-10-13T10:00:00Z LN-Eta BOOTED Ticket: C80',
        '2026-10-13T10:01:00Z LN-Eta TICKET Ticket: none',
      ),
      plan,
    );
    expect(a.lanes['LN-Eta']?.tickets).toEqual([]);
    const b = foldEvents(
      a,
      file,
      lines(
        '2026-10-13T10:02:00Z LN-Eta TICKET Ticket: C80',
        '2026-10-13T10:03:00Z LN-Eta TICKET Ticket: Q99',
      ),
      plan,
    );
    expect(b.lanes['LN-Eta']?.tickets).toEqual([]);
    const c = foldEvents(
      b,
      file,
      lines(
        '2026-10-13T10:04:00Z LN-Eta TICKET Unit: U02',
        '2026-10-13T10:05:00Z LN-Eta BOOTED (seat b)',
      ),
      plan,
    );
    expect(c.lanes['LN-Eta']?.tickets).toEqual([]);
  });

  it('reads on from where it stopped, holding back a partial line', () => {
    const a = foldEvents(
      emptyEventsState(),
      file,
      '2026-10-13T10:00:00Z LN-Eps BOOTED Ticket: C80\n2026-10-13T10:01',
      plan,
    );
    expect(a.offset).toBe(Buffer.byteLength('2026-10-13T10:00:00Z LN-Eps BOOTED Ticket: C80\n'));
    const b = foldEvents(a, file, '2026-10-13T10:01:00Z LN-Eps TICKET Unit: U03\n', plan);
    expect(b.lanes['LN-Eps']?.tickets).toEqual(['U03']);
    expect(foldEvents(b, '/other/events.log', '', plan).lanes).toEqual({});
  });

  it('places lanes from the round log, and shows open lanes as unknown', () => {
    const out = buildAgents({
      events,
      round: { events: file, lastEventAt: events.lastAt },
      herdr: { ok: true, error: null },
      plan,
      owner,
      now: new Date('2026-10-13T12:00:00Z'),
    });
    const by = Object.fromEntries(out.lanes.map((l) => [l.lane, l]));
    expect(by['LN-Alpha']).toMatchObject({ state: 'unknown', units: ['U03'], nodes: ['tasks'] });
    expect(by['LN-Beta']).toMatchObject({ state: 'unknown', machine: 'box-b', nodes: ['found'] });
    expect(by['LN-Gamma']).toMatchObject({ state: 'done', nodes: ['fix'] });
    expect(by['LN-Alpha']).toMatchObject({ workspace: null, seen: { herdr: false, events: true } });
    expect(out.byNode).toEqual({
      tasks: ['LN-Alpha'],
      found: ['LN-Beta', 'LN-Delta'],
      fix: ['LN-Gamma'],
    });
    expect(out.fog).toEqual([]);
  });

  it('drops a closed lane after twelve hours, and keeps an open one as unknown', () => {
    const out = buildAgents({
      events,
      round: null,
      herdr: { ok: false, error: 'no socket' },
      plan,
      owner,
      now: new Date('2026-10-14T12:00:00Z'),
    });
    expect(out.lanes.map((l) => [l.lane, l.state])).toEqual([
      ['LN-Alpha', 'unknown'],
      ['LN-Beta', 'unknown'],
    ]);
    expect(out.fog.map((f) => f.id)).toEqual(['round']);
  });
});
