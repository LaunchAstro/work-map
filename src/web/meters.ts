// SPDX-License-Identifier: AGPL-3.0-only
//
// The one place that decides what a card, a stage and the project header show (#207, folds in #174):
// Progress, Tickets and Review bars, the open-bugs count and the momentum line. A map with a ticket census
// counts tickets; without one, section scope. The components only draw what this returns.

import type { Snapshot } from '../core/contract.ts';
import {
  asideWords,
  selectedTicketCounts,
  statusOf,
  ticketProgressCurrent,
  type TicketCounts,
  type TicketProgress,
} from '../core/ticket-progress.ts';
import { pendingBar, progressBar, reviewBar, shown, visible, type BarModel } from './bar-models.ts';
import type { MeterData } from './stage.ts';

export interface MeterSet {
  readonly progress: BarModel;
  /** Build tickets done and left; null on a map without a ticket census. */
  readonly tickets: BarModel | null;
  readonly review: BarModel;
  /** Open bug tickets, and how many are fixed, for the footer; null without a current census. */
  readonly bugs: { readonly open: number; readonly fixed: number } | null;
  /** "+4 tickets this week" or "nothing moved in 9 days"; null when there is nothing to go on. */
  readonly momentum: string | null;
}

const DAY = 86_400_000;
/** Whether a bar's census can show a number: current, none of its sections held, every closure known. */
function countable(
  counts: TicketCounts | undefined,
  progress: TicketProgress,
  failed: boolean,
  now: number,
  sections: readonly string[] | null | undefined,
): boolean {
  // Without its sections a bar covers those of the tickets it counts; null is the whole project.
  const own =
    sections === undefined
      ? [...new Set(counts?.tickets.flatMap((t) => t.section ?? []) ?? [])]
      : sections;
  const held = (progress.pendingSections ?? []).some((id) => !own || own.includes(id));
  return (
    ticketProgressCurrent(progress, now, failed) && !held && !(counts?.total && counts.pct === null)
  );
}

/** Progress on a ticket map: live, built not live, and to do, weighted by unit size (#204). */
export function ticketProgressBar(
  counts: TicketCounts | undefined,
  progress: TicketProgress,
  failed: boolean,
  now: number,
  sections: readonly string[] | null,
  emptySections = 0,
): BarModel {
  const empty = emptySections
    ? ` · ${emptySections} ${emptySections === 1 ? 'section' : 'sections'} with no mapped tickets`
    : '';
  if (!countable(counts, progress, failed, now, sections))
    return pendingBar('progress', `Progress pending · ticket census not current${empty}`);
  if (!counts?.total || counts.pct === null)
    return {
      kind: 'progress',
      label: 'Progress',
      pending: null,
      meter: null,
      segments: [
        {
          key: 'planned',
          tone: 'rest',
          share: 100,
          label: null,
          words: `No tickets mapped${empty}`,
        },
      ],
    };
  const built = counts.pct;
  const live = counts.livePct ?? null;
  const weight = counts.weight ?? 0;
  const from = (part: number | undefined): number => (weight && part ? (part / weight) * 100 : 0);
  const sources = [
    from(counts.fromAudit) ? `${shown(from(counts.fromAudit))} from the audit` : '',
    from(counts.fromLuna) ? `${shown(from(counts.fromLuna))} from earlier re-checks` : '',
  ].filter(Boolean);
  const words = `${live === null ? 'Live unknown' : `Live ${shown(live)}`} · Built ${shown(built)} · ${shown(100 - built)} to go${sources.length ? ` · ${sources.join(' · ')}` : ''}${empty}`;
  const liveShare = live === null ? 0 : Math.min(live, built);
  return {
    kind: 'progress',
    label: 'Progress',
    pending: null,
    meter: built,
    segments: visible([
      { key: 'live', tone: 'live', share: liveShare, label: Math.round(liveShare), words },
      {
        key: 'built',
        tone: live === null ? 'completed' : 'merged',
        share: built - liveShare,
        // The built part always carries the whole built figure; live carries its own (18 Oct 2026).
        label: Math.round(built),
        words,
      },
      { key: 'planned', tone: 'rest', share: 100 - built, label: null, words },
    ]),
  };
}

/** Build tickets done against left (#207); bugs and questions are never in it. */
export function ticketsBar(
  counts: TicketCounts | undefined,
  progress: TicketProgress,
  failed: boolean,
  now: number,
  sections?: readonly string[] | null,
): BarModel {
  const done = counts?.completed ?? 0;
  const total = counts?.total ?? 0;
  const words = `${total ? `${done} done · ${total - done} left` : 'No tickets mapped'}${asideWords(counts && { ...counts, audited: 0 })}${counts?.unknown ? ` · ${counts.unknown} closure unknown` : ''}`;
  if (!countable(counts, progress, failed, now, sections))
    return pendingBar('tickets', `${words} · census pending`);
  const share = total ? (done / total) * 100 : 0;
  return {
    kind: 'tickets',
    label: 'Tickets',
    pending: null,
    meter: total ? share : null,
    segments: visible([
      {
        key: 'completed',
        tone: 'completed',
        share,
        label: total ? Math.round(share) : null,
        words,
      },
      { key: 'remaining', tone: 'rest', share: 100 - share, label: null, words },
    ]),
  };
}

/** The latest merge of a PR listed as the sections' build work, from the snapshot's merged PRs. */
export function lastMergeAt(
  snapshot: Pick<Snapshot, 'prs' | 'work' | 'sources'> | null | undefined,
  sections: readonly string[] | null,
): number | null {
  const repo = snapshot?.sources.github?.repo;
  if (!snapshot?.work || !repo) return null;
  const merged = new Map(
    Object.values(snapshot.prs).map((p) => [`${repo}#${p.number}`, p.mergedAt]),
  );
  const times = Object.entries(snapshot.work.byNode)
    .filter(([id]) => !sections || sections.includes(id))
    .flatMap(([, w]) => w.planning.build.map((p) => Date.parse(merged.get(p.key) ?? '')))
    .filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}

/** "+N tickets this week" from build tickets closed in the last 7 days, else how long since anything moved. */
export function momentum(
  counts: TicketCounts | undefined,
  lastMerge: number | null,
  now: number,
): string | null {
  const closed = (counts?.tickets ?? [])
    .filter((t) => statusOf(t) === 'done' && t.closedAt)
    .map((t) => Date.parse(t.closedAt!))
    .filter((at) => Number.isFinite(at) && at <= now);
  const week = closed.filter((at) => now - at < 7 * DAY).length;
  if (week) return `+${week} ${week === 1 ? 'ticket' : 'tickets'} this week`;
  const last = Math.max(...closed, ...(lastMerge !== null && lastMerge <= now ? [lastMerge] : []));
  if (!Number.isFinite(last)) return null;
  const days = Math.floor((now - last) / DAY);
  return days < 1 ? 'moved today' : `nothing moved in ${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * Every bar and count for one scope: a section (`[id]`), a stage (its section ids) or the whole project
 * (null). `tickets` is the map's ticket census: present on a ticket-count map, absent on a scope map.
 */
export function meters(input: {
  readonly tickets: TicketProgress | undefined;
  readonly work: MeterData | undefined;
  readonly sections: readonly string[] | null;
  readonly failed: boolean;
  readonly now: number;
  readonly lastMerge?: number | null | undefined;
}): MeterSet {
  const { tickets, sections, failed, now } = input;
  const review = reviewBar(input.work);
  if (!tickets)
    return { progress: progressBar(input.work), tickets: null, review, bugs: null, momentum: null };
  const counts = sections ? selectedTicketCounts(tickets, sections) : tickets.totals;
  const bugCounts = tickets.bugs
    ? sections
      ? selectedTicketCounts(tickets, sections, 'bugs')
      : tickets.bugs.totals
    : undefined;
  const own = sections ?? Object.keys(tickets.byNode);
  const emptySections = own.length > 1 ? own.filter((id) => !tickets.byNode[id]?.total).length : 0;
  return {
    progress: ticketProgressBar(counts, tickets, failed, now, sections, emptySections),
    tickets: ticketsBar(counts, tickets, failed, now, sections),
    review,
    bugs:
      bugCounts && countable(bugCounts, tickets, failed, now, sections)
        ? { open: bugCounts.total - bugCounts.completed, fixed: bugCounts.completed }
        : null,
    momentum: momentum(counts, input.lastMerge ?? null, now),
  };
}
