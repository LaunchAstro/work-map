// SPDX-License-Identifier: AGPL-3.0-only
//
// The map canvas: the wire layer, the stage headers with their meters, and a card per section.
import type { ReactNode, RefObject } from 'react';
import type { Snapshot } from '../core/contract.ts';
import { cardAgents, type SeatGaugeReport } from '../core/seat-gauge.ts';
import type { TicketProgress } from '../core/ticket-progress.ts';
import type { TipControls } from './Bar.tsx';
import { lastMergeAt, meters } from './meters.ts';
import { Box, Meters } from './Box.tsx';
import { stageMeters } from './stage.ts';
import type { View } from './words.ts';

export function Board({
  s,
  board,
  svg,
  labels,
  view,
  inspected,
  open,
  related,
  activate,
  enter,
  leave,
  tip,
  showTip,
  hideTip,
  tickets,
  snapFailed,
  now,
  seatGauge,
}: TipControls & {
  readonly s: Snapshot;
  readonly board: RefObject<HTMLDivElement | null>;
  readonly svg: RefObject<SVGSVGElement | null>;
  readonly labels: RefObject<HTMLDivElement | null>;
  readonly view: View;
  readonly inspected: string | null;
  readonly open: string | null;
  readonly related: ReadonlySet<string>;
  readonly activate: (id: string, activation: 'pointer' | 'keyboard') => void;
  readonly enter: (id: string) => void;
  readonly leave: (id: string) => void;
  readonly tickets: TicketProgress | undefined;
  readonly snapFailed: string | null;
  readonly now: number;
  readonly seatGauge: SeatGaugeReport | null;
}): ReactNode {
  const stageWork = new Map(
    s.stages.map((stage) => [
      stage.index,
      stageMeters(stage.nodes, s.work?.byNode, s.work?.complete ?? false),
    ]),
  );
  return (
    <div
      className="canvas"
      style={{
        zoom: view.scale,
        transform: `translate(${view.x / view.scale}px, ${view.y / view.scale}px)`,
      }}
    >
      <div className="board" ref={board} data-inspecting={inspected ? 'yes' : 'no'}>
        <svg ref={svg} aria-hidden="true" />
        <div ref={labels} className="wire-labels" />
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${s.stages.length}, var(--column))`,
            gridTemplateRows: `auto repeat(${Math.max(...s.stages.flatMap((st) => st.nodes.map((n) => n.row)))}, minmax(118px, auto))`,
          }}
        >
          {s.stages.map((st) => (
            <div
              className="stage"
              key={`s${st.index}`}
              style={{ gridColumn: st.index, gridRow: 1 }}
            >
              <b>
                {st.index} · {st.name}
              </b>
              <div className="stage-meters">
                <Meters
                  id={`stage:${st.index}`}
                  {...meters({
                    tickets,
                    work: stageWork.get(st.index),
                    sections: st.nodes.map((node) => node.id),
                    failed: snapFailed !== null,
                    now,
                    lastMerge: lastMergeAt(
                      s,
                      st.nodes.map((node) => node.id),
                    ),
                  })}
                  tip={tip}
                  showTip={showTip}
                  hideTip={hideTip}
                />
              </div>
            </div>
          ))}
          {s.stages.flatMap((st) =>
            st.nodes.map((n) => (
              <Box
                key={n.id}
                n={n}
                stage={st.index}
                agents={cardAgents(seatGauge, n.id, now)}
                open={open === n.id}
                activate={(mode) => activate(n.id, mode)}
                enter={() => enter(n.id)}
                leave={() => leave(n.id)}
                related={related.has(n.id)}
                inspected={inspected === n.id}
                tip={tip}
                showTip={showTip}
                hideTip={hideTip}
                work={s.work?.byNode[n.id]}
                tickets={tickets}
                ticketFailed={snapFailed !== null}
                now={now}
                lastMerge={lastMergeAt(s, [n.id])}
              />
            )),
          )}
        </div>
      </div>
    </div>
  );
}
