// SPDX-License-Identifier: AGPL-3.0-only
// #252: a card keeps its agents between Seat Gauge reads, and remembers the last one that closed there.
import { expect, it } from 'vitest';
import { cardAgents, type SeatGaugeReport, type SeatGaugeSession } from '../src/core/seat-gauge.ts';

const now = Date.parse('2026-10-19T03:00:00Z');
const iso = (msAgo: number): string => new Date(now - msAgo).toISOString();
function session(
  id: string,
  section: string | null,
  status: string,
  started: number,
  closed: number | null = null,
): SeatGaugeSession {
  return {
    id,
    repository: 'Demo/product',
    section,
    prs: [],
    tickets: [`Demo/product#${id.length}`],
    elapsedSeconds: null,
    // Pending, as the window marks every row once a publication passes its 90-second check.
    state: 'pending',
    reason: 'Fresh mapped session evidence pending',
    source: {
      machine: 'm4',
      session_id: id,
      workspace: `PR-Fix-${id}-Seat`,
      pane: 'p',
      tool: 'claude',
      model: null,
      effort: null,
      repo: null,
      section: null,
      seat: null,
      branch: null,
      started_at: iso(started),
      closed_at: closed === null ? null : iso(closed),
      status,
      as_of: iso(100_000),
      stale: false,
      tokens: null,
      usd: null,
    },
  };
}
function report(at: number, sessions: SeatGaugeSession[]): SeatGaugeReport {
  return {
    schema: 'work-map-seat-gauge/1',
    project: 'proof',
    at: iso(at),
    readAt: iso(at),
    githubAt: iso(at),
    state: 'pending',
    reason: 'Fresh Seat Gauge publication pending',
    sessions,
    unmapped: 0,
  };
}

it('keeps open agents on their card past the 90-second check, working ones first', () => {
  const r = report(120_000, [
    session('a', 'runs', 'done', 60_000),
    session('b', 'runs', 'working', 30_000),
    session('c', 'chat', 'working', 10_000),
    session('d', 'runs', 'closed', 90_000, 20_000),
  ]);
  const runs = cardAgents(r, 'runs', now);
  expect(runs.open.map((row) => row.id)).toEqual(['b', 'a']);
  expect(runs.last).toBeNull();
});

it('shows the latest closed agent when none is open', () => {
  const r = report(10_000, [
    session('old', 'runs', 'closed', 900_000, 600_000),
    session('new', 'runs', 'closed', 500_000, 60_000),
  ]);
  expect(cardAgents(r, 'runs', now)).toEqual({ open: [], last: r.sessions[1] });
});

it('lets open agents go once Seat Gauge has published nothing for fifteen minutes', () => {
  const r = report(15 * 60_000 + 1, [
    session('a', 'runs', 'working', 60_000),
    session('z', 'runs', 'closed', 900_000, 600_000),
  ]);
  expect(cardAgents(r, 'runs', now)).toEqual({ open: [], last: r.sessions[1] });
  expect(cardAgents(null, 'runs', now)).toEqual({ open: [], last: null });
});
