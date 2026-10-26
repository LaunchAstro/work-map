// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { TicketDetails } from '../src/web/TicketProgress.tsx';
import { Bar } from '../src/web/Bar.tsx';
import { ticketsBar as ticketBar } from '../src/web/meters.ts';
import {
  currentTicketProgress,
  pendingTicketProgress,
  selectedTicketCounts,
  ticketCounts,
  type ProgressTicket,
  type TicketProgress,
} from '../src/core/ticket-progress.ts';
import { ticketSyncOutcome } from '../src/web/ticket-sync.ts';
import { syncEvidence } from '../src/cli/map-sync.ts';
const at = '2026-10-16T01:00:00Z';
const now = Date.parse(at);
const done: ProgressTicket = {
  key: 'Example/app#1',
  url: 'https://github.com/Example/app/issues/1',
  title: 'Spec',
  section: 'small',
  mapping: 'Project override',
  state: 'CLOSED',
  stateReason: 'COMPLETED',
};
const open = {
  ...done,
  key: 'Example/app#2',
  url: 'https://github.com/Example/app/issues/2',
  section: 'large',
  state: 'OPEN',
  stateReason: null,
};
const counts = ticketCounts([done, open], true);
const progress: TicketProgress = {
  ...pendingTicketProgress(),
  at,
  complete: true,
  reason: null,
  byNode: {
    small: ticketCounts([done], true),
    large: ticketCounts([open], true),
    empty: ticketCounts([], true),
  },
  totals: counts,
};
it('shows exact ticket links, numerator, denominator, mapping and a separate two-state bar', () => {
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(
    <>
      <Bar
        id="t"
        model={ticketBar(counts, progress, false, now)}
        tip={null}
        showTip={() => {}}
        hideTip={() => {}}
      />
      <TicketDetails counts={counts} progress={progress} failed={false} now={now} />
    </>,
  );
  expect(root.textContent).toContain('1/2 completed');
  expect(root.textContent).toContain('Completed1');
  expect(root.textContent).toContain('All mapped tickets2');
  expect(root.textContent).toContain('Project override');
  expect(root.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('50');
  expect(root.querySelectorAll('.ticket-bar > [data-k]')).toHaveLength(2);
  expect([...root.querySelectorAll('a')].map((a) => a.href)).toContain(done.url);
  expect(root.textContent).toContain('does not establish reviewed, merged, deployed or live scope');
});
// #242: an old complete read keeps its percentage between Syncs; failed and future reads are pending.
it('hides current percentages on failed and future reads and makes empty sections explicit', () => {
  expect(
    renderToStaticMarkup(
      <Bar
        id="t"
        model={ticketBar(counts, progress, false, now + 600_001)}
        tip={null}
        showTip={() => {}}
        hideTip={() => {}}
      />,
    ),
  ).toContain('aria-valuenow');
  for (const [time, failed] of [
    [now, true],
    [now - 1, false],
  ] as const) {
    const html = renderToStaticMarkup(
      <Bar
        id="t"
        model={ticketBar(counts, progress, failed, time)}
        tip={null}
        showTip={() => {}}
        hideTip={() => {}}
      />,
    );
    expect(html).not.toContain('aria-valuenow');
    expect(html).toContain('census pending');
  }
  const html = renderToStaticMarkup(
    <Bar
      id="t"
      model={ticketBar(progress.byNode['empty'], progress, false, now)}
      tip={null}
      showTip={() => {}}
      hideTip={() => {}}
    />,
  );
  expect(html).toContain('No tickets mapped');
  expect(html).not.toContain('aria-valuenow');
});
it('aggregates unique counts across unequal and empty sections and refuses inconsistent public projections', () => {
  expect(selectedTicketCounts(progress, ['small', 'small', 'large', 'empty']).pct).toBe(50);
  expect(currentTicketProgress(progress)).not.toBeNull();
  expect(currentTicketProgress({ ...progress, totals: { ...counts, completed: 2 } })).toBeNull();
  expect(
    currentTicketProgress({
      ...progress,
      byNode: { ...progress.byNode, other: progress.byNode['small'] },
    }),
  ).toBeNull();
  expect(currentTicketProgress(progress, ['small'])).toBeNull();
});
it('checks whole and selected section Sync against refreshed issue evidence', () => {
  expect(ticketSyncOutcome({ ticketProgress: progress }, null, at, now)).toMatchObject({
    status: 'complete',
    message: 'Ticket census · 1/2 completed',
  });
  expect(ticketSyncOutcome({ ticketProgress: progress }, 'small', at, now).message).toContain(
    'Shared ticket census refreshed; selected section · 1/1',
  );
  expect(ticketSyncOutcome({ ticketProgress: progress }, 'empty', at, now).message).toContain(
    'No mapped tickets',
  );
  for (const [p, section, since] of [
    [progress, 'missing', at],
    [progress, 'small', '2026-10-16T01:00:01Z'],
    [{ ...progress, complete: false }, null, at],
    [undefined, null, at],
  ] as const)
    expect(ticketSyncOutcome({ ticketProgress: p }, section, since, now).status).toBe('paused');
});
it('server Sync refuses a missing or stale ticket census independently of collector exit', () => {
  const stamp = new Date().toISOString();
  const start = Date.parse(stamp);
  const snapshot = {
    schema: 'work-map/4',
    id: 'fixture',
    stages: [],
    prs: {},
    generatedAt: stamp,
    sources: { github: { lastRun: { at: stamp, partial: false } } },
    work: { at: stamp, complete: true },
    progressBasis: 'ticket-count',
  };
  const agents = {
    schema: 'work-map-agents/2',
    lanes: [],
    generatedAt: stamp,
    herdr: { ok: true },
  };
  expect(syncEvidence(snapshot, agents, start, start).status).toBe('incomplete');
  expect(
    syncEvidence({ ...snapshot, ticketProgress: { ...progress, at: stamp } }, agents, start, start)
      .status,
  ).toBe('complete');
  expect(syncEvidence({ ...snapshot, ticketProgress: progress }, agents, start, start).status).toBe(
    'incomplete',
  );
});

it('acknowledges fresh ticket evidence while separately reporting incomplete PR and planning sources', () => {
  for (const section of [null, 'small']) {
    const outcome = ticketSyncOutcome({ ticketProgress: progress }, section, at, now, [
      'Planning read is incomplete',
    ]);
    expect(outcome.status).toBe('paused');
    expect(outcome.message).toContain(
      section === null
        ? 'Ticket census · 1/2 completed'
        : 'Shared ticket census refreshed; selected section · 1/1 completed',
    );
    expect(outcome.message).toContain('Other sources pending · Planning read is incomplete');
  }
});
it('details list a scope’s bugs as fixed out of found, and the questions left out (#88)', () => {
  const bug = { ...open, key: 'Example/app#3', url: 'https://github.com/Example/app/issues/3' };
  const question = {
    ...done,
    key: 'Example/app#4',
    url: 'https://github.com/Example/app/issues/4',
  };
  const bugs = ticketCounts([bug], true);
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(
    <TicketDetails
      counts={counts}
      bugs={bugs}
      questions={[question]}
      progress={{ ...progress, skipped: [question] }}
      failed={false}
      now={now}
    />,
  );
  expect(root.textContent).toContain('Bugs1');
  expect(root.textContent).toContain('0/1 fixed');
  expect(root.textContent).toContain('Questions left out1');
  expect([...root.querySelectorAll('a')].map((a) => a.href)).toContain(question.url);
  expect(root.textContent).toContain('0 not on the map');
});
it('a section held for cut-short labels shows its bar pending, not an empty bar (#157)', () => {
  const held = ticketCounts([done, open], false);
  const bar = ticketBar(held, { ...progress, pendingSections: ['large'] }, false, now);
  expect(bar.pending).not.toBeNull();
  expect(bar.meter).toBeNull();
});
it('Sync stays paused while a section is held for cut-short labels, and says why (#157)', () => {
  const held: TicketProgress = {
    ...progress,
    byNode: { ...progress.byNode, large: ticketCounts([open], false) },
    totals: ticketCounts([done, open], false),
    pendingSections: ['large'],
  };
  for (const section of ['large', null])
    expect(ticketSyncOutcome({ ticketProgress: held }, section, at, now).status).toBe('paused');
  const warned = ticketSyncOutcome({ ticketProgress: held }, 'large', at, now, [
    'Planning read is incomplete',
  ]);
  expect(warned.message).toContain('Ticket completion pending');
  expect(ticketSyncOutcome({ ticketProgress: held }, 'small', at, now).status).toBe('complete');
});
// #189: absorbed and dropped tickets are named beside every completed fraction.
const absorbedTicket: ProgressTicket = {
  ...done,
  key: 'Example/app#5',
  url: 'https://github.com/Example/app/issues/5',
  stateReason: 'NOT_PLANNED',
  absorbedInto: 'Example/app#1',
  follows: { parent: 'Example/app#1', state: 'CLOSED', stateReason: 'COMPLETED', note: null },
};
const droppedTicket: ProgressTicket = {
  ...done,
  key: 'Example/app#6',
  url: 'https://github.com/Example/app/issues/6',
  stateReason: 'NOT_PLANNED',
  absorbedInto: null,
  follows: null,
};
it('the Bugs details name absorbed and dropped bugs (#189)', () => {
  const bugs = ticketCounts([open, absorbedTicket, droppedTicket], true);
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(
    <TicketDetails counts={counts} bugs={bugs} progress={progress} failed={false} now={now} />,
  );
  expect(root.textContent).toContain('1/2 fixed · 1 absorbed · 1 dropped');
});
it('a ticket Sync names absorbed and dropped tickets beside the completed fraction (#189)', () => {
  const small = ticketCounts([done, absorbedTicket, droppedTicket], true);
  const p = {
    ...progress,
    byNode: { ...progress.byNode, small },
    totals: ticketCounts([done, absorbedTicket, droppedTicket, open], true),
  };
  expect(ticketSyncOutcome({ ticketProgress: p }, null, at, now).message).toBe(
    'Ticket census · 2/3 completed · 1 absorbed · 1 dropped',
  );
  expect(ticketSyncOutcome({ ticketProgress: p }, 'small', at, now).message).toBe(
    'Shared ticket census refreshed; selected section · 2/2 completed · 1 absorbed · 1 dropped',
  );
});
