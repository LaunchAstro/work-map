// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { buildSeatGauge, currentSeatGauge } from '../src/core/seat-gauge.ts';
import type { SeatGaugeReport, SeatGaugeSession } from '../src/core/seat-gauge.ts';
import { AgentPills, SeatGauge, SeatGaugeContents, sessionDetails } from '../src/web/SeatGauge.tsx';
import { currentAgents } from '../src/web/snapshot.ts';
import { AGENTS_SCHEMA } from '../src/core/contract.ts';
const now = Date.parse('2026-10-16T01:00:00Z');
const at = new Date(now).toISOString();
function fixture() {
  const project = {
    version: 1 as const,
    id: 'proof',
    title: 'Proof',
    roadmapRepo: 'Example/plan',
    productRepo: 'Example/product',
    repos: ['Example/product'],
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
    seatGauge: { repositories: { label: 'Example/product' } },
  };
  project.repos = ['Example/product'];
  const row = {
    machine: 'machine',
    session_id: 'id',
    workspace: 'label-tasks-seat',
    pane: 'pane',
    tool: 'codex',
    repo: 'label',
    section: 'tasks',
    branch: 'work',
    started_at: new Date(now - 60_000).toISOString(),
    status: 'done',
    as_of: at,
    stale: false,
    tokens: {
      responses: 1,
      input: 111,
      output: 222,
      thinking: 22,
      cacheRead: 333,
      cacheWrite5m: 444,
      cacheWrite1h: 555,
    },
    usd: 0.1234,
  };
  const log = { version: 1, updated: at, sessions: [row], problems: {} };
  const cache = {
    project: project.id,
    at,
    complete: true,
    error: null,
    prs: [
      {
        key: 'Example/product#2',
        headRepository: 'Example/product',
        headRefName: 'work',
        issueKeys: ['Example/product#1'],
        state: 'OPEN',
      },
    ],
  };
  return {
    project,
    row,
    log,
    cache,
    build: () => buildSeatGauge(log, project, new Set(['tasks']), cache, new Date(now)),
  };
}
it('labels every figure as a session total, preserves thinking as an output subset and never calls done closed', () => {
  const f = fixture();
  const report = f.build();
  const row = report.sessions[0]!;
  expect(row.state).toBe('current');
  const html = renderToStaticMarkup(<SeatGaugeContents report={report} />);
  expect(html).toContain('Session total');
  expect(html).toContain('earlier branches');
  expect(html).toContain('list-price USD 0.1234');
  expect(html).toContain('output 222');
  expect(html).toContain('(included in output)');
  expect(html).toContain('turn complete, session open');
  expect(html).not.toMatch(/ticket (time|cost)/i);
  const agent = renderToStaticMarkup(<AgentPills agents={{ open: [row], last: null }} />);
  expect(agent).not.toContain('Agent ');
  expect(agent).toContain('data-working="no"');
  f.row.status = 'working';
  expect(
    renderToStaticMarkup(<AgentPills agents={{ open: [f.build().sessions[0]!], last: null }} />),
  ).toContain('data-working="yes"');
});
it.each([
  'expired',
  'failed',
  'future',
  'future-github',
  'wrong-project',
  'duplicate',
  'wrong-id',
  'bad-elapsed',
])('does not show current totals for %s browser evidence', (mode) => {
  const f = fixture();
  const report = f.build();
  if (mode === 'future') report.at = new Date(now + 1).toISOString();
  // #242: old GitHub placements keep their last read; only a never-read or future-dated one is refused.
  if (mode === 'future-github') report.githubAt = new Date(now + 1).toISOString();
  if (mode === 'duplicate') report.sessions.push(report.sessions[0]!);
  if (mode === 'wrong-id') report.sessions[0]!.id = 'invented';
  if (mode === 'bad-elapsed') report.sessions[0]!.elapsedSeconds = 99;
  const shown = currentSeatGauge(
    report,
    mode === 'wrong-project' ? 'other' : f.project.id,
    mode === 'expired' ? now + 90_001 : now,
    mode === 'failed',
  );
  expect(shown?.sessions.filter((row) => row.state === 'current') ?? []).toHaveLength(0);
  expect(renderToStaticMarkup(<SeatGaugeContents report={shown} />)).not.toContain('input 111');
});
it('preserves exact source dates on display expiry and reevaluates mappings on each publication', () => {
  const f = fixture();
  const report = f.build();
  const expired = currentSeatGauge(report, f.project.id, now + 90_001)!;
  expect(expired.at).toBe(at);
  expect(expired.sessions[0]?.source.as_of).toBe(at);
  f.project.seatGauge.repositories.label = 'Other/product';
  expect(f.build()).toMatchObject({ sessions: [], unmapped: 1 });
  f.project.seatGauge.repositories.label = 'example/PRODUCT';
  expect(f.build().sessions[0]?.state).toBe('current');
  f.row.section = 'guess-me';
  expect(f.build().sessions[0]?.state).toBe('pending');
});
it('discards malformed optional session data without discarding ordinary agents', () => {
  const agents = {
    schema: AGENTS_SCHEMA,
    generatedAt: at,
    herdr: { ok: false },
    lanes: [],
    byNode: {},
    fog: [],
    seatGauge: { schema: 'unexpected' },
  };
  expect(currentAgents(agents)).toMatchObject({ schema: AGENTS_SCHEMA, lanes: [] });
  expect(currentAgents(agents)?.seatGauge).toBeUndefined();
});
it('keeps impossible clocks, unknown statuses and inherited repository mappings pending', () => {
  for (const mode of ['clock', 'status', 'prototype']) {
    const f = fixture();
    if (mode === 'clock') f.row.started_at = new Date(now + 1000).toISOString();
    if (mode === 'status') f.row.status = 'unknown';
    if (mode === 'prototype') {
      f.project.seatGauge.repositories = Object.create({ label: 'Example/product' });
    }
    if (mode === 'prototype') expect(f.build()).toMatchObject({ sessions: [], unmapped: 1 });
    else expect(f.build().sessions[0]?.state).toBe('pending');
  }
});
it('hides the Seat Gauge header button when the project publishes no report (#153)', () => {
  expect(renderToStaticMarkup(<SeatGauge report={null} />)).toBe('');
});

it('reads agent details and the pending observation in AEST', () => {
  const observed = '2026-10-17T01:00:00.000Z';
  const row: SeatGaugeSession = {
    id: JSON.stringify(['fixture', 'fixture']),
    source: {
      machine: 'fixture',
      session_id: 'fixture',
      workspace: 'fixture',
      pane: 'fixture',
      tool: 'codex',
      model: null,
      effort: null,
      repo: 'fixture',
      section: 'tasks',
      seat: null,
      branch: 'wm/1',
      started_at: observed,
      closed_at: null,
      status: 'working',
      as_of: observed,
      stale: false,
      tokens: null,
      usd: null,
    },
    repository: 'Example/product',
    section: 'tasks',
    prs: [],
    tickets: ['Example/product#1'],
    elapsedSeconds: 0,
    state: 'pending',
    reason: 'Fixture',
  };
  const report: SeatGaugeReport = {
    schema: 'work-map-seat-gauge/1',
    project: 'fixture',
    at: observed,
    readAt: observed,
    githubAt: observed,
    state: 'pending',
    reason: 'Fixture',
    sessions: [row],
    unmapped: 0,
  };
  const element = document.createElement('div');
  element.innerHTML = renderToStaticMarkup(<SeatGaugeContents report={report} />);
  const pending = [...element.querySelectorAll('p')].find((p) =>
    p.textContent.startsWith('Session total pending. Last observation'),
  )?.textContent;
  // 01:00 UTC is 11:00 am AEST, whatever the date layout.
  expect(sessionDetails(row)).toMatch(/11:00(?::00)?\s*am/i);
  expect(pending).toMatch(/11:00(?::00)?\s*am/i);
});
