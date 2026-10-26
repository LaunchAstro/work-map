// SPDX-License-Identifier: AGPL-3.0-only
//
// The overview strip under the header: merge progress or project scope, the merge summary, and the
// placement counts (PRs not placed and map gaps, or tickets, PRs and files not placed apart).
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { PrView, Snapshot } from '../core/contract.ts';
import { currentMapGapReport } from '../core/map-gaps.ts';
import { ticketProgressCurrent, type TicketProgress } from '../core/ticket-progress.ts';
import { clockHours, mergeAxis, mergeHours, type MergeHour } from './activity.ts';
import { Bar, tipHandlers, type Tip, type TipControls } from './Bar.tsx';
import type { BarModel } from './bar-models.ts';
import { lastMergeAt, meters } from './meters.ts';
import { githubMetricsCurrent, githubMetricsShown } from './github-freshness.ts';
import { shortStamp, stoppedAgo } from './words.ts';
import { mapGapsCurrent } from './map-gap-freshness.ts';
import { stageMeters, type MeterData } from './stage.ts';
import { hourLabel, hourSpan } from '../core/time.ts';
import { readOnce } from '../core/freshness.ts';

const MERGE_WINDOW_HOURS = 12;

/** One labelled bar in the project scope header. */
function ProjectBar(
  props: TipControls & { readonly label: string; readonly id: string; readonly model: BarModel },
): ReactNode {
  return (
    <div className="m">
      <span className="ml">{props.label}</span>
      <Bar {...props} />
    </div>
  );
}

/**
 * The project's Progress: the equal-weight average of every section's scope, as the stage bars use.
 * Pending when the snapshot read failed, the work was never read, or any section has no scope weights;
 * between Syncs it keeps the last read (#242).
 */
function projectScope(s: Snapshot, failed: boolean, now: number): MeterData['scope'] {
  const nodes = s.stages.flatMap((stage) => stage.nodes);
  // The evidence's own time counts, not only the snapshot's: a regenerated snapshot can't
  // freshen old work.
  if (failed || !s.work || !readOnce(s.generatedAt, now) || !nodes.length) return undefined;
  if (!readOnce(s.work.at, now)) return undefined;
  return stageMeters(nodes, s.work.byNode, s.work.complete).scope;
}

function Pace({
  hours,
  tip,
  showTip,
  hideTip,
}: TipControls & { readonly hours: readonly MergeHour[] }): ReactNode {
  const axis = mergeAxis(hours);
  return (
    <div className="pace">
      <div className="merge-chart">
        <div className="merge-axis" aria-label={`Quantity, 0 to ${axis.ceiling} merges`}>
          <span className="quantity">Quantity</span>
          {axis.ticks.map((tick) => (
            <span
              key={tick}
              className="merge-tick"
              style={{ bottom: `${(100 * tick) / axis.ceiling}%` }}
            >
              {tick}
            </span>
          ))}
        </div>
        <div
          className="merge-graph"
          aria-label="Hourly merge activity, oldest first"
          style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}
        >
          <div className="merge-grid" aria-hidden="true">
            {axis.ticks.map((tick) => (
              <i key={tick} style={{ bottom: `${(100 * tick) / axis.ceiling}%` }} />
            ))}
          </div>
          {hours.map((hour, i) => (
            <button
              type="button"
              key={hour.start}
              aria-label={`${hourSpan(hour.start, hour.end)}: ${hour.count} ${hour.count === 1 ? 'merge' : 'merges'}`}
              {...tipHandlers(
                `hour:${i}`,
                `${hourSpan(hour.start, hour.end)} · ${hour.count} ${hour.count === 1 ? 'merge' : 'merges'}`,
                { tip, showTip, hideTip },
              )}
            >
              <i
                data-busy={hour.count >= 4 ? 'yes' : 'no'}
                style={{ height: `${(100 * hour.count) / axis.ceiling}%` }}
              />
            </button>
          ))}
        </div>
        <div
          className="merge-hours"
          aria-hidden="true"
          style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}
        >
          {hours.map((hour) => (
            <span key={hour.start}>{hourLabel(hour.start)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Overview({
  s,
  tickets,
  snapFailed,
  now,
  statsTab,
  setStatsTab,
  setTip,
  tip,
  showTip,
  hideTip,
  showUnmapped,
  setShowUnmapped,
}: TipControls & {
  readonly s: Snapshot;
  readonly tickets: TicketProgress | undefined;
  readonly snapFailed: string | null;
  readonly now: number;
  readonly statsTab: 'scope' | 'merges';
  readonly setStatsTab: Dispatch<SetStateAction<'scope' | 'merges'>>;
  readonly setTip: Dispatch<SetStateAction<Tip | null>>;
  readonly showUnmapped: boolean;
  readonly setShowUnmapped: Dispatch<SetStateAction<boolean>>;
}): ReactNode {
  const projectWork = {
    scope: projectScope(s, snapFailed !== null, now),
    review: s.work?.review,
  };
  const shown = meters({
    tickets,
    work: projectWork,
    sections: null,
    failed: snapFailed !== null,
    now,
    lastMerge: lastMergeAt(s, null),
  });
  const mergeBuckets = mergeHours(s.prs, s.stats.at, MERGE_WINDOW_HOURS);
  const metricsCurrent = githubMetricsCurrent(
    s.sources.github?.lastRun,
    snapFailed !== null,
    s.stats.at,
    now,
  );
  // #242: a skipped or failed merge read keeps the last good figures, labelled with their time.
  const metricsShown = githubMetricsShown(
    s.sources.github?.lastRun,
    snapFailed !== null,
    s.stats.at,
    now,
  );
  const metricsNote = metricsCurrent
    ? null
    : `as of ${shortStamp(s.stats.at)}, ${stoppedAgo(s.stats.at, now)}`;
  const queueTitle = s.stats.queueEntries?.length
    ? s.stats.queueEntries.map((e) => `${e.position}. #${e.number} ${e.title}`).join('\n')
    : undefined;
  const gapCandidate = currentMapGapReport(s.mapGaps);
  const gapReport = gapCandidate?.repo === s.sources.github?.repo ? gapCandidate : null;
  const gapsCurrent = mapGapsCurrent(
    gapReport,
    snapFailed !== null,
    s.sources.github?.repo ?? '',
    now,
  );
  const workShown = metricsShown && !!s.work?.complete && !s.work.error;
  // #5: a map placed by section counts tickets, PRs and files apart, with no plan-unit count.
  const offMap = s.work?.offMap;
  const prsShown = workShown && readOnce(s.work?.at, now);
  const ticketsShown =
    !!tickets &&
    snapFailed === null &&
    ticketProgressCurrent(tickets, now) &&
    !offMap?.unreadLabels.length;
  const unmapped = s.unmapped.prs
    .map((n) => s.prs[String(n)])
    .filter((p): p is PrView => p !== undefined);
  return (
    <section className="strip" aria-label="Overall">
      <div className="strip-tabs" aria-label="Project overview">
        <button
          type="button"
          aria-pressed={statsTab === 'merges'}
          onClick={() => {
            setStatsTab('merges');
            setTip(null);
          }}
        >
          Merge progress
        </button>
        <button
          type="button"
          aria-pressed={statsTab === 'scope'}
          onClick={() => {
            setStatsTab('scope');
            setTip(null);
          }}
        >
          Project scope
        </button>
      </div>
      <div className="overview-panel">
        {statsTab === 'scope' ? (
          <div className="overall-meters">
            <ProjectBar
              label="Progress"
              id="project:progress"
              model={shown.progress}
              tip={tip}
              showTip={showTip}
              hideTip={hideTip}
            />
            {shown.tickets ? (
              <ProjectBar
                label="Tickets"
                id="project:tickets"
                model={shown.tickets}
                tip={tip}
                showTip={showTip}
                hideTip={hideTip}
              />
            ) : null}
            <ProjectBar
              label="Review"
              id="project:review"
              model={shown.review}
              tip={tip}
              showTip={showTip}
              hideTip={hideTip}
            />
            {shown.momentum || shown.bugs ? (
              <div className="momentum">
                {[
                  shown.momentum,
                  shown.bugs
                    ? `${shown.bugs.open} open ${shown.bugs.open === 1 ? 'bug' : 'bugs'} · ${shown.bugs.fixed} fixed`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            ) : null}
          </div>
        ) : metricsShown ? (
          <>
            <Pace
              hours={clockHours(s.prs, s.stats.at, MERGE_WINDOW_HOURS)}
              tip={tip}
              showTip={showTip}
              hideTip={hideTip}
            />
            {metricsNote ? (
              <span className="merge-asof" role="status">
                Merges {metricsNote}
              </span>
            ) : null}
          </>
        ) : (
          <span role="status">Merge activity pending a fresh complete GitHub read</span>
        )}
      </div>
      <div className="merge-summary">
        <div className="m">
          <span className="ml" title="Average merges per hour over the last 12 hours">
            Average
          </span>
          <span className="big">
            {metricsShown && mergeBuckets.length
              ? (
                  mergeBuckets.reduce((sum, hour) => sum + hour.count, 0) / mergeBuckets.length
                ).toFixed(1)
              : '—'}{' '}
            <small>/ hr</small>
          </span>
        </div>
        <div className="m">
          <span className="ml">Last hour</span>
          <span className="big">{metricsShown ? (mergeBuckets.at(-1)?.count ?? '—') : '—'}</span>
        </div>
        <div className="m" title={metricsShown ? queueTitle : undefined}>
          <span className="ml">Queued</span>
          <span className="big">{metricsShown ? (s.stats.queued ?? '—') : '—'}</span>
        </div>
      </div>
      <div className="status-column">
        <div className="placement-group">
          {offMap ? (
            <>
              <button
                type="button"
                className="m gaps"
                onClick={() => setShowUnmapped((v) => !v)}
                title="Tickets no section could place"
              >
                <span className="ml">Tickets not placed</span>
                <span className="big">{ticketsShown ? tickets.unplaced.length : '—'}</span>
              </button>
              <button
                type="button"
                className="m gaps"
                onClick={() => setShowUnmapped((v) => !v)}
                title="Open and merged PRs no section could place"
              >
                <span className="ml">PRs not placed</span>
                <span className="big">{prsShown ? offMap.prs.length : '—'}</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="m gaps"
              onClick={() => setShowUnmapped((v) => !v)}
              title="Merged and open PRs no section could place"
            >
              <span className="ml">Not placed</span>
              <span className="big">
                {workShown ? s.unmapped.count + (s.work?.unplacedPrs.length ?? 0) : '—'}
              </span>
            </button>
          )}
          <div
            className="m"
            title={
              gapReport
                ? `${gapReport.reason}. Read ${shortStamp(gapReport.checkedAt)}. ${gapReport.prsRead}/${gapReport.prsExpected} tracked product PRs inspected. Counts cover unique unmapped changed paths, not all repository files.${gapReport.lastKnown ? ` Last complete: ${gapReport.lastKnown.gapFiles} gaps at ${shortStamp(gapReport.lastKnown.at)}.` : ''}`
                : 'Map gaps pending a complete PR-file census.'
            }
          >
            <span className="ml">{offMap ? 'Files not placed' : 'Map gaps'}</span>
            <span className="big">{gapsCurrent ? gapReport?.gapFiles : '—'}</span>
            {!gapsCurrent && <small>pending</small>}
          </div>
        </div>
      </div>
      {showUnmapped && offMap ? (
        <ul className="ov-list">
          {ticketsShown
            ? tickets.unplaced.map((t) => (
                <li key={t.key}>
                  <a href={t.url} target="_blank" rel="noreferrer">
                    {t.key}
                  </a>{' '}
                  ticket · {t.title}
                </li>
              ))
            : null}
          {(prsShown ? offMap.prs : []).map((p) => (
            <li key={p.key}>
              <a href={p.url} target="_blank" rel="noreferrer">
                {p.key}
              </a>{' '}
              {p.state === 'OPEN' ? 'open' : 'merged'} · {p.title}
            </li>
          ))}
        </ul>
      ) : showUnmapped ? (
        <ul className="ov-list">
          {s.work?.unplacedPrs.map((p) => (
            <li key={p.key}>
              <a href={p.url} target="_blank" rel="noreferrer">
                {p.key}
              </a>{' '}
              open · {p.title}
            </li>
          ))}
          {unmapped.map((p) => (
            <li key={p.number}>
              <a href={p.url} target="_blank" rel="noreferrer">
                #{p.number}
              </a>{' '}
              {shortStamp(p.mergedAt)} · {p.title}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
