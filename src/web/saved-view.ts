// SPDX-License-Identifier: AGPL-3.0-only
//
// Each map's own view, kept in this browser (#148): zoom and position, theme, the % and Agents toggles
// and the overview tab, keyed by the map's id. Storage can be missing or blocked (a private window, cleared
// site data), so every read and write is guarded and the map renders the same without it.
import { z } from 'zod';
import type { View } from './words.ts';

export interface SavedView {
  /** Absent while the map sits at its home view, which follows the window size. */
  readonly view?: View | undefined;
  readonly theme?: 'light' | 'dark' | undefined;
  readonly percentages?: boolean | undefined;
  readonly agents?: boolean | undefined;
  readonly tab?: 'scope' | 'merges' | undefined;
}

const finite = z.number().refine(Number.isFinite);
// Each field is read on its own, so one bad value never costs the others.
const FIELDS = {
  view: z.object({ x: finite, y: finite, scale: finite.refine((n) => n > 0) }),
  theme: z.enum(['light', 'dark']),
  percentages: z.boolean(),
  agents: z.boolean(),
  tab: z.enum(['scope', 'merges']),
} as const;
const HOME = 'work-map:home';
// Reading `localStorage` itself can throw (a SecurityError where site data is blocked), so the
// default is looked up inside each guard, never as a default argument.
const local = (storage: Storage | undefined): Storage | undefined =>
  storage ?? globalThis.localStorage;
const key = (id: string): string => `work-map:view:${id}`;

export function readSavedView(id: string | null | undefined, storage?: Storage): SavedView {
  if (!id) return {};
  try {
    const raw: unknown = JSON.parse(local(storage)?.getItem(key(id)) ?? 'null');
    if (!raw || typeof raw !== 'object') return {};
    const saved: Record<string, unknown> = {};
    for (const [field, schema] of Object.entries(FIELDS)) {
      const parsed = schema.safeParse((raw as Record<string, unknown>)[field]);
      if (parsed.success) saved[field] = parsed.data;
    }
    return saved as SavedView;
  } catch {
    return {};
  }
}

export function writeSavedView(id: string, saved: SavedView, storage?: Storage): void {
  try {
    local(storage)?.setItem(key(id), JSON.stringify(saved));
  } catch {
    // Storage is a convenience: a blocked write leaves the map working, unsaved.
  }
}

/** The bare address opens this server's own map, independently of the last picker selection. */
export function savedMapId(search: string, storage?: Storage): string | null {
  const named = new URLSearchParams(search).get('map');
  if (named) return named;
  try {
    return local(storage)?.getItem(HOME) ?? null;
  } catch {
    return null;
  }
}

export function rememberHomeMap(id: string, storage?: Storage): void {
  try {
    local(storage)?.setItem(HOME, id);
  } catch {}
}
