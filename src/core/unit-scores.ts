import { z } from 'zod';

/** A build unit's effective score (#204): built and live shares of the unit, 0 to 1, and their source. */
export interface UnitScore {
  /** Estimate days from the audit: the unit's weight. */
  readonly days: number;
  readonly built: number;
  /** Never above `built`. */
  readonly live: number;
  readonly by: 'audit' | 'luna' | 'deep';
  readonly at: string;
  readonly confidence: number;
  readonly reason: string;
}
export interface UnitScores {
  readonly asAt: string;
  readonly units: Readonly<Record<string, UnitScore>>;
}
/** One re-check of a unit, as the score store keeps it. */
export interface UnitScoreEntry {
  readonly built: number;
  readonly live: number;
  readonly confidence: number;
  readonly reason: string;
  /** ISO time of the check. */
  readonly at: string;
  /** Why the score went down; a drop without one is refused. */
  readonly drop?: string | undefined;
  /** Who scored it: a re-check of new merges (the default) or a deep sync's full read (#214). */
  readonly by?: 'luna' | 'deep' | undefined;
}
const share = z.number().min(0).max(1);
export const UnitScoreEntrySchema: z.ZodType<UnitScoreEntry> = z
  .strictObject({
    built: share,
    live: share,
    confidence: share,
    reason: z.string().min(1).max(2000),
    at: z.iso.datetime({ offset: true }),
    drop: z.string().min(1).max(2000).optional(),
    by: z.enum(['luna', 'deep']).optional(),
  })
  .refine((e) => e.live <= e.built, 'live cannot exceed built');
export const UNIT_SCORE_STORE = 'work-map-unit-scores/1';
export interface UnitScoreStore {
  readonly schema: typeof UNIT_SCORE_STORE;
  readonly units: Readonly<Record<string, UnitScoreEntry[]>>;
}
export const UnitScoreStoreSchema: z.ZodType<UnitScoreStore> = z.strictObject({
  schema: z.literal(UNIT_SCORE_STORE),
  units: z.record(z.string().min(1), z.array(UnitScoreEntrySchema).max(200)),
});
export const DEFAULT_CONFIDENCE_FLOOR = 0.6;

/** The audit's live field as a share of the unit: yes is its built share, partly half of it, no none. */
export function auditBaseline(
  unit: { days: number; code: number; live: 'yes' | 'partly' | 'no' },
  asAt: string,
): UnitScore {
  return {
    days: unit.days,
    built: unit.code,
    live: unit.live === 'yes' ? unit.code : unit.live === 'partly' ? unit.code / 2 : 0,
    by: 'audit',
    at: asAt,
    confidence: 1,
    reason: 'Audit',
  };
}
/** An audit date as prose ("13 October 2026, about 8:45 pm AEST") or ISO, as a time; unreadable is earliest. */
const timeOf = (at: string): number => {
  const exact = Date.parse(at);
  if (!Number.isNaN(exact)) return exact;
  const day = Date.parse(at.split(',')[0] ?? '');
  return Number.isNaN(day) ? -Infinity : day;
};
/**
 * The score that stands after the store's re-checks, oldest first. A check replaces the standing score only
 * when it is newer, at least `floor` confident, and neither share drops unless the check says why.
 */
export function effectiveScore(
  base: UnitScore,
  entries: readonly UnitScoreEntry[],
  floor: number = DEFAULT_CONFIDENCE_FLOOR,
): UnitScore {
  let current = base;
  for (const entry of entries.toSorted((a, b) => timeOf(a.at) - timeOf(b.at))) {
    const dropped = entry.built < current.built || entry.live < current.live;
    if (
      timeOf(entry.at) <= timeOf(current.at) ||
      entry.confidence < floor ||
      entry.live > entry.built ||
      (dropped && !entry.drop)
    )
      continue;
    current = {
      days: current.days,
      built: entry.built,
      live: entry.live,
      by: entry.by ?? 'luna',
      at: entry.at,
      confidence: entry.confidence,
      reason: dropped ? `${entry.reason} (lower: ${entry.drop})` : entry.reason,
    };
  }
  return current;
}

/** A section's key in the score store, on a map without build units (#215). */
export const sectionKey = (section: string): string => `section:${section}`;
/**
 * Each section's standing score on a map without build units (#215): its store entries under the unit
 * rules, from nothing. A section with no entry that stands has no score.
 */
export function sectionScores(
  store: Readonly<Record<string, readonly UnitScoreEntry[]>>,
  sections: readonly string[],
  floor: number = DEFAULT_CONFIDENCE_FLOOR,
): Record<string, UnitScore> {
  const none: UnitScore = {
    days: 1,
    built: 0,
    live: 0,
    by: 'audit',
    at: '1970-01-01T00:00:00Z',
    confidence: 0,
    reason: 'No score',
  };
  return Object.fromEntries(
    sections.flatMap((id) => {
      const key = sectionKey(id);
      const score = effectiveScore(none, Object.hasOwn(store, key) ? store[key]! : [], floor);
      return score === none ? [] : [[id, score]];
    }),
  );
}
