import { expect, it } from 'vitest';
import { refreshVersions } from '../src/readers/versions.ts';
import { currentVersions } from '../src/core/versions.ts';

const sha = (n: string): string => n.repeat(40);
function association(
  args: readonly string[],
  prs: { number: number; merged: boolean; mergeCommit: { oid: string } | null }[],
): string {
  const query = args.find((a) => a.startsWith('query=')) ?? '';
  const repository = Object.fromEntries(
    [...query.matchAll(/(c[0-9]+): object\(oid:"([a-f0-9]+)"\)/g)].map((m) => [
      m[1],
      { associatedPullRequests: { pageInfo: { hasNextPage: false }, nodes: prs } },
    ]),
  );
  return JSON.stringify({ data: { rateLimit: { remaining: 4990 }, repository } });
}
const site = {
  name: 'Demo',
  origin: 'https://demo.example.com',
  buildPath: '/build.json',
  metaName: 'demo-build',
};
it('counts merged PR identities, not commits or associated open PRs', async () => {
  const calls: string[][] = [];
  const run = async (args: readonly string[]): Promise<string> => {
    calls.push([...args]);
    const route = args[1] ?? '';
    if (route === 'rate_limit')
      return JSON.stringify({
        resources: { core: { remaining: 5000 }, graphql: { remaining: 5000 } },
      });
    if (route.endsWith('/commits/main')) return JSON.stringify({ sha: sha('d') });
    if (route.endsWith('/commits/aaaaaaaaaaaa')) return JSON.stringify({ sha: sha('a') });
    if (route.includes('/compare/'))
      return JSON.stringify({
        status: 'ahead',
        ahead_by: 3,
        total_commits: 3,
        base_commit: { sha: sha('a') },
        merge_base_commit: { sha: sha('a') },
        commits: [{ sha: sha('b') }, { sha: sha('c') }, { sha: sha('d') }],
      });
    if (route === 'graphql')
      return association(args, [
        { number: 2, merged: true, mergeCommit: { oid: sha('c') } },
        { number: 3, merged: false, mergeCommit: { oid: sha('d') } },
        { number: 1, merged: true, mergeCommit: { oid: sha('b') } },
      ]);
    throw new Error('Unexpected route ' + route);
  };
  const buildPath = site.buildPath;
  const request = async (url: string): Promise<Response> =>
    new Response(
      url.endsWith(buildPath)
        ? JSON.stringify({ build: 'aaaaaaaaaaaa' })
        : '<meta name="demo-build" content="aaaaaaaaaaaa">',
    );
  const result = await refreshVersions({
    repo: 'Demo/product',
    sites: [site],
    run,
    request,
    now: new Date('2026-10-14T01:00:00Z'),
  });
  expect(result.main).toBe(sha('d'));
  expect(result.sites[0]).toMatchObject({
    state: 'current',
    build: 'aaaaaaaaaaaa',
    sha: sha('a'),
    merges: 2,
  });
  expect(calls[1]?.[1]).toBe('repos/Demo/product/commits/main');
});

it('does not treat commented-out metadata as the served page stamp', async () => {
  const run = async (args: readonly string[]): Promise<string> =>
    args[1] === 'rate_limit'
      ? '{"resources":{"core":{"remaining":5000},"graphql":{"remaining":5000}}}'
      : JSON.stringify({ sha: sha('d') });
  const buildPath = site.buildPath;
  const request = async (url: string): Promise<Response> =>
    new Response(
      url.endsWith(buildPath)
        ? '{"build":"aaaaaaaaaaaa"}'
        : '<head><!-- <meta name="demo-build" content="aaaaaaaaaaaa"> --></head>',
    );
  const result = await refreshVersions({
    repo: 'Demo/product',
    sites: [site],
    run,
    request,
    now: new Date('2026-10-14T01:00:00Z'),
  });
  expect(result.sites[0]).toMatchObject({
    state: 'pending',
    sha: null,
    merges: null,
    reason: 'Served page build stamp is missing or ambiguous',
  });
});

function evidence(
  options: {
    status?: string;
    total?: number;
    commits?: string[];
    page?: string;
    stamp?: string;
    remaining?: number;
    failPulls?: boolean;
  } = {},
) {
  const run = async (args: readonly string[]): Promise<string> => {
    const route = args[1] ?? '';
    if (route === 'rate_limit')
      return JSON.stringify({
        resources: { core: { remaining: options.remaining ?? 5000 }, graphql: { remaining: 5000 } },
      });
    if (route.endsWith('/commits/main')) return JSON.stringify({ sha: sha('d') });
    if (route.endsWith('/commits/aaaaaaaaaaaa')) return JSON.stringify({ sha: sha('a') });
    if (route.includes('/compare/'))
      return JSON.stringify({
        status: options.status ?? 'ahead',
        ahead_by: options.total ?? 2,
        total_commits: options.total ?? 2,
        base_commit: { sha: sha('a') },
        merge_base_commit: { sha: sha('a') },
        commits: (options.commits ?? [sha('b'), sha('d')]).map((value) => ({ sha: value })),
      });
    if (route === 'graphql') {
      if (options.failPulls) throw new Error('Network unavailable');
      return association(args, [{ number: 8, merged: true, mergeCommit: { oid: sha('d') } }]);
    }
    throw new Error('Unexpected route');
  };
  const request = async (url: string): Promise<Response> =>
    new Response(
      url.endsWith('.json')
        ? JSON.stringify({ build: options.stamp ?? 'aaaaaaaaaaaa' })
        : (options.page ?? `<meta content="${options.stamp ?? 'aaaaaaaaaaaa'}" name='demo-build'>`),
    );
  return {
    repo: 'Demo/product',
    sites: [site],
    run,
    request,
    now: new Date('2026-10-14T01:00:00Z'),
  };
}
it.each([
  { stamp: 'aaaaaaaaaaaa-dirty' },
  { page: '<meta name="demo-build" content="bbbbbbbbbbbb">' },
  {
    page: '<meta name="demo-build" content="aaaaaaaaaaaa"><meta name="demo-build" content="aaaaaaaaaaaa">',
  },
  { page: "<script>\"<meta name='demo-build' content='aaaaaaaaaaaa'>\"</script>" },
  { page: `<div data-source='<meta name="demo-build" content="aaaaaaaaaaaa">'></div>` },
  { page: '<template><meta name="demo-build" content="aaaaaaaaaaaa"></template>' },
  { page: '<title><meta name="demo-build" content="aaaaaaaaaaaa"></title>' },
  { page: '<meta x:name="demo-build" content="aaaaaaaaaaaa">' },
  { page: '<meta name="wrong" name="demo-build" content="aaaaaaaaaaaa">' },
  { status: 'identical', total: 0, commits: [] },
  { status: 'diverged' },
  { status: 'behind' },
  { total: 3 },
  { commits: [sha('b'), sha('b')] },
  { total: 1001 },
  { failPulls: true },
  { remaining: 1000 },
])('keeps uncertain evidence pending rather than claiming zero: %j', async (options) => {
  const result = await refreshVersions(evidence(options));
  expect(result.sites[0]).toMatchObject({ state: 'pending', merges: null });
});

it.each([true, false])('handles merged=%s PRs without a merge identity', async (merged) => {
  const input = evidence();
  const result = await refreshVersions({
    ...input,
    run: async (args) =>
      args[1] === 'graphql'
        ? association(args, [{ number: 9, merged, mergeCommit: null }])
        : input.run(args),
  });
  expect(result.sites[0]).toMatchObject(
    merged ? { state: 'pending', merges: null } : { state: 'current', merges: 0 },
  );
});

it('rejects current browser evidence whose resolved revision does not match its build', async () => {
  const result = await refreshVersions(evidence());
  expect(currentVersions(result)).not.toBeNull();
  const corrupted = structuredClone(result);
  expect(
    currentVersions({
      ...corrupted,
      sites: [{ ...corrupted.sites[0]!, sha: sha('f') }],
    }),
  ).toBeNull();
});
it('retains a dated last-known observation on failure without labelling it current', async () => {
  const previous = await refreshVersions(evidence());
  const input = evidence({ failPulls: true });
  const result = await refreshVersions({
    ...input,
    previous,
    now: new Date('2026-10-14T02:00:00Z'),
  });
  expect(result.sites[0]).toMatchObject({
    state: 'pending',
    merges: null,
    lastKnown: { at: '2026-10-14T01:00:00.000Z', merges: 1, main: sha('d'), sha: sha('a') },
  });
  expect(result.checkedAt).toBe('2026-10-14T02:00:00.000Z');
});
it('resolves an identical clean build to a verified zero', async () => {
  const input = evidence();
  const run = async (args: readonly string[]): Promise<string> =>
    args[1]?.endsWith('/commits/main') ? JSON.stringify({ sha: sha('a') }) : input.run(args);
  const result = await refreshVersions({
    ...evidence({ status: 'identical', total: 0, commits: [] }),
    run: async (args) =>
      args[1]?.includes('/compare/')
        ? JSON.stringify({
            status: 'identical',
            ahead_by: 0,
            total_commits: 0,
            base_commit: { sha: sha('a') },
            merge_base_commit: { sha: sha('a') },
            commits: [],
          })
        : run(args),
  });
  expect(result.sites[0]).toMatchObject({ state: 'current', merges: 0, sha: sha('a') });
});
it('reads a complete paginated comparison and deduplicates one PR spanning rebase commits', async () => {
  const commits = Array.from({ length: 101 }, (_, i) => (i + 1).toString(16).padStart(40, '0'));
  const head = commits.at(-1)!;
  const run = async (args: readonly string[]): Promise<string> => {
    const route = args[1] ?? '';
    if (route === 'rate_limit')
      return '{"resources":{"core":{"remaining":5000},"graphql":{"remaining":5000}}}';
    if (route.endsWith('/commits/main')) return JSON.stringify({ sha: head });
    if (route.endsWith('/commits/aaaaaaaaaaaa')) return JSON.stringify({ sha: sha('a') });
    if (route.includes('/compare/'))
      return JSON.stringify({
        status: 'ahead',
        ahead_by: 101,
        total_commits: 101,
        base_commit: { sha: sha('a') },
        merge_base_commit: { sha: sha('a') },
        commits: commits
          .slice(route.endsWith('page=1') ? 0 : 100, route.endsWith('page=1') ? 100 : 101)
          .map((value) => ({ sha: value })),
      });
    if (route === 'graphql')
      return association(args, [{ number: 7, merged: true, mergeCommit: { oid: head } }]);
    throw new Error('Unexpected route');
  };
  const result = await refreshVersions({ ...evidence(), run });
  expect(result.sites[0]).toMatchObject({ state: 'current', merges: 1 });
});
it.each(['oversized', 'redirected'])('bounds %s public evidence', async (kind) => {
  const response =
    kind === 'oversized'
      ? new Response('a'.repeat(4097))
      : Object.defineProperty(new Response('{"build":"aaaaaaaaaaaa"}'), 'redirected', {
          value: true,
        });
  const result = await refreshVersions({ ...evidence(), request: async () => response });
  expect(result.sites[0]).toMatchObject({ state: 'pending', sha: null, merges: null });
});

it('bounds comparison work so a slow site cannot consume the manual refresh deadline', async () => {
  let calls = 0;
  const input = evidence();
  const result = await refreshVersions({
    ...input,
    run: async (args) => {
      ++calls;
      return input.run(args);
    },
    now: new Date('2026-10-14T01:00:00Z'),
  });
  expect(result.sites[0]?.merges).toBe(1);
  expect(calls).toBeLessThanOrEqual(5);
});

it.each(['hidden-page', 'graphql-error', 'missing-commit'])(
  'keeps %s PR association evidence pending',
  async (kind) => {
    const input = evidence();
    const run = async (args: readonly string[]): Promise<string> => {
      if (args[1] !== 'graphql') return input.run(args);
      if (kind === 'graphql-error')
        return JSON.stringify({
          errors: [{ message: 'Partial response' }],
          data: { rateLimit: { remaining: 4990 }, repository: {} },
        });
      const response = JSON.parse(
        association(args, [{ number: 8, merged: true, mergeCommit: { oid: sha('d') } }]),
      );
      if (kind === 'missing-commit') response.data.repository.c0 = null;
      else response.data.repository.c0.associatedPullRequests.pageInfo.hasNextPage = true;
      return JSON.stringify(response);
    };
    const result = await refreshVersions({ ...input, run });
    expect(result.sites[0]).toMatchObject({ state: 'pending', merges: null });
  },
);

// TN-50: a failed setup read names the repository on every site, not a generic reason.
it.each([
  ['the rate limit read fails', 0],
  ['the core reserve is reached', 1000],
])('gives every site the repository reason when %s, with no further read', async (_, core) => {
  const calls: string[][] = [];
  let requests = 0;
  const result = await refreshVersions({
    repo: 'Acme/app',
    sites: [
      { ...site, name: 'Acme web', origin: 'https://web.acme.example' },
      { ...site, name: 'Acme admin', origin: 'https://admin.acme.example' },
    ],
    run: async (args) => {
      calls.push([...args]);
      if (core === 0) throw new Error('gh: network unavailable');
      return JSON.stringify({
        resources: { core: { remaining: core }, graphql: { remaining: 5000 } },
      });
    },
    request: async () => {
      requests++;
      return new Response('{}');
    },
    now: new Date('2026-10-14T01:00:00Z'),
  });
  expect(result.main).toBeNull();
  expect(result.sites.map((s) => [s.state, s.reason])).toEqual([
    ['pending', 'Repository revision is unavailable or GitHub read reserve reached'],
    ['pending', 'Repository revision is unavailable or GitHub read reserve reached'],
  ]);
  expect(calls.map((args) => args[1])).toEqual(['rate_limit']);
  expect(requests).toBe(0);
});

// TN-50: a same-repository publication with no sites (after an invalid configuration) has nothing to keep,
// so a failed setup read lists the configured sites as pending, as main does.
it('lists the configured sites when the last publication kept none and the setup read fails', async () => {
  const result = await refreshVersions({
    repo: 'Acme/app',
    sites: [{ ...site, name: 'Acme web', origin: 'https://web.acme.example' }],
    previous: {
      schema: 'work-map-versions/1',
      repo: 'Acme/app',
      checkedAt: '2026-10-14T00:00:00.000Z',
      main: null,
      sites: [],
      error: 'Version configuration is invalid',
    },
    run: async () => {
      throw new Error('gh: network unavailable');
    },
    request: async () => new Response('{}'),
    now: new Date('2026-10-14T01:00:00Z'),
  });
  expect(result.sites.map((s) => [s.name, s.state])).toEqual([['Acme web', 'pending']]);
  expect(result.error).toBe('Repository revision is unavailable or GitHub read reserve reached');
});
