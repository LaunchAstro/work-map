// @vitest-environment jsdom
/// <reference lib="dom" />
// #225: the header counts every ticket on the map's repositories once, split by kind on hover,
// while cards keep Tickets as build work only.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import {
  pendingTicketProgress,
  ticketCensus,
  ticketCounts,
  type ProgressTicket,
  type TicketProgress,
} from '../src/core/ticket-progress.ts';
import { AllTickets } from '../src/web/TicketProgress.tsx';

const at = '2026-10-18T00:00:00Z';
let n = 0;
const ticket = (
  section: string | null,
  state: 'done' | 'open' | 'dropped' | 'absorbed-open' | 'absorbed-done',
): ProgressTicket => {
  n += 1;
  const aside = state === 'dropped' || state.startsWith('absorbed');
  return {
    key: `Example/app#${n}`,
    title: `Ticket ${n}`,
    url: `https://github.com/Example/app/issues/${n}`,
    state: state === 'open' ? 'OPEN' : 'CLOSED',
    stateReason: state === 'open' ? null : aside ? 'NOT_PLANNED' : 'COMPLETED',
    section,
    mapping: 'test',
    ...(state.startsWith('absorbed')
      ? {
          absorbedInto: 'Example/app#999',
          follows: {
            parent: 'Example/app#999',
            state: state === 'absorbed-open' ? 'OPEN' : 'CLOSED',
            stateReason: state === 'absorbed-open' ? null : 'COMPLETED',
            note: null,
          },
        }
      : {}),
  };
};
const many = (count: number, make: () => ProgressTicket): ProgressTicket[] =>
  Array.from({ length: count }, make);

const build = [
  ...many(3, () => ticket('found', 'done')),
  ...many(2, () => ticket('found', 'open')),
  ...many(4, () => ticket('found', 'absorbed-open')),
  ticket('found', 'absorbed-done'),
  ticket('found', 'dropped'),
];
const fixes = [...many(5, () => ticket('found', 'done')), ticket('found', 'open')];
const questions = [...many(2, () => ticket('found', 'done')), ticket('found', 'open')];
const unplaced = [...many(6, () => ticket(null, 'done')), ...many(3, () => ticket(null, 'open'))];
const outside = [ticket('outside', 'done'), ticket('outside', 'open')];
const progress: TicketProgress = {
  ...pendingTicketProgress(),
  at,
  complete: true,
  reason: null,
  byNode: { found: ticketCounts(build, true) },
  totals: ticketCounts(build, true),
  bugs: { byNode: { found: ticketCounts(fixes, true) }, totals: ticketCounts(fixes, true) },
  skipped: questions,
  unplaced,
  outside,
};

it('counts every ticket once: done and open on GitHub, absorbed and dropped apart', () => {
  const census = ticketCensus(progress);
  expect(census.done).toBe(3 + 5 + 2 + 6 + 1);
  expect(census.open).toBe(2 + 1 + 1 + 3 + 1);
  expect(census.absorbedOpen).toBe(4);
  expect(census.absorbedDone).toBe(1);
  expect(census.dropped).toBe(1);
  expect(census.kinds.map((k) => [k.kind, k.done, k.open])).toEqual([
    ['build', 3, 2],
    ['fixes', 5, 1],
    ['decisions', 2, 1],
    ['unplaced', 6, 3],
    ['outside', 1, 1],
  ]);
  const all = build.length + fixes.length + questions.length + unplaced.length + outside.length;
  expect(
    census.done +
      census.open +
      census.absorbedOpen +
      census.absorbedDone +
      census.dropped +
      census.unknown,
  ).toBe(all);
});

it('shows the total in the header with the split by kind on hover and focus', () => {
  const box = document.createElement('div');
  box.innerHTML = renderToStaticMarkup(
    h(AllTickets, { tickets: progress, failed: false, now: Date.parse(at) }),
  );
  const el = box.querySelector('.all-tickets')!;
  expect(el.textContent).toBe('All tickets 17 done · 8 open');
  expect(el.getAttribute('tabindex')).toBe('0');
  const tip = el.getAttribute('title')!;
  expect(tip).toContain('Build work (the cards): 3 done · 2 open');
  expect(tip).toContain('Fixes from checks: 5 done · 1 open');
  expect(tip).toContain('Decisions and questions: 2 done · 1 open');
  expect(tip).toContain('Not on the map: 6 done · 3 open');
  expect(tip).toContain('Outside the plan: 1 done · 1 open');
  expect(tip).toContain('Absorbed into open work: 4');
  expect(tip).toContain('Absorbed into done work: 1');
  expect(tip).toContain('Dropped: 1');
});

it('shows nothing while the census is pending', () => {
  const html = renderToStaticMarkup(
    h(AllTickets, { tickets: pendingTicketProgress(), failed: false, now: Date.parse(at) }),
  );
  expect(html).toBe('');
});
