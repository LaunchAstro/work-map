// @vitest-environment jsdom
import { act, createElement, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  clampView,
  homeView,
  readout,
  sameGeometry,
  scaleLimits,
  startsPan,
  stepZoom,
  wheelPixels,
  zoomTo,
  type Geometry,
} from '../src/web/camera.ts';
import { useMapCamera } from '../src/web/useMapCamera.ts';
import { mergeAxis, mergeHours } from '../src/web/activity.ts';
import type { PrView } from '../src/core/contract.ts';
// A 1080-wide portrait window. Content runs from the first stage's left/top to the last
// stage's right and the lowest card's bottom.
const g: Geometry = {
  width: 1080,
  height: 1700,
  boardWidth: 1900,
  boardHeight: 3000,
  content: { left: 26, top: 26, right: 1800, bottom: 2900 },
  stages: [
    { left: 26, right: 254, top: 26 },
    { left: 302, right: 530, top: 26 },
    { left: 578, right: 806, top: 26 },
    { left: 854, right: 1082, top: 26 },
    { left: 1130, right: 1358, top: 26 },
  ],
};
const onScreen = (v: { x: number; y: number; scale: number }, px: number, py: number) => [
  px * v.scale + v.x,
  py * v.scale + v.y,
];
describe('one bounded free camera', () => {
  it('opens at 100%: the first four stage columns fill the width, at the top-left', () => {
    const home = homeView(g);
    expect(onScreen(home, 26, 26)).toEqual([12, 12]);
    expect(onScreen(home, 1082, 26)[0]).toBeCloseTo(1068);
    expect(readout(home, g)).toBe(100);
  });
  it('keeps four column widths at 100% even with only one, two or three stages', () => {
    for (const count of [1, 2, 3]) {
      const stages = g.stages.slice(0, count);
      const smaller = { ...g, stages, content: { ...g.content, right: stages.at(-1)!.right } };
      expect(homeView(smaller).scale).toBe(homeView(g).scale);
    }
  });
  it('never lets the nodes leave the window when dragged past any edge', () => {
    const home = homeView(g);
    const left = clampView({ ...home, x: home.x + 5000 }, g);
    expect(onScreen(left, 26, 26)[0]).toBeCloseTo(12);
    const right = clampView({ ...home, x: home.x - 1e6 }, g);
    expect(onScreen(right, 1800, 26)[0]).toBeCloseTo(1068);
    const across = clampView({ ...home, x: home.x - 200 }, g);
    expect(onScreen(across, 26, 26)[0]).toBeCloseTo(12 - 200);
    const top = clampView({ ...home, y: home.y + 5000 }, g);
    expect(onScreen(top, 26, 26)[1]).toBeCloseTo(12);
    const bottom = clampView({ ...home, y: home.y - 1e6 }, g);
    expect(onScreen(bottom, 26, 2900)[1]).toBeCloseTo(1688);
  });
  it('pins a map smaller than the window to the top-left', () => {
    const { min } = scaleLimits(g);
    const small = clampView({ x: 400, y: 900, scale: min }, g);
    expect(onScreen(small, 26, 26)).toEqual([12, 12]);
  });
  it('zooms around a point within limits and reads relative to home', () => {
    const home = homeView(g);
    const { min, max } = scaleLimits(g);
    expect(max / home.scale).toBeCloseTo(2);
    expect(min).toBeLessThanOrEqual(home.scale * 0.25);
    const closer = zoomTo(home, home.scale * 1.5, 540, 600, g);
    expect(readout(closer, g)).toBe(150);
    const board = [(540 - home.x) / home.scale, (600 - home.y) / home.scale] as const;
    expect(onScreen(closer, board[0], board[1])[0]).toBeCloseTo(540);
    expect(onScreen(closer, board[0], board[1])[1]).toBeCloseTo(600);
    expect(zoomTo(home, 1e6, 0, 0, g).scale).toBe(max);
    expect(zoomTo(home, 1e-6, 0, 0, g).scale).toBe(min);
    expect(wheelPixels(3, 0, 1000)).toBe(3);
    expect(wheelPixels(3, 1, 1000)).toBe(48);
    expect(wheelPixels(1, 2, 1000)).toBe(1000);
  });
});
const element = (selector: string) => document.querySelector(selector)!;
describe('zoom steps and pointer panning', () => {
  it('+ and − step to the next whole ten of the readout, within the limits', () => {
    const home = homeView(g);
    const at = (pct: number) => zoomTo(home, (home.scale * pct) / 100, 540, 600, g);
    const step = (pct: number, dir: 1 | -1) => readout(stepZoom(at(pct), dir, 540, 600, g), g);
    expect(step(93, 1)).toBe(100);
    expect(step(100, 1)).toBe(110);
    expect(step(93, -1)).toBe(90);
    expect(step(100, -1)).toBe(90);
    expect(step(90, -1)).toBe(80);
    expect(step(195, 1)).toBe(200);
    expect(step(200, 1)).toBe(200);
  });
  it('a press anywhere on the board pans, links and buttons on cards included; callouts keep theirs', () => {
    document.body.innerHTML = `<div class="viewport"><div class="board">
      <div class="node" role="button"><h3>Card</h3><span class="t">text</span><a href="#">link</a><button>b</button></div>
      <div class="stage"><b>Stage</b></div>
      <div class="callout"><p>details</p><summary>group</summary></div><input /></div></div>`;
    expect(startsPan(element('.board'))).toBe(true);
    expect(startsPan(element('.node'))).toBe(true);
    expect(startsPan(element('.node h3'))).toBe(true);
    expect(startsPan(element('.node .t'))).toBe(true);
    expect(startsPan(element('.stage b'))).toBe(true);
    expect(startsPan(element('.node a'))).toBe(true);
    expect(startsPan(element('.node button'))).toBe(true);
    expect(startsPan(element('.callout p'))).toBe(false);
    expect(startsPan(element('.callout summary'))).toBe(false);
    expect(startsPan(element('input'))).toBe(false);
  });
});
it('geometry that differs by under half a pixel is the same view', () => {
  // Chromium snaps layout to 1/64 px at each zoom, so measuring at a new zoom moves edges by a hair.
  const snapped: Geometry = {
    ...g,
    content: { ...g.content, right: g.content.right + 0.016 },
    stages: g.stages.map((s, i) => (i === 3 ? { ...s, right: s.right - 0.016 } : s)),
  };
  expect(sameGeometry(g, snapped)).toBe(true);
  expect(sameGeometry(g, { ...g, width: g.width + 0.49 })).toBe(true);
  // A real change is never swallowed: half a pixel or more, or a different set of stages.
  expect(sameGeometry(g, { ...g, width: g.width + 0.5 })).toBe(false);
  expect(sameGeometry(g, { ...g, content: { ...g.content, bottom: g.content.bottom + 1 } })).toBe(
    false,
  );
  expect(sameGeometry(g, { ...g, stages: g.stages.slice(1) })).toBe(false);
});
it('every measured coordinate is a change from half a pixel either way; so are the stages’ count and order', () => {
  const edits: ((x: Geometry, d: number) => void)[] = [
    ...(['width', 'height', 'boardWidth', 'boardHeight'] as const).map(
      (k) => (x: Geometry, d: number) => void (x[k] += d),
    ),
    ...(['left', 'top', 'right', 'bottom'] as const).map(
      (k) => (x: Geometry, d: number) => void (x.content[k] += d),
    ),
    ...g.stages.flatMap((_, i) =>
      (['left', 'right', 'top'] as const).map(
        (k) => (x: Geometry, d: number) => void (x.stages[i]![k] += d),
      ),
    ),
  ];
  for (const edit of edits)
    for (const d of [-0.5, -0.49, 0.49, 0.5]) {
      const next = structuredClone(g);
      edit(next, d);
      expect(sameGeometry(g, next), `delta ${d}`).toBe(Math.abs(d) < 0.5);
      expect(sameGeometry(next, g), `reverse delta ${d}`).toBe(Math.abs(d) < 0.5);
    }
  expect(sameGeometry(g, { ...g, stages: [...g.stages, g.stages[0]!] })).toBe(false);
  expect(sameGeometry(g, { ...g, stages: g.stages.toReversed() })).toBe(false);
});
it('the camera ignores sub-pixel jitter without re-rendering, measured from the last geometry it took', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let resized: (() => void) | undefined;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  // Only the fourth stage's right edge moves, by `delta`.
  let delta = 0;
  let renders = 0;
  let camera: ReturnType<typeof useMapCamera> | undefined;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const s = camera?.view.scale ?? 1;
    const rect = (x: number, y: number, w: number, h: number) =>
      new DOMRect(x * s, y * s, w * s, h * s);
    const i = Number(this.dataset['index']);
    if (this.classList.contains('stage')) {
      const stage = g.stages[i]!;
      return rect(stage.left, stage.top, stage.right - stage.left + (i === 3 ? delta : 0), 40);
    }
    if (this.classList.contains('node')) return rect(26, 100, 200, 2800);
    return rect(0, 0, 1900, 3000);
  });
  for (const [key, value] of [
    ['clientWidth', 1080],
    ['clientHeight', 1700],
    ['offsetWidth', 1900],
    ['offsetHeight', 3000],
  ] as const)
    vi.spyOn(HTMLElement.prototype, key, 'get').mockReturnValue(value);
  function Harness() {
    const board = useRef<HTMLDivElement | null>(null);
    camera = useMapCamera(board, g.stages.length, () => {});
    renders++;
    return createElement(
      'div',
      { ref: camera.ref },
      createElement(
        'div',
        { ref: board },
        ...g.stages.map((_, i) =>
          createElement('div', { className: 'stage', 'data-index': i, key: i }),
        ),
        createElement('div', { className: 'node' }),
      ),
    );
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const step = async (next: number) => {
    delta = next;
    await act(async () => resized?.());
    return { scale: camera!.view.scale, renders };
  };
  try {
    await act(async () => root.render(createElement(Harness)));
    const first = { scale: camera!.view.scale, renders };
    // oxlint-disable-next-line no-await-in-loop -- each step measures after the last
    for (const jitter of [0.2, -0.49, 0.49]) expect(await step(jitter)).toEqual(first);
    const taken = await step(0.5);
    expect(taken.scale).not.toBe(first.scale);
    // 0.7 and 0.9 are under half a pixel from the 0.5 just taken; 1.1 is not.
    // oxlint-disable-next-line no-await-in-loop -- each step measures after the last
    for (const small of [0.7, 0.9]) expect(await step(small)).toEqual(taken);
    expect((await step(1.1)).scale).not.toBe(taken.scale);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

describe('six rolling hourly merge buckets', () => {
  it('uses a bounded integer quantity scale for zero, small and large counts', () => {
    expect(mergeAxis([])).toEqual({ ceiling: 1, ticks: [0, 1] });
    for (const [max, ceiling, ticks] of [
      [0, 1, [0, 1]],
      [1, 1, [0, 1]],
      [3, 3, [0, 1, 2, 3]],
      [4, 4, [0, 2, 4]],
      [5, 6, [0, 2, 4, 6]],
      [500, 600, [0, 200, 400, 600]],
    ] as const) {
      expect(mergeAxis([{ count: 0 }, { count: max }])).toEqual({ ceiling, ticks });
    }
    for (let max = 1; max <= 10_000; max++) {
      const axis = mergeAxis([{ count: max }]);
      expect(axis.ceiling).toBeGreaterThanOrEqual(max);
      expect(axis.ticks.length).toBeLessThanOrEqual(4);
      expect(axis.ticks.every(Number.isInteger)).toBe(true);
      expect(axis.ticks.at(-1)).toBe(axis.ceiling);
    }
  });
  it('owns exact hourly boundaries once, excludes future and old merges, and retains zero buckets', () => {
    const at = '2026-10-14T06:00:00Z';
    const prs = Object.fromEntries(
      ['00:00:00', '00:00:01', '01:00:00', '05:00:00', '06:00:00', '06:00:01'].map((time, i) => [
        String(i),
        { mergedAt: `2026-10-14T${time}Z` },
      ]),
    ) as Record<string, PrView>;
    expect(mergeHours(prs, at).map((h) => h.count)).toEqual([2, 0, 0, 0, 1, 1]);
    expect(mergeHours(prs, 'unknown')).toEqual([]);
  });
});

function KeyHarness() {
  const board = useRef<HTMLDivElement | null>(null);
  return createElement('div', { ref: useMapCamera(board, 0, () => {}).ref });
}
/** Presses + with these modifiers and says whether the map took the key from the browser. */
const pressPlus = (init: KeyboardEventInit): boolean => {
  const e = new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(e);
  return e.defaultPrevented;
};
describe('camera keyboard shortcuts', () => {
  it('leaves Command with + to the browser, as Control and Option are', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(KeyHarness)));
    try {
      expect(pressPlus({})).toBe(true);
      expect(pressPlus({ metaKey: true })).toBe(false);
      expect(pressPlus({ ctrlKey: true })).toBe(false);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});
