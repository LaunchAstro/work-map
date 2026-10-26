import { describe, expect, it } from 'vitest';
import type { LaneView } from '../src/core/contract.ts';
import {
  reviewView,
  roundedShares,
  type ReviewPr,
  type ScopeShares,
} from '../src/core/coverage.ts';
import type { SectionWork } from '../src/core/work.ts';
import { progressBar } from '../src/web/bar-models.ts';
import { stageMeters } from '../src/web/stage.ts';
import { currentAgents } from '../src/web/snapshot.ts';

const pr = (key: string, changedLines: number | null, reviewed = false): ReviewPr => ({
  key,
  changedLines,
  review: reviewed ? 'reviewed' : 'unreviewed',
  title: key,
  url: 'https://example.com',
  state: 'OPEN',
  marked: false,
  receiptUrl: null,
  reason: '',
  labels: [],
});
function section(shares: ScopeShares, prs: ReviewPr[] = [], pending = false): SectionWork {
  return {
    state: 'planned',
    shares,
    scope: {
      shares,
      display: roundedShares(shares),
      estimated: false,
      pending,
      reason: '',
      at: null,
    },
    review: reviewView(prs, true),
    openPrs: [],
    planning: { idea: [], map: [], tickets: [], spec: [], build: [] },
    missing: [],
    blockers: [],
  };
}
const zero = { live: 0, merged: 0, built: 0, planned: 100 };
const nodes = [{ id: 'a' }, { id: 'b' }];
describe('stage display meters', () => {
  it('averages every exact section equally, rounds once and retains pending open scope', () => {
    const a = section({ live: 97.1, merged: 0.2, built: 0.3, planned: 2.4 });
    const b = section({ live: 0, merged: 0, built: 20, planned: 80 }, [pr('repo#1', 100)], true);
    const result = stageMeters(nodes, { a, b }, true);
    expect(result.scope?.shares).toEqual({ live: 48.55, merged: 0.1, built: 10.15, planned: 41.2 });
    expect(result.scope?.display).toEqual({ live: 49, merged: 0, built: 10, planned: 41 });
    expect(result.scope?.pending).toBe(true);
    expect(stageMeters([...nodes, { id: 'a' }], { a, b }, true)).toEqual(result);
  });
  it('stays pending while any section is fully pending, as the project bar does', () => {
    const a = section({ live: 80, merged: 10, built: 0, planned: 10 });
    const b = section(zero, [], true);
    const result = stageMeters(nodes, { a, b }, true);
    expect(result.scope).toBeUndefined();
    expect(progressBar(result).pending).toBe('Progress pending');
  });
  it('does not publish a percentage for missing, incomplete or empty membership', () => {
    const a = section(zero);
    for (const result of [
      stageMeters(nodes, { a }, true),
      stageMeters([{ id: 'a' }], { a }, false),
      stageMeters([], {}, true),
    ]) {
      expect(result.scope).toBeUndefined();
      expect(result.review?.pct).toBeNull();
    }
  });
  it('weights unique repository-qualified PR changed lines without diluting empty sections', () => {
    const small = pr('one#1', 1, true),
      large = pr('two#1', 99);
    const a = section(zero, [small, large]),
      b = section(zero, [small]);
    const result = stageMeters(nodes, { a, b }, true);
    expect(result.review?.pct).toBe(1);
    expect(result.review?.totalLines).toBe(100);
    expect(stageMeters(nodes, { a, b: section(zero) }, true).review?.pct).toBe(1);
  });
  it('keeps conflicting duplicate, missing-size, zero-size and incomplete review pending', () => {
    const a = section(zero, [pr('one#1', 10, true)]);
    for (const b of [
      section(zero, [pr('one#1', 10)]),
      section(zero, [pr('one#1', 20, true)]),
      section(zero, [pr('two#2', null)]),
    ])
      expect(stageMeters(nodes, { a, b }, true).review?.pct).toBeNull();
    expect(
      stageMeters([{ id: 'a' }], { a: section(zero, [pr('one#1', 0)]) }, true).review?.pct,
    ).toBeNull();
    expect(
      stageMeters(nodes, { a, b: { ...section(zero), review: reviewView([], false) } }, true).review
        ?.pct,
    ).toBeNull();
  });
});

const lane = (text: string): LaneView => ({
  lane: 'LN-Build',
  workspace: null,
  state: 'working',
  seen: { herdr: true, events: true },
  machine: null,
  tickets: [],
  units: [],
  nodes: ['a'],
  boxVia: 'section',
  bootedAt: null,
  closedAt: null,
  last: { at: '2026-10-14T00:00:00Z', verb: 'TICKET', text },
});
describe('agent phase network boundary', () => {
  const goodLane = lane('Phase: build');
  const snapshot = {
    schema: 'work-map-agents/2',
    generatedAt: '2026-10-14T00:00:00Z',
    round: null,
    herdr: { ok: true, error: null },
    lanes: [goodLane],
    byNode: { a: [goodLane.lane] },
    fog: [],
  };
  it('admits valid phase evidence and null events', () => {
    expect(currentAgents(snapshot)).toBe(snapshot);
    expect(currentAgents({ ...snapshot, lanes: [{ ...goodLane, last: null }] })).not.toBeNull();
  });
  it('rejects newly consumed missing or malformed fields before rendering', () => {
    for (const invalid of [
      { ...goodLane, seen: undefined },
      { ...goodLane, seen: { herdr: true } },
      { ...goodLane, seen: { herdr: 'true', events: true } },
      { ...goodLane, last: { ...goodLane.last, text: undefined } },
      { ...goodLane, last: { ...goodLane.last, at: 'invalid' } },
      { ...goodLane, last: { ...goodLane.last, verb: 1 } },
    ])
      expect(currentAgents({ ...snapshot, lanes: [invalid] })).toBeNull();
  });
});
