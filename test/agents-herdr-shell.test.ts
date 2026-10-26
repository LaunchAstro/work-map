// The agents file's herdr fields are an empty shell since herdr stopped being read. Readers accept a file
// without them; the collector keeps writing them for one release so an open previous screen passes its check
// (removal is #310).
import { describe, expect, it } from 'vitest';
import { syncEvidence } from '../src/cli/map-sync.ts';
import { buildAgents, emptyEventsState, foldEvents } from '../src/core/agents.ts';
import { SEAT_GAUGE_PENDING } from '../src/core/loading-bay.ts';
import type { Plan } from '../src/core/plan.ts';
import { currentAgents } from '../src/web/snapshot.ts';
import { previousAgentsShape } from './previous-screen.ts';

const plan: Plan = { units: {}, tickets: {}, unitIssues: {} };
const file = '/round/events.log';
const fold = (...lines: string[]) =>
  foldEvents(emptyEventsState(), file, `${lines.join('\n')}\n`, plan);
const pending = { state: 'pending', reason: SEAT_GAUGE_PENDING } as const;

// As today's collector writes it: herdr pending, every lane unseen by herdr.
const today = {
  ...buildAgents({
    events: fold(
      '2026-10-20T10:00:00Z LN-Kite BOOTED machine=alpha Section: found',
      '2026-10-20T10:01:00Z LN-Wren BOOTED',
    ),
    round: null,
    herdr: { ok: false, error: SEAT_GAUGE_PENDING },
    plan,
    owner: new Map(),
    now: new Date('2026-10-20T12:00:00Z'),
  }),
  agentSource: pending,
};
const json = (value: unknown): Record<string, unknown> =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
const withoutHerdr = json(today);
delete withoutHerdr['herdr'];
for (const lane of withoutHerdr['lanes'] as { seen: Record<string, unknown> }[])
  delete lane.seen['herdr'];

describe('agents file without the herdr shell', () => {
  it('reads the file as written today and without herdr; the previous screen accepts the first', () => {
    expect(today.lanes).toHaveLength(2);
    expect(currentAgents(json(today))).not.toBeNull();
    expect(currentAgents(withoutHerdr)).not.toBeNull();
    expect(previousAgentsShape(today)).toBe(true);
  });

  it('still refuses a herdr value that is present but wrong', () => {
    const base = json(today);
    const lane = (base['lanes'] as Record<string, unknown>[])[0] ?? {};
    for (const herdr of [null, 'x', { ok: 'false' }])
      expect(currentAgents({ ...base, herdr }), JSON.stringify(herdr)).toBeNull();
    for (const seen of [{ herdr: 'false', events: true }, { herdr: false }, { events: 'true' }])
      expect(
        currentAgents({ ...base, lanes: [{ ...lane, seen }] }),
        JSON.stringify(seen),
      ).toBeNull();
    expect(currentAgents({ ...base, lanes: [{ ...lane, seen: undefined }] })).toBeNull();
  });

  it('counts a missing herdr as not ok when deciding whether the lane read is complete', () => {
    const at = new Date(Date.now() + 1000).toISOString();
    const now = Date.now();
    const snapshot = {
      schema: 'work-map/4',
      id: 'fixture',
      stages: [],
      prs: {},
      generatedAt: at,
      sources: { github: { lastRun: { at, partial: false, skipped: false } } },
      work: { at, complete: true },
    };
    const base = { schema: 'work-map-agents/2', lanes: [], generatedAt: at };
    const incomplete = (agents: Record<string, unknown>): boolean => {
      const r = syncEvidence(snapshot, { ...base, ...agents }, now, now);
      return r.status === 'incomplete' && r.reasons.includes('Lane read is incomplete');
    };
    const cases: [string, Record<string, unknown>, boolean][] = [
      [
        'today, pending',
        { herdr: { ok: false, error: SEAT_GAUGE_PENDING }, agentSource: pending },
        false,
      ],
      ['no herdr, pending', { agentSource: pending }, false],
      ['today, not pending', { herdr: { ok: false, error: SEAT_GAUGE_PENDING } }, true],
      ['no herdr, not pending', {}, true],
      ['herdr ok', { herdr: { ok: true } }, false],
      ['malformed herdr', { herdr: 'x' }, true],
      ['malformed herdr, pending', { herdr: 'x', agentSource: pending }, true],
    ];
    for (const [name, agents, expected] of cases) expect(incomplete(agents), name).toBe(expected);
  });

  it('writes no fog note about herdr', () => {
    const notes = today.fog.map((f) => `${f.id}: ${f.text}`);
    expect(notes.filter((n) => /herdr/i.test(n))).toEqual([]);
    expect(today.fog.find((f) => f.id === 'round')?.text).toBe(
      'No round events.log was found, so lanes and tickets come from the last log read, if any.',
    );
  });

  it('takes a machine only from machine=, with its case kept', () => {
    const events = fold(
      '2026-10-20T10:00:00Z LN-One BOOTED machine=alpha',
      '2026-10-20T10:00:00Z LN-Two BOOTED seat=b machine=Big-Box Unit: U01',
      '2026-10-20T10:00:00Z LN-Three BOOTED on the big box',
    );
    expect(events.lanes['LN-One']?.machine).toBe('alpha');
    expect(events.lanes['LN-Two']?.machine).toBe('Big-Box');
    expect(events.lanes['LN-Three']?.machine).toBeNull();
  });
});
