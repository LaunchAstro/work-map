// SPDX-License-Identifier: AGPL-3.0-only
//
// The header: map links, freshness, ticket inventory, site versions, Seat Gauge, the loading bay,
// the camera and display controls, and Sync.
import { useRef, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { AgentsSnapshot, Snapshot } from '../core/contract.ts';
import type { MapLink } from '../core/map-links.ts';
import { SEAT_GAUGE_PENDING } from '../core/loading-bay.ts';
import type { SeatGaugeReport } from '../core/seat-gauge.ts';
import { ticketProgressCurrent, type TicketProgress } from '../core/ticket-progress.ts';
import type { VersionsSnapshot } from '../core/versions.ts';
import { LoadingBay } from './LoadingBay.tsx';
import { MapLinks } from './MapLinks.tsx';
import { SeatGauge } from './SeatGauge.tsx';
import { SiteVersions } from './SiteVersions.tsx';
import { SyncControls, type SyncUi } from './Sync.tsx';
import { AllTickets, TicketInventory } from './TicketProgress.tsx';
import type { useMapCamera } from './useMapCamera.ts';
import type { Poll } from './usePoll.ts';
import { shortStamp } from './words.ts';
import { sameDay } from '../core/time.ts';
import { cardAge } from './card-age.ts';

export function Header({
  maps,
  s,
  a,
  snapFailed,
  versions,
  tickets,
  seatGauge,
  now,
  camera,
  showPercentages,
  setShowPercentages,
  showAgents,
  setShowAgents,
  theme,
  setTheme,
  syncState,
  syncMap,
  switchMap,
}: {
  readonly maps: Poll<readonly MapLink[]>;
  readonly switchMap?: ((id: string) => void) | undefined;
  readonly s: Snapshot | null;
  readonly a: AgentsSnapshot | null;
  readonly snapFailed: string | null;
  readonly versions: Poll<VersionsSnapshot>;
  readonly tickets: TicketProgress | undefined;
  readonly seatGauge: SeatGaugeReport | null;
  readonly now: number;
  readonly camera: Pick<ReturnType<typeof useMapCamera>, 'zoom' | 'zoomStep' | 'home'>;
  readonly showPercentages: boolean;
  readonly setShowPercentages: Dispatch<SetStateAction<boolean>>;
  readonly showAgents: boolean;
  readonly setShowAgents: Dispatch<SetStateAction<boolean>>;
  readonly theme: 'light' | 'dark';
  readonly setTheme: Dispatch<SetStateAction<'light' | 'dark'>>;
  readonly syncState: SyncUi;
  readonly syncMap: () => Promise<void>;
}): ReactNode {
  const versionsShown = useRef(false);
  if (versions.data?.sites.length || versions.data?.error) versionsShown.current = true;
  const scopeKnown =
    !!s?.totals.days &&
    !!s?.stages.every((stage) => stage.nodes.every((node) => node.units.length));
  const run = s?.sources.github?.lastRun;
  // #245: the cards are read only on Sync, so their age shows beside the merge read's time.
  const cards = cardAge(s?.work, now);
  return (
    <header className="bar-top">
      <MapLinks
        maps={maps.failed ? null : maps.data}
        id={s?.id}
        title={s?.title.replace(/\s+roadmap$/i, ' work map') ?? 'Work map'}
        onSwitch={switchMap}
      />
      <div className="header-details">
        <div className="header-status">
          <span
            className="updated"
            title={
              s
                ? `${scopeKnown && s.sources.audit ? `Audit as at ${s.sources.audit.asAt}` : 'Code audit baseline pending'}. GitHub read ${shortStamp(run?.at)}${run?.skipped ? ` (${run.skipped})` : ''}${run?.error ? ` (failed: ${run.error})` : ''}. ${cards?.detail ?? ''} Round context read ${shortStamp(a?.generatedAt)}.${tickets ? ` Tickets read ${tickets.at ? shortStamp(tickets.at) : 'pending'}.` : ''} ${seatGauge?.reason ?? SEAT_GAUGE_PENDING}`
                : ''
            }
          >
            updated{' '}
            {s
              ? sameDay(Date.parse(s.generatedAt), now)
                ? shortStamp(s.generatedAt).replace(/^.*, /, '')
                : shortStamp(s.generatedAt)
              : '…'}
            {cards ? ` · ${cards.words}` : ''}
            {tickets && !ticketProgressCurrent(tickets, now, snapFailed !== null)
              ? ' · tickets pending'
              : ''}
            {snapFailed ? ' · refresh failed' : ''}
            {s?.work?.error ? ' · planning refresh incomplete' : ''}
          </span>
          {tickets ? <AllTickets tickets={tickets} failed={snapFailed !== null} now={now} /> : null}
        </div>
        <div className="header-actions">
          {tickets ? (
            <TicketInventory tickets={tickets} failed={snapFailed !== null} now={now} />
          ) : null}
          <SeatGauge report={seatGauge} />
          {s?.loadingBay ? (
            <LoadingBay data={s.loadingBay} failed={snapFailed !== null} now={now} />
          ) : null}
          {(versions.data || (versions.failed && versionsShown.current)) && (
            <SiteVersions data={versions.data} failed={versions.failed !== null} />
          )}
          <div className="camera-controls" aria-label="Map view">
            <button
              type="button"
              aria-label="Zoom out"
              title="Zoom out (−)"
              disabled={camera.zoom === null}
              onClick={() => camera.zoomStep(-1)}
            >
              −
            </button>
            <button
              type="button"
              className="zoom-readout"
              aria-label={`Zoom ${camera.zoom ?? '–'}%, return to 100% at the start`}
              title="Return to 100% at the start (0)"
              disabled={camera.zoom === null}
              onClick={camera.home}
            >
              {camera.zoom === null ? '–' : `${camera.zoom}%`}
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              title="Zoom in (+)"
              disabled={camera.zoom === null}
              onClick={() => camera.zoomStep(1)}
            >
              +
            </button>
            <button
              type="button"
              className="percentage-toggle"
              aria-label={showPercentages ? 'Hide percentages' : 'Show percentages'}
              title={showPercentages ? 'Hide percentages' : 'Show percentages'}
              aria-pressed={showPercentages}
              onClick={() => setShowPercentages((visible) => !visible)}
            >
              %
            </button>
            <button
              type="button"
              className="agents-toggle"
              aria-label={showAgents ? 'Hide agents' : 'Show agents'}
              title={showAgents ? 'Hide agents' : 'Show agents'}
              aria-pressed={showAgents}
              onClick={() => setShowAgents((visible) => !visible)}
            >
              Agents
            </button>
            <button
              type="button"
              aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
              title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
              aria-pressed={theme === 'dark'}
              onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4a8.5 8.5 0 1 0 11.5 11.5Z" />
              </svg>
            </button>
          </div>
          <SyncControls syncState={syncState} syncMap={syncMap} />
        </div>
      </div>
    </header>
  );
}
