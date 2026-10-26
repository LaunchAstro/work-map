// SPDX-License-Identifier: AGPL-3.0-only
//
// The Sync button and its status line; what one Sync does is `runSync` in sync-run.ts.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AgentsSnapshot, Snapshot } from '../core/contract.ts';
import type { VersionsSnapshot } from '../core/versions.ts';
import { runSync, type SyncUi } from './sync-run.ts';

export type { SyncUi } from './sync-run.ts';

type Refresh<T> = { readonly refresh: () => Promise<T> };

/** The Sync button's state for the map in the address; the outcome itself is `runSync` (#181). */
export function useSync(
  snap: Refresh<Snapshot>,
  agents: Refresh<AgentsSnapshot>,
  versions: Refresh<VersionsSnapshot>,
  search: string = globalThis.location?.search ?? '',
  ready = true,
): { syncState: SyncUi; syncMap: () => Promise<void> } {
  const owner = useMemo(() => ({ live: true, running: false }), [search]);
  const [status, setStatus] = useState<{ owner: typeof owner; state: SyncUi } | null>(null);
  useEffect(() => {
    owner.live = true;
    return () => {
      owner.live = false;
    };
  }, [owner]);
  const setSyncState = (state: SyncUi): void => {
    if (owner.live) setStatus({ owner, state });
  };
  // One Sync for everything: the census is shared, so there is no per-section sync.
  const syncMap = async (): Promise<void> => {
    if (!ready || owner.running) return;
    owner.running = true;
    try {
      const final = await runSync({
        fetcher: (url, init) => fetch(url, init),
        search,
        sources: {
          snapshot: snap.refresh,
          agents: agents.refresh,
          versions: versions.refresh,
        },
        progress: setSyncState,
        live: () => owner.live,
      });
      if (final) setSyncState(final);
    } finally {
      owner.running = false;
    }
  };
  return {
    syncState: !ready
      ? { state: 'busy', message: 'Loading selected map…' }
      : status?.owner === owner
        ? status.state
        : { state: 'idle' },
    syncMap,
  };
}

export function SyncControls({
  syncState,
  syncMap,
}: {
  readonly syncState: SyncUi;
  readonly syncMap: () => Promise<void>;
}): ReactNode {
  return (
    <div className="sync-controls">
      <button
        type="button"
        disabled={syncState.state === 'busy'}
        aria-label="Sync all: GitHub and round context for the whole map"
        title="Sync all: GitHub and round context for the whole map"
        onClick={() => void syncMap()}
      >
        {syncState.state === 'busy' ? 'Syncing…' : 'Sync all'}
      </button>
      <span role="status" aria-live="polite">
        {syncState.state === 'idle' ? '' : syncState.message}
      </span>
    </div>
  );
}
