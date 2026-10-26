import { readOnce } from '../core/freshness.ts';
import type { LedgerPr, LoadingBay as LoadingBayData } from '../core/loading-bay.ts';
import { CalloutGroup, HeaderCallout } from './Callout.tsx';
import { time } from './words.ts';

const MILESTONES = [
  ['dropped', 'Dropped'],
  ['queued', 'Queued'],
  ['ready', 'Ready'],
  ['opened', 'Opened'],
  ['merged', 'Merged'],
  ['pending', 'Pending'],
] as const;
type Props = { data: LoadingBayData | undefined; failed: boolean; now: number };

const bayCurrent = ({ data, failed, now }: Props): boolean =>
  !!data && !failed && data.complete && readOnce(data.githubAt, now);

function PrRow({ pr, current }: { pr: LedgerPr; current: boolean }): React.JSX.Element {
  const at = pr.events.findLast((event) => event.kind === pr.status)?.at ?? null;
  return (
    <div className="brief-row">
      <div className="brief-key">{pr.key}</div>
      <a className="brief-row-title" href={pr.url} target="_blank" rel="noreferrer">
        {pr.title}
      </a>
      <p>
        {pr.status}
        {current ? '' : ' (dated)'} · {time(at)}
        {pr.reason ? ` · ${pr.reason}` : ''} · as of {time(pr.checkedAt)}
      </p>
      <details className="brief-history">
        <summary>Dated history</summary>
        {pr.events.map((event) => (
          <p key={event.id}>
            {event.kind} · {time(event.at)}
            {event.reason ? ` · ${event.reason}` : ''}
          </p>
        ))}
      </details>
    </div>
  );
}

export function LoadingBayContents(props: Props): React.JSX.Element {
  const { data, now } = props;
  const current = bayCurrent(props);
  const rows = (data?.prs ?? []).map((pr) => ({
    pr,
    current: current && pr.complete && readOnce(pr.checkedAt, now),
  }));
  const notes = [
    `GitHub as of ${time(data?.githubAt ?? null)}${current ? '' : ' · pending'}.`,
    'Session totals are shown separately in Seat Gauge.',
    'Change descriptions pending follow-up.',
    `${
      data?.readyLabel
        ? `Ready comes only from the configured PR label ${data.readyLabel}.`
        : 'PR readiness pending. No project PR-ready label is configured.'
    } Queue removals retain GitHub’s reason.`,
    ...(data?.reason ? [data.reason] : []),
  ];
  return (
    <div className="brief-groups">
      {MILESTONES.map(([key, title]) => {
        // Group by the last known milestone; rows without a fresh read say "dated".
        const group = rows.filter((row) => row.pr.status === key);
        return group.length ? (
          <CalloutGroup key={key} title={title} count={group.length} open={key !== 'merged'}>
            {group.map((row) => (
              <PrRow key={row.pr.key} pr={row.pr} current={row.current} />
            ))}
          </CalloutGroup>
        ) : null;
      })}
      {!rows.length ? <p className="brief-empty">Loading bay history pending.</p> : null}
      <CalloutGroup title="Sources and status" count={notes.length}>
        {notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </CalloutGroup>
    </div>
  );
}

export function LoadingBay(props: Props): React.JSX.Element {
  return (
    <HeaderCallout
      button="Loading bay"
      label="GitHub loading bay"
      title="Loading bay"
      snapshot={`GitHub as of ${time(props.data?.githubAt ?? null)}${bayCurrent(props) ? '' : ' · pending'}`}
    >
      <LoadingBayContents {...props} />
    </HeaderCallout>
  );
}
