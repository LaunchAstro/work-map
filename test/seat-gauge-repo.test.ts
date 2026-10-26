import { expect, it } from 'vitest';
import { buildSeatGauge, seatGaugeFailure } from '../src/core/seat-gauge.ts';
import type { Project } from '../src/readers/project.ts';

// Seat Gauge's `repository` is the GitHub `owner/name` of the session's remote, null when it has
// none, and absent from older versions; `repo` stays the label its workspace name starts with.
const now = Date.parse('2026-10-26T01:00:00Z');
const at = new Date(now).toISOString();
function fixture(repository: unknown, workspace = 'LABEL-tasks-seat', repo: unknown = 'LABEL') {
  const project = {
    version: 1,
    id: 'proof',
    title: 'Proof',
    roadmapRepo: 'Example/plan',
    productRepo: 'Example/product',
    repos: ['Example/product', 'Example/other'],
    files: { audit: '', flow: '', plan: '', mapping: '', sections: '' },
    lanePrefix: '',
    laneRules: [],
    dependencies: [],
    ticketConventions: {
      readyLabel: 'ready',
      ticketLabels: [],
      mapLabel: 'map',
      ideaLabels: [],
      ideaPattern: '^Idea:',
      specLabels: ['spec'],
      specPattern: '^Spec:',
    },
    seatGauge: { repositories: { LABEL: 'Example/product' } },
  } as unknown as Project;
  const row: Record<string, unknown> = {
    machine: 'machine',
    session_id: 'id',
    workspace,
    pane: 'pane',
    tool: 'claude',
    section: 'tasks',
    seat: 'seat',
    branch: null,
    started_at: new Date(now - 60_000).toISOString(),
    status: 'working',
    as_of: at,
    stale: false,
    tokens: null,
    usd: null,
  };
  if (repo !== undefined) row['repo'] = repo;
  if (repository !== undefined) row['repository'] = repository;
  const log = { version: 1, updated: at, sessions: [row], problems: {} };
  // An open PR #12 in Example/other, so a lane its workspace names is placed (#248).
  const cache = {
    project: 'proof',
    at,
    complete: true,
    error: null,
    prs: [
      {
        key: 'Example/other#12',
        headRepository: 'Example/other',
        headRefName: 'lane',
        issueKeys: [],
        state: 'OPEN',
      },
    ],
  };
  return {
    project,
    log,
    build: () => buildSeatGauge(log, project, new Set(['tasks']), cache, new Date(now)),
  };
}
const mapped = (f: ReturnType<typeof fixture>) => {
  const report = f.build();
  return { repository: report.sessions[0]?.repository ?? null, unmapped: report.unmapped };
};

const lane = { pattern: '^LANE-[A-Za-z]+-([1-9][0-9]*)-', repository: 'Example/other' };

it('maps a session by the GitHub repository Seat Gauge names, ahead of the label map', () => {
  expect(mapped(fixture('Example/other'))).toEqual({ repository: 'Example/other', unmapped: 0 });
});
it('takes the configured spelling of a named repository, as repository comparison ignores case', () => {
  expect(mapped(fixture('example/PRODUCT'))).toEqual({
    repository: 'Example/product',
    unmapped: 0,
  });
});
it.each([
  ['null', null],
  ['absent', undefined],
])(
  'falls back to the label map, then the workspace pattern, when repository is %s',
  (_, repository) => {
    expect(mapped(fixture(repository))).toEqual({ repository: 'Example/product', unmapped: 0 });
    const f = fixture(repository, 'LANE-Fix-12-seat', null);
    expect(mapped(f)).toEqual({ repository: null, unmapped: 1 });
    Object.assign(f.project.seatGauge!, { workspace: lane });
    expect(mapped(f).repository).toBe('Example/other');
  },
);
it.each([
  'Example/product/extra',
  'Example/',
  '/product',
  'Example product/x',
  'Exa_mple/product',
  'Example/product\n',
  '',
  42,
  { owner: 'Example' },
])('ignores a malformed repository %j and falls back as if it were absent', (repository) => {
  const f = fixture(repository);
  const report = f.build();
  expect(report.state).toBe('current');
  expect(report.sessions[0]).toMatchObject({
    repository: 'Example/product',
    source: { repository: null },
  });
});
it('keeps an overlength named foreign repository anonymous', () => {
  const f = fixture(`Outside/${'p'.repeat(505)}`);
  // The label maps to the repository of the open PR on this branch, so a fallback would place it.
  Object.assign(f.project.seatGauge!.repositories!, { LABEL: 'Example/other' });
  Object.assign(f.log.sessions[0]!, {
    session_id: 'private-id',
    branch: 'lane',
    tokens: {
      responses: 1,
      input: 1,
      output: 1,
      thinking: 0,
      cacheRead: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
    },
    usd: 1,
  });
  const report = f.build();
  expect(report).toMatchObject({ sessions: [], unmapped: 1 });
  expect(JSON.stringify(report)).not.toContain('private-id');
  const kept = seatGaugeFailure(report, f.project, new Date(now), new Set(['tasks']));
  expect(kept).toMatchObject({ sessions: [], unmapped: 1 });
});
it('counts a session in a repository outside the project anonymously, whatever its label or workspace says', () => {
  const f = fixture('Outside/product', 'LANE-Fix-12-seat');
  Object.assign(f.project.seatGauge!, { workspace: lane });
  const report = f.build();
  expect(report.sessions).toHaveLength(0);
  expect(report.unmapped).toBe(1);
  expect(JSON.stringify(report)).not.toContain('Outside');
});
it('drops a kept row after a failed read once its named repository leaves the project', () => {
  const f = fixture('Example/other');
  const before = f.build();
  expect(before.sessions).toHaveLength(1);
  // A retained row is mapped again from its own source under the current config.
  Object.assign(f.project, { repos: ['Example/product'] });
  const after = seatGaugeFailure(before, f.project, new Date(now), new Set(['tasks']));
  expect(after.sessions).toHaveLength(0);
  expect(after.unmapped).toBe(1);
});
it('keeps a row saved before the repository field existed after a failed read', () => {
  const f = fixture(undefined);
  const before = f.build();
  const saved = JSON.parse(JSON.stringify(before));
  delete saved.sessions[0].source.repository;
  const after = seatGaugeFailure(saved, f.project, new Date(now), new Set(['tasks']));
  expect(after.sessions).toHaveLength(1);
  expect(after.sessions[0]?.repository).toBe('Example/product');
});
