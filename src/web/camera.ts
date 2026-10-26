// SPDX-License-Identifier: AGPL-3.0-only
//
// The map's one camera. 100% means the first four stage columns fill the window width; the view can
// zoom from "the whole map fits" to twice that, steps in whole tens, and never pans the cards off
// the window.
import type { View } from './words.ts';

/** Viewport size, board size and positions, in board pixels at scale 1. */
export type Geometry = {
  width: number;
  height: number;
  boardWidth: number;
  boardHeight: number;
  /** The cards' extent: first stage's left and top, last stage's right, lowest card's bottom. */
  content: { left: number; top: number; right: number; bottom: number };
  stages: readonly { left: number; right: number; top: number }[];
};

const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.5;
/**
 * Measurements under half a pixel apart are the same view. Chromium snaps layout to 1/64 px at each
 * zoom, so treating those as changes re-homes the camera on every frame.
 */
export function sameGeometry(a: Geometry, b: Geometry): boolean {
  return (
    near(a.width, b.width) &&
    near(a.height, b.height) &&
    near(a.boardWidth, b.boardWidth) &&
    near(a.boardHeight, b.boardHeight) &&
    near(a.content.left, b.content.left) &&
    near(a.content.top, b.content.top) &&
    near(a.content.right, b.content.right) &&
    near(a.content.bottom, b.content.bottom) &&
    a.stages.length === b.stages.length &&
    a.stages.every(
      (s, i) =>
        near(s.left, b.stages[i]!.left) &&
        near(s.right, b.stages[i]!.right) &&
        near(s.top, b.stages[i]!.top),
    )
  );
}

export const HOME_COLUMNS = 4;
export const GUTTER = 12;

export function homeScale(g: Geometry): number {
  const first = g.stages[0]!;
  const count = Math.min(g.stages.length, HOME_COLUMNS);
  const last = g.stages[count - 1]!;
  const column = first.right - first.left;
  const gap = g.stages[1] ? g.stages[1].left - first.right : 48;
  const span = last.right - first.left + (HOME_COLUMNS - count) * (column + gap);
  return Math.max(1, g.width - 2 * GUTTER) / Math.max(1, span);
}

export function scaleLimits(g: Geometry): { min: number; max: number } {
  const home = homeScale(g);
  const fit = Math.min(
    Math.max(1, g.width - 2 * GUTTER) / Math.max(1, g.content.right - g.content.left),
    Math.max(1, g.height - 2 * GUTTER) / Math.max(1, g.content.bottom - g.content.top),
  );
  return { min: Math.min(fit, home * 0.25), max: home * 2 };
}

/** 100%, at the top-left of the first stage. */
export function homeView(g: Geometry): View {
  const scale = homeScale(g);
  return clampView(
    { scale, x: GUTTER - scale * g.content.left, y: GUTTER - scale * g.content.top },
    g,
  );
}

/** Keep the cards covering the window where they are larger, pinned top-left where smaller. */
export function clampView(v: View, g: Geometry): View {
  const axis = (offset: number, start: number, end: number, span: number): number => {
    const low = GUTTER - start * v.scale;
    if ((end - start) * v.scale <= span - 2 * GUTTER) return low;
    return Math.min(low, Math.max(offset, span - GUTTER - end * v.scale));
  };
  return {
    scale: v.scale,
    x: axis(v.x, g.content.left, g.content.right, g.width),
    y: axis(v.y, g.content.top, g.content.bottom, g.height),
  };
}

/** Zoom to `scale` (clamped to the limits) keeping screen point (cx, cy) still, then clamp. */
export function zoomTo(v: View, scale: number, cx: number, cy: number, g: Geometry): View {
  const { min, max } = scaleLimits(g);
  const next = Math.min(max, Math.max(min, scale));
  const k = next / v.scale;
  return clampView({ scale: next, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }, g);
}

/** + and −: the next whole ten of the readout up or down (93% to 100% to 110%), within the limits. */
export function stepZoom(v: View, direction: 1 | -1, cx: number, cy: number, g: Geometry): View {
  const now = readout(v, g);
  const tens = direction > 0 ? Math.floor(now / 10) + 1 : Math.ceil(now / 10) - 1;
  return zoomTo(v, (homeScale(g) * tens * 10) / 100, cx, cy, g);
}

/**
 * Whether a press starts a pan: anywhere on the board, cards and the links and buttons on them
 * included, so dragging never selects text. Only callouts and form fields keep their own press; a
 * press that doesn't drag still clicks whatever it landed on.
 */
export function startsPan(target: Element): boolean {
  return !target.closest('.callout,input,textarea,select,[contenteditable=true]');
}

/** The zoom readout: whole percent of 100% (home). */
export function readout(v: View, g: Geometry): number {
  return Math.round((100 * v.scale) / homeScale(g));
}

export function wheelPixels(delta: number, mode: number, span: number): number {
  return delta * (mode === 1 ? 16 : mode === 2 ? span : 1);
}
