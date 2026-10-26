import { z } from 'zod';
import type { WorkCache } from '../readers/work-github.ts';

export const SEAT_GAUGE_PENDING =
  'Current lane evidence is pending. Qualified Seat Gauge observations and session totals are shown separately.';
const date = z.iso.datetime({ offset: true });
export interface Lifecycle {
  id: string;
  kind: 'opened' | 'ready' | 'queued' | 'merged' | 'dropped';
  at: string;
  reason: string | null;
}
const LifecycleSchema: z.ZodType<Lifecycle> = z.object({
  id: z.string(),
  kind: z.enum(['opened', 'ready', 'queued', 'merged', 'dropped']),
  at: date,
  reason: z.string().nullable(),
});
export interface LedgerPr {
  key: string;
  url: string;
  title: string;
  checkedAt: string;
  complete: boolean;
  events: Lifecycle[];
  status: 'opened' | 'ready' | 'queued' | 'merged' | 'dropped' | 'pending';
  reason: string | null;
}
const PrSchema: z.ZodType<LedgerPr> = z.object({
  key: z.string(),
  url: z.url({ protocol: /^https$/ }),
  title: z.string(),
  checkedAt: date,
  complete: z.boolean(),
  events: z.array(LifecycleSchema),
  status: z.enum(['opened', 'ready', 'queued', 'merged', 'dropped', 'pending']),
  reason: z.string().nullable(),
});
export interface LoadingBay {
  schema: 'work-map-loading-bay/1';
  githubAt: string | null;
  readyLabel: string | null;
  complete: boolean;
  reason: string | null;
  prs: LedgerPr[];
}
const LoadingBaySchema: z.ZodType<LoadingBay> = z.object({
  schema: z.literal('work-map-loading-bay/1'),
  githubAt: date.nullable(),
  readyLabel: z.string().nullable(),
  complete: z.boolean(),
  reason: z.string().nullable(),
  prs: z.array(PrSchema),
});
export function currentLoadingBay(value: unknown): LoadingBay | null {
  const parsed = LoadingBaySchema.safeParse(value);
  if (!parsed.success) return null;
  const bay = parsed.data;
  return new Set(bay.prs.map((pr) => pr.key)).size === bay.prs.length ? bay : null;
}
export function buildLoadingBay(cache: WorkCache, readyLabel: string | null = null): LoadingBay {
  return {
    schema: 'work-map-loading-bay/1',
    githubAt: cache.at || null,
    readyLabel,
    complete: cache.complete && cache.ledgerComplete === true,
    reason: cache.error ?? (cache.ledgerComplete ? null : 'Lifecycle history pending'),
    prs: (cache.ledgerPrs ?? [])
      .map(({ key, url, title, checkedAt, complete, events, status, reason }) => ({
        key,
        url,
        title,
        checkedAt,
        complete,
        events,
        status,
        reason,
      }))
      .toSorted((a, b) => b.checkedAt.localeCompare(a.checkedAt)),
  };
}
