// SPDX-License-Identifier: AGPL-3.0-only
import type { Wire } from '../core/contract.ts';
import { orthogonalPoints, outerRoute, roundedPath, type Point } from './interactions.ts';

export function drawWires(
  board: HTMLElement,
  svg: SVGSVGElement,
  wires: readonly Wire[],
  scale: number,
  labels: HTMLElement,
  active: string | null,
): void {
  const b = board.getBoundingClientRect();
  const w = board.offsetWidth;
  const h = board.offsetHeight;
  const viewBox = `0 0 ${w} ${h}`;
  if (svg.getAttribute('viewBox') !== viewBox) svg.setAttribute('viewBox', viewBox);
  const box = (id: string): { l: number; r: number; t: number; b: number } | null => {
    const el = board.querySelector(`#n-${CSS.escape(id)}`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      l: (r.left - b.left) / scale,
      r: (r.right - b.left) / scale,
      t: (r.top - b.top) / scale,
      b: (r.bottom - b.top) / scale,
    };
  };
  const point = (end: readonly (string | number)[]): [number, number] | null => {
    const n = box(String(end[0]));
    if (!n) return null;
    const side = end[1];
    const k = typeof end[2] === 'number' ? end[2] : 0.5;
    if (side === 'l') return [n.l, n.t + (n.b - n.t) * k];
    if (side === 'r') return [n.r, n.t + (n.b - n.t) * k];
    if (side === 't') return [n.l + (n.r - n.l) * k, n.t];
    return [n.l + (n.r - n.l) * k, n.b];
  };
  const stages = [...board.querySelectorAll('.stage')].map((el) => el.getBoundingClientRect());
  const gapX = (gap: number): number => {
    const a = stages[gap - 1];
    const c = stages[gap];
    return a && c ? ((a.right + c.left) / 2 - b.left) / scale : 0;
  };
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag: string, attrs: Record<string, string | number>): SVGElement => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  if (!svg.querySelector(':scope > defs')) {
    const defs = el('defs', {});
    for (const [id, cls] of [
      ['ah', 'arrow'],
      ['aha', 'arrow-accent'],
    ] as const) {
      const m = el('marker', {
        id,
        viewBox: '0 0 10 10',
        refX: 9,
        refY: 5,
        markerWidth: 7,
        markerHeight: 7,
        markerUnits: 'userSpaceOnUse',
        orient: 'auto-start-reverse',
      });
      m.append(el('path', { d: 'M0,0 L10,5 L0,10 z', class: cls }));
      defs.append(m);
    }
    svg.append(defs);
  }
  labels.replaceChildren();
  const paths = [...svg.querySelectorAll<SVGPathElement>(':scope > path.edge')];
  let pathIndex = 0;
  for (const wire of wires) {
    const p1 = point(wire.from);
    const p2 = point(wire.to);
    if (!p1 || !p2) continue;
    const [x1, y1] = p1;
    const [x2, y2] = p2;
    const transient = wire.kind === 'blocked';
    const fromBox = box(String(wire.from[0]));
    const toBox = box(String(wire.to[0]));
    const sourceStage = stages.findIndex(
      (r) => x1 >= (r.left - b.left) / scale - 1 && x1 <= (r.right - b.left) / scale + 1,
    );
    const targetStage = stages.findIndex(
      (r) => x2 >= (r.left - b.left) / scale - 1 && x2 <= (r.right - b.left) / scale + 1,
    );
    const inferredGap =
      sourceStage >= 0 && targetStage >= 0 && sourceStage !== targetStage
        ? gapX(Math.min(sourceStage, targetStage) + 1)
        : undefined;
    let pts: Point[];
    if (transient) pts = orthogonalPoints(p1, p2);
    else if (wire.gap) pts = orthogonalPoints(p1, p2, gapX(wire.gap) + (wire.lane ?? 0));
    else if (
      fromBox &&
      toBox &&
      ((sourceStage === targetStage && x1 !== x2) || Math.abs(sourceStage - targetStage) > 1)
    ) {
      const sourceGutter = wire.from[1] === 'l' ? fromBox.l - 18 : fromBox.r + 18;
      const targetGutter = wire.to[1] === 'r' ? toBox.r + 18 : toBox.l - 18;
      pts = outerRoute(p1, p2, sourceGutter, targetGutter, 14);
    } else pts = orthogonalPoints(p1, p2, inferredGap);
    const related = active && (wire.from[0] === active || wire.to[0] === active);
    const controls: readonly [Point, Point] =
      pts.length === 4
        ? [pts[1]!, pts[2]!]
        : x1 === x2
          ? [
              [x1 + 6, y1 + (y2 - y1) / 3],
              [x2 + 6, y1 + ((y2 - y1) * 2) / 3],
            ]
          : [
              [x1 + (x2 - x1) / 3, y1 - 6],
              [x1 + ((x2 - x1) * 2) / 3, y2 - 6],
            ];
    const path =
      pts.length > 4
        ? roundedPath(pts, 32)
        : `M${p1.join(',')} C${controls[0].join(',')} ${controls[1].join(',')} ${p2.join(',')}`;
    const edge = paths[pathIndex++] ?? el('path', {});
    const attrs = {
      d: related ? path : roundedPath(pts),
      class: `edge${wire.kind ? ` ${wire.kind}` : ''}${related ? ' selected' : ''}`,
      'data-from': String(wire.from[0]),
      'data-to': String(wire.to[0]),
      'data-route': transient ? 'transient' : 'permanent',
      'marker-end': related || wire.kind === 'loop' ? 'url(#aha)' : 'url(#ah)',
    };
    for (const [name, value] of Object.entries(attrs)) {
      if (edge.getAttribute(name) !== value) edge.setAttribute(name, value);
    }
    if (edge.parentNode !== svg) svg.append(edge);
    if (wire.label && !transient && related) {
      const badge = document.createElement('span');
      badge.className = 'wire-label';
      badge.textContent = wire.label;
      badge.title = wire.label;
      const middle: Point =
        pts.length >= 4
          ? [pts[1]![0], (pts[1]![1] + pts[2]![1]) / 2]
          : [(x1 + x2) / 2, (y1 + y2) / 2];
      badge.dataset['side'] = pts.length >= 4 ? 'right' : 'above';
      badge.style.left = `${middle[0] + (pts.length >= 4 ? 12 : 0)}px`;
      badge.style.top = `${middle[1] - (pts.length >= 4 ? 0 : 12)}px`;
      badge.dataset['from'] = String(wire.from[0]);
      badge.dataset['to'] = String(wire.to[0]);
      labels.append(badge);
    }
  }
  for (const edge of paths.slice(pathIndex)) edge.remove();
}
