// @vitest-environment jsdom
/// <reference lib="dom" />
// #232: days left = unit days × (1 − built), from the same weights as Progress.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import {
  daysLeft,
  pendingTicketProgress,
  ticketCounts,
  type ProgressTicket,
  type TicketProgress,
} from '../src/core/ticket-progress.ts';
import { AllTickets, DaysLeft } from '../src/web/TicketProgress.tsx';

const at = '2026-10-18T00:00:00Z';
let n = 0;
const ticket = (
  open: boolean,
  share?: { weight: number; built: number; live: number },
): ProgressTicket => {
  n += 1;
  return {
    key: `Example/app#${n}`,
    title: `Ticket ${n}`,
    url: `https://github.com/Example/app/issues/${n}`,
    state: open ? 'OPEN' : 'CLOSED',
    stateReason: open ? null : 'COMPLETED',
    section: 'found',
    mapping: 'test',
    ...(share ? { share: { unit: 'U1', by: null, at: null, ...share } } : {}),
  };
};
// Unit U1: 6 days over three cards, audit says 50% built. One card done.
const weighted = [
  ticket(false, { weight: 2, built: 0.5, live: 0 }),
  ticket(true, { weight: 2, built: 0.5, live: 0 }),
  ticket(true, { weight: 2, built: 0.5, live: 0 }),
];
const counted = [ticket(false), ticket(true), ticket(true)];

it('is weight minus built when tickets carry unit days, and agrees with Progress', () => {
  const c = ticketCounts(weighted, true);
  // Done card 2 days in full, two open cards half built: 4 of 6 built.
  expect(c.pct).toBeCloseTo((4 / 6) * 100);
  expect(daysLeft(c)).toBeCloseTo(2);
  expect(daysLeft(c)).toBeCloseTo(c.weight! * (1 - c.pct! / 100));
});

it('is hidden where tickets carry no unit days (a map with no units)', () => {
  expect(daysLeft(ticketCounts(counted, true))).toBeNull();
  expect(renderToStaticMarkup(h(DaysLeft, { counts: ticketCounts(counted, true) }))).toBe('');
});

it('is hidden while the ticket read is not current', () => {
  expect(daysLeft(ticketCounts(weighted, false))).toBeNull();
  expect(daysLeft(undefined)).toBeNull();
});

it('reads as whole days on the card', () => {
  const words = (left: number): string => {
    const box = document.createElement('div');
    const c = ticketCounts([ticket(true, { weight: left, built: 0, live: 0 })], true);
    box.innerHTML = renderToStaticMarkup(h(DaysLeft, { counts: c }));
    return box.textContent ?? '';
  };
  expect(words(2.4)).toBe('2 days left');
  expect(words(1)).toBe('1 day left');
  expect(words(0.3)).toBe('<1 day left');
});

it('adds the total to the header', () => {
  const progress: TicketProgress = {
    ...pendingTicketProgress(),
    at,
    complete: true,
    reason: null,
    byNode: { found: ticketCounts(weighted, true) },
    totals: ticketCounts(weighted, true),
  };
  const box = document.createElement('div');
  box.innerHTML = renderToStaticMarkup(
    h(AllTickets, { tickets: progress, failed: false, now: Date.parse(at) }),
  );
  expect(box.querySelector('.all-tickets')!.textContent).toMatch(/ · 2 days left$/u);
});
