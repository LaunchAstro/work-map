// SPDX-License-Identifier: AGPL-3.0-only
//
// Every bar on the map (progress, tickets and review, on cards, stages and the project header) is one
// ordered list of segments; meters.ts decides which a scope shows. These adapters turn each source into that list, with the
// words the hover call-out and screen readers use.

import type { MeterData } from './stage.ts';

export type BarTone = 'live' | 'merged' | 'built' | 'rest' | 'reviewed' | 'completed';
export type BarSegment = {
  /** Stable key within the bar; also the segment's data-k attribute. */
  readonly key: string;
  readonly tone: BarTone;
  /** Exact share of the bar, 0 to 100. */
  readonly share: number;
  /** Whole percentage shown inside the segment, or null for no label. */
  readonly label: number | null;
  readonly words: string;
};
export type BarModel = {
  readonly kind: 'progress' | 'review' | 'tickets';
  readonly label: string;
  /** Pending bars draw a hatched track with one segment carrying these words. */
  readonly pending: string | null;
  readonly segments: readonly BarSegment[];
  /** Completion for role=meter, when the bar is one known fraction. */
  readonly meter: number | null;
};

/** A whole percentage, or "<1%" for a share above zero that rounds to nothing. */
export const shown = (exact: number, display: number = Math.round(exact)): string =>
  `${exact > 0 && display === 0 ? '<1' : display}%`;

const SCOPE_TONES = [
  ['live', 'live', 'Live'],
  ['merged', 'merged', 'Merged, not live'],
  ['built', 'built', 'Coded, not merged'],
] as const;

export function progressBar(work: MeterData | undefined): BarModel {
  const scope = work?.scope;
  if (!scope || (scope.pending && scope.shares.planned === 100))
    return pendingBar('progress', `Progress pending${scope ? `: ${scope.reason}` : ''}`);
  const segments: BarSegment[] = SCOPE_TONES.map(([key, tone, name]) => ({
    key,
    tone,
    share: scope.shares[key],
    label: scope.display[key],
    words: `${name} · ${shown(scope.shares[key], scope.display[key])}`,
  }));
  segments.push({
    key: 'planned',
    tone: 'rest',
    share: scope.shares.planned,
    label: null,
    words: `Not built · ${shown(scope.shares.planned, scope.display.planned)}`,
  });
  return {
    kind: 'progress',
    label: 'Progress',
    pending: null,
    segments: visible(segments),
    meter: null,
  };
}

export function reviewBar(work: MeterData | undefined): BarModel {
  const value = work?.review?.pct;
  // A complete read with no PRs is a known nothing, drawn empty like an unmapped ticket bar.
  if (value == null && work?.review?.complete && work.review.prs.length === 0)
    return {
      kind: 'review',
      label: 'Review',
      pending: null,
      meter: null,
      segments: [
        { key: 'unreviewed', tone: 'rest', share: 100, label: null, words: 'No PRs to review yet' },
      ],
    };
  if (value == null) return pendingBar('review', 'Review pending');
  const reviewed = Math.round(value);
  return {
    kind: 'review',
    label: 'Review',
    pending: null,
    meter: null,
    segments: visible([
      {
        key: 'reviewed',
        tone: 'reviewed',
        share: value,
        label: reviewed,
        words: `Reviewed · ${shown(value, reviewed)}`,
      },
      {
        key: 'unreviewed',
        tone: 'rest',
        share: 100 - value,
        label: null,
        words: `Unreviewed · ${shown(100 - value, 100 - reviewed)}`,
      },
    ]),
  };
}

const LABELS = {
  progress: 'Progress',
  review: 'Review',
  tickets: 'Tickets',
} as const;

export function pendingBar(kind: BarModel['kind'], words: string): BarModel {
  return {
    kind,
    label: LABELS[kind],
    pending: words,
    meter: null,
    segments: [{ key: 'pending', tone: 'rest', share: 100, label: null, words }],
  };
}

/** Zero-width segments are dropped so no divider is drawn for them. */
export function visible(segments: readonly BarSegment[]): BarSegment[] {
  return segments.filter((segment) => segment.share > 0);
}
