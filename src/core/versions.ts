import { z } from 'zod';

const commit = z.string().regex(/^[a-f0-9]{40}$/);
const build = z.string().regex(/^[a-f0-9]{12}(?:-dirty)?$/);
const time = z.iso.datetime();
const origin = z.string().refine((value) => {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      u.origin === value &&
      !u.username &&
      !u.password &&
      /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)
    );
  } catch {
    return false;
  }
});
export interface VersionSite {
  readonly name: string;
  readonly origin: string;
  readonly buildPath: string;
  readonly metaName: string;
}
export interface VersionObservation {
  readonly at: string;
  readonly build: string;
  readonly sha: string;
  readonly main: string;
  readonly merges: number;
}
export interface SiteVersion {
  readonly name: string;
  readonly origin: string;
  readonly buildUrl: string;
  readonly state: 'current' | 'pending';
  readonly build: string | null;
  readonly sha: string | null;
  readonly merges: number | null;
  readonly reason: string;
  readonly lastKnown: VersionObservation | null;
}
export interface VersionsSnapshot {
  readonly schema: 'work-map-versions/1';
  readonly repo: string;
  readonly checkedAt: string;
  readonly main: string | null;
  readonly sites: readonly SiteVersion[];
  readonly error?: string | undefined;
}
export const VersionSitesSchema: z.ZodType<readonly VersionSite[]> = z
  .array(
    z.object({
      name: z.string().min(1).max(100),
      origin,
      buildPath: z.string().regex(/^\/[a-zA-Z0-9/_-]+\.json$/),
      metaName: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    }),
  )
  .min(1)
  .max(10)
  .refine((sites) => new Set(sites.map((s) => s.origin)).size === sites.length);
const ObservationSchema: z.ZodType<VersionObservation> = z.object({
  at: time,
  build,
  sha: commit,
  main: commit,
  merges: z.number().int().nonnegative(),
});
const SiteSchema: z.ZodType<SiteVersion> = z
  .object({
    name: z.string(),
    origin,
    buildUrl: z.url(),
    state: z.enum(['current', 'pending']),
    build: build.nullable(),
    sha: commit.nullable(),
    merges: z.number().int().nonnegative().nullable(),
    reason: z.string(),
    lastKnown: ObservationSchema.nullable(),
  })
  .refine(
    (s) =>
      s.state !== 'current' ||
      (s.build !== null &&
        !s.build.endsWith('-dirty') &&
        s.sha !== null &&
        s.sha.startsWith(s.build) &&
        s.merges !== null),
  );
export const VersionsSchema: z.ZodType<VersionsSnapshot> = z
  .object({
    schema: z.literal('work-map-versions/1'),
    repo: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/),
    checkedAt: time,
    main: commit.nullable(),
    sites: z.array(SiteSchema),
    error: z.string().optional(),
  })
  .refine((v) => v.main !== null || v.sites.every((s) => s.state === 'pending'));
export function currentVersions(value: unknown): VersionsSnapshot | null {
  const parsed = VersionsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
