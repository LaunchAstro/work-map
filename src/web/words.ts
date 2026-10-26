// SPDX-License-Identifier: AGPL-3.0-only
//
// The words the diagram shows, kept apart from the drawing so they are tested.

import type { ProgressTicket } from '../core/ticket-progress.ts';
import { shortTime, stamp } from '../core/time.ts';

export interface View {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}
export const pct = (n: number): string => `${Math.round(n)}%`;

/** A time in the map's zone, for example "14 Oct, 12:40 am". */
export const shortStamp = (iso: string | null | undefined): string =>
  iso ? shortTime(iso) : 'not yet';
/** The callout time format, shared by the loading bay and Seat Gauge. */
export const time = (at: string | null): string => (at ? stamp(at) : 'Pending');

export function stoppedAgo(stoppedAt: string, now: number): string {
  const stopped = Date.parse(stoppedAt);
  if (!Number.isFinite(stopped) || !Number.isFinite(now)) return 'unknown time';
  const elapsed = now - stopped;
  if (elapsed < 0) return 'timestamp ahead of clock';
  if (elapsed < 60_000) return 'just now';
  const [count, unit] =
    elapsed < 3_600_000
      ? [Math.floor(elapsed / 60_000), 'minute']
      : elapsed < 86_400_000
        ? [Math.floor(elapsed / 3_600_000), 'hour']
        : [Math.floor(elapsed / 86_400_000), 'day'];
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/**
 * A ticket card's frozen score: the newest share a re-check or deep sync scored, or null when none did.
 * The audit is retired, so the line only dates the score.
 */
export function scoredLine(
  tickets: readonly Pick<ProgressTicket, 'share'>[] | undefined,
): { readonly label: string; readonly title: string } | null {
  let newest: string | null = null;
  for (const { share } of tickets ?? [])
    if (
      (share?.by === 'luna' || share?.by === 'deep') &&
      share.at &&
      Number.isFinite(Date.parse(share.at))
    )
      if (!newest || Date.parse(share.at) > Date.parse(newest)) newest = share.at;
  if (!newest) return null;
  const when = shortTime(newest);
  return {
    label: `Scored ${when.split(',')[0]}`,
    title: `Last audit score, ${when}. The audit is retired, so this score no longer changes.`,
  };
}
