// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useState } from 'react';

/** The part of a poll that renders: its data and when its last read failed. */
export type Poll<T> = { readonly data: T | null; readonly failed: string | null };

export function usePoll<T>(
  url: string,
  every: number,
  parse: (value: unknown) => T | null,
  retainPrevious = false,
): {
  data: T | null;
  at: string | null;
  failed: string | null;
  refresh: () => Promise<T>;
  current: boolean;
  /** The address `data` was read from; a retained poll can still show an earlier address's data. */
  source: string | null;
} {
  const owner = useMemo(() => ({ live: true, sequence: 0 }), [url, parse]);
  const [state, setState] = useState<{
    owner: typeof owner | null;
    data: T | null;
    at: string | null;
    failed: string | null;
    source: string | null;
  }>({
    owner: null,
    data: null,
    at: null,
    failed: null,
    source: null,
  });
  const refresh = useCallback(async (): Promise<T> => {
    const request = ++owner.sequence;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error('Data read failed');
      const data = parse(await response.json());
      if (!data) throw new Error('Data update pending');
      if (owner.live && request === owner.sequence)
        setState({ owner, data, at: new Date().toISOString(), failed: null, source: url });
      return data;
    } catch (error) {
      if (owner.live && request === owner.sequence)
        setState((s) => {
          const keep = s.owner === owner || retainPrevious;
          return {
            owner,
            data: keep ? s.data : null,
            at: keep ? s.at : null,
            failed: new Date().toISOString(),
            source: keep ? s.source : null,
          };
        });
      throw error;
    }
  }, [owner, url, parse, retainPrevious]);
  useEffect(() => {
    owner.live = true;
    void refresh().catch(() => {});
    const timer = setInterval(() => void refresh().catch(() => {}), every);
    return () => {
      owner.live = false;
      ++owner.sequence;
      clearInterval(timer);
    };
  }, [owner, refresh, every]);
  const current = state.owner === owner;
  return {
    data: current || retainPrevious ? state.data : null,
    at: current || retainPrevious ? state.at : null,
    failed: current ? state.failed : null,
    current: current && state.data !== null && state.failed === null,
    source: current || retainPrevious ? state.source : null,
    refresh,
  };
}

/** A poll shown as not yet read: what an overlay shows while another map's board is painted. */
export function unread<P extends { data: unknown; at: string | null; failed: string | null }>(
  poll: P,
): P {
  return { ...poll, data: null, at: null, failed: null, current: false };
}
