import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { currentSeatGauge } from '../src/core/seat-gauge.ts';
import { emptyWorkCache, refreshWork } from '../src/readers/work-github.ts';
import type { Project } from '../src/readers/project.ts';

const counts = {
  responses: 2,
  input: 100,
  output: 20,
  thinking: 5,
  cacheRead: 30,
  cacheWrite5m: 10,
  cacheWrite1h: 0,
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'work-map-seat-'));
  const data = join(root, 'data');
  mkdirSync(data);
  const support = join(root, 'Library/Application Support/com.launchastro.seatgauge');
  mkdirSync(support, { recursive: true });
  const path = join(support, 'log.json');
  const at = new Date().toISOString();
  const row = {
    machine: 'local',
    session_id: 'session-1',
    workspace: 'product-tasks-seat',
    pane: 'pane-1',
    tool: 'codex',
    model: 'model',
    effort: 'high',
    repo: 'product',
    section: 'tasks',
    seat: 'seat',
    branch: 'feat/7-work',
    started_at: new Date(Date.parse(at) - 60_000).toISOString(),
    status: 'done',
    as_of: at,
    stale: false,
    tokens: counts,
    models: { model: counts },
    usd: 0.01,
  };
  const log = { version: 1, updated: at, sessions: [row], problems: {} };
  const project = {
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
    seatGauge: { repositories: { product: 'Demo/product' } },
  };
  const cache = {
    version: 2,
    project: 'proof',
    at,
    complete: true,
    error: null,
    issues: {},
    prs: [
      {
        key: 'Demo/product#8',
        number: 8,
        title: 'Synthetic',
        body: '',
        url: 'https://github.com/Demo/product/pull/8',
        headRefName: 'feat/7-work',
        headRepository: 'Demo/product',
        issueKeys: ['Demo/product#7'],
        state: 'OPEN',
      },
    ],
  };
  // The GitHub collector's published placements, when a test needs them (#158).
  const placed: { snapshot: unknown } = { snapshot: null };
  function publish() {
    writeFileSync(path, JSON.stringify(log));
    if (placed.snapshot)
      writeFileSync(join(data, 'snapshot.json'), JSON.stringify(placed.snapshot));
    writeFileSync(join(data, 'work-cache.json'), JSON.stringify(cache));
    writeFileSync(join(root, 'project.json'), JSON.stringify(project));
  }
  function run() {
    const result = spawnSync(
      process.execPath,
      [
        resolve('src/cli/generate.ts'),
        'agents',
        '--project',
        join(root, 'project.json'),
        '--repo-root',
        resolve('test/fixtures'),
        '--data',
        data,
      ],
      {
        env: { ...process.env, HOME: root, WORK_MAP_ROUND_ROOT: join(root, 'empty-round') },
        encoding: 'utf8',
        timeout: 15_000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(readFileSync(join(data, 'agents.json'), 'utf8'));
  }
  publish();
  return {
    root,
    data,
    path,
    at,
    row,
    log,
    project,
    cache,
    placed,
    publish,
    run,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}
it('publishes one current-branch-associated session total through the actual agents collector, without closing a done turn', () => {
  const f = fixture();
  try {
    const before = readFileSync(f.path, 'utf8');
    const report = f.run().seatGauge;
    expect(report).toMatchObject({
      schema: 'work-map-seat-gauge/1',
      project: 'proof',
      at: f.at,
      state: 'current',
      sessions: [
        {
          state: 'current',
          repository: 'Demo/product',
          section: 'tasks',
          prs: ['Demo/product#8'],
          tickets: ['Demo/product#7'],
          elapsedSeconds: 60,
          source: { status: 'done', closed_at: null, tokens: counts },
        },
      ],
    });
    expect(readFileSync(f.path, 'utf8')).toBe(before);
  } finally {
    f.close();
  }
});
it.each([
  'repo',
  'branch',
  'fork',
  'unknown-head',
  'future-github',
  'stale-row',
  'future-row',
  'machine-failed',
  'stale-file',
  'duplicate-conflict',
])('keeps %s evidence pending without guessing', (mode) => {
  const f = fixture();
  try {
    if (mode === 'repo') f.row.repo = 'unmapped';
    if (mode === 'branch') f.row.branch = 'other';
    if (mode === 'fork') f.cache.prs[0]!.headRepository = 'Other/product';
    if (mode === 'unknown-head') f.cache.prs[0]!.headRepository = '';
    // #242: old GitHub work keeps its last read; only a future-dated one is refused.
    if (mode === 'future-github') f.cache.at = new Date(Date.now() + 60_000).toISOString();
    if (mode === 'stale-row') f.row.as_of = new Date(Date.now() - 90_001).toISOString();
    if (mode === 'future-row') f.row.as_of = new Date(Date.now() + 60_000).toISOString();
    if (mode === 'machine-failed')
      Object.assign(f.log.problems, { local: 'private diagnostic must not escape' });
    if (mode === 'stale-file') f.log.updated = new Date(Date.now() - 90_001).toISOString();
    if (mode === 'duplicate-conflict')
      f.log.sessions.push({ ...f.row, tokens: { ...counts, input: 999 } });
    f.publish();
    const result = f.run();
    if (mode === 'repo') {
      expect(result.seatGauge.sessions).toHaveLength(0);
      expect(result.seatGauge.unmapped).toBe(1);
      expect(JSON.stringify(result.seatGauge)).not.toContain('session-1');
      expect(JSON.stringify(result.seatGauge)).not.toContain('feat/7-work');
    } else {
      expect(result.seatGauge?.sessions).toHaveLength(1);
      expect(result.seatGauge.sessions[0].state).toBe('pending');
    }
    expect(JSON.stringify(result)).not.toContain('private diagnostic');
  } finally {
    f.close();
  }
});
const byMachine = (r: { sessions: { source: { machine: string } }[] }, machine: string) =>
  r.sessions.find((row) => row.source.machine === machine);
// TN-42: a problem on one machine leaves the report and the other machines' rows current.
it('keeps one machine current when only another machine reports a problem', () => {
  const f = fixture();
  try {
    f.row.machine = 'alpha';
    f.log.sessions.push({ ...f.row, machine: 'beta', session_id: 'session-2' });
    Object.assign(f.log.problems, { beta: 'private diagnostic must not escape' });
    f.publish();
    const report = f.run().seatGauge;
    expect(report.state).toBe('current');
    expect(byMachine(report, 'alpha')).toMatchObject({ state: 'current' });
    expect(byMachine(report, 'beta')).toMatchObject({
      state: 'pending',
      reason: 'Machine observation failed',
    });
    const shown = currentSeatGauge(report, 'proof')!;
    expect(shown.state).toBe('current');
    expect(byMachine(shown, 'alpha')).toMatchObject({ state: 'current' });
    expect(byMachine(shown, 'beta')).toMatchObject({ state: 'pending' });
    expect(JSON.stringify(report)).not.toContain('private diagnostic');
  } finally {
    f.close();
  }
});
it('keeps sessions current on a read whose open PR had its labels cut short (TN-37)', async () => {
  const f = fixture();
  try {
    const project: Project = { ...f.project, version: 1 };
    const open = {
      number: 8,
      title: 'Synthetic',
      body: '',
      url: 'https://github.com/Demo/product/pull/8',
      createdAt: f.at,
      updatedAt: f.at,
      headRefName: 'feat/7-work',
      headRepository: { nameWithOwner: 'Demo/product' },
      labels: {
        totalCount: 101,
        nodes: Array.from({ length: 100 }, (_, n) => ({ name: `l${n}` })),
      },
      latestOpinionatedReviews: { totalCount: 0, nodes: [] },
      comments: { totalCount: 0, nodes: [] },
      closingIssuesReferences: {
        totalCount: 1,
        nodes: [
          {
            number: 7,
            title: 'Work',
            url: 'https://github.com/Demo/product/issues/7',
            state: 'OPEN',
            repository: { nameWithOwner: 'Demo/product' },
          },
        ],
      },
      timelineItems: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] },
    };
    const cache = await refreshWork({
      project,
      cache: emptyWorkCache('proof'),
      now: new Date(),
      run: async (args) => {
        if (args[1] === 'rate_limit')
          return JSON.stringify({
            resources: { core: { remaining: 5000 }, graphql: { remaining: 5000 } },
          });
        const state = /states:(\w+)/.exec(args.find((a) => a.startsWith('query=')) ?? '')?.[1];
        return JSON.stringify({
          data: {
            rateLimit: { remaining: 5000 },
            repository: {
              [state ? 'pullRequests' : 'issues']: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: state === 'OPEN' ? [open] : [],
              },
            },
          },
        });
      },
    });
    writeFileSync(join(f.data, 'work-cache.json'), JSON.stringify(cache));
    const report = f.run().seatGauge;
    expect(report).toMatchObject({
      state: 'current',
      sessions: [{ state: 'current', prs: ['Demo/product#8'], tickets: ['Demo/product#7'] }],
    });
    expect(cache).toMatchObject({ truncated: true, prs: [{ labelsComplete: false }] });
  } finally {
    f.close();
  }
});
it.each(['missing', 'malformed', 'version', 'symlink', 'oversize', 'directory', 'fifo'])(
  'retains dated pending evidence after %s publication',
  (mode) => {
    const f = fixture();
    try {
      const prior = f.run().seatGauge;
      expect(prior?.state).toBe('current');
      rmSync(f.path);
      if (mode === 'malformed') writeFileSync(f.path, '{');
      if (mode === 'version') writeFileSync(f.path, JSON.stringify({ ...f.log, version: 2 }));
      if (mode === 'symlink') {
        writeFileSync(join(f.root, 'target.json'), JSON.stringify(f.log));
        symlinkSync(join(f.root, 'target.json'), f.path);
      }
      if (mode === 'oversize') writeFileSync(f.path, ' '.repeat(4_000_001));
      if (mode === 'directory') mkdirSync(f.path);
      if (mode === 'fifo') expect(spawnSync('mkfifo', [f.path]).status).toBe(0);
      const next = f.run().seatGauge;
      expect(next).toMatchObject({
        state: 'pending',
        at: prior.at,
        sessions: [{ state: 'pending', source: { as_of: f.at, tokens: counts } }],
      });
    } finally {
      f.close();
    }
  },
);
it('deduplicates identical sessions and keeps a session once when it links to multiple PRs', () => {
  const f = fixture();
  try {
    f.log.sessions.push({ ...f.row });
    f.cache.prs.push({ ...f.cache.prs[0]!, key: 'Demo/product#9', number: 9 });
    f.publish();
    const report = f.run().seatGauge;
    expect(report.sessions).toHaveLength(1);
    expect(report.sessions[0].prs).toEqual(['Demo/product#8', 'Demo/product#9']);
  } finally {
    f.close();
  }
});
it('requires explicit producer closure and retains unknown tokens rather than zero', () => {
  const f = fixture();
  try {
    Object.assign(f.row, { closed_at: f.at, status: 'closed', tokens: null, usd: null });
    f.publish();
    expect(f.run().seatGauge.sessions[0]).toMatchObject({
      state: 'current',
      elapsedSeconds: 60,
      source: { closed_at: f.at, status: 'closed', tokens: null, usd: null },
    });
  } finally {
    f.close();
  }
});
it('keeps machine/session tuple identities distinct and strips unsupported producer fields', () => {
  const f = fixture();
  try {
    Object.assign(f.row, {
      machine: 'a:b',
      session_id: 'c',
      prompt: 'marker-private',
      transcript_path: 'marker-path',
    });
    f.log.sessions.push({ ...f.row, machine: 'a', session_id: 'b:c' });
    f.publish();
    const report = f.run().seatGauge;
    expect(report.sessions).toHaveLength(2);
    expect(new Set(report.sessions.map((r: { id: string }) => r.id)).size).toBe(2);
    expect(JSON.stringify(report)).not.toContain('marker-');
  } finally {
    f.close();
  }
});

it('keeps unrelated sessions as an anonymous pending count without publishing identity or usage', () => {
  const f = fixture();
  try {
    f.log.sessions.push({
      ...f.row,
      session_id: 'private-client-id',
      workspace: 'private-client-workspace',
      repo: 'private-client-repo',
      branch: 'private-client-branch',
      tokens: { ...counts, input: 777777 },
      usd: 98.7654,
    });
    f.publish();
    const report = f.run().seatGauge;
    expect(report.sessions).toHaveLength(1);
    expect(report.sessions[0].state).toBe('current');
    expect(report.unmapped).toBe(1);
    expect(JSON.stringify(report)).not.toContain('private-client');
    expect(JSON.stringify(report)).not.toContain('777777');
    expect(JSON.stringify(report)).not.toContain('98.7654');
  } finally {
    f.close();
  }
});
it('removes previously mapped identity after configuration removal even when the next producer read fails', () => {
  const f = fixture();
  try {
    expect(f.run().seatGauge.sessions).toHaveLength(1);
    f.project.seatGauge.repositories.product = 'Other/product';
    f.publish();
    rmSync(f.path);
    const report = f.run().seatGauge;
    expect(report.state).toBe('pending');
    expect(report.sessions).toHaveLength(0);
    expect(report.unmapped).toBe(1);
    expect(JSON.stringify(report)).not.toContain('session-1');
    expect(JSON.stringify(report)).not.toContain('feat/7-work');
  } finally {
    f.close();
  }
});
// The GitHub collector's snapshot: #149 is a ticket in `fix`, PR #150 is placed in `tasks` (#158).
function placements(at: string, prs: Record<string, string> = {}) {
  return {
    id: 'proof',
    ticketProgress: {
      totals: { tickets: [{ key: 'Demo/product#149', section: 'fix' }] },
      skipped: [],
      outside: [],
    },
    work: {
      at,
      byNode: Object.fromEntries(
        ['found', 'tasks', 'fix'].map((id) => [
          id,
          {
            openPrs: Object.entries(prs)
              .filter(([, section]) => section === id)
              .map(([key]) => ({ key })),
            planning: { tickets: [] },
          },
        ]),
      ),
    },
  };
}
function branchSession(f: ReturnType<typeof fixture>) {
  Object.assign(f.project.seatGauge, { branchTicket: '^[a-z]+/([1-9][0-9]*)-' });
  Object.assign(f.row, { branch: 'wm/149-zoom-tens', section: 'Data', status: 'working' });
  f.cache.prs = [];
  f.placed.snapshot = placements(f.at);
}
it('places a working session by its branch ticket before any PR exists (#158)', () => {
  const f = fixture();
  try {
    branchSession(f);
    f.publish();
    expect(f.run().seatGauge.sessions).toMatchObject([
      {
        state: 'current',
        repository: 'Demo/product',
        section: 'fix',
        prs: [],
        tickets: ['Demo/product#149'],
      },
    ]);
  } finally {
    f.close();
  }
});
it('places the same session by its open PR once one exists, keeping the branch ticket (#158)', () => {
  const f = fixture();
  try {
    branchSession(f);
    f.cache.prs = [
      {
        key: 'Demo/product#150',
        number: 150,
        title: 'Synthetic',
        body: '',
        url: 'https://github.com/Demo/product/pull/150',
        headRefName: 'wm/149-zoom-tens',
        headRepository: 'Demo/product',
        issueKeys: ['Demo/product#7'],
        state: 'OPEN',
      },
    ];
    f.placed.snapshot = placements(f.at, { 'Demo/product#150': 'tasks' });
    f.publish();
    expect(f.run().seatGauge.sessions).toMatchObject([
      {
        state: 'current',
        section: 'tasks',
        prs: ['Demo/product#150'],
        tickets: ['Demo/product#149', 'Demo/product#7'],
      },
    ]);
  } finally {
    f.close();
  }
});
it.each(['unplaced-ticket', 'future-snapshot', 'other-project'])(
  'counts an unplaced branch session anonymously, as other unplaced sessions: %s (#158)',
  (mode) => {
    const f = fixture();
    try {
      branchSession(f);
      if (mode === 'unplaced-ticket') f.row.branch = 'wm/148-other';
      if (mode === 'future-snapshot')
        f.placed.snapshot = placements(new Date(Date.now() + 60_000).toISOString());
      if (mode === 'other-project') f.placed.snapshot = { ...placements(f.at), id: 'other' };
      f.publish();
      const report = f.run().seatGauge;
      expect(report.sessions).toHaveLength(0);
      expect(report.unmapped).toBe(1);
      expect(JSON.stringify(report)).not.toContain('session-1');
    } finally {
      f.close();
    }
  },
);
it('keeps a mapped session without a branch pattern as a pending row, as before (#158)', () => {
  const f = fixture();
  try {
    branchSession(f);
    delete (f.project.seatGauge as { branchTicket?: string }).branchTicket;
    f.publish();
    const [row] = f.run().seatGauge.sessions;
    expect(row).toMatchObject({ state: 'pending', section: null, prs: [] });
  } finally {
    f.close();
  }
});
it('rejects a branch pattern without a capture group (#158)', () => {
  const f = fixture();
  try {
    Object.assign(f.project.seatGauge, { branchTicket: '^wm/' });
    f.publish();
    const result = spawnSync(
      process.execPath,
      [
        resolve('src/cli/generate.ts'),
        'agents',
        '--project',
        join(f.root, 'project.json'),
        '--repo-root',
        resolve('test/fixtures'),
        '--data',
        f.data,
      ],
      { env: { ...process.env, HOME: f.root }, encoding: 'utf8', timeout: 15_000 },
    );
    expect(result.status).not.toBe(0);
  } finally {
    f.close();
  }
});
// #248: fleet lanes name their PR or ticket in the herdr workspace (`<REPO>-<Job>-<number>-<Seat>`), not
// in a branch Seat Gauge can see.
function workspaceSession(f: ReturnType<typeof fixture>, workspace: string) {
  Object.assign(f.project.seatGauge, {
    workspace: {
      pattern: '^PR-[A-Za-z]+-([1-9][0-9]*)[a-z]?-[A-Za-z]+$',
      repository: 'Demo/product',
    },
  });
  Object.assign(f.row, {
    workspace,
    repo: 'PR-Fix',
    section: '149b',
    branch: null,
    status: 'working',
  });
  f.cache.prs = [];
  f.placed.snapshot = placements(f.at);
}
it('places a working lane by the ticket its workspace names, even with incomplete token totals (#248)', () => {
  const f = fixture();
  try {
    workspaceSession(f, 'PR-Fix-149b-Seat');
    f.row.stale = true;
    f.publish();
    const report = f.run().seatGauge;
    // The window qualifies the row again; a lane without a branch must stay current there too.
    expect(currentSeatGauge(report, 'proof')?.sessions[0]?.state).toBe('current');
    expect(report.sessions).toMatchObject([
      {
        state: 'current',
        repository: 'Demo/product',
        section: 'fix',
        prs: [],
        tickets: ['Demo/product#149'],
      },
    ]);
  } finally {
    f.close();
  }
});
it('places a lane by the open PR its workspace names (#248)', () => {
  const f = fixture();
  try {
    workspaceSession(f, 'PR-Rebase-150-Seat');
    f.cache.prs = [
      {
        key: 'Demo/product#150',
        number: 150,
        title: 'Synthetic',
        body: '',
        url: 'https://github.com/Demo/product/pull/150',
        headRefName: 'wm/other-branch',
        headRepository: 'Demo/product',
        issueKeys: ['Demo/product#7'],
        state: 'OPEN',
      },
    ];
    f.placed.snapshot = placements(f.at, { 'Demo/product#150': 'tasks' });
    f.publish();
    expect(f.run().seatGauge.sessions).toMatchObject([
      {
        state: 'current',
        section: 'tasks',
        prs: ['Demo/product#150'],
        tickets: ['Demo/product#7'],
      },
    ]);
  } finally {
    f.close();
  }
});
it.each(['PR-Fix-LocalRed-Seat', 'PR-Fix-148-Seat', 'LN-Orchestrator'])(
  'counts a lane whose workspace names no placed work anonymously: %s (#248)',
  (workspace) => {
    const f = fixture();
    try {
      workspaceSession(f, workspace);
      f.publish();
      const report = f.run().seatGauge;
      expect(report.sessions).toHaveLength(0);
      expect(report.unmapped).toBe(1);
    } finally {
      f.close();
    }
  },
);

it('an open PR keeps the branch ticket link even when the map has not placed that ticket (#165)', () => {
  const f = fixture();
  try {
    branchSession(f);
    f.row.branch = 'wm/148-other';
    f.cache.prs = [
      {
        key: 'Demo/product#150',
        number: 150,
        title: 'Synthetic',
        body: '',
        url: 'https://github.com/Demo/product/pull/150',
        headRefName: f.row.branch,
        headRepository: 'Demo/product',
        issueKeys: ['Demo/product#7'],
        state: 'OPEN',
      },
    ];
    f.placed.snapshot = placements(f.at, { 'Demo/product#150': 'tasks' });
    f.publish();
    expect(f.run().seatGauge.sessions).toMatchObject([
      { state: 'current', section: 'tasks', tickets: ['Demo/product#148', 'Demo/product#7'] },
    ]);
  } finally {
    f.close();
  }
});
it('counts a branch session anonymously when its ticket sits in a section no longer on the map (#165)', () => {
  const f = fixture();
  try {
    branchSession(f);
    const snapshot = placements(f.at);
    snapshot.ticketProgress.totals.tickets[0]!.section = 'removed-section';
    f.placed.snapshot = snapshot;
    f.publish();
    const report = f.run().seatGauge;
    expect(report.sessions).toHaveLength(0);
    expect(report.unmapped).toBe(1);
    expect(JSON.stringify(report)).not.toContain('session-1');
  } finally {
    f.close();
  }
});
// A malformed file and a valid file with the wrong schema fail by different paths; both re-place.
it.each(
  ['unplaced', 'pattern', 'other-ticket', 'legacy-report'].flatMap((mode) =>
    ['malformed', 'invalid-schema'].map((failure) => [mode, failure]),
  ),
)(
  'a failed producer read places a kept branch session again under the current config and placements: %s, %s read (#165)',
  (mode, failure) => {
    const f = fixture();
    try {
      branchSession(f);
      f.publish();
      expect(f.run().seatGauge.sessions[0].tickets).toEqual(['Demo/product#149']);
      // `legacy-report`: a report written before sessions carried their branch ticket.
      const prior = JSON.parse(readFileSync(join(f.data, 'agents.json'), 'utf8'));
      if (mode === 'legacy-report') delete prior.seatGauge.sessions[0].branchTicket;
      writeFileSync(join(f.data, 'agents.json'), JSON.stringify(prior));
      const snapshot = placements(f.at);
      if (mode === 'unplaced') snapshot.ticketProgress.totals.tickets = [];
      if (mode === 'pattern')
        Object.assign(f.project.seatGauge, { branchTicket: '^other/([1-9][0-9]*)-' });
      if (mode === 'other-ticket' || mode === 'legacy-report') {
        Object.assign(f.project.seatGauge, { branchTicket: '^wm/1([1-9][0-9]*)-' });
        snapshot.ticketProgress.totals.tickets[0]!.key = 'Demo/product#49';
      }
      f.placed.snapshot = snapshot;
      f.publish();
      writeFileSync(
        f.path,
        failure === 'malformed' ? '{' : JSON.stringify({ ...f.log, version: 2 }),
      );
      const report = f.run().seatGauge;
      if (mode === 'unplaced' || mode === 'pattern') {
        expect(report.sessions).toHaveLength(0);
        expect(report.unmapped).toBe(1);
        expect(JSON.stringify(report)).not.toContain('session-1');
      } else expect(report.sessions).toMatchObject([{ tickets: ['Demo/product#49'] }]);
    } finally {
      f.close();
    }
  },
);
it('places by a day-old GitHub read and expires only with the session (#242)', () => {
  const f = fixture();
  try {
    branchSession(f);
    f.placed.snapshot = placements(new Date(Date.parse(f.at) - 86_400_000).toISOString());
    f.publish();
    const report = f.run().seatGauge;
    expect(report.sessions).toMatchObject([{ state: 'current', section: 'fix' }]);
    expect(currentSeatGauge(report, 'proof', Date.parse(report.readAt))?.sessions[0]?.state).toBe(
      'current',
    );
    expect(currentSeatGauge(report, 'proof', Date.parse(f.at) + 90_001)?.sessions[0]?.state).toBe(
      'pending',
    );
  } finally {
    f.close();
  }
});
