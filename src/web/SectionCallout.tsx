// SPDX-License-Identifier: AGPL-3.0-only
import { useState, type ReactNode } from 'react';
import type { NodeView, Snapshot } from '../core/contract.ts';
import {
  pendingTicketProgress,
  ticketCountMap,
  ticketProgressCurrent,
} from '../core/ticket-progress.ts';
import { Callout, CalloutGroup } from './Callout.tsx';
import { buildSectionBrief, sectionBriefMarkdown } from './sectionBrief.ts';
import { DaysLeft, TicketDetails } from './TicketProgress.tsx';
import { shortStamp, type View } from './words.ts';

export function SectionCallout(props: {
  n: NodeView;
  snapshot: Snapshot;
  snapshotFailed: boolean;
  anchor: HTMLElement;
  viewport: HTMLElement;
  view: View;
  close: () => void;
  keyboard: boolean;
  ticketFailed: boolean;
  now: number;
}): ReactNode {
  const [copyFailed, setCopyFailed] = useState(false);
  const { n } = props;
  const brief = buildSectionBrief(props.snapshot, n, props.snapshotFailed);
  return (
    <Callout
      label={`${n.title} details`}
      title={n.title}
      section={n.id}
      snapshot={`Snapshot ${shortStamp(props.snapshot.generatedAt)}`}
      anchor={props.anchor}
      container={props.viewport}
      side="beside"
      watch={props.view}
      keyboard={props.keyboard}
      copy={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(sectionBriefMarkdown(brief));
            setCopyFailed(false);
          } catch {
            setCopyFailed(true);
          }
        })();
      }}
      close={props.close}
    >
      <p className="section-context">{n.text}</p>
      {props.snapshot.ticketProgress &&
      ticketProgressCurrent(props.snapshot.ticketProgress, props.now, props.ticketFailed) ? (
        <DaysLeft counts={props.snapshot.ticketProgress.byNode[n.id]} />
      ) : null}
      {ticketCountMap(props.snapshot) ? (
        <TicketDetails
          counts={props.snapshot.ticketProgress?.byNode[n.id]}
          bugs={props.snapshot.ticketProgress?.bugs?.byNode[n.id]}
          questions={props.snapshot.ticketProgress?.skipped?.filter((t) => t.section === n.id)}
          progress={props.snapshot.ticketProgress ?? pendingTicketProgress()}
          failed={props.ticketFailed}
          now={props.now}
        />
      ) : null}
      {copyFailed ? <p role="alert">Couldn’t copy the section context.</p> : null}
      <div className="brief-groups">
        {brief.groups
          .filter((group) => group.id !== 'ticket-progress')
          .map((group) => (
            <CalloutGroup
              key={group.id}
              title={group.title}
              count={group.rows.length}
              open={group.expanded}
            >
              {group.rows.length ? (
                group.rows.map((row) => (
                  <div className="brief-row" key={row.key}>
                    <div className="brief-key">{row.key}</div>
                    {row.url ? (
                      <a
                        className="brief-row-title"
                        href={row.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {row.title}
                      </a>
                    ) : (
                      <strong className="brief-row-title">{row.title}</strong>
                    )}
                    {row.details.map((detail, index) => (
                      <p key={index}>{detail}</p>
                    ))}
                    {row.links.length ? (
                      <div className="brief-row-links">
                        {row.links.map((link) => (
                          <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                            {link.title}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="brief-empty">No records supplied.</p>
              )}
            </CalloutGroup>
          ))}
        <CalloutGroup title="Sources and status">
          {brief.source.map((source) => (
            <p key={source}>{source}</p>
          ))}
        </CalloutGroup>
      </div>
    </Callout>
  );
}
