// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import type { SeatGaugeSession } from '../src/core/seat-gauge.ts';
import { Box } from '../src/web/Box.tsx';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const at = '2026-10-17T01:00:00Z';
const node = buildSnapshot({
  audit: JSON.parse(fixture('audit.json')) as Audit,
  flow: JSON.parse(fixture('flow.json')) as Flow,
  plan: parseBuildUnits(fixture('build-units.md')),
  generatedAt: at,
}).stages.flatMap((stage) => stage.nodes)[0]!;
const session = (status: string): SeatGaugeSession => ({
  id: JSON.stringify(['local', 'session-1']),
  source: {
    machine: 'local',
    session_id: 'session-1',
    workspace: 'PRODUCT-Data-Seat',
    pane: 'pane-1',
    tool: 'claude',
    model: null,
    effort: null,
    repo: 'PRODUCT',
    section: 'Data',
    seat: null,
    branch: 'wm/149-zoom-tens',
    started_at: null,
    closed_at: null,
    status,
    as_of: at,
    stale: false,
    tokens: null,
    usd: null,
  },
  repository: 'Demo/product',
  section: node.id,
  prs: [],
  tickets: ['Demo/product#149'],
  elapsedSeconds: null,
  state: 'current',
  reason: 'Branch ticket associated; whole-session totals',
});
function card(open: SeatGaugeSession[], last: SeatGaugeSession | null = null): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(
    <Box
      n={node}
      stage={1}
      agents={{ open, last }}
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
      tickets={undefined}
      ticketFailed={false}
      now={Date.parse(at)}
    />,
  );
  return root;
}
const build = (root: HTMLElement) =>
  root.querySelector('.planning-mini span[aria-label^="build:"]')!;

it('a placed working session shows the agent pill and spins the build step (#158)', () => {
  const root = card([session('working')]);
  expect(root.querySelector('.agent-pill')?.getAttribute('data-working')).toBe('yes');
  expect(build(root).getAttribute('data-working')).toBe('yes');
  expect(build(root).querySelector('.working-icon')).not.toBeNull();
});
it('an idle placed session keeps its pill but the build step still (#158)', () => {
  const root = card([session('idle')]);
  expect(root.querySelector('.agent-pill')?.getAttribute('data-working')).toBe('no');
  expect(build(root).getAttribute('data-working')).toBe('no');
});

// #252: pills only, one until expanded, each a link to its work; the last closed agent when none is open.
const named = (id: string, status: string): SeatGaugeSession => ({
  ...session(status),
  id,
  source: { ...session(status).source, session_id: id, workspace: `PR-Fix-${id}-Seat` },
});
it('shows every agent as a pill, without a label or a per-card toggle (#252, #255)', () => {
  const root = card([named('1', 'working'), named('2', 'done'), named('3', 'done')]);
  expect(root.textContent).not.toMatch(/\bAgent\b/);
  expect([...root.querySelectorAll('.agent-pill')].map((a) => a.textContent)).toEqual([
    'PR-Fix-1-Seat',
    'PR-Fix-2-Seat',
    'PR-Fix-3-Seat',
  ]);
  expect(root.querySelector('.agent-more')).toBeNull();
  expect(root.querySelector('.agent-pill')?.getAttribute('href')).toBe(
    'https://github.com/Demo/product/issues/149',
  );
});
it('keeps only open PRs and blockers in the footer, each a number over its label (#255)', () => {
  const figures = [...card([]).querySelectorAll('.card-counts > span')];
  expect(
    figures.map((f) => [f.querySelector('b')?.textContent, f.querySelector('small')?.textContent]),
  ).toEqual([
    ['–', 'open PRs'],
    ['–', 'blockers'],
  ]);
  expect(card([]).querySelector('.days-left, .unreviewed')).toBeNull();
});
it('shows the last closed agent, dimmed and not working, when none is open (#252)', () => {
  const closed = named('9', 'closed');
  closed.source = { ...closed.source, closed_at: at };
  const root = card([], closed);
  const pill = root.querySelector('.agent-pill')!;
  expect(pill.getAttribute('data-previous')).toBe('yes');
  expect(pill.getAttribute('data-working')).toBe('no');
  expect(root.querySelector('.agent-more')).toBeNull();
  expect(build(root).getAttribute('data-working')).toBe('no');
});
