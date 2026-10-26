import { describe, it, expect } from 'vitest';
import {
  transitionInspection,
  cardTone,
  orthogonalPoints,
  outerRoute,
  roundedPath,
  type InspectionState,
} from '../src/web/interactions.ts';
import type { SectionWork } from '../src/core/work.ts';
import { readFileSync } from 'node:fs';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import { scopeView } from '../src/core/scope.ts';
const fixture = (name: string): string =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const snapshot = buildSnapshot({
  audit: JSON.parse(fixture('audit.json')) as Audit,
  flow: JSON.parse(fixture('flow.json')) as Flow,
  plan: parseBuildUnits(fixture('build-units.md')),
  generatedAt: '2026-10-14T00:00:00Z',
});
const base = { scope: scopeView(snapshot.stages[0]!.nodes[0]!, []), openPrs: [] };
function section(built = 0, open = 0, pending = false): Pick<SectionWork, 'scope' | 'openPrs'> {
  return {
    ...base,
    openPrs: Array.from({ length: open }, () => ({
      key: 'repo#1',
      number: 1,
      title: 'Repair',
      body: '',
      url: 'https://example.com',
      headRefName: 'repair',
      issueKeys: [],
      state: 'OPEN' as const,
      inferred: false,
    })),
    scope: {
      ...base.scope,
      shares: { live: 0, merged: 0, built, planned: 100 - built },
      display: { live: 0, merged: 0, built, planned: 100 - built },
      pending,
    },
  };
}
describe('inspection lifecycle', () => {
  it('records hover without opening details and a pin takes precedence', () => {
    const hover = transitionInspection(
      { hovered: null, pinned: null },
      { type: 'enter', id: 'inbox' },
    );
    expect(hover.pinned).toBeNull();
    const pin = transitionInspection(hover, {
      type: 'activate',
      id: 'inbox',
      activation: 'pointer',
    });
    const changed = transitionInspection(pin, { type: 'enter', id: 'chat' });
    expect(changed.pinned).toEqual(pin.pinned);
    expect(changed.hovered).toBe('chat');
    expect(transitionInspection(changed, { type: 'close' })).toEqual({
      hovered: 'chat',
      pinned: null,
    });
    expect(transitionInspection(pin, { type: 'clearHover' }).pinned).toEqual(pin.pinned);
  });
  it('a stale leave cannot remove newer hover context', () => {
    const current: InspectionState = { hovered: 'chat', pinned: null };
    expect(transitionInspection(current, { type: 'leave', id: 'inbox' })).toEqual(current);
    expect(transitionInspection(current, { type: 'leave', id: 'chat' })).toEqual({
      hovered: null,
      pinned: null,
    });
  });
  it('deliberate activation replaces the pin and retains keyboard origin', () => {
    expect(
      transitionInspection(
        { hovered: 'inbox', pinned: { id: 'inbox', activation: 'pointer' } },
        { type: 'activate', id: 'chat', activation: 'keyboard' },
      ),
    ).toEqual({ hovered: 'inbox', pinned: { id: 'chat', activation: 'keyboard' } });
  });
});
describe('progress presentation', () => {
  it('grey requires confirmed zero scope with no open work', () => {
    expect(cardTone(section())).toBe('unstarted');
    expect(cardTone(section(0, 1))).toBe('started');
    expect(cardTone(section(0, 0, true))).toBe('started');
    expect(cardTone(undefined)).toBe('unknown');
    expect(cardTone(section(90))).toBe('started');
    expect(cardTone(section(91))).toBe('started');
  });
  it('purple requires exact live scope strictly above 90, regardless of cumulative progress', () => {
    const work = section(0);
    for (const [live, expected] of [
      [90, 'started'],
      [90.01, 'live90'],
      [87, 'started'],
    ] as const) {
      expect(
        cardTone({
          ...work,
          scope: {
            ...work.scope,
            shares: { live, merged: 100 - live, built: 0, planned: 0 },
          },
        }),
      ).toBe(expected);
    }
  });
  it('weighted 90% live rounding noise does not receive purple treatment', () => {
    const audit = JSON.parse(fixture('audit.json')) as Audit;
    const units = { ...audit.units };
    units['U01'] = { ...units['U01']!, days: 0.4, code: 0.9, low: 0.9, high: 0.9, live: 'yes' };
    units['U02'] = { ...units['U02']!, days: 0.1, code: 0.9, low: 0.9, high: 0.9, live: 'yes' };
    const weighted = buildSnapshot({
      audit: { ...audit, units },
      flow: JSON.parse(fixture('flow.json')) as Flow,
      plan: parseBuildUnits(fixture('build-units.md')),
      generatedAt: '2026-10-14T00:00:00Z',
    });
    const scope = scopeView(weighted.stages[0]!.nodes[0]!, []);
    expect(scope.shares.live).toBeGreaterThan(90);
    expect(scope.shares.live).toBeCloseTo(90, 12);
    expect(cardTone({ scope, openPrs: [] })).toBe('started');
    expect(
      cardTone({
        scope: { ...scope, shares: { live: 90.01, merged: 0, built: 0, planned: 9.99 } },
        openPrs: [],
      }),
    ).toBe('live90');
  });
});
describe('permanent route geometry', () => {
  it('uses an axis-aligned channel and rounds its turns', () => {
    const route = orthogonalPoints([10, 20], [100, 90], 70);
    expect(route).toEqual([
      [10, 20],
      [70, 20],
      [70, 90],
      [100, 90],
    ]);
    expect(roundedPath(route)).toContain('Q70,20');
  });
  it('honours an explicit gutter even when right-side endpoints align', () => {
    const route = orthogonalPoints([100, 20], [100, 90], 140);
    expect(route).toEqual([
      [100, 20],
      [140, 20],
      [140, 90],
      [100, 90],
    ]);
    expect(roundedPath(route)).toContain('Q140,20');
  });
  it('straight horizontal and vertical routes need no corner', () => {
    expect(roundedPath(orthogonalPoints([0, 0], [100, 0]))).toBe('M0,0 L100,0');
    expect(roundedPath(orthogonalPoints([0, 0], [0, 100]))).toBe('M0,0 L0,100');
  });
  it('reversed endpoints stay orthogonal and duplicate points stay finite', () => {
    const route = orthogonalPoints([100, 90], [10, 20], 70);
    expect(
      route.every((p, i) => i === 0 || p[0] === route[i - 1]![0] || p[1] === route[i - 1]![1]),
    ).toBe(true);
    expect(
      roundedPath([
        [0, 0],
        [0, 0],
        [1, 0],
        [1, 2],
      ]),
    ).not.toMatch(/NaN|Infinity/);
    expect(
      roundedPath([
        [0, 0],
        [0, 0],
      ]),
    ).toBe('M0,0');
  });
  it('backward and same-column routes use an outside corridor without diagonal legs', () => {
    for (const route of [
      outerRoute([600, 400], [100, 200], 620, 80, 14),
      outerRoute([100, 400], [200, 200], 80, 220, 14),
    ]) {
      expect(
        route.every((p, i) => i === 0 || p[0] === route[i - 1]![0] || p[1] === route[i - 1]![1]),
      ).toBe(true);
      expect(route.slice(2, 4).every((p) => p[1] === 14)).toBe(true);
      expect(roundedPath(route)).not.toMatch(/NaN|Infinity/);
    }
  });
});
