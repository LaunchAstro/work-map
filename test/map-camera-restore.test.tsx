// @vitest-environment jsdom
// #148: a map's saved camera comes back on its first measure, within the zoom and position limits.
import { act, createElement, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useMapCamera } from '../src/web/useMapCamera.ts';
import type { View } from '../src/web/words.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Five 320-wide stages 40 apart and one 2800-tall card, in a 1080 × 1600 window.
async function restored(saved: View): Promise<ReturnType<typeof useMapCamera>> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  let camera: ReturnType<typeof useMapCamera> | undefined;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const scale = camera?.view.scale ?? 1;
    const rect = (x: number, y: number, width: number, height: number) =>
      new DOMRect(x * scale, y * scale, width * scale, height * scale);
    if (this.classList.contains('stage'))
      return rect(20 + 360 * Number(this.dataset['index']), 20, 320, 40);
    if (this.classList.contains('node')) return rect(20, 100, 320, 2800);
    return rect(0, 0, 1900, 3000);
  });
  for (const [key, value] of [
    ['clientWidth', 1080],
    ['clientHeight', 1600],
    ['offsetWidth', 1900],
    ['offsetHeight', 3000],
  ] as const)
    vi.spyOn(HTMLElement.prototype, key, 'get').mockReturnValue(value);
  function Harness() {
    const board = useRef<HTMLDivElement | null>(null);
    camera = useMapCamera(board, 5, () => {}, saved);
    return createElement(
      'div',
      { ref: camera.ref },
      createElement(
        'div',
        { ref: board },
        ...Array.from({ length: 5 }, (_, index) =>
          createElement('div', { key: index, className: 'stage', 'data-index': index }),
        ),
        createElement('div', { className: 'node' }),
      ),
    );
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Harness)));
    return camera!;
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}

it('the first measure restores a saved camera instead of home', async () => {
  const saved = { x: -140, y: -200, scale: 0.8 };
  const camera = await restored(saved);
  expect(camera.view).toEqual(saved);
  expect(camera.atHome).toBe(false);
});

it('a saved camera past the limits comes back clamped in zoom and both directions', async () => {
  const camera = await restored({ x: 1_000_000, y: -1_000_000, scale: 100 });
  const maxScale = (2 * (1080 - 24)) / (4 * 320 + 3 * 40);
  expect(camera.view.scale).toBeCloseTo(maxScale);
  expect(camera.view.x).toBeCloseTo(12 - 20 * maxScale);
  expect(camera.view.y).toBeCloseTo(1600 - 12 - 2900 * maxScale);
  expect(camera.atHome).toBe(false);
});
