// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import type { NodeView } from '../core/contract.ts';
import type { CardAgents } from '../core/seat-gauge.ts';
import { ticketProgressCurrent, type TicketProgress } from '../core/ticket-progress.ts';
import type { SectionWork } from '../core/work.ts';
import { Bar, type TipControls } from './Bar.tsx';
import type { BarModel } from './bar-models.ts';
import { meters } from './meters.ts';
import { cardTone } from './interactions.ts';
import { AgentPills } from './SeatGauge.tsx';
import { PLANNING_STEPS, planningStepTip, type PlanningStep } from './stage.ts';
import { scoredLine } from './words.ts';

export function Meters(
  props: TipControls & {
    readonly id: string;
    readonly progress: BarModel;
    readonly tickets: BarModel | null;
    readonly review: BarModel;
    readonly momentum?: string | null | undefined;
    readonly progressTitle?: string | undefined;
  },
): ReactNode {
  return (
    <>
      <div className="progress-meter">
        <div className="bar-title" title={props.progressTitle}>
          Progress
        </div>
        <Bar {...props} id={`${props.id}:progress`} model={props.progress} />
      </div>
      {props.tickets ? (
        <div className="tickets-meter">
          <div className="bar-title">Tickets</div>
          <Bar {...props} id={`${props.id}:tickets`} model={props.tickets} />
        </div>
      ) : null}
      <div className="review-meter">
        <div className="bar-title">Review</div>
        <Bar {...props} id={`${props.id}:review`} model={props.review} />
      </div>
      {props.momentum ? <div className="momentum">{props.momentum}</div> : null}
    </>
  );
}
function WorkingIcon(): ReactNode {
  return (
    <svg
      className="working-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M20 8a8 8 0 0 0-14-2L3 9m0-5v5h5M4 16a8 8 0 0 0 14 2l3-3m0 5v-5h-5" />
    </svg>
  );
}

export function Box(
  props: TipControls & {
    readonly n: NodeView;
    readonly stage: number;
    readonly agents: CardAgents;
    readonly open: boolean;
    readonly activate: (mode: 'pointer' | 'keyboard') => void;
    readonly enter: () => void;
    readonly leave: () => void;
    readonly related: boolean;
    readonly inspected: boolean;
    readonly work: SectionWork | undefined;
    readonly tickets: TicketProgress | undefined;
    readonly ticketFailed: boolean;
    readonly now: number;
    /** The section's latest merge, for the momentum line. */
    readonly lastMerge?: number | null | undefined;
  },
): ReactNode {
  const { n, work } = props;
  // A working Seat Gauge session placed on this card is building.
  const phases = new Set<PlanningStep>(
    props.agents.open.some((row) => row.source.status === 'working') ? ['build'] : [],
  );
  const externalBlockers = work?.blockers.filter((b) => b.section !== n.id) ?? [];
  const ticketCounts = props.tickets?.byNode[n.id];
  const scored = props.tickets ? scoredLine(ticketCounts?.tickets) : null;
  const ticketsCurrent =
    !!props.tickets && ticketProgressCurrent(props.tickets, props.now, props.ticketFailed);
  const shown = meters({
    tickets: props.tickets,
    work,
    sections: [n.id],
    failed: props.ticketFailed,
    now: props.now,
    lastMerge: props.lastMerge,
  });
  return (
    <div
      className="node"
      data-progress={
        props.tickets
          ? cardTone(work, ticketsCurrent ? (ticketCounts ?? null) : null)
          : cardTone(work)
      }
      data-related={props.related ? 'yes' : 'no'}
      data-inspected={props.inspected ? 'yes' : 'no'}
      data-build={work?.state ?? 'planned'}
      data-open={props.open ? 'yes' : 'no'}
      id={`n-${n.id}`}
      style={{ gridColumn: props.stage, gridRow: n.row + 1 }}
      role="button"
      tabIndex={0}
      aria-expanded={props.open}
      aria-label={`${n.title}, open details`}
      onPointerEnter={props.enter}
      onPointerLeave={props.leave}
      onClick={() => props.activate('pointer')}
      onKeyDown={(e) => {
        // Space opens the card only when the card itself has focus, not a segment or link inside it.
        if (e.key === 'Enter' || (e.key === ' ' && e.target === e.currentTarget)) {
          e.preventDefault();
          props.activate('keyboard');
        }
      }}
    >
      <h3>{n.title}</h3>
      {scored ? (
        <div className="score-line" title={scored.title}>
          {scored.label}
        </div>
      ) : null}
      <div className="node-meters">
        <Meters
          id={`section:${n.id}`}
          progress={shown.progress}
          tickets={shown.tickets}
          review={shown.review}
          momentum={shown.momentum}
          progressTitle={
            props.tickets ? 'Built and live, weighted by unit size' : work?.scope.reason
          }
          tip={props.tip}
          showTip={props.showTip}
          hideTip={props.hideTip}
        />
      </div>
      <AgentPills agents={props.agents} />
      <div className="node-footer">
        <div className="card-counts">
          <Count
            className="scope-caption"
            value={work?.openPrs.length}
            label={work?.openPrs.length === 1 ? 'open PR' : 'open PRs'}
          />
          <Count
            className="blocked"
            value={work ? externalBlockers.length : undefined}
            label={externalBlockers.length === 1 ? 'blocker' : 'blockers'}
            title="Open blockers outside this section; full details include within-section dependencies"
          />
          {shown.bugs ? (
            <Count
              className="open-bugs"
              value={shown.bugs.open}
              label={shown.bugs.open === 1 ? 'open bug' : 'open bugs'}
              title={`${shown.bugs.fixed} fixed`}
            />
          ) : null}
        </div>
        <div
          className="planning-mini"
          title={
            work
              ? `Missing ${work.missing.join(', ') || 'nothing'}`
              : 'Planning context not read yet'
          }
        >
          {PLANNING_STEPS.map((step) => (
            <span
              key={step}
              data-exists={work?.planning[step].length ? 'yes' : 'no'}
              data-working={phases.has(step) ? 'yes' : 'no'}
              title={
                [
                  phases.has(step) ? 'Active agent’s last reported phase' : undefined,
                  planningStepTip(step, work),
                ]
                  .filter(Boolean)
                  .join('\n') || undefined
              }
              aria-label={`${step}: ${phases.has(step) ? 'agent working; last reported phase; ' : ''}evidence ${work?.planning[step].length ? 'present' : !work || work.missing.includes('context') ? 'pending' : 'missing'}`}
            >
              {/* The icon is hidden from assistive technology unless it holds the spec link. */}
              <i
                aria-hidden={
                  step === 'spec' && !phases.has(step) && work?.planning.spec[0] ? undefined : true
                }
              >
                {phases.has(step) ? (
                  <WorkingIcon />
                ) : step === 'spec' && work?.planning.spec[0] ? (
                  // The spec tick opens its first evidence: the spec issue, else the document.
                  <a
                    className="planning-link"
                    href={work.planning.spec[0].url}
                    aria-label={`Open spec: ${work.planning.spec[0].title}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    ✓
                  </a>
                ) : work?.planning[step].length ? (
                  '✓'
                ) : !work || work.missing.includes('context') ? (
                  '?'
                ) : (
                  '×'
                )}
              </i>
              <span className="planning-label">{step}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A footer figure: the number over a one-line label; a dash until the work is read. */
function Count(props: {
  className: string;
  value: number | undefined;
  label: string;
  title?: string;
}): ReactNode {
  return (
    <span className={props.className} title={props.title ?? `${props.label} pending`}>
      <b>{props.value ?? '–'}</b> <small>{props.label}</small>
    </span>
  );
}
