import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import {
  auditBaseline,
  effectiveScore,
  UnitScoreStoreSchema,
  type UnitScoreEntry,
  type UnitScores,
} from '../core/unit-scores.ts';

const AuditFile = z.object({
  asAt: z.string().min(1),
  units: z.record(
    z.string().min(1),
    z.object({
      code: z.number().min(0).max(1),
      days: z.number().positive().default(1),
      live: z.enum(['yes', 'partly', 'no']).default('no'),
    }),
  ),
});

/** The local score store's re-checks per unit; a missing or invalid store gives none. */
export function readUnitScoreStore(path: string): Readonly<Record<string, UnitScoreEntry[]>> {
  try {
    return UnitScoreStoreSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).units;
  } catch {
    return {};
  }
}

/**
 * The build-unit scores the project config names (#194, #204): each unit's audit baseline (code share,
 * estimate days, live), replaced by the local store's re-checks where they pass the rules. A missing,
 * unreadable or invalid audit file, or one outside the root, gives nothing.
 */
export function readUnitScores(
  root: string,
  file: string,
  options: { store?: string | undefined; floor?: number | undefined } = {},
): UnitScores | undefined {
  const path = resolve(root, file);
  const inside = relative(resolve(root), path);
  if (isAbsolute(file) || !inside || inside.startsWith('..') || isAbsolute(inside))
    return undefined;
  let read: z.infer<typeof AuditFile>;
  try {
    read = AuditFile.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return undefined;
  }
  const store = options.store ? readUnitScoreStore(options.store) : {};
  return {
    asAt: read.asAt,
    units: Object.fromEntries(
      Object.entries(read.units).map(([id, u]) => [
        id,
        effectiveScore(
          auditBaseline(u, read.asAt),
          Object.hasOwn(store, id) ? store[id]! : [],
          options.floor,
        ),
      ]),
    ),
  };
}
