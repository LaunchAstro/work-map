// SPDX-License-Identifier: AGPL-3.0-only
//
// #242, #245: the cards are read from GitHub only on Sync, not on the five-minute timer or after a merge, so the header
// says how old their last read is, and whether a newer read failed. Old reads are shown, never pending.
import type { WorkView } from '../core/work.ts';
import { shortStamp, stoppedAgo } from './words.ts';

export interface CardAge {
  /** For the header line, for example "cards 2 hours ago". */
  readonly words: string;
  /** For the hover help: the read time, and a newer failed read when there is one. */
  readonly detail: string;
  readonly failed: boolean;
}

export function cardAge(
  work: Pick<WorkView, 'at' | 'lastFailure'> | undefined,
  now: number,
): CardAge | null {
  if (!work) return null;
  const at = work.at || null;
  const failure = work.lastFailure;
  const failed = !!failure && (!at || Date.parse(failure.at) > Date.parse(at));
  return {
    words: `cards ${at ? stoppedAgo(at, now) : 'not read yet'}${failed ? ' · last card read failed' : ''}`,
    detail: `Cards read ${at ? shortStamp(at) : 'not yet'}${failed && failure ? ` (a later read at ${shortStamp(failure.at)} failed: ${failure.error})` : ''}.`,
    failed,
  };
}
