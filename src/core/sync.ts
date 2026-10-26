// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

/** The server's reply to a Sync. It always says whether site versions had to be read. */
export type SyncResult = (
  | { status: 'complete'; snapshotAt: string; agentsAt: string }
  | { status: 'incomplete'; reasons: string[] }
  | { status: 'failed'; reason: string }
) & {
  versionsRequired: boolean;
  versionsAt?: string | undefined;
  /** Faults that do not make Sync incomplete, such as the site version read (#206). */
  warnings?: string[] | undefined;
};
const time = z.string().refine((at) => Number.isFinite(Date.parse(at)));
const versions = {
  versionsRequired: z.boolean(),
  versionsAt: time.optional(),
  warnings: z.array(z.string()).optional(),
};
export const SyncResultSchema: z.ZodType<SyncResult> = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('complete'),
    snapshotAt: time,
    agentsAt: time,
    ...versions,
  }),
  z.object({ status: z.literal('incomplete'), reasons: z.array(z.string()), ...versions }),
  z.object({ status: z.literal('failed'), reason: z.string(), ...versions }),
]);
