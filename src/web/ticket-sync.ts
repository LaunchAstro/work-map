import type { Snapshot } from '../core/contract.ts';
import { asideWords, ticketProgressCurrent } from '../core/ticket-progress.ts';

/** A ticket Sync's outcome: complete, or paused while the census or another source is pending. */
export interface TicketSyncOutcome {
  readonly status: 'complete' | 'paused';
  readonly message: string;
}

export function ticketSyncOutcome(
  snapshot: Pick<Snapshot, 'ticketProgress'>,
  section: string | null,
  since: string,
  now = Date.now(),
  sourceWarnings: readonly string[] = [],
): TicketSyncOutcome {
  const warning = sourceWarnings.length
    ? ` · Other sources pending · ${sourceWarnings.join(' · ')}`
    : '';
  const progress = snapshot.ticketProgress;
  const selected = section === null ? progress?.totals : progress?.byNode[section];
  if (
    !ticketProgressCurrent(progress, now) ||
    !progress?.at ||
    Date.parse(progress.at) < Date.parse(since) ||
    !Number.isFinite(Date.parse(since)) ||
    !selected ||
    selected.unknown ||
    (section === null
      ? !!progress.pendingSections?.length
      : progress.pendingSections?.includes(section))
  )
    return {
      status: 'paused',
      message: `Ticket completion pending; source census, labels or closure evidence is incomplete${warning}`,
    };
  return {
    status: sourceWarnings.length ? 'paused' : 'complete',
    message: `${section === null ? 'Ticket census' : 'Shared ticket census refreshed; selected section'} · ${selected.total ? `${selected.completed}/${selected.total} completed` : 'No mapped tickets'}${asideWords(selected)}${warning}`,
  };
}
