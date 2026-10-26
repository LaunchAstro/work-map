// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import type { Snapshot } from '../src/core/contract.ts';
import { pendingTicketProgress, ticketCounts } from '../src/core/ticket-progress.ts';
import { Header } from '../src/web/Header.tsx';
import { shortStamp } from '../src/web/words.ts';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const at = '2026-10-17T02:00:00.000Z';
const now = Date.parse(at);
const base = buildSnapshot({
  audit: JSON.parse(fixture('audit.json')) as Audit,
  flow: JSON.parse(fixture('flow.json')) as Flow,
  plan: parseBuildUnits(fixture('build-units.md')),
  generatedAt: at,
});
function ticketSnapshot(censusAt: string): Snapshot {
  return {
    ...base,
    progressBasis: 'ticket-count',
    ticketProgress: {
      ...pendingTicketProgress(),
      at: censusAt,
      complete: true,
      reason: null,
      byNode: Object.fromEntries(
        base.stages.flatMap((stage) =>
          stage.nodes.map((node) => [node.id, ticketCounts([], true)]),
        ),
      ),
    },
  };
}
function header(snapshot: Snapshot): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(
    <Header
      maps={{ data: null, failed: null }}
      s={snapshot}
      a={null}
      snapFailed={null}
      versions={{ data: null, failed: null }}
      tickets={snapshot.ticketProgress}
      seatGauge={null}
      now={now}
      camera={{ zoom: 100, zoomStep: () => {}, home: () => {} }}
      showPercentages={true}
      setShowPercentages={() => {}}
      showAgents={true}
      setShowAgents={() => {}}
      theme="light"
      setTheme={() => {}}
      syncState={{ state: 'idle' }}
      syncMap={async () => {}}
    />,
  );
  return root;
}

it('#255: the header Agents toggle sits beside % and says what it will do', () => {
  const root = header(ticketSnapshot(at));
  const toggle = root.querySelector<HTMLButtonElement>('.agents-toggle')!;
  expect(toggle.textContent).toBe('Agents');
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(toggle.getAttribute('aria-label')).toBe('Hide agents');
  expect(toggle.previousElementSibling?.className).toBe('percentage-toggle');
});

// #242: an older census is not pending; the header gives its read time.
it('the header gives the ticket census its read time, and an old census is not pending', () => {
  const old = '2026-10-17T00:00:00.000Z';
  const updated = header(ticketSnapshot(old)).querySelector('.updated')!;
  expect(updated.getAttribute('title')).toContain(`Tickets read ${shortStamp(old)}.`);
  expect(updated.textContent).not.toContain('tickets pending');
});
