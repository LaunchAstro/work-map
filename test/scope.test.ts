import { currentSnapshot } from '../src/web/snapshot.ts';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import {
  scopeEvidence,
  scopeView,
  roundedShares,
  reviewPr,
  reviewView,
  type OpenScopeEstimate,
} from '../src/core/scope.ts';
import { buildWork, type OpenPr } from '../src/core/work.ts';
import { refreshWork, emptyWorkCache, type WorkCache } from '../src/readers/work-github.ts';
import type { Project } from '../src/readers/project.ts';
const fixture = (name: string): string =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const plan = parseBuildUnits(fixture('build-units.md'));
const snap = buildSnapshot({
  audit: JSON.parse(fixture('audit.json')) as Audit,
  flow: JSON.parse(fixture('flow.json')) as Flow,
  plan,
  generatedAt: '2026-10-14T01:00:00Z',
});
const node = snap.stages.flatMap((s) => s.nodes).find((n) => n.id === 'tasks')!;
const head = 'a'.repeat(40);
const pr: OpenPr = {
  key: 'Acme/app#1',
  number: 1,
  title: 'New feature',
  body: 'Section: tasks',
  url: 'https://example.com/1',
  headRefName: 'feature',
  headRefOid: head,
  issueKeys: [],
  additions: 300,
  deletions: 100,
  state: 'OPEN',
  labels: [],
  labelsComplete: true,
  reviews: [],
  reviewsComplete: true,
  comments: [],
  commentsComplete: true,
};
const estimate = (prs = [pr], built = 25): OpenScopeEstimate => ({
  at: '2026-10-14T01:00:00Z',
  model: 'example-model',
  reason: 'Distinct feature additions',
  evidence: scopeEvidence(node, prs),
  units: Object.fromEntries(node.units.map((u) => [u.id, { built, reason: 'Unique scope' }])),
});
const receipt = (
  verdict = 'approve',
  sha = head,
  author = 'owner',
  at = '2026-10-14T01:00:00Z',
) => ({
  author,
  createdAt: at,
  updatedAt: at,
  url: 'https://example.com/review',
  body: `Review notes\nReviewer: Reviewer A\nModel: model-a\nHead SHA: ${sha}\nVerdict: ${verdict}\nCode review: ${verdict === 'approve' ? 'no findings' : 'changes requested'}`,
});
const project: Project = {
  version: 1,
  id: 'test',
  title: 'Test',
  roadmapRepo: 'Acme/plan',
  productRepo: 'Acme/app',
  repos: ['Acme/app'],
  files: {
    audit: 'audit.json',
    flow: 'flow.json',
    plan: 'units.md',
    mapping: 'mapping.json',
    sections: 'sections.json',
  },
  lanePrefix: 'AC-',
  laneRules: [],
  reviewReceiptAuthors: ['owner'],
  dependencies: [],
  ticketConventions: {
    readyLabel: 'ready',
    ticketLabels: [],
    mapLabel: 'map',
    ideaLabels: [],
    ideaPattern: '^Idea:',
    specLabels: [],
    specPattern: '^Spec:',
  },
};

// The project's debt labels reach every pull request the map shows, not only reviewPr called directly.
it("builds the map's review from the project's debt labels", () => {
  const nodes = [];
  for (const n of snap.stages.flatMap((stage) => stage.nodes)) nodes.push({ ...n, units: [] });
  const approved = (number: number, labels: string[]): OpenPr => ({
    ...pr,
    key: `Acme/app#${number}`,
    number,
    labels,
    reviews: [{ state: 'APPROVED', head }],
  });
  const result = buildWork({
    project: { ...project, reviewDebtLabels: ['needs-human'] },
    plan,
    nodes,
    issues: {},
    prs: [approved(1, ['needs-human']), approved(2, ['unreviewed'])],
    maps: { 'Acme/app#1': 'tasks', 'Acme/app#2': 'tasks' },
    at: '2026-10-14T01:00:00Z',
    complete: true,
    error: null,
  });
  const review = new Map(result.byNode['tasks']?.review.prs.map((p) => [p.key, p]));
  expect(review.get('Acme/app#1')).toMatchObject({ review: 'unreviewed', marked: true });
  expect(review.get('Acme/app#2')).toMatchObject({ review: 'reviewed' });
});

describe('exclusive full-scope shares', () => {
  it('includes explicitly mapped PRs in review without inventing approved scope', () => {
    const nodes = [];
    for (const n of snap.stages.flatMap((stage) => stage.nodes)) nodes.push({ ...n, units: [] });
    const input: Parameters<typeof buildWork>[0] = {
      project,
      plan,
      nodes,
      issues: {},
      prs: [{ ...pr, body: '', reviews: [{ state: 'APPROVED', head }] }],
      trackedMergedPrs: [{ ...pr, key: 'Acme/app#2', number: 2, body: '', state: 'MERGED' }],
      maps: { 'Acme/app#1': 'tasks', 'Acme/app#2': 'tasks' },
      at: '2026-10-14T01:00:00Z',
      complete: true,
      error: null,
    };
    const result = buildWork(input);
    expect(result.byNode['tasks']?.review).toMatchObject({
      pct: 50,
      reviewedLines: 400,
      totalLines: 800,
    });
    expect(result.unplacedPrs).toEqual([]);
    expect(result.byNode['tasks']?.scope.pending).toBe(true);
    expect(result.byNode['tasks']?.scope.shares).toEqual(
      buildWork({ ...input, prs: [], trackedMergedPrs: [] }).byNode['tasks']?.scope.shares,
    );
    const stated = buildWork({ ...input, prs: [{ ...pr, body: 'Section: fix' }] });
    expect(stated.byNode['fix']?.openPrs.map((p) => p.key)).toEqual(['Acme/app#1']);
    expect(stated.byNode['tasks']?.openPrs).toEqual([]);
    const otherRepo = buildWork({ ...input, maps: { 'Acme/other#1': 'tasks' } });
    expect(otherRepo.unplacedPrs.map((p) => p.key)).toEqual(['Acme/app#1']);
    const invalid = buildWork({ ...input, maps: { 'Acme/app#1': 'missing' } });
    expect(invalid.unplacedPrs.map((p) => p.key)).toEqual(['Acme/app#1']);
    const declaredOutside = buildWork({
      ...input,
      prs: [{ ...pr, body: 'Ticket: none' }],
      trackedMergedPrs: [],
    });
    expect(declaredOutside.byNode['tasks']?.openPrs).toEqual([]);
    expect(declaredOutside.review.totalLines).toBe(0);
    const linked = { ...pr, body: 'Refs #3', issueKeys: ['Acme/app#3'] };
    const excluded = buildWork({
      ...input,
      prs: [linked],
      maps: { 'Acme/app#1': 'outside', 'Acme/app#3': 'fix' },
    });
    expect(excluded.byNode['fix']?.openPrs).toEqual([]);
    expect(excluded.byNode['tasks']?.openPrs).toEqual([]);
    const linkedFallback = buildWork({
      ...input,
      prs: [linked],
      maps: { 'Acme/app#1': 'missing', 'Acme/app#3': 'fix' },
    });
    expect(linkedFallback.byNode['fix']?.openPrs.map((p) => p.key)).toEqual(['Acme/app#1']);
  });
  it('keeps sections without approved weighted units pending even without open PRs', () => {
    const empty = { ...node, units: [] };
    expect(scopeView(empty, []).pending).toBe(true);
    expect(scopeView(empty, []).reason).toContain('approved scope');
    expect(scopeView(empty, [pr], { ...estimate(), units: {} }).pending).toBe(true);
  });
  it('subtracts built scope from planned and preserves live and merged truth', () => {
    const view = scopeView(node, [pr], estimate());
    expect(view.shares).toEqual({ live: 0, merged: 50, built: 25, planned: 25 });
    expect(view.pending).toBe(false);
    expect(Object.values(view.shares).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it('retains raw fractional audit weights rather than rounding a future project’s scope denominator', () => {
    const audit = JSON.parse(fixture('audit.json')) as Audit;
    const id = node.units[0]!.id;
    const changed = {
      ...audit,
      units: { ...audit.units, [id]: { ...audit.units[id]!, days: 0.25 } },
    };
    const snapshot = buildSnapshot({
      audit: changed,
      flow: JSON.parse(fixture('flow.json')) as Flow,
      plan,
      generatedAt: '2026-10-14T01:00:00Z',
    });
    expect(
      snapshot.stages
        .flatMap((s) => s.nodes)
        .flatMap((n) => n.units)
        .find((u) => u.id === id)?.days,
    ).toBe(0.25);
  });
  it('uses unit day weights and caps each unit at its remaining scope', () => {
    const weighted = {
      ...node,
      units: [
        {
          ...node.units[0]!,
          id: 'A',
          days: 1,
          coded: { ...node.coded, pct: 80 },
          estimate: { ...node.estimate, pct: 80 },
        },
        {
          ...node.units[0]!,
          id: 'B',
          days: 3,
          coded: { ...node.coded, pct: 40 },
          estimate: { ...node.estimate, pct: 40 },
        },
      ],
    };
    const e = {
      ...estimate(),
      evidence: scopeEvidence(weighted, [pr]),
      units: {
        A: { built: 999, reason: 'Capped' },
        B: { built: 10, reason: 'Weighted' },
      },
    };
    expect(scopeView(weighted, [pr], e).shares.built).toBe(12.5);
  });
  it('does not multiply a jointly estimated feature when stacked PRs cover it twice', () => {
    const prs = [pr, { ...pr, key: 'Acme/app#2', number: 2 }];
    expect(scopeView(node, prs, estimate(prs)).shares.built).toBe(25);
    const repair = scopeView(node, [pr], estimate([pr], 0));
    expect(repair.shares.built).toBe(0);
    expect(repair.pending).toBe(false);
    expect(repair.estimated).toBe(true);
  });
  it('invalidates estimates when heads, size, body, baseline, weights or scope text changes', () => {
    const e = estimate();
    for (const changed of [
      { ...pr, headRefOid: 'b'.repeat(40) },
      { ...pr, additions: 301 },
      { ...pr, body: 'Changed' },
      { ...pr, issueKeys: ['Acme/app#4'] },
    ])
      expect(scopeView(node, [changed], e).pending).toBe(true);
    for (const changed of [
      { ...node, text: 'New scope' },
      { ...node, units: node.units.map((u) => ({ ...u, days: u.days + 1 })) },
      { ...node, units: node.units.map((u) => ({ ...u, estimate: { ...u.estimate, pct: 60 } })) },
      {
        ...node,
        units: node.units.map((u) => ({ ...u, audit: { ...u.audit, why: 'Corrected audit' } })),
      },
    ])
      expect(scopeView(changed, [pr], e).pending).toBe(true);
    expect(scopeView(node, [pr], e, false).pending).toBe(true);
    expect(scopeView(node, [pr], { ...e, units: {} }).pending).toBe(true);
    expect(
      scopeView(node, [pr], {
        ...e,
        units: { ...e.units, outside: { built: 5, reason: 'Invalid' } },
      }).pending,
    ).toBe(true);
  });
  it('rounds all four displayed segments jointly', () => {
    expect(roundedShares({ live: 6.4, merged: 39.4, built: 5.4, planned: 48.8 })).toEqual({
      live: 7,
      merged: 39,
      built: 5,
      planned: 49,
    });
    expect(scopeView(node, [pr]).pending).toBe(true);
    expect(scopeView(node, []).pending).toBe(false);
  });
});

describe('head-bound attributed review evidence', () => {
  it('accepts current-head trusted receipts despite stale debt labels and retains the marker', () => {
    const result = reviewPr({ ...pr, labels: ['unreviewed'], comments: [receipt()] }, ['owner']);
    expect(result.review).toBe('reviewed');
    expect(result.marked).toBe(true);
    expect(result.receiptUrl).toContain('/review');
  });
  it('withholds approval when an older edited HOLD could be outside the truncated comment window', () => {
    const visible = receipt('approve', head, 'owner', '2026-10-14T02:00:00Z');
    const hidden = { ...receipt('changes requested'), updatedAt: '2026-10-14T03:00:00Z' };
    const result = reviewPr(
      { ...pr, labels: ['unreviewed'], comments: [visible], commentsComplete: false },
      ['owner'],
    );
    expect(result.review).toBe('unreviewed');
    expect(result.marked).toBe(true);
    expect(result.receiptUrl).toBe(visible.url);
    expect(result.reason).toContain('comment history incomplete');
    expect(reviewPr({ ...pr, comments: [visible, hidden] }, ['owner']).review).toBe('unreviewed');
    const negative = reviewPr({ ...pr, comments: [hidden], commentsComplete: false }, ['owner']);
    expect(negative.review).toBe('unreviewed');
    expect(negative.receiptUrl).toBe(hidden.url);
    expect(negative.reason).toContain('changes requested');
    expect(negative.reason).toContain('incomplete');
  });
  it('tracks fence markers, opening lengths and whitespace-only closing lines', () => {
    const footer = receipt().body;
    for (const prefix of [
      '```\n~~~\n',
      '````\n```\n',
      '```ts\n```python\n',
      '~~~\n```\n',
      '~~~~\n~~~\n',
    ])
      expect(
        reviewPr({ ...pr, comments: [{ ...receipt(), body: prefix + footer }] }, ['owner']).review,
      ).toBe('unreviewed');
    for (const prefix of [
      '```ts\nExample\n```\n',
      '~~~~\n```inside-code\n~~~~~  \n',
      '```ts\n~~~\n```\n',
      '```ts\n```python\n```\n',
    ])
      expect(
        reviewPr({ ...pr, comments: [{ ...receipt(), body: prefix + footer }] }, ['owner']).review,
      ).toBe('reviewed');
  });
  it('rejects lazy quote continuations and open HTML wrappers, allowing properly closed controls', () => {
    for (const prefix of [
      '> quoted example\n',
      '> quote\nlazy continuation\n',
      '<details>\n',
      '<blockquote>\n',
      '<code>\n',
      '<pre>\n',
      '<DETAILS><code></code>\n',
    ])
      expect(
        reviewPr({ ...pr, comments: [{ ...receipt(), body: prefix + receipt().body }] }, ['owner'])
          .review,
      ).toBe('unreviewed');
    for (const prefix of [
      '> quoted example\n\n',
      '<details>Example</details>\n\n',
      '<blockquote><code>Example</code></blockquote>\n',
    ])
      expect(
        reviewPr({ ...pr, comments: [{ ...receipt(), body: prefix + receipt().body }] }, ['owner'])
          .review,
      ).toBe('reviewed');
  });
  it('recognises the later structured area HOLD from example-app#971 without broadening PASS', () => {
    const sha = 'ee2ca69e3f960bdec7f2c96dc3702c73db90f8e3';
    const approved = receipt('approve', sha, 'maintainer', '2026-10-05T09:24:39Z');
    const held = {
      author: 'maintainer',
      createdAt: '2026-10-12T08:33:25Z',
      updatedAt: '2026-10-12T08:33:25Z',
      url: 'https://github.com/example-org/example-app/pull/971#issuecomment-1000001',
      body: `Review notes\n\nReviewer: Reviewer B\nModel: model-b\nHead SHA: ${sha}\nScope: area pass at main 866cea5634\nVerdict: changes requested\nFindings: #970\n`,
    };
    const candidate = {
      ...pr,
      key: 'example-org/example-app#971',
      number: 971,
      state: 'MERGED' as const,
      headRefOid: sha,
      labels: ['unreviewed'],
    };
    const review = reviewPr({ ...candidate, comments: [approved, held] }, ['maintainer']);
    expect(review.review).toBe('unreviewed');
    expect(review.marked).toBe(true);
    expect(review.receiptUrl).toBe(held.url);
    expect(review.reason).toContain('changes requested');
    for (const changed of [
      { ...held, author: 'intruder' },
      { ...held, body: held.body.replace(sha, 'b'.repeat(40)) },
      {
        ...held,
        body: held.body
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n'),
      },
      { ...held, createdAt: 'invalid', updatedAt: 'invalid' },
    ])
      expect(reviewPr({ ...candidate, comments: [approved, changed] }, ['maintainer']).review).toBe(
        'reviewed',
      );
    for (const changed of [
      { ...held, body: '```\n~~~\n' + held.body },
      { ...held, body: '<details>\n' + held.body },
      { ...held, body: '> quoted HOLD\n' + held.body.replace('Review notes\n\n', '') },
    ])
      expect(reviewPr({ ...candidate, comments: [approved, changed] }, ['maintainer']).review).toBe(
        'unreviewed',
      );
    const loosePass = {
      ...held,
      body: held.body
        .replace('Verdict: changes requested', 'Verdict: approve')
        .replace('Findings: #970', 'Code review: no findings'),
    };
    expect(
      reviewPr({ ...candidate, labels: [], comments: [loosePass] }, ['maintainer']).review,
    ).toBe('unreviewed');
    expect(
      reviewPr(
        { ...candidate, comments: [{ ...held, body: `Prose says changes requested for ${sha}` }] },
        ['maintainer'],
      ).receiptUrl,
    ).toBeNull();
  });
  it('a later structured HOLD mentioning inline HTML cannot preserve an earlier PASS', () => {
    const approved = receipt('approve', head, 'owner', '2026-10-01T01:00:00Z');
    for (const tag of ['<details>', '<Code />', '<pre>', '<blockquote>']) {
      const held = {
        ...receipt('changes requested', head, 'owner', '2026-10-02T01:00:00Z'),
        body: `Fix the \`${tag}\` behaviour.\n\n${receipt('changes requested').body}`,
        url: `https://example.com/hold/${encodeURIComponent(tag)}`,
      };
      const review = reviewPr({ ...pr, comments: [approved, held] }, ['owner']);
      expect(review.review).toBe('unreviewed');
      expect(review.receiptUrl).toBe(held.url);
      expect(review.reason).toContain('changes requested');
    }
  });
  it('rejects untrusted, stale, quoted, malformed and mismatched receipts', () => {
    for (const c of [
      receipt('approve', head, 'intruder'),
      receipt('approve', 'b'.repeat(40)),
      {
        ...receipt(),
        body: receipt()
          .body.split('\n')
          .map((line) => `> ${line}`)
          .join('\n'),
      },
      { ...receipt(), body: `${receipt().body}\n\`\`\`` },
      { ...receipt(), body: `\`\`\`\n${receipt().body}` },
      {
        ...receipt(),
        body: receipt().body.replace('Code review: no findings', 'Code review: changes requested'),
      },
    ])
      expect(reviewPr({ ...pr, comments: [c] }, ['owner']).review).toBe('unreviewed');
  });
  it('lets the latest current-head negative receipt override an earlier PASS and formal approval', () => {
    const result = reviewPr(
      {
        ...pr,
        reviews: [{ head, state: 'APPROVED' }],
        comments: [receipt(), receipt('changes requested', head, 'owner', '2026-10-14T02:00:00Z')],
      },
      ['owner'],
    );
    expect(result.review).toBe('unreviewed');
    expect(
      reviewPr({ ...pr, comments: [receipt()], reviewDecision: 'CHANGES_REQUESTED' }, ['owner'])
        .review,
    ).toBe('unreviewed');
  });
  it('treats an edited negative receipt as latest and resolves tied evidence conservatively', () => {
    const pass = receipt('approve', head, 'owner', '2026-10-14T02:00:00Z');
    const edited = { ...receipt('changes requested'), updatedAt: '2026-10-14T03:00:00Z' };
    for (const comments of [
      [edited, pass],
      [pass, edited],
    ])
      expect(reviewPr({ ...pr, comments }, ['owner']).review).toBe('unreviewed');
    const hold = receipt('changes requested', head, 'owner', pass.createdAt);
    for (const comments of [
      [hold, pass],
      [pass, hold],
    ])
      expect(reviewPr({ ...pr, comments }, ['owner']).review).toBe('unreviewed');
  });
  it('requires formal approval on current head, full metadata, no negative opinion and no debt', () => {
    expect(reviewPr({ ...pr, reviews: [{ head, state: 'APPROVED' }] }).review).toBe('reviewed');
    for (const patch of [
      { reviews: [{ head: 'b'.repeat(40), state: 'APPROVED' }] },
      { labels: ['unreviewed'] },
      { reviewsComplete: false },
      { commentsComplete: false },
      { reviewDecision: 'CHANGES_REQUESTED' },
    ])
      expect(reviewPr({ ...pr, reviews: [{ head, state: 'APPROVED' }], ...patch }).review).toBe(
        'unreviewed',
      );
    expect(reviewPr(pr).review).toBe('unreviewed');
  });
  it('weights open and merged changes, including zero-scope repairs, and deduplicates PR keys', () => {
    const approved = reviewPr({ ...pr, comments: [receipt()] }, ['owner']);
    const pending = reviewPr({
      ...pr,
      key: 'Acme/app#2',
      state: 'MERGED',
      additions: 50,
      deletions: 50,
    });
    const view = reviewView([approved, approved, pending], true);
    expect(view.pct).toBe(80);
    expect(view.totalLines).toBe(500);
    expect(reviewView([approved, { ...pending, changedLines: null }], true).pct).toBeNull();
    expect(reviewView([approved], false).pct).toBeNull();
    expect(reviewView([], true).pct).toBeNull();
  });
  it('counts a freshly relocated PR once and never synthesises missing metadata in its old section', () => {
    const historical = buildSnapshot({
      audit: JSON.parse(fixture('audit.json')) as Audit,
      flow: JSON.parse(fixture('flow.json')) as Flow,
      plan,
      generatedAt: '2026-10-14T01:00:00Z',
      prs: [
        {
          number: 1,
          title: 'Feature',
          body: `Unit: ${node.units[0]!.id}`,
          url: pr.url,
          headRefName: 'feature',
          mergedAt: '2026-10-14T00:00:00Z',
          updatedAt: '2026-10-14T00:00:00Z',
          labels: [],
        },
      ],
    });
    const approved = {
      ...pr,
      body: 'Section: fix',
      state: 'MERGED' as const,
      comments: [receipt()],
    };
    const view = buildWork({
      project,
      plan,
      nodes: historical.stages.flatMap((s) => s.nodes),
      issues: {},
      prs: [],
      trackedMergedPrs: [approved],
      mergedPrs: Object.values(historical.prs),
      maps: {},
      at: 'now',
      complete: true,
      error: null,
    });
    expect(view.byNode['tasks']?.review.prs).toHaveLength(0);
    expect(view.byNode['tasks']?.planning.build).toHaveLength(0);
    expect(view.byNode['fix']?.review.pct).toBe(100);
    expect(view.review.prs).toHaveLength(1);
    expect(view.review.pct).toBe(100);
  });
  it('uses all-repo merged history and preserves legacy placement without double-counting', () => {
    const approved = { ...pr, state: 'MERGED' as const, comments: [receipt()] };
    const view = buildWork({
      project,
      plan,
      nodes: [node],
      issues: {},
      prs: [],
      trackedMergedPrs: [approved],
      maps: {},
      at: 'now',
      complete: true,
      error: null,
    });
    expect(view.byNode['tasks']?.review.pct).toBe(100);
    expect(view.byNode['tasks']?.planning.build).toHaveLength(1);
  });
});

const apiPr = (number: number, updatedAt = '2026-10-14T01:00:00Z') => ({
  number,
  title: 'Feature',
  body: 'Section: tasks',
  url: `https://example.com/${number}`,
  headRefName: 'feature',
  headRefOid: head,
  additions: 300,
  deletions: 100,
  updatedAt,
  labels: { totalCount: 1, nodes: [{ name: 'unreviewed' }] },
  reviewDecision: null,
  latestOpinionatedReviews: { totalCount: 0, nodes: [] },
  comments: { totalCount: 1, nodes: [{ ...receipt(), author: { login: 'owner' } }] },
  closingIssuesReferences: { totalCount: 0, nodes: [] },
});
const answer = (field: string, nodes: unknown[], next = false) =>
  JSON.stringify({
    data: {
      rateLimit: { remaining: 4000 },
      repository: {
        [field]: { nodes, pageInfo: { hasNextPage: next, endCursor: next ? 'next' : null } },
      },
    },
  });
const limits = JSON.stringify({
  resources: { core: { remaining: 4000 }, graphql: { remaining: 4000 } },
});
describe('all-repository merged PR history', () => {
  it('backfills v1, pages merged PRs and reads open PRs fresh', async () => {
    const calls: string[] = [];
    const result = await refreshWork({
      project,
      cache: { ...emptyWorkCache('test'), version: 1, complete: true },
      now: new Date('2026-10-14T02:00:00Z'),
      run: async (args) => {
        if (args[1] === 'rate_limit') return limits;
        const query = args.find((a) => a.startsWith('query='))!;
        calls.push(query);
        if (query.includes('issues(first')) return answer('issues', []);
        if (query.includes('states:OPEN')) return answer('pullRequests', [apiPr(3)]);
        return args.includes('cursor=next')
          ? answer('pullRequests', [apiPr(2, '2020-01-01T00:00:00Z')])
          : answer('pullRequests', [apiPr(1)], true);
      },
    });
    expect(result.version).toBe(2);
    expect(result.mergedPrs?.map((p) => p.number)).toEqual([1, 2]);
    expect(result.prs.map((p) => p.number)).toEqual([3]);
    expect(result.mergedPrs?.[0]?.comments?.[0]?.author).toBe('owner');
    expect(
      calls.every((q) => !q.includes('latestOpinionatedReviews') || q.includes('writersOnly:true')),
    ).toBe(true);
    expect(result.complete).toBe(true);
  });
  it('uses repo-specific incremental watermarks, full pages new repos and removes deleted repos', async () => {
    const old: WorkCache = {
      ...emptyWorkCache('test'),
      complete: true,
      mergedThrough: { 'Acme/app': '2026-10-14T01:00:00Z' },
      ledgerPrs: [],
      mergedPrs: [
        { ...pr, state: 'MERGED' },
        { ...pr, key: 'Acme/removed#4', number: 4 },
      ],
      prs: [{ ...pr, number: 6 }],
      reposThrough: { 'Acme/app': '2026-10-14T01:00:00Z' },
    };
    const calls: string[][] = [];
    const result = await refreshWork({
      project: { ...project, repos: ['Acme/app', 'Acme/new'] },
      cache: old,
      now: new Date('2026-10-14T01:05:00Z'),
      run: async (args) => {
        calls.push([...args]);
        if (args[1] === 'rate_limit') return limits;
        const query = args.find((a) => a.startsWith('query='))!;
        if (query.includes('issues(first')) return answer('issues', []);
        if (query.includes('states:OPEN')) return answer('pullRequests', []);
        return answer(
          'pullRequests',
          [
            apiPr(
              args.includes('name=new') ? (args.includes('cursor=next') ? 8 : 7) : 5,
              '2020-01-01T00:00:00Z',
            ),
          ],
          !args.includes('cursor=next'),
        );
      },
    });
    expect(result.mergedPrs?.map((p) => p.key).toSorted()).toEqual([
      'Acme/app#1',
      'Acme/new#7',
      'Acme/new#8',
    ]);
    expect(result.prs).toHaveLength(0);
    expect(
      calls.filter((a) => a.includes('name=app') && a.some((q) => q.includes('states:MERGED'))),
    ).toHaveLength(1);
    expect(
      calls.filter((a) => a.includes('name=new') && a.some((q) => q.includes('states:MERGED'))),
    ).toHaveLength(2);
  });
  it('warns the card of a PR whose closing references GitHub cut short (TN-37)', async () => {
    const refs = Array.from({ length: 100 }, (_, n) => ({
      number: 1000 + n,
      title: `Ticket ${n}`,
      url: `https://example.com/t${n}`,
      state: 'OPEN',
      repository: { nameWithOwner: 'Acme/app' },
    }));
    const card = async (totalCount: number) => {
      const cache = await refreshWork({
        project,
        cache: emptyWorkCache('test'),
        now: new Date('2026-10-14T02:00:00Z'),
        run: async (args) => {
          if (args[1] === 'rate_limit') return limits;
          const query = args.find((a) => a.startsWith('query='))!;
          if (query.includes('issues(first')) return answer('issues', []);
          return answer(
            'pullRequests',
            query.includes('states:OPEN')
              ? [{ ...apiPr(3), closingIssuesReferences: { totalCount, nodes: refs } }]
              : [],
          );
        },
      });
      const view = buildWork({
        project,
        plan,
        nodes: snap.stages.flatMap((s) => s.nodes),
        issues: cache.issues,
        prs: cache.prs,
        trackedMergedPrs: cache.mergedPrs ?? [],
        maps: {},
        at: cache.at,
        complete: cache.complete,
        error: cache.error,
      });
      return { cache, view };
    };
    const cut = await card(101);
    expect(cut.cache).toMatchObject({ complete: true, truncated: true });
    expect(cut.view.byNode['tasks']?.openPrs.map((p) => p.key)).toEqual(['Acme/app#3']);
    expect(cut.view.byNode['tasks']?.missing).toContain('context');
    expect(cut.view.byNode['fix']?.missing).not.toContain('context');
    expect(cut.cache.prs[0]?.closingComplete).toBe(false);
    const whole = await card(100);
    expect(whole.cache.truncated).toBe(false);
    expect(whole.view.byNode['tasks']?.missing).not.toContain('context');
  });
  it('marks truncated review metadata incomplete and preserves cached evidence on reserve failure', async () => {
    const result = await refreshWork({
      project,
      cache: emptyWorkCache('test'),
      now: new Date(),
      run: async (args) => {
        if (args[1] === 'rate_limit') return limits;
        const query = args.find((a) => a.startsWith('query='))!;
        if (query.includes('issues(first')) return answer('issues', []);
        return answer(
          'pullRequests',
          query.includes('states:MERGED')
            ? [{ ...apiPr(1), latestOpinionatedReviews: { totalCount: 101, nodes: [] } }]
            : [],
        );
      },
    });
    // TN-37: the read finished, so it stays complete; the cut-short reviews are recorded apart.
    expect(result.complete).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.mergedPrs?.[0]?.reviewsComplete).toBe(false);
    const old = { ...result, at: '2026-10-14T01:00:00Z', complete: true };
    const failed = await refreshWork({
      project,
      cache: old,
      now: new Date(),
      run: async () =>
        JSON.stringify({ resources: { core: { remaining: 999 }, graphql: { remaining: 4000 } } }),
    });
    expect(failed.at).toBe(old.at);
    expect(failed.mergedPrs).toEqual(old.mergedPrs);
    // #242: the reserve stop keeps the last good read's completeness and says why it stopped.
    expect(failed.complete).toBe(true);
    expect(failed.lastFailure?.error).toMatch(/reserve/);
  });
});

it('holds an old snapshot at the UI boundary and accepts the matching current version', () => {
  expect(currentSnapshot({ ...snap, schema: 'work-map/3' })).toBeNull();
  expect(currentSnapshot(null)).toBeNull();
  expect(currentSnapshot(snap)).toBe(snap);
});
