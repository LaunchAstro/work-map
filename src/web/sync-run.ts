// SPDX-License-Identifier: AGPL-3.0-only
//
// One Sync's outcome, as a plain function (#181): asks the server to re-read GitHub and the round context,
// then re-reads the map data. Its fetcher and data reads are passed in, so it is tested without React.
import type { AgentsSnapshot, Snapshot } from '../core/contract.ts';
import { SyncResultSchema, type SyncResult } from '../core/sync.ts';
import { ticketCountMap } from '../core/ticket-progress.ts';
import type { VersionsSnapshot } from '../core/versions.ts';
import { mapPath } from './map-path.ts';
import { ticketSyncOutcome } from './ticket-sync.ts';

export type SyncUi =
  | { state: 'idle' }
  | {
      state: 'busy' | 'complete' | 'incomplete' | 'failed';
      message: string;
    };
export interface SyncSources {
  readonly snapshot: () => Promise<Snapshot>;
  readonly agents: () => Promise<AgentsSnapshot>;
  readonly versions: () => Promise<VersionsSnapshot>;
}

/** Whether the browser's site versions are as new as this completed Sync says they must be. */
function versionsCurrent(
  result: Extract<SyncResult, { status: 'complete' }>,
  read: PromiseSettledResult<VersionsSnapshot> | undefined,
): boolean {
  if (read?.status !== 'fulfilled') return !result.versionsRequired;
  const { checkedAt, error, sites } = read.value;
  if (
    result.versionsRequired &&
    (!result.versionsAt ||
      sites.length === 0 ||
      Date.parse(checkedAt) < Date.parse(result.versionsAt))
  )
    return false;
  return (
    !error &&
    sites.every((site) => site.state === 'current') &&
    !(sites.length > 0 && Date.parse(checkedAt) < Date.parse(result.snapshotAt) - 60_000)
  );
}

/**
 * The Sync line's last state, or null when the caller stopped listening. `progress` gets the busy states
 * on the way. Site version faults are a warning on the line, never a reason for incomplete (#206).
 */
export async function runSync(input: {
  readonly fetcher: typeof fetch;
  readonly search: string;
  readonly sources: SyncSources;
  readonly progress: (state: SyncUi) => void;
  readonly live?: (() => boolean) | undefined;
  readonly now?: (() => number) | undefined;
}): Promise<SyncUi | null> {
  const live = input.live ?? (() => true);
  const now = input.now ?? Date.now;
  const syncRequestedAt = new Date(now()).toISOString();
  input.progress({ state: 'busy', message: 'Reading GitHub and round context…' });
  try {
    const response = await input.fetcher(mapPath('/sync', input.search), {
      method: 'POST',
      credentials: 'omit',
      headers: { 'X-Work-Map-Sync': '1', 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error('Sync request failed');
    const parsed = SyncResultSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new Error('Sync response unavailable');
    const result = parsed.data;
    const reads = await Promise.allSettled([input.sources.snapshot(), input.sources.agents()]);
    const versionRead = await Promise.allSettled([input.sources.versions()]);
    if (!live()) return null;
    const serverWarnings = result.warnings ?? [];
    const refreshedSnapshot = reads[0];
    if (
      result.status === 'incomplete' &&
      refreshedSnapshot?.status === 'fulfilled' &&
      ticketCountMap(refreshedSnapshot.value)
    ) {
      const warnings = [...result.reasons, ...serverWarnings];
      if (reads[1]?.status === 'rejected') warnings.push('Round context browser read pending');
      if (result.versionsRequired && versionRead[0]?.status === 'rejected')
        warnings.push('Site version browser read pending');
      const outcome = ticketSyncOutcome(
        refreshedSnapshot.value,
        null,
        syncRequestedAt,
        now(),
        warnings,
      );
      return {
        state: 'incomplete',
        message: `${outcome.message} · Seat Gauge checked separately`,
      };
    }
    if (reads.some((read) => read.status === 'rejected'))
      throw new Error('Sync finished; map read failed');
    if (result.status !== 'complete')
      return {
        state: result.status === 'incomplete' ? 'incomplete' : 'failed',
        message:
          result.status === 'incomplete'
            ? 'Sync incomplete; source data is pending'
            : 'Sync failed; try again',
      };
    const [snapshotRead, agentsRead] = reads;
    if (
      snapshotRead?.status !== 'fulfilled' ||
      agentsRead?.status !== 'fulfilled' ||
      !Number.isFinite(Date.parse(snapshotRead.value.generatedAt)) ||
      !Number.isFinite(Date.parse(agentsRead.value.generatedAt)) ||
      Date.parse(snapshotRead.value.generatedAt) < Date.parse(result.snapshotAt) ||
      Date.parse(agentsRead.value.generatedAt) < Date.parse(result.agentsAt)
    )
      throw new Error('Updated data is still pending');
    const versionWarning =
      serverWarnings.length || !versionsCurrent(result, versionRead[0])
        ? ' · site versions pending (warning)'
        : '';
    const readWarning =
      snapshotRead.value.mapGaps && !snapshotRead.value.mapGaps.complete
        ? ' · map gaps pending'
        : '';
    if (ticketCountMap(snapshotRead.value)) {
      const outcome = ticketSyncOutcome(snapshotRead.value, null, syncRequestedAt, now());
      return {
        state: outcome.status === 'complete' && !readWarning ? 'complete' : 'incomplete',
        message: `${outcome.message}${readWarning}${versionWarning} · Seat Gauge checked separately`,
      };
    }
    return {
      state: readWarning ? 'incomplete' : 'complete',
      message: `GitHub up to date${readWarning}${versionWarning} · Seat Gauge checked separately`,
    };
  } catch (error) {
    return { state: 'failed', message: error instanceof Error ? error.message : 'Sync failed' };
  }
}
