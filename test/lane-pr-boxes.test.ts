import { describe, expect, it } from 'vitest';
import {
  buildAgents,
  emptyEventsState,
  lanePrBoxes,
  type EventLane,
  type EventsState,
} from '../src/core/agents.ts';
import type { LaneRule } from '../src/core/infer.ts';
import type { IssuePlacement } from '../src/core/issues.ts';
import type { Plan } from '../src/core/plan.ts';

const plan: Plan = {
  units: {
    U1: { title: 'One', tickets: ['T1'] },
    U2: { title: 'Two', tickets: ['T2'] },
  },
  tickets: { T1: 'U1', T2: 'U2' },
  unitIssues: {},
};
const owner = new Map([
  ['U1', 'tasks'],
  ['U2', 'fix'],
]);
const boxes = new Set(['tasks', 'fix', 'found']);
const issueBox = new Map<string, IssuePlacement>([
  ['Acme/app#5', { box: 'tasks', reason: 'parent map', inferred: true }],
  ['Acme/app#6', { box: 'outside', reason: 'outside the map', inferred: false }],
  ['Acme/app#7', { box: 'fix', reason: 'Section: fix', inferred: false }],
]);
const laneRules: LaneRule[] = [{ pattern: '^Gamma', box: 'found' }];

const ev = (lane: string, patch: Partial<EventLane> = {}): EventLane => ({
  lane,
  bootedAt: '2026-10-20T00:00:00Z',
  closedAt: null,
  machine: null,
  tickets: [],
  issues: [],
  section: null,
  prs: [],
  last: null,
  ...patch,
});
const last = (at: string): EventLane['last'] => ({ at, verb: 'PUSHING', text: '' });
const state = (...lanes: EventLane[]): EventsState => ({
  ...emptyEventsState(),
  lanes: Object.fromEntries(lanes.map((l) => [l.lane, l])),
});

type Input = Parameters<typeof lanePrBoxes>[0];
const input = (events: EventsState, patch: Partial<Input> = {}): Input => ({
  events,
  plan,
  owner,
  boxes,
  briefBox: new Map(),
  issueBox,
  laneRules,
  lanePrefix: 'L-',
  repository: 'Acme/app',
  ...patch,
});

/** The mapping as it was: a whole agents file first, then each lane's PRs to its box. */
function reference(x: Input): Record<string, string> {
  const { lanes } = buildAgents({
    prefix: x.lanePrefix,
    laneRules: x.laneRules,
    events: x.events,
    round: null,
    herdr: { ok: false, error: null },
    plan: x.plan,
    owner: x.owner,
    now: new Date(),
    boxes: x.boxes,
    keepClosedHours: Infinity,
    issueBox: x.issueBox,
    briefBox: x.briefBox,
  });
  const out: Record<string, string> = {};
  const at = (lane: string): string => x.events.lanes[lane]?.last?.at ?? '';
  const ranked = [...lanes].toSorted((a, b) => at(a.lane).localeCompare(at(b.lane)));
  for (const lane of ranked) {
    const box = lane.nodes[0];
    if (!box) continue;
    for (const n of x.events.lanes[lane.lane]?.prs ?? []) out[`${x.repository}#${n}`] = box;
  }
  return out;
}

describe('lanePrBoxes', () => {
  it('places the PRs of a lane that closed days ago', () => {
    const events = state(
      ev('L-Old', { section: 'tasks', prs: [101], closedAt: '2026-10-01T00:00:00Z' }),
    );
    expect(lanePrBoxes(input(events))).toEqual({ 'Acme/app#101': 'tasks' });
  });

  it('gives a PR two lanes name to the lane that wrote last', () => {
    const events = state(
      ev('L-Alpha', { section: 'tasks', prs: [7], last: last('2026-10-20T10:00:00Z') }),
      ev('L-Beta', { section: 'fix', prs: [7], last: last('2026-10-20T09:00:00Z') }),
    );
    expect(lanePrBoxes(input(events))).toEqual({ 'Acme/app#7': 'tasks' });
  });

  it('gives a PR two lanes name at the same time to the later lane name', () => {
    const events = state(
      ev('L-Beta', { section: 'fix', prs: [7], last: last('2026-10-20T10:00:00Z') }),
      ev('L-Alpha', { section: 'tasks', prs: [7], last: last('2026-10-20T10:00:00Z') }),
    );
    expect(lanePrBoxes(input(events))).toEqual({ 'Acme/app#7': 'fix' });
  });

  it('ranks a lane with no last line below one with any', () => {
    const events = state(
      ev('L-Alpha', { section: 'tasks', prs: [7], last: last('2026-10-20T10:00:00Z') }),
      ev('L-Zeta', { section: 'fix', prs: [7] }),
    );
    expect(lanePrBoxes(input(events))).toEqual({ 'Acme/app#7': 'tasks' });
  });

  it('places a lane by the box its brief names', () => {
    const briefBox = new Map([['L-Brief', 'found']]);
    const events = state(ev('L-Brief', { prs: [1] }));
    expect(lanePrBoxes(input(events, { briefBox }))).toEqual({ 'Acme/app#1': 'found' });
  });

  it('places a lane by its Section line', () => {
    const events = state(ev('L-Sec', { section: 'fix', prs: [2] }));
    expect(lanePrBoxes(input(events))).toEqual({ 'Acme/app#2': 'fix' });
  });

  it("places a lane by its ticket's unit", () => {
    const events = state(ev('L-Tick', { tickets: ['T2'], prs: [3] }));
    expect(lanePrBoxes(input(events))).toEqual({ 'Acme/app#3': 'fix' });
  });

  it("places a lane by its ticket issue's placement", () => {
    const events = state(ev('L-Issue', { issues: ['Acme/app#5'], prs: [4] }));
    expect(lanePrBoxes(input(events))).toEqual({ 'Acme/app#4': 'tasks' });
  });

  it('places a lane by a lane-name rule', () => {
    const events = state(ev('L-Gamma-2', { prs: [8] }));
    expect(lanePrBoxes(input(events))).toEqual({ 'Acme/app#8': 'found' });
  });

  it('places nothing for a lane with no box', () => {
    const events = state(
      ev('L-None', { prs: [9] }),
      ev('L-Away', { section: 'nowhere', issues: ['Acme/app#6'], prs: [10] }),
    );
    expect(lanePrBoxes(input(events))).toEqual({});
  });

  it('returns what building the whole agents file first returned, for a varied round', () => {
    const events = state(
      ev('L-Old', { section: 'tasks', prs: [1, 2], closedAt: '2026-09-01T00:00:00Z' }),
      ev('L-Alpha', { tickets: ['T1'], prs: [2, 3], last: last('2026-10-20T10:00:00Z') }),
      ev('L-Beta', { section: 'fix', prs: [3, 4], last: last('2026-10-20T10:00:00Z') }),
      ev('L-Gamma', { prs: [4, 5], last: last('2026-10-20T09:00:00Z') }),
      ev('L-Brief', { section: 'nowhere', prs: [5, 6], last: last('2026-10-20T11:00:00Z') }),
      ev('L-Issue', { issues: ['Acme/app#6', 'Acme/app#7'], prs: [6], closedAt: 'x' }),
      ev('L-Lost', { tickets: ['T9'], issues: ['Acme/app#6'], prs: [1, 7] }),
      ev('Other', { tickets: ['T2'], prs: [8], last: last('2026-10-20T08:00:00Z') }),
    );
    const x = input(events, { briefBox: new Map([['L-Brief', 'found']]) });
    const want = reference(x);
    expect(Object.keys(want).length).toBeGreaterThan(5);
    expect(lanePrBoxes(x)).toEqual(want);
  });

  it('returns what building the whole agents file first returned, for many generated rounds', () => {
    let seed = 7;
    const rand = (n: number): number => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed % n;
    };
    const pick = <T>(xs: readonly T[]): T => xs[rand(xs.length)] as T;
    const some = <T>(xs: readonly T[]): T[] => xs.filter(() => rand(2) === 0);
    const names = ['L-Alpha', 'L-Beta', 'L-Gamma', 'L-Delta', 'Other', 'L-Gamma-2'];
    for (let round = 0; round < 300; round++) {
      const lanes = some(names).map((name) =>
        ev(name, {
          section: pick([null, null, 'tasks', 'fix', 'nowhere']),
          tickets: some(['T1', 'T2', 'T9']),
          issues: some(['Acme/app#5', 'Acme/app#6', 'Acme/app#7']),
          prs: some([1, 2, 3, 4]),
          last: pick([null, last('2026-10-20T10:00:00Z'), last('2026-10-20T11:00:00Z')]),
          closedAt: pick([null, '2026-09-01T00:00:00Z']),
        }),
      );
      const x = input(state(...lanes), {
        briefBox: new Map(some(names).map((n) => [n, pick(['tasks', 'fix', 'found'])])),
      });
      expect(lanePrBoxes(x)).toEqual(reference(x));
    }
  });
});
