// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import {
  pendingTicketProgress,
  ticketCounts,
  type ProgressTicket,
  type TicketShare,
} from '../src/core/ticket-progress.ts';
import { buildWork } from '../src/core/work.ts';
import type { Project } from '../src/readers/project.ts';
import { Board } from '../src/web/Board.tsx';
import { Box } from '../src/web/Box.tsx';

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

const card = (shares: Pick<TicketShare, 'by' | 'at'>[]): HTMLElement => {
  const tickets: ProgressTicket[] = shares.map((share, i) => ({
    key: `Example/app#${i + 1}`,
    title: `Ticket ${i + 1}`,
    url: `https://github.com/Example/app/issues/${i + 1}`,
    state: 'OPEN',
    stateReason: null,
    section: node.id,
    mapping: 'section label',
    share: { unit: 'U1', weight: 1, built: 0.5, live: 0, ...share },
  }));
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
      tickets={{
        ...pendingTicketProgress(),
        at,
        complete: true,
        reason: null,
        byNode: { [node.id]: ticketCounts(tickets, true) },
      }}
      ticketFailed={false}
      now={Date.parse(at)}
    />,
  );
  return root;
};

it('a ticket card dates its frozen audit score from the newest re-check or deep sync', () => {
  const line = card([
    { by: 'luna', at: '2026-10-15T23:30:00Z' },
    { by: 'deep', at: '2026-10-16T22:00:00Z' },
    { by: 'audit', at: '2026-10-17T00:00:00Z' },
  ]).querySelector('.score-line');
  expect(line?.textContent).toBe('Scored 17 Oct');
  expect(line?.getAttribute('title')).toBe(
    'Last audit score, 17 Oct, 8:00 am. The audit is retired, so this score no longer changes.',
  );
  expect(
    card([
      { by: 'audit', at },
      { by: null, at: null },
    ]).querySelector('.score-line'),
  ).toBeNull();
});
it('a score with an unreadable time is left out of the Scored line', () => {
  expect(card([{ by: 'luna', at: 'not a time' }]).querySelector('.score-line')).toBeNull();
  expect(
    card([
      { by: 'deep', at: 'not a time' },
      { by: 'luna', at: '2026-10-15T23:30:00Z' },
    ]).querySelector('.score-line')?.textContent,
  ).toBe('Scored 16 Oct');
});
it('the card face carries no ticket closure line; it lives in the section details (#88 q14)', () => {
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
      tickets={undefined}
      ticketFailed={false}
      now={Date.parse(at)}
    />,
  );
  expect(root.textContent).not.toContain('Ticket closure');
});
it('the spec ✓ opens the spec, takes keyboard focus and stays in the accessibility tree (#139)', () => {
  const spec = 'Example/plan:docs/SPEC.md';
  const url = 'https://github.com/Example/plan/blob/develop/docs/SPEC.md';
  const project: Project = {
    version: 1,
    id: 'card-face',
    title: 'Card face',
    roadmapRepo: 'Example/plan',
    productRepo: 'Example/app',
    repos: ['Example/plan', 'Example/app'],
    files: { audit: '', flow: '', plan: '', mapping: '', sections: '' },
    lanePrefix: '',
    laneRules: [],
    ticketConventions: {
      mapLabel: 'map',
      ideaLabels: [],
      ideaPattern: '^Idea:',
      specLabels: ['spec'],
      readyLabel: 'ready',
      ticketLabels: [],
      specPattern: '^Spec:',
    },
    specDocuments: { [node.id]: [spec] },
    dependencies: [],
  };
  const work = buildWork({
    project,
    plan: parseBuildUnits(fixture('build-units.md')),
    nodes: [node],
    issues: {},
    prs: [],
    maps: {},
    specDocuments: { [spec]: { found: true, branch: 'develop', url } },
    at,
    complete: true,
    error: null,
  }).byNode[node.id];
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
      work={work}
      tickets={undefined}
      ticketFailed={false}
      now={Date.parse(at)}
    />,
  );
  const link = root.querySelector<HTMLAnchorElement>('[aria-label="spec: evidence present"] a')!;
  expect(link.href).toBe(url);
  expect(link.tabIndex).toBe(0);
  expect(link.closest('[aria-hidden="true"]')).toBeNull();
});
// #157: a section held for cut-short labels holds its own card and its stage, and no other.
it('a held section holds only its own card and stage bars', () => {
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(
    <Board
      s={snapshot}
      board={{ current: null }}
      svg={{ current: null }}
      labels={{ current: null }}
      view={{ x: 0, y: 0, scale: 1 }}
      inspected={null}
      open={null}
      related={new Set()}
      activate={() => {}}
      enter={() => {}}
      leave={() => {}}
      tip={null}
      showTip={() => {}}
      hideTip={() => {}}
      tickets={{
        ...pendingTicketProgress(),
        at,
        complete: true,
        reason: null,
        byNode: Object.fromEntries(
          ['found', 'tasks', 'fix'].map((id) => [id, ticketCounts([], true)]),
        ),
        pendingSections: ['found'],
      }}
      snapFailed={null}
      now={Date.parse(at)}
      seatGauge={null}
    />,
  );
  // 'found' is alone in the first stage.
  const stages = root.querySelectorAll('.stage');
  for (const selector of ['.ticket-bar', '.scope-bar']) {
    expect(root.querySelector(`#n-found ${selector}`)?.getAttribute('data-pending')).toBe('yes');
    expect(stages[0]?.querySelector(selector)?.getAttribute('data-pending')).toBe('yes');
    expect(root.querySelector(`#n-tasks ${selector}`)?.getAttribute('data-pending')).toBe('no');
    expect(stages[1]?.querySelector(selector)?.getAttribute('data-pending')).toBe('no');
  }
});

const space = (target: Element): boolean => {
  const e = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e.defaultPrevented;
};

it('Space on the focused card opens it, but Space on a bar segment inside does not', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const activate = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <Box
        n={node}
        stage={1}
        agents={{ open: [], last: null }}
        open={false}
        activate={activate}
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
    ),
  );
  try {
    const face = host.querySelector('.node')!;
    expect(space(face.querySelector('[data-k][tabindex="0"]')!)).toBe(false);
    expect(activate).not.toHaveBeenCalled();
    expect(space(face)).toBe(true);
    expect(activate).toHaveBeenCalledWith('keyboard');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
