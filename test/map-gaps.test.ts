import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { refreshMapGaps } from '../src/readers/map-gaps.ts';
import { previousMapGapReport } from './previous-screen.ts';

const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const map = { repo: 'Demo/product', shared: ['shared/**'], boxes: { task: ['src/**'] } };
const pr = (number = 1, repository = map.repo) => ({
  key: `${repository}#${number}`,
  number,
  headRefOid: head,
});
const now = new Date('2026-10-15T00:00:00Z');
const limits = JSON.stringify({
  resources: { core: { remaining: 5000 }, graphql: { remaining: 5000 } },
});
const files = (paths: string[], next = false, total = paths.length) => ({
  totalCount: total,
  pageInfo: { hasNextPage: next, endCursor: next ? 'next' : null },
  nodes: paths.map((path) => ({ path })),
});
function response(args: readonly string[], values: Record<number, unknown>): string {
  const query = args.find((a) => a.startsWith('query=')) ?? '';
  return JSON.stringify({
    data: {
      rateLimit: { remaining: 4999 },
      repository: Object.fromEntries(
        [...query.matchAll(/(p\d+): pullRequest\(number: (\d+)\)/g)].map((m) => [
          m[1],
          values[Number(m[2])],
        ]),
      ),
    },
  });
}
const run = async (args: readonly string[]): Promise<string> =>
  args[1] === 'rate_limit'
    ? limits
    : response(args, {
        1: {
          headRefOid: head,
          baseRefOid: base,
          files: files(['src/a.ts', 'orphan.ts', 'shared/a']),
        },
      });

it('counts unique gap paths and repo-qualified PRs from a complete mapped-repo inventory', async () => {
  const result = await refreshMapGaps({
    map,
    prs: [pr(), pr(), pr(1, 'Demo/roadmap')],
    inventoryComplete: true,
    run,
    now,
  });
  expect(result.report).toMatchObject({
    complete: true,
    at: now.toISOString(),
    checkedAt: now.toISOString(),
    gapFiles: 1,
    prsExpected: 1,
    prsRead: 1,
  });
  expect(result.cache.entries['Demo/product#1']).toMatchObject({ head, base });
  expect(result.cache.entries['Demo/product#1']?.files).toHaveLength(3);
  expect(previousMapGapReport(result.report)).toBe(true);
});

it('follows all file pages instead of pretending the first hundred is complete', async () => {
  let pages = 0;
  const reader = async (args: readonly string[]): Promise<string> => {
    if (args[1] === 'rate_limit') return limits;
    const query = args.find((a) => a.startsWith('query=')) ?? '';
    if (!query.includes('files('))
      return response(args, { 1: { headRefOid: head, baseRefOid: base } });
    pages++;
    return response(args, {
      1: {
        headRefOid: head,
        baseRefOid: base,
        files: pages === 1 ? files(['src/a'], true, 2) : files(['unowned'], false, 2),
      },
    });
  };
  const result = await refreshMapGaps({
    map,
    prs: [pr()],
    inventoryComplete: true,
    run: reader,
    now,
  });
  expect(pages).toBe(2);
  expect(result.report).toMatchObject({ complete: true, gapFiles: 1 });
  expect(result.cache.entries['Demo/product#1']?.files).toEqual(['src/a', 'unowned']);
});

it('reuses only complete head/base inventories and recalculates changed mapping rules', async () => {
  const prior = await refreshMapGaps({ map, prs: [pr()], inventoryComplete: true, run, now });
  const queries: string[] = [];
  const cached = async (args: readonly string[]): Promise<string> => {
    const query = args.find((a) => a.startsWith('query=')) ?? '';
    queries.push(query);
    return args[1] === 'rate_limit'
      ? limits
      : response(args, { 1: { headRefOid: head, baseRefOid: base } });
  };
  const result = await refreshMapGaps({
    map: { ...map, shared: ['**'] },
    prs: [pr()],
    inventoryComplete: true,
    run: cached,
    now,
    previousCache: prior.cache,
    previousReport: prior.report,
  });
  expect(queries.every((query) => !query.includes('files('))).toBe(true);
  expect(result.report).toMatchObject({ complete: true, gapFiles: 0 });
});

it('does not reuse a file inventory after the comparison base changes', async () => {
  const prior = await refreshMapGaps({ map, prs: [pr()], inventoryComplete: true, run, now });
  const newBase = 'c'.repeat(40);
  let requestedFiles = false;
  const reader = async (args: readonly string[]): Promise<string> => {
    if (args[1] === 'rate_limit') return limits;
    const query = args.find((a) => a.startsWith('query=')) ?? '';
    requestedFiles ||= query.includes('files(');
    return response(args, {
      1: { headRefOid: head, baseRefOid: newBase, files: files(['new-gap']) },
    });
  };
  const result = await refreshMapGaps({
    map,
    prs: [pr()],
    inventoryComplete: true,
    run: reader,
    now,
    previousCache: prior.cache,
  });
  expect(requestedFiles).toBe(true);
  expect(result.cache.entries[pr().key]?.files).toEqual(['new-gap']);
});

it('preserves explicitly dated last-known counts after a failed read, without calling them complete', async () => {
  const prior = await refreshMapGaps({ map, prs: [pr()], inventoryComplete: true, run, now });
  const result = await refreshMapGaps({
    map,
    prs: [pr()],
    inventoryComplete: true,
    run: async () => {
      throw new Error('private transport details');
    },
    now: new Date(now.getTime() + 60000),
    previousReport: prior.report,
    previousCache: prior.cache,
  });
  expect(result.report).toMatchObject({
    complete: false,
    at: now.toISOString(),
    gapFiles: 1,
    lastKnown: { at: now.toISOString(), gapFiles: 1 },
  });
  expect(JSON.stringify(result)).not.toContain('private transport');
  expect(previousMapGapReport(result.report)).toBe(true);
});

it('keeps complete partial cache progress across bounded runs, while the overall census stays pending', async () => {
  let time = 0;
  let queries = 0;
  const reader = async (args: readonly string[]): Promise<string> => {
    if (args[1] === 'rate_limit') return limits;
    queries++;
    time = queries === 1 ? 44000 : 45000;
    return response(
      args,
      Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [
          i + 1,
          { headRefOid: head, baseRefOid: base, files: files(['orphan']) },
        ]),
      ),
    );
  };
  const result = await refreshMapGaps({
    map,
    prs: Array.from({ length: 21 }, (_, i) => pr(i + 1)),
    inventoryComplete: true,
    run: reader,
    now,
    clock: () => time,
  });
  expect(result.report.complete).toBe(false);
  expect(Object.keys(result.cache.entries).length).toBeGreaterThan(0);
  expect(result.report.prsExpected).toBe(21);
});

it('refuses incomplete inventories, conflicting identities and missing exact heads without API work', async () => {
  let calls = 0;
  const reader = async (): Promise<string> => {
    calls++;
    return limits;
  };
  for (const input of [
    { prs: [pr()], inventoryComplete: false },
    { prs: [pr(), { ...pr(), headRefOid: 'c'.repeat(40) }], inventoryComplete: true },
    { prs: [{ key: pr().key, number: 1 }], inventoryComplete: true },
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- each refusal has an independent bounded input
    const result = await refreshMapGaps({ map, ...input, run: reader, now });
    expect(result.report).toMatchObject({ complete: false, at: null, lastKnown: null });
  }
  expect(calls).toBe(0);
});

it('stops at the existing reserve and rejects moving heads or incomplete file totals', async () => {
  for (const mode of ['reserve', 'moving', 'total'] as const) {
    let fileRead = false;
    const reader = async (args: readonly string[]): Promise<string> => {
      if (args[1] === 'rate_limit')
        return mode === 'reserve'
          ? '{"resources":{"core":{"remaining":999},"graphql":{"remaining":5000}}}'
          : limits;
      const query = args.find((a) => a.startsWith('query=')) ?? '';
      const withFiles = query.includes('files(');
      const changed = mode === 'moving' && fileRead && !withFiles;
      fileRead ||= withFiles;
      return response(args, {
        1: {
          headRefOid: changed ? 'c'.repeat(40) : head,
          baseRefOid: base,
          files: files(['gap'], false, mode === 'total' ? 2 : 1),
        },
      });
    };
    // oxlint-disable-next-line no-await-in-loop -- check each independent refusal mode
    const result = await refreshMapGaps({
      map,
      prs: [pr()],
      inventoryComplete: true,
      run: reader,
      now,
    });
    expect(result.report.complete, mode).toBe(false);
  }
});

it('counts one unmapped path shared by two PRs once', async () => {
  const reader = async (args: readonly string[]): Promise<string> =>
    args[1] === 'rate_limit'
      ? limits
      : response(
          args,
          Object.fromEntries(
            [1, 2].map((number) => [
              number,
              { headRefOid: head, baseRefOid: base, files: files(['same-gap']) },
            ]),
          ),
        );
  const result = await refreshMapGaps({
    map,
    prs: [pr(1), pr(2)],
    inventoryComplete: true,
    run: reader,
    now,
  });
  expect(result.report).toMatchObject({ complete: true, gapFiles: 1 });
  expect(Object.keys(result.cache.entries)).toHaveLength(2);
});

it('discards reports from another repository or changed map instead of retaining unrelated counts', async () => {
  const previous = await refreshMapGaps({ map, prs: [pr()], inventoryComplete: true, run, now });
  for (const prior of [
    { ...previous.report, repo: 'Other/product' },
    { ...previous.report, mapDigest: '0'.repeat(64) },
    { ...previous.report, checkedAt: '2027-01-01T00:00:00Z' },
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- each foreign prior is independently refused
    const result = await refreshMapGaps({
      map,
      prs: [pr()],
      inventoryComplete: false,
      run,
      now,
      previousReport: prior,
    });
    expect(result.report).toMatchObject({
      complete: false,
      at: null,
      lastKnown: null,
      gapFiles: 0,
    });
  }
});

it('refuses cursor loops, duplicate paths and GraphQL partial errors', async () => {
  for (const mode of ['cursor', 'duplicate', 'graphql'] as const) {
    const reader = async (args: readonly string[]): Promise<string> => {
      if (args[1] === 'rate_limit') return limits;
      const paths = mode === 'duplicate' ? ['gap', 'gap'] : ['gap'];
      const raw = response(args, {
        1: {
          headRefOid: head,
          baseRefOid: base,
          files: files(paths, mode === 'cursor', mode === 'cursor' ? 4 : paths.length),
        },
      });
      return mode === 'graphql'
        ? JSON.stringify({ ...JSON.parse(raw), errors: [{ message: 'partial' }] })
        : raw;
    };
    // oxlint-disable-next-line no-await-in-loop -- hostile modes have independent read state
    const result = await refreshMapGaps({
      map,
      prs: [pr()],
      inventoryComplete: true,
      run: reader,
      now,
    });
    expect(result.report.complete, mode).toBe(false);
  }
});

it('does not reach GitHub for a complete empty repository inventory', async () => {
  const result = await refreshMapGaps({
    map,
    prs: [],
    inventoryComplete: true,
    run: async () => {
      throw new Error('should not read');
    },
    now,
  });
  expect(result.report).toMatchObject({ complete: true, prsExpected: 0, prsRead: 0, gapFiles: 0 });
});

it.each([1000, 1001, 1099])(
  'preserves the reserve with %i remaining before a bounded GraphQL batch',
  async (remaining) => {
    let queries = 0;
    const result = await refreshMapGaps({
      map,
      prs: [pr()],
      inventoryComplete: true,
      now,
      run: async (args) => {
        if (args[1] === 'rate_limit')
          return JSON.stringify({ resources: { core: { remaining }, graphql: { remaining } } });
        queries++;
        return response(args, { 1: { headRefOid: head, baseRefOid: base, files: files(['gap']) } });
      },
    });
    expect(queries).toBe(0);
    expect(result.report.complete).toBe(false);
  },
);

it('refuses a result whose read crossed the protected reserve', async () => {
  const result = await refreshMapGaps({
    map,
    prs: [pr()],
    inventoryComplete: true,
    now,
    run: async (args) => {
      if (args[1] === 'rate_limit') return limits;
      const answer = JSON.parse(
        response(args, { 1: { headRefOid: head, baseRefOid: base, files: files(['gap']) } }),
      );
      answer.data.rateLimit.remaining = 999;
      return JSON.stringify(answer);
    },
  });
  expect(result.report.complete).toBe(false);
});

it('admits a bounded batch at 1100 and accepts a final response at the 1000 reserve', async () => {
  let queries = 0;
  const result = await refreshMapGaps({
    map,
    prs: [pr()],
    inventoryComplete: true,
    now,
    run: async (args) => {
      if (args[1] === 'rate_limit')
        return JSON.stringify({
          resources: { core: { remaining: 1100 }, graphql: { remaining: 1100 } },
        });
      queries++;
      const answer = JSON.parse(
        response(args, { 1: { headRefOid: head, baseRefOid: base, files: files(['gap']) } }),
      );
      answer.data.rateLimit.remaining = queries === 1 ? 1100 : 1000;
      return JSON.stringify(answer);
    },
  });
  expect(queries).toBe(2);
  expect(result.report.complete).toBe(true);
});

it('passes the remaining one millisecond to synchronous transport so it can terminate the child read', async () => {
  let logicalTime = 0;
  let timeoutSeen: number | undefined;
  const reader = (args: readonly string[], timeoutMs?: number): Promise<string> => {
    if (args[1] === 'rate_limit') {
      logicalTime = 44999;
      return Promise.resolve(limits);
    }
    timeoutSeen = timeoutMs;
    execFileSync(
      process.execPath,
      ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120)'],
      { timeout: timeoutMs ?? 5000 },
    );
    return Promise.resolve(
      response(args, { 1: { headRefOid: head, baseRefOid: base, files: files(['gap']) } }),
    );
  };
  const result = await refreshMapGaps({
    map,
    prs: [pr()],
    inventoryComplete: true,
    now,
    clock: () => logicalTime,
    run: reader,
  });
  expect(timeoutSeen).toBe(1);
  expect(result.report.complete).toBe(false);
});

it('rejects an over-deadline response before accepting its file inventory', async () => {
  let logicalTime = 0;
  const result = await refreshMapGaps({
    map,
    prs: [pr()],
    inventoryComplete: true,
    now,
    clock: () => logicalTime,
    run: async (args) => {
      if (args[1] === 'rate_limit') return limits;
      logicalTime = 45001;
      return response(args, { 1: { headRefOid: head, baseRefOid: base, files: files(['gap']) } });
    },
  });
  expect(result.report.complete).toBe(false);
  expect(Object.keys(result.cache.entries)).toHaveLength(0);
});

it('recalculates cached merged-file coverage without any further metadata API reads', async () => {
  const merged = { ...pr(), state: 'MERGED' as const };
  const prior = await refreshMapGaps({ map, prs: [merged], inventoryComplete: true, run, now });
  let calls = 0;
  const result = await refreshMapGaps({
    map: { ...map, shared: ['**'] },
    prs: [merged],
    inventoryComplete: true,
    now,
    previousCache: prior.cache,
    previousReport: prior.report,
    run: async () => {
      calls++;
      throw new Error('immutable merged cache needs no API');
    },
  });
  expect(calls).toBe(0);
  expect(result.cache.entries['Demo/product#1']?.files).toHaveLength(3);
  expect(result.report).toMatchObject({
    complete: true,
    gapFiles: 0,
    prsExpected: 1,
    prsRead: 1,
  });
});

it('checks newly merged or ambiguous cached PRs until their first full recheck is complete', async () => {
  const merged = { ...pr(), state: 'MERGED' as const };
  let time = 0;
  let queries = 0;
  const partial = await refreshMapGaps({
    map,
    prs: [merged],
    inventoryComplete: true,
    now,
    clock: () => time,
    run: async (args) => {
      if (args[1] === 'rate_limit') return limits;
      queries++;
      if (queries === 2) time = 45000;
      return response(args, { 1: { headRefOid: head, baseRefOid: base, files: files(['gap']) } });
    },
  });
  expect(partial.report.complete).toBe(false);
  expect(Object.keys(partial.cache.entries)).toHaveLength(1);
  let rechecks = 0;
  const reader = async (args: readonly string[]): Promise<string> => {
    if (args[1] === 'rate_limit') return limits;
    rechecks++;
    return response(args, { 1: { headRefOid: head, baseRefOid: base } });
  };
  const current = await refreshMapGaps({
    map,
    prs: [merged],
    inventoryComplete: true,
    now,
    previousCache: partial.cache,
    previousReport: partial.report,
    run: reader,
  });
  expect(rechecks).toBe(2);
  expect(current.report.complete).toBe(true);
  rechecks = 0;
  const ambiguous = await refreshMapGaps({
    map,
    prs: [{ ...pr(), state: 'OPEN' as const }, merged],
    inventoryComplete: true,
    now,
    previousCache: current.cache,
    previousReport: current.report,
    run: reader,
  });
  expect(ambiguous.report.complete).toBe(true);
  expect(rechecks).toBe(2);
});

it('invalidates an open cached inventory when its base changes immediately before the final recheck', async () => {
  const open = { ...pr(), state: 'OPEN' as const };
  const prior = await refreshMapGaps({ map, prs: [open], inventoryComplete: true, run, now });
  let queries = 0;
  const result = await refreshMapGaps({
    map,
    prs: [open],
    inventoryComplete: true,
    now,
    previousCache: prior.cache,
    previousReport: prior.report,
    run: async (args) => {
      if (args[1] === 'rate_limit') return limits;
      queries++;
      return response(args, {
        1: { headRefOid: head, baseRefOid: queries === 1 ? base : 'c'.repeat(40) },
      });
    },
  });
  expect(queries).toBe(2);
  expect(result.report).toMatchObject({ complete: false, lastKnown: { gapFiles: 1 } });
  expect(result.cache.entries[open.key]).toBeUndefined();
});

it('rechecks legacy merged caches even with complete reports and always rechecks open PRs', async () => {
  const merged = { ...pr(), state: 'MERGED' as const };
  const prior = await refreshMapGaps({ map, prs: [merged], inventoryComplete: true, run, now });
  const legacy = { ...prior.cache, entries: { [merged.key]: { head, base, files: ['gap'] } } };
  let calls = 0;
  const cached = await refreshMapGaps({
    map,
    prs: [merged],
    inventoryComplete: true,
    now,
    previousCache: legacy,
    previousReport: prior.report,
    run: async (args) => {
      calls++;
      return args[1] === 'rate_limit'
        ? limits
        : response(args, { 1: { headRefOid: head, baseRefOid: base } });
    },
  });
  expect(calls).toBe(3);
  expect(cached.report.complete).toBe(true);
  calls = 0;
  const open = { ...pr(), state: 'OPEN' as const };
  const result = await refreshMapGaps({
    map,
    prs: [open],
    inventoryComplete: true,
    now,
    previousCache: prior.cache,
    previousReport: prior.report,
    run: async (args) => {
      calls++;
      return args[1] === 'rate_limit'
        ? limits
        : response(args, { 1: { headRefOid: head, baseRefOid: base } });
    },
  });
  expect(calls).toBe(3);
  expect(result.report.complete).toBe(true);
});

it('does not treat a legacy cache without a complete report as a fully rechecked merged inventory', async () => {
  const merged = { ...pr(), state: 'MERGED' as const };
  const cache = {
    schema: 'work-map-gap-cache/1',
    repo: map.repo,
    entries: { [merged.key]: { head, base, files: ['gap'] } },
  };
  let queries = 0;
  const result = await refreshMapGaps({
    map,
    prs: [merged],
    inventoryComplete: true,
    now,
    previousCache: cache,
    run: async (args) => {
      if (args[1] === 'rate_limit') return limits;
      queries++;
      return response(args, { 1: { headRefOid: head, baseRefOid: base } });
    },
  });
  expect(queries).toBe(2);
  expect(result.report.complete).toBe(true);
});

it('rechecks an open inventory after it merges before treating its comparison as immutable', async () => {
  const open = { ...pr(), state: 'OPEN' as const };
  const prior = await refreshMapGaps({ map, prs: [open], inventoryComplete: true, run, now });
  let queries = 0;
  const result = await refreshMapGaps({
    map,
    prs: [{ ...open, state: 'MERGED' as const }],
    inventoryComplete: true,
    now,
    previousCache: prior.cache,
    previousReport: prior.report,
    run: async (args) => {
      if (args[1] === 'rate_limit') return limits;
      queries++;
      return response(args, {
        1: {
          headRefOid: head,
          baseRefOid: 'c'.repeat(40),
          files: files(['new-gap', 'second-gap']),
        },
      });
    },
  });
  expect(queries).toBe(3);
  expect(result.report).toMatchObject({ complete: true, gapFiles: 2 });
});
