import type { ReactNode } from 'react';
import {
  asideWords,
  daysLeft,
  isAbsorbed,
  statusOf,
  ticketCensus,
  ticketProgressCurrent,
  type CensusKind,
  type ProgressTicket,
  type TicketCounts,
  type TicketProgress,
} from '../core/ticket-progress.ts';
import { shortStamp } from './words.ts';
import { CalloutGroup, HeaderCallout } from './Callout.tsx';

export function ticketSummary(counts: TicketCounts | undefined, current: boolean): string {
  if (!counts?.total)
    return `${current ? 'No mapped tickets' : 'No mapped tickets · census pending'}${asideWords(counts)}`;
  return `${counts.completed}/${counts.total} completed${asideWords(counts)}${counts.unknown ? ` · ${counts.unknown} closure unknown` : ''}${!current ? ' · dated evidence' : ''}`;
}
export function TicketDetails(props: {
  counts: TicketCounts | undefined;
  /** The same scope's bug cards, when the project names bug labels. */
  bugs?: TicketCounts | undefined;
  /** The same scope's question cards, left out of every count. */
  questions?: readonly ProgressTicket[] | undefined;
  progress: TicketProgress;
  failed: boolean;
  now: number;
}): ReactNode {
  const p = props.progress;
  const current = ticketProgressCurrent(p, props.now, props.failed);
  return (
    <div className="ticket-details">
      <p>
        Ticket completion · {ticketSummary(props.counts, current)}.{' '}
        {p.at ? `GitHub checked ${shortStamp(p.at)}.` : 'Full issue census pending.'}{' '}
        {current ? 'Current issue census.' : 'Current percentage pending.'}
      </p>
      <p>
        Counts work cards (tickets, specs and umbrella issues) once. Bugs found by checks are
        counted in Bugs and questions (grilling, research, prototype) are left out, as the
        project&apos;s labels say. A ticket closed as absorbed into a parent counts by that parent;
        one closed as not planned with no parent is dropped and leaves the total. Ticket closure
        does not establish reviewed, merged, deployed or live scope.
      </p>
      {p.reason ? <p>{p.reason}</p> : null}
      <div className="brief-groups">
        <CalloutGroup title="Completed" count={props.counts?.completed ?? 0}>
          <TicketLinks
            tickets={props.counts?.tickets.filter((t) => statusOf(t) === 'done') ?? []}
          />
        </CalloutGroup>
        <CalloutGroup title="All mapped tickets" count={props.counts?.total ?? 0}>
          <TicketLinks
            tickets={props.counts?.tickets.filter((t) => statusOf(t) !== 'dropped') ?? []}
          />
        </CalloutGroup>
        {props.counts?.absorbed ? (
          <CalloutGroup title="Absorbed into a parent" count={props.counts.absorbed}>
            <TicketLinks tickets={props.counts.tickets.filter(isAbsorbed)} />
          </CalloutGroup>
        ) : null}
        {props.counts?.dropped ? (
          <CalloutGroup title="Dropped" count={props.counts.dropped}>
            <TicketLinks tickets={props.counts.tickets.filter((t) => statusOf(t) === 'dropped')} />
          </CalloutGroup>
        ) : null}
        {props.bugs ? (
          <CalloutGroup title="Bugs" count={props.bugs.total}>
            <p>
              {props.bugs.completed}/{props.bugs.total} fixed{asideWords(props.bugs)}
            </p>
            <TicketLinks tickets={props.bugs.tickets} />
          </CalloutGroup>
        ) : null}
        {props.questions?.length ? (
          <CalloutGroup title="Questions left out" count={props.questions.length}>
            <TicketLinks tickets={props.questions} />
          </CalloutGroup>
        ) : null}
        <CalloutGroup
          title="Mapping exceptions"
          count={p.unplaced.length + p.missing.length + p.outside.length}
        >
          <p>
            {p.unplaced.length} not on the map · {p.missing.length} missing · {p.outside.length}{' '}
            outside
          </p>
          <TicketLinks tickets={[...p.unplaced, ...p.outside]} />
          {p.missing.map((key) => (
            <p key={key}>Configured ticket missing from census · {key}</p>
          ))}
        </CalloutGroup>
      </div>
    </div>
  );
}
function TicketLinks({ tickets }: { tickets: TicketCounts['tickets'] }): ReactNode {
  if (!tickets.length) return <p>No tickets.</p>;
  return (
    <ul>
      {tickets.map((ticket) => (
        <li key={ticket.key}>
          <a href={ticket.url} target="_blank" rel="noreferrer">
            {ticket.key} · {ticket.title}
          </a>
          <span>
            {' '}
            · {ticket.state}
            {ticket.stateReason ? ` / ${ticket.stateReason}` : ''}
            {ticket.follows
              ? ` · follows ${ticket.follows.parent} (${ticket.follows.note ?? ticket.follows.state ?? 'unread'})`
              : ''}{' '}
            · {ticket.mapping}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The header's Tickets button: the whole project's ticket inventory and mappings. */
export function TicketInventory(props: {
  tickets: TicketProgress;
  failed: boolean;
  now: number;
}): ReactNode {
  const current = ticketProgressCurrent(props.tickets, props.now, props.failed);
  return (
    <HeaderCallout
      button="Tickets"
      label="Ticket inventory and mappings"
      title="Tickets"
      snapshot={
        props.tickets.at
          ? `GitHub checked ${shortStamp(props.tickets.at)}${current ? '' : ' · pending'}`
          : 'Issue census pending'
      }
    >
      <TicketDetails
        counts={props.tickets.totals}
        bugs={props.tickets.bugs?.totals}
        questions={props.tickets.skipped}
        progress={props.tickets}
        failed={props.failed}
        now={props.now}
      />
    </HeaderCallout>
  );
}

const KIND_WORDS: Readonly<Record<CensusKind, string>> = {
  build: 'Build work (the cards)',
  fixes: 'Fixes from checks',
  decisions: 'Decisions and questions',
  unplaced: 'Not on the map',
  outside: 'Outside the plan',
};
const dayWords = (left: number): string =>
  left < 0.5
    ? '<1 day left'
    : `${Math.round(left)} ${Math.round(left) === 1 ? 'day' : 'days'} left`;
/** Days of work left on a card (#232); nothing where the map has no unit days. */
export function DaysLeft(props: { counts: TicketCounts | undefined }): ReactNode {
  const left = daysLeft(props.counts);
  return left === null ? null : (
    <p className="days-left" title="Unit days × (1 − built), the weights Progress uses">
      {dayWords(left)}
    </p>
  );
}
/** The header's count of every ticket on the map's repositories, split by kind on hover (#225). */
export function AllTickets(props: {
  tickets: TicketProgress;
  failed: boolean;
  now: number;
}): ReactNode {
  if (!ticketProgressCurrent(props.tickets, props.now, props.failed)) return null;
  const c = ticketCensus(props.tickets);
  const left = daysLeft(props.tickets.totals);
  const tip = [
    `Every ticket on this map's repositories: ${c.done} done · ${c.open} open.`,
    ...c.kinds.map((k) => `${KIND_WORDS[k.kind]}: ${k.done} done · ${k.open} open`),
    `Absorbed into open work: ${c.absorbedOpen}`,
    `Absorbed into done work: ${c.absorbedDone}`,
    `Dropped: ${c.dropped}`,
    ...(c.unknown ? [`Closure unknown: ${c.unknown}`] : []),
    'The cards count build work only.',
  ].join('\n');
  return (
    <span className="all-tickets" tabIndex={0} title={tip}>
      All tickets {c.done} done · {c.open} open
      {left === null ? null : ` · ${dayWords(left)}`}
    </span>
  );
}
