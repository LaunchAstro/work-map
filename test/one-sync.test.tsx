// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import { pendingTicketProgress, ticketCounts } from '../src/core/ticket-progress.ts';
import { Box } from '../src/web/Box.tsx';
import { ComponentControls } from '../src/web/ComponentControls.tsx';
import { SyncControls } from '../src/web/Sync.tsx';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const at = '2026-10-17T01:00:00Z';
const snapshot = buildSnapshot({
  audit: JSON.parse(fixture('audit.json')) as Audit,
  flow: JSON.parse(fixture('flow.json')) as Flow,
  plan: parseBuildUnits(fixture('build-units.md')),
  generatedAt: at,
});
const node = snapshot.stages.flatMap((stage) => stage.nodes)[0]!;

it('a card carries no per-card ticket freshness line: freshness lives in the header (#155)', () => {
  const tickets = {
    ...pendingTicketProgress(),
    at,
    complete: true,
    reason: null,
    byNode: { [node.id]: ticketCounts([], true) },
  };
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(
    <Box
      n={node}
      stage={1}
      agents={{ open: [], last: null }}
      open={false}
      activate={() => {}}
      enter={() => {}}
      leave={() => {}}
      related={false}
      inspected={false}
      tip={null}
      showTip={() => {}}
      hideTip={() => {}}
      work={undefined}
      tickets={tickets}
      ticketFailed={false}
      now={Date.parse(at) + 300_000}
    />,
  );
  expect(root.textContent).not.toContain('Tickets checked');
  const described = root.querySelector('.node')?.getAttribute('aria-describedby');
  if (described) expect(root.querySelector(`#${described}`)).not.toBeNull();
});
it('the header keeps one Sync, named for the whole map (#155)', () => {
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(
    <SyncControls syncState={{ state: 'idle' }} syncMap={async () => {}} />,
  );
  expect(root.querySelector('button')?.textContent).toBe('Sync all');
});
it('callouts offer Copy and Close, never a per-section Sync (#155)', () => {
  // Even a caller still passing the old sync prop gets no section Sync.
  const legacy = { sync: { busy: false, run: () => {} } } as {};
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(
    <ComponentControls title="Website" {...legacy} copy={() => {}} close={() => {}} />,
  );
  expect([...root.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
    'Copy Website',
    'Close Website',
  ]);
  expect(root.querySelector('.sync-section')).toBeNull();
});
const css = (name: string): string =>
  readFileSync(join(import.meta.dirname, '..', 'src', 'web', 'flow', name), 'utf8');
it('the header keeps the updated stamp on one line and lets the actions wrap', () => {
  const strip = css('04-header-strip.css');
  expect(strip).toMatch(/\.updated\s*\{[^}]*white-space:\s*nowrap/);
  expect(strip).toMatch(/\.header-details\s*\{[^}]*flex-wrap:\s*wrap/);
  expect(css('08-merge-chart-sync.css')).toMatch(
    /\.sync-controls \[role='status'\]\s*\{[^}]*max-width/,
  );
});
