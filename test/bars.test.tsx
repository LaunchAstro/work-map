// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Bar, type TipControls } from '../src/web/Bar.tsx';
import { progressBar, reviewBar } from '../src/web/bar-models.ts';
import { ticketsBar as ticketBar } from '../src/web/meters.ts';
import { cardTone } from '../src/web/interactions.ts';
import {
  pendingTicketProgress,
  ticketCounts,
  type ProgressTicket,
} from '../src/core/ticket-progress.ts';
import type { MeterData } from '../src/web/stage.ts';

const at = '2026-10-16T01:00:00Z';
const now = Date.parse(at);
const tips: TipControls = { tip: null, showTip: () => {}, hideTip: () => {} };
const ticket = (n: number, done: boolean): ProgressTicket => ({
  key: `Example/app#${n}`,
  url: `https://github.com/Example/app/issues/${n}`,
  title: `Ticket ${n}`,
  section: 'design',
  mapping: 'Repository default',
  state: done ? 'CLOSED' : 'OPEN',
  stateReason: done ? 'COMPLETED' : null,
});
const design = ticketCounts(
  Array.from({ length: 75 }, (_, i) => ticket(i + 1, i < 69)),
  true,
);
const progress = {
  ...pendingTicketProgress(),
  at,
  complete: true,
  reason: null,
  byNode: { design, empty: ticketCounts([], true) },
  totals: design,
};
const scoped: MeterData = {
  scope: {
    shares: { live: 60, merged: 20, built: 0, planned: 20 },
    display: { live: 60, merged: 20, built: 0, planned: 20 },
    estimated: false,
    pending: false,
    reason: 'Approved units',
    at: null,
  },
  review: { pct: 36, prs: [], complete: true } as unknown as MeterData['review'],
};
function render(node: React.ReactNode): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(node);
  return root;
}

describe('one bar for every source', () => {
  it('draws ticket, progress and review bars with the same frame and label markup', () => {
    const root = render(
      <>
        <Bar id="t" model={ticketBar(design, progress, false, now)} {...tips} />
        <Bar id="p" model={progressBar(scoped)} {...tips} />
        <Bar id="r" model={reviewBar(scoped)} {...tips} />
      </>,
    );
    const bars = [...root.querySelectorAll('.bar')];
    expect(bars).toHaveLength(3);
    for (const bar of bars) {
      expect(bar.querySelectorAll(':scope > span[data-tone]').length).toBeGreaterThan(0);
      expect(bar.querySelector('.bar-label')).not.toBeNull();
    }
    expect(bars[0]!.querySelector('[data-tone=completed] .bar-label')?.textContent).toBe('92%');
  });

  it('moves ticket counts into the hover words and says when nothing is mapped', () => {
    expect(ticketBar(design, progress, false, now).segments[0]!.words).toBe('69 done · 6 left');
    const empty = ticketBar(progress.byNode.empty, progress, false, now);
    expect(empty.segments.map((s) => s.words)).toEqual(['No tickets mapped']);
    expect(empty.segments[0]!.label).toBeNull();
    const root = render(<Bar id="e" model={empty} {...tips} />);
    expect(root.textContent).toBe('');
  });

  it('draws an empty review bar, not pending, for a section with no PRs yet', () => {
    const none = reviewBar({
      ...scoped,
      review: noReview(),
    });
    expect(none.pending).toBeNull();
    expect(none.segments.map((s) => s.words)).toEqual(['No PRs to review yet']);
    expect(render(<Bar id="n" model={none} {...tips} />).textContent).toBe('');
    // An incomplete read is still pending.
    const unread = reviewBar({ ...scoped, review: { ...noReview(), complete: false } });
    expect(unread.pending).toBe('Review pending');
  });

  // #242: an old complete census keeps its percentage between Syncs; a failed read is still pending.
  it('keeps an old census as its last value and shows a failed read as pending', () => {
    const old = ticketBar(design, progress, false, now + 3_600_000);
    expect(old.pending).toBeNull();
    const failed = ticketBar(design, progress, true, now);
    expect(failed.pending).toContain('census pending');
    expect(render(<Bar id="s" model={failed} {...tips} />).innerHTML).not.toContain(
      'aria-valuenow',
    );
  });

  it('calls the empty end of progress Not built, unlabelled, and drops zero segments', () => {
    const bar = progressBar(scoped);
    expect(bar.segments.map((s) => s.key)).toEqual(['live', 'merged', 'planned']);
    const rest = bar.segments.at(-1)!;
    expect(rest.label).toBeNull();
    expect(rest.words).toBe('Not built · 20%');
    expect(JSON.stringify(bar)).not.toContain('Planned');
  });

  it('holds a ticket bar with an unknown closure as pending, with no percentage', () => {
    const unknown = ticketCounts(
      [ticket(1, true), { ...ticket(2, true), stateReason: null }],
      true,
    );
    expect(unknown.pct).toBeNull();
    const root = render(<Bar id="u" model={ticketBar(unknown, progress, false, now)} {...tips} />);
    expect(root.querySelector('[role=img]')).not.toBeNull();
    expect(root.innerHTML).not.toContain('aria-valuenow');
    expect(root.querySelector('[data-k]')?.getAttribute('aria-label')).toContain(
      '1 closure unknown',
    );
  });
});

describe('one card rule on every map (#147)', () => {
  it('leaves the empty end of a ticket bar unlabelled, as on progress bars', () => {
    const half = ticketCounts([ticket(1, true), ticket(2, false)], true);
    const bar = ticketBar(half, { ...progress, byNode: { design: half } }, false, now);
    expect(bar.segments.at(-1)!.key).toBe('remaining');
    expect(bar.segments.at(-1)!.label).toBeNull();
    const none = ticketCounts([ticket(1, false), ticket(2, false)], true);
    expect(ticketBar(none, progress, false, now).segments.every((s) => s.label === null)).toBe(
      true,
    );
  });
  it('leaves the unreviewed end of a review bar unlabelled, as on progress and ticket bars', () => {
    const bar = reviewBar(scoped);
    expect(bar.segments.map((s) => [s.key, s.label])).toEqual([
      ['reviewed', 36],
      ['unreviewed', null],
    ]);
    const root = render(<Bar id="r" model={bar} {...tips} />);
    expect(root.querySelector('[data-k=unreviewed] .bar-label')).toBeNull();
  });
  it('dashes a ticket-count card with nothing done and nothing open, like a scope card', () => {
    const none = ticketCounts([ticket(1, false), ticket(2, false)], true);
    expect(cardTone({ scope: undefined, openPrs: [] } as never, none)).toBe('unstarted');
    expect(cardTone({ scope: undefined, openPrs: [{}] } as never, none)).toBe('started');
    expect(cardTone(undefined, ticketCounts([], true))).toBe('unstarted');
  });
});

describe('purple above 90% for both sources', () => {
  it('turns a ticket-count card purple past 90% completion', () => {
    expect(cardTone(undefined, design)).toBe('live90');
    expect(cardTone(undefined, ticketCounts([ticket(1, true), ticket(2, false)], true))).toBe(
      'started',
    );
  });
});

function noReview() {
  return {
    denominator: 'tracked PR code changes' as const,
    pct: null,
    reviewedLines: 0,
    totalLines: 0,
    complete: true,
    prs: [],
  };
}
