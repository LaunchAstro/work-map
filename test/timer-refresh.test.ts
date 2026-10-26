// SPDX-License-Identifier: AGPL-3.0-only
// #242, #245: the five-minute timer and the post-merge kick read only the merge panel; the cards are read
// when they never were, or on Sync, and then only what changed.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, expect, it } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'map-timer-refresh-'));
const data = join(root, 'data');
const bin = join(root, 'bin');
const state = join(root, 'state.json');
const calls = join(root, 'calls.log');
mkdirSync(data);
mkdirSync(bin);
afterAll(() => rmSync(root, { recursive: true, force: true }));

// A fake gh: one line per call in calls.log, answers shaped like GitHub's for each query the map sends.
writeFileSync(
  join(bin, 'fake-gh.mjs'),
  `
import { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const { merged } = JSON.parse(readFileSync(${JSON.stringify(state)}, 'utf8'));
const say = (label, value) => { appendFileSync(${JSON.stringify(calls)}, label + '\\n'); process.stdout.write(JSON.stringify(value)); };
const page = { hasNextPage: false, endCursor: null };
const pr = (p) => ({ number: p.number, title: 'PR ' + p.number, body: 'Why: x', url: 'https://github.com/Demo/product/pull/' + p.number, mergedAt: p.at, updatedAt: p.at, headRefName: 'b-' + p.number, labels: { totalCount: 0, nodes: [] } });
const workPr = (p) => ({ ...pr(p), createdAt: p.at, headRepository: { nameWithOwner: 'Demo/product' }, latestOpinionatedReviews: { totalCount: 0, nodes: [] }, comments: { totalCount: 0, nodes: [] }, closingIssuesReferences: { totalCount: 0, nodes: [] }, timelineItems: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] }, files: { totalCount: 1, nodes: [{ path: 'src/a.ts' }] } });
if (args[1] === 'rate_limit') say('rate_limit', { resources: { core: { remaining: 5000 }, graphql: { remaining: 5000 } } });
else {
  const q = args.find((a) => a.startsWith('query=')) ?? '';
  const rateLimit = { cost: 1, remaining: 4990 };
  if (q.includes('pullRequests(states: MERGED, orderBy')) say('merges', { data: { rateLimit, repository: { pullRequests: { pageInfo: page, nodes: merged.map(pr) } }, search: { pageInfo: page, nodes: [] }, ...(q.includes('queue:') ? { queue: { mergeQueue: { entries: { totalCount: 1, nodes: [{ position: 1, enqueuedAt: '2026-10-19T00:00:00Z', pullRequest: { number: 99, title: 'Queued', url: 'https://github.com/Demo/product/pull/99' } }] } } } } : {}) } });
  else if (q.includes('search(query:$q')) {
    const since = Date.parse(/updated:>=(\\S+)/.exec(args.find((a) => a.startsWith('q=')) ?? '')?.[1] ?? '');
    say('probe', { data: { rateLimit, search: { issueCount: 0, pageInfo: page, nodes: merged.filter((p) => Date.parse(p.at) >= since).map((p) => ({ kind: 'PullRequest', state: 'MERGED', updatedAt: p.at, repository: { nameWithOwner: 'Demo/product' } })) } } });
  } else {
    const s = /pullRequests\\(states:(\\w+)/.exec(q)?.[1];
    say('cards:' + (s ?? 'other'), { data: { rateLimit, repository: s ? { pullRequests: { pageInfo: page, nodes: s === 'MERGED' ? merged.map(workPr) : [] } } : { issues: { pageInfo: page, nodes: [] } } } });
  }
}
`,
);
writeFileSync(
  join(bin, 'gh'),
  `#!/bin/sh\nexec "${process.execPath}" "${join(bin, 'fake-gh.mjs')}" "$@"\n`,
  { mode: 0o755 },
);
const project = join(root, 'project.json');
writeFileSync(
  project,
  JSON.stringify({
    version: 1,
    id: 'proof',
    title: 'Proof',
    roadmapRepo: 'Demo/plan',
    productRepo: 'Demo/product',
    repos: ['Demo/product'],
    files: {
      audit: 'audit.json',
      flow: 'flow.json',
      plan: 'build-units.md',
      mapping: 'mapping.json',
      sections: 'sections.json',
    },
    lanePrefix: 'PROOF-',
    laneRules: [],
    dependencies: [],
    ticketConventions: {
      mapLabel: 'map',
      ideaLabels: ['idea'],
      ideaPattern: '^Idea:',
      specLabels: ['spec'],
      readyLabel: 'ready',
      ticketLabels: ['task'],
      specPattern: '^Spec:',
    },
  }),
);

const now = Date.now();
const setMerged = (numbers: number[]): void =>
  writeFileSync(
    state,
    JSON.stringify({
      merged: numbers.map((n) => ({
        number: n,
        at: new Date(now - (10 - n) * 1000).toISOString(),
      })),
    }),
  );
/** One collector run; returns the calls it made and its runs.jsonl line. */
function collect(...flags: string[]): { calls: string[]; log: Record<string, unknown> } {
  writeFileSync(calls, '');
  const run = spawnSync(
    process.execPath,
    [
      resolve('src/cli/generate.ts'),
      'github',
      ...flags,
      '--project',
      project,
      '--repo-root',
      resolve('test/fixtures'),
      '--data',
      data,
    ],
    {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env['PATH']}`,
        WORK_MAP_PROJECT: '',
        WORK_MAP_ROADMAP: '',
      },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  expect(run.error).toBeUndefined();
  const lines = readFileSync(join(data, 'runs.jsonl'), 'utf8').trim().split('\n');
  return {
    calls: readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean),
    log: JSON.parse(lines.at(-1)!) as Record<string, unknown>,
  };
}
const workAt = (): string =>
  (JSON.parse(readFileSync(join(data, 'work-cache.json'), 'utf8')) as { at: string }).at;

it('reads the cards once when they were never read, then the timer reads only the merge panel', () => {
  setMerged([1, 2]);
  const first = collect();
  expect(first.calls.filter((c) => c.startsWith('cards:')).length).toBeGreaterThan(0);
  const cardsAt = workAt();

  const timer = collect();
  expect(timer.calls).toEqual(['rate_limit', 'merges']);
  expect(timer.log).toMatchObject({ scope: 'timer', cardsRead: false, graphqlPoints: 1 });
  expect(timer.log['graphqlCosts']).toEqual({ merges: [1] });
  expect(workAt()).toBe(cardsAt);

  // The snapshot still carries the cards' last read, its time and the queue the merge read saw.
  const snap = JSON.parse(readFileSync(join(data, 'snapshot.json'), 'utf8')) as {
    work: { at: string };
    stats: { queued: number; queueEntries: { number: number }[] };
  };
  expect(snap.work.at).toBe(cardsAt);
  expect(snap.stats.queued).toBe(1);
  expect(snap.stats.queueEntries.map((e) => e.number)).toEqual([99]);
});

it('a new merge (the post-merge kick) reads only the merge panel; the cards wait for Sync', () => {
  setMerged([1, 2]);
  const cardsAt = workAt();
  // A merge after the cards' last read.
  const { merged } = JSON.parse(readFileSync(state, 'utf8')) as { merged: unknown[] };
  writeFileSync(
    state,
    JSON.stringify({ merged: [...merged, { number: 3, at: new Date().toISOString() }] }),
  );
  const kick = collect();
  expect(kick.calls).toEqual(['rate_limit', 'merges']);
  expect(kick.log).toMatchObject({ scope: 'timer', cardsRead: false, graphqlPoints: 1 });
  expect(workAt()).toBe(cardsAt);
  // Sync after that merge reads the product repository directly, whatever the (possibly lagging) probe says.
  const sync = collect('--sync');
  expect(sync.calls).toEqual([
    'rate_limit',
    'merges',
    'rate_limit',
    'probe',
    'cards:other',
    'cards:MERGED',
    'cards:OPEN',
    'cards:CLOSED',
  ]);
  expect(sync.log).toMatchObject({ scope: 'sync', cardsRead: true, cardsReread: ['Demo/product'] });
});

it('the manual Sync still refreshes the cards, reading only what changed', () => {
  const before = workAt();
  const sync = collect('--sync');
  expect(sync.log).toMatchObject({ scope: 'sync', cardsRead: true });
  // The merges of the last ten minutes fall inside the probe's overlap, so only merged PRs are read again.
  expect(sync.calls).toEqual(['rate_limit', 'merges', 'rate_limit', 'probe', 'cards:MERGED']);
  expect(Date.parse(workAt())).toBeGreaterThan(Date.parse(before));
});
