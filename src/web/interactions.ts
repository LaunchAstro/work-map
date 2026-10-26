import type { SectionWork } from '../core/work.ts';
import type { TicketCounts } from '../core/ticket-progress.ts';

export type InspectionState = {
  hovered: string | null;
  pinned: { id: string; activation: 'pointer' | 'keyboard' } | null;
};
export type InspectionEvent =
  | { type: 'enter' | 'leave'; id: string }
  | { type: 'activate'; id: string; activation: 'pointer' | 'keyboard' }
  | { type: 'close' }
  | { type: 'clearHover' };
export function transitionInspection(
  state: InspectionState,
  event: InspectionEvent,
): InspectionState {
  if (event.type === 'close') return { ...state, pinned: null };
  if (event.type === 'clearHover') return { ...state, hovered: null };
  if (event.type === 'activate')
    return { ...state, pinned: { id: event.id, activation: event.activation } };
  if (event.type === 'enter') return { ...state, hovered: event.id };
  return state.hovered === event.id ? { ...state, hovered: null } : state;
}
/**
 * A card's tone, one rule for both sources. Ticket-count projects pass their current section
 * counts: past 90% complete turns the card purple, and nothing done with nothing open dashes it,
 * as live scope and built scope do.
 */
export function cardTone(
  work: Pick<SectionWork, 'scope' | 'openPrs'> | undefined,
  tickets?: Pick<TicketCounts, 'pct' | 'total' | 'completed' | 'livePct'> | null,
): 'live90' | 'unstarted' | 'started' | 'unknown' {
  // #207: a ticket card turns live past 90% live; with live unknown (no unit audit), past 90% built.
  if (tickets?.total && (tickets.livePct ?? tickets.pct ?? 0) > 90 + 1e-7) return 'live90';
  // Unstarted means nothing built: no ticket done, no unit share built and no open PR.
  if (tickets)
    return tickets.completed === 0 && !(tickets.pct ?? 0) && !work?.openPrs.length
      ? 'unstarted'
      : 'started';
  if (!work) return 'unknown';
  if (work.scope.shares.live > 90 + 1e-7) return 'live90';
  return !work.scope.pending &&
    work.openPrs.length === 0 &&
    work.scope.shares.live + work.scope.shares.merged + work.scope.shares.built === 0
    ? 'unstarted'
    : 'started';
}
export type Point = readonly [number, number];
export function orthogonalPoints(from: Point, to: Point, corridor?: number): Point[] {
  if (corridor === undefined && (from[0] === to[0] || from[1] === to[1])) return [from, to];
  const x = corridor ?? (from[0] + to[0]) / 2;
  return [from, [x, from[1]], [x, to[1]], to];
}
export function outerRoute(
  from: Point,
  to: Point,
  sourceGutter: number,
  targetGutter: number,
  outerY: number,
): Point[] {
  return [
    from,
    [sourceGutter, from[1]],
    [sourceGutter, outerY],
    [targetGutter, outerY],
    [targetGutter, to[1]],
    to,
  ];
}
export function roundedPath(points: readonly Point[], radius = 10): string {
  const pts = points.filter(
    (p, i) => i === 0 || p[0] !== points[i - 1]?.[0] || p[1] !== points[i - 1]?.[1],
  );
  if (!pts.length) return '';
  let path = `M${pts[0]!.join(',')}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]!;
    const p = pts[i]!;
    const next = pts[i + 1]!;
    const before = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    const after = Math.hypot(next[0] - p[0], next[1] - p[1]);
    const r = Math.min(radius, before / 2, after / 2);
    const start: Point = [
      p[0] + ((prev[0] - p[0]) * r) / before,
      p[1] + ((prev[1] - p[1]) * r) / before,
    ];
    const end: Point = [
      p[0] + ((next[0] - p[0]) * r) / after,
      p[1] + ((next[1] - p[1]) * r) / after,
    ];
    path += ` L${start.join(',')} Q${p.join(',')} ${end.join(',')}`;
  }
  return `${path}${pts.length > 1 ? ` L${pts.at(-1)!.join(',')}` : ''}`;
}
