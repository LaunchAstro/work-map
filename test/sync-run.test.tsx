// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { AgentsSnapshot, Snapshot } from '../src/core/contract.ts';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import { pendingTicketProgress, ticketCounts } from '../src/core/ticket-progress.ts';
import type { VersionsSnapshot } from '../src/core/versions.ts';
import { runSync, type SyncUi } from '../src/web/sync-run.ts';
import { useSync } from '../src/web/Sync.tsx';

// #206 (folds in #181): Sync's outcome is a plain function with an injected fetcher.
const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const base = buildSnapshot({
  audit: JSON.parse(fixture('audit.json')) as Audit,
  flow: JSON.parse(fixture('flow.json')) as Flow,
  plan: parseBuildUnits(fixture('build-units.md')),
  generatedAt: '2026-10-18T01:00:00Z',
});
const started = Date.parse('2026-10-18T01:00:00Z');
const later = new Date(started + 5_000).toISOString();
const ticketSnapshot = (): Snapshot => ({
  ...base,
  generatedAt: later,
  progressBasis: 'ticket-count',
  ticketProgress: {
    ...pendingTicketProgress(),
    at: later,
    complete: true,
    reason: null,
    byNode: Object.fromEntries(
      base.stages.flatMap((s) => s.nodes).map((n) => [n.id, ticketCounts([], true)]),
    ),
    totals: ticketCounts([], true),
  },
});
const agents = { generatedAt: later } as AgentsSnapshot;
const versions = {
  checkedAt: later,
  error: null,
  sites: [],
} as unknown as VersionsSnapshot;
const reply =
  (body: unknown, ok = true): typeof fetch =>
  async () =>
    ({ ok, json: async () => body }) as Response;
const broken: typeof fetch = async () => new Response('{broken', { status: 200 });
const sync = async (
  body: unknown,
  snapshot: () => Promise<Snapshot> = async () => ticketSnapshot(),
  live = () => true,
  fetcher: typeof fetch = reply(body),
  search = '',
): Promise<{ final: SyncUi | null; seen: SyncUi[] }> => {
  const seen: SyncUi[] = [];
  // The request goes out at `started`; the census it reads back was taken 5 s later.
  let calls = 0;
  const final = await runSync({
    fetcher,
    search,
    sources: {
      snapshot,
      agents: async () => agents,
      versions: async () => versions,
    },
    progress: (s) => seen.push(s),
    live,
    now: () => (calls++ ? started + 10_000 : started),
  });
  return { final, seen };
};
const complete = (extra: Record<string, unknown> = {}) => ({
  status: 'complete',
  snapshotAt: later,
  agentsAt: later,
  versionsRequired: false,
  ...extra,
});

describe('runSync, a plain function (#181)', () => {
  it('a ticket map completes; any re-check word from an older server is ignored', async () => {
    const { final, seen } = await sync(complete({ recheck: 'started' }));
    expect(seen[0]).toEqual({ state: 'busy', message: 'Reading GitHub and round context…' });
    expect(final).toEqual({
      state: 'complete',
      message: 'Ticket census · No mapped tickets · Seat Gauge checked separately',
    });
  });
  it('a site version fault is a warning on a complete Sync, not incomplete (#206)', async () => {
    const { final } = await sync(
      complete({ versionsRequired: true, warnings: ['Site version read is incomplete'] }),
    );
    expect(final).toMatchObject({ state: 'complete' });
    expect(final && 'message' in final && final.message).toContain(
      'site versions pending (warning)',
    );
  });
  it('a map without a ticket census completes once GitHub is read, with no audit run', async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(complete({ deep: 'started' })));
    };
    const { final } = await sync(
      undefined,
      async () => ({ ...base, generatedAt: later }),
      undefined,
      fetcher,
    );
    expect(calls).toEqual(['/sync']);
    expect(final).toEqual({
      state: 'complete',
      message: 'GitHub up to date · Seat Gauge checked separately',
    });
  });
  it('posts to the map it was started for, not the one the address shows now', async () => {
    globalThis.history.pushState(null, '', '?map=beta');
    const calls: string[] = [];
    const fetcher: typeof fetch = async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(complete()));
    };
    await sync(undefined, undefined, undefined, fetcher, '?map=alpha');
    globalThis.history.pushState(null, '', '/');
    expect(calls).toEqual(['/m/alpha/sync']);
  });
  it('an incomplete server reply on a ticket map stays incomplete with its reasons', async () => {
    const { final } = await sync({
      status: 'incomplete',
      reasons: ['Lane read is incomplete'],
      versionsRequired: false,
    });
    expect(final).toMatchObject({ state: 'incomplete' });
    expect(final && 'message' in final && final.message).toContain('Lane read is incomplete');
  });
  it('a malformed or unreadable reply or a failed map read fails; a caller gone gets nothing', async () => {
    expect((await sync({ status: 'odd' })).final).toMatchObject({
      state: 'failed',
      message: 'Sync response unavailable',
    });
    expect((await sync(undefined, undefined, undefined, broken)).final).toMatchObject({
      state: 'failed',
      message: 'Sync response unavailable',
    });
    expect(
      (
        await sync(complete(), async () => {
          throw new Error('read');
        })
      ).final,
    ).toMatchObject({ state: 'failed', message: 'Sync finished; map read failed' });
    expect((await sync(complete(), undefined, () => false)).final).toBeNull();
  });
});

it('the Sync button sends one guarded request however often it is pressed, and reads each source once', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse(later));
  let release!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const snap = { refresh: vi.fn(async () => ticketSnapshot()) };
  const round = { refresh: vi.fn(async () => agents) };
  const sites = { refresh: vi.fn(async () => versions) };
  let hook!: ReturnType<typeof useSync>;
  function Harness(): null {
    hook = useSync(snap, round, sites, '');
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Harness />));
    let first!: Promise<void>;
    await act(async () => {
      first = hook.syncMap();
      await hook.syncMap();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('/sync', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'X-Work-Map-Sync': '1', 'Content-Type': 'application/json' },
    });
    await act(async () => {
      release(new Response(JSON.stringify(complete())));
      await first;
    });
    expect(hook.syncState).toEqual({
      state: 'complete',
      message: 'Ticket census · No mapped tickets · Seat Gauge checked separately',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const source of [snap, round, sites]) expect(source.refresh).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
