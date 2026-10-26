import type { ReactNode } from 'react';
import {
  sessionOpen,
  type CardAgents,
  type SeatGaugeReport,
  type SeatGaugeSession,
} from '../core/seat-gauge.ts';
import { CalloutGroup, HeaderCallout } from './Callout.tsx';
import { time } from './words.ts';

export function sessionDetails(row: SeatGaugeSession): string {
  return `${row.source.tool} · ${row.source.status === 'done' ? 'turn complete, session open' : row.source.status} · ${row.source.branch ?? row.prs[0] ?? row.tickets[0] ?? 'branch pending'} · observed ${time(row.source.as_of)}`;
}
/** #252: a card's agents as pills, each linking to its PR or ticket; the header's Agents toggle hides them all. */
export function AgentPills({ agents }: { agents: CardAgents }): ReactNode {
  const rows = agents.open.length ? agents.open : agents.last ? [agents.last] : [];
  return rows.length ? (
    <div className="agent-pills" onClick={(event) => event.stopPropagation()}>
      {rows.map((row) => (
        <AgentPill key={row.id} row={row} />
      ))}
    </div>
  ) : null;
}
function AgentPill({ row }: { row: SeatGaugeSession }): ReactNode {
  const work = row.prs[0] ?? row.tickets[0];
  const [repo, number] = work?.split('#') ?? [];
  const closed = row.source.closed_at;
  const working = !closed && row.source.status === 'working';
  return (
    <a
      className="agent-pill"
      data-working={working ? 'yes' : 'no'}
      data-previous={closed ? 'yes' : 'no'}
      title={closed ? `Last agent, closed ${time(closed)}` : sessionDetails(row)}
      {...(work
        ? {
            href: `https://github.com/${repo}/${row.prs.length ? 'pull' : 'issues'}/${number}`,
            target: '_blank',
            rel: 'noreferrer',
          }
        : {})}
    >
      {working ? (
        <svg className="agent-sparkle" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
          <path d="M12 1l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" />
        </svg>
      ) : null}
      {row.source.workspace || row.source.session_id}
    </a>
  );
}
function link(key: string, kind: 'pull' | 'issues'): ReactNode {
  const [repo, number] = key.split('#');
  return (
    <a
      key={key}
      href={`https://github.com/${repo}/${kind}/${number}`}
      target="_blank"
      rel="noreferrer"
    >
      {key}
    </a>
  );
}
export function SeatGaugeContents({ report }: { report: SeatGaugeReport | null }): ReactNode {
  const shown = report?.sessions.filter(sessionOpen) ?? [];
  const closed = (report?.sessions.length ?? 0) - shown.length;
  const working =
    report?.state === 'current'
      ? shown.filter((row) => row.state === 'current' && row.source.status === 'working').length
      : null;
  const notes = [
    'Whole-session totals for the current branch. They can include earlier branches. Elapsed time runs from the first observed work to the latest observation or the recorded session close. USD is a list-price estimate.',
    report?.reason ?? 'Seat Gauge publication pending',
    ...(report && report.unmapped > 0
      ? [`${report.unmapped} unmapped sessions. Session total pending.`]
      : []),
    ...(closed > 0 ? [`${closed} closed mapped sessions not shown.`] : []),
  ];
  return (
    <div className="brief-groups">
      <p>{working === null ? 'Seat Gauge pending' : `Qualified agents working · ${working}`}</p>
      {shown.map((row) => (
        <CalloutGroup key={row.id} title={row.source.workspace || row.source.session_id}>
          <div className="brief-row">
            <p>{sessionDetails(row)}</p>
            <p>
              {row.repository ?? 'Repository mapping pending'} · {row.section ?? 'Section pending'}{' '}
              · {row.state === 'pending' ? `Pending: ${row.reason}` : 'Current observation'}
            </p>
            {row.state === 'current' ? (
              <p>
                <b>Session total</b> · elapsed{' '}
                {row.elapsedSeconds === null ? 'pending' : `${row.elapsedSeconds}s`} · input{' '}
                {row.source.tokens?.input.toLocaleString() ?? 'pending'} · output{' '}
                {row.source.tokens?.output.toLocaleString() ?? 'pending'} · thinking{' '}
                {row.source.tokens?.thinking.toLocaleString() ?? 'pending'} (included in output) ·
                cache read {row.source.tokens?.cacheRead.toLocaleString() ?? 'pending'} · cache
                write 5m {row.source.tokens?.cacheWrite5m.toLocaleString() ?? 'pending'} · cache
                write 1h {row.source.tokens?.cacheWrite1h.toLocaleString() ?? 'pending'} ·
                list-price USD {row.source.usd === null ? 'pending' : row.source.usd.toFixed(4)}
              </p>
            ) : (
              <p>Session total pending. Last observation {time(row.source.as_of)}.</p>
            )}
            <div className="brief-row-links">
              {row.prs.map((key) => link(key, 'pull'))}
              {row.tickets.map((key) => link(key, 'issues'))}
            </div>
          </div>
        </CalloutGroup>
      ))}
      {report && shown.length === 0 ? (
        <p className="brief-empty">No open mapped sessions in this publication.</p>
      ) : null}
      <CalloutGroup title="Sources and status" count={notes.length}>
        {notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </CalloutGroup>
    </div>
  );
}

// Seat Gauge is optional: hidden when the project publishes no report.
export function SeatGauge({ report }: { report: SeatGaugeReport | null }): ReactNode {
  if (!report) return null;
  return (
    <HeaderCallout
      button="Seat Gauge"
      label="Seat Gauge session totals"
      title="Seat Gauge"
      snapshot={`Published ${time(report.at)}${
        report.state === 'pending' || report.unmapped > 0 ? ' · pending' : ''
      }`}
    >
      <SeatGaugeContents report={report} />
    </HeaderCallout>
  );
}
