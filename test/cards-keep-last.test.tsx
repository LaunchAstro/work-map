// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only
// #242: between Syncs the cards and the merge panel show their last good values with their age; pending
// only for evidence never read.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import {
  pendingTicketProgress,
  ticketCounts,
  ticketProgressCurrent,
  type TicketProgress,
} from '../src/core/ticket-progress.ts';
import { readOnce } from '../src/core/freshness.ts';
import { githubMetricsShown } from '../src/web/github-freshness.ts';
import { cardAge } from '../src/web/card-age.ts';
import { Overview } from '../src/web/Overview.tsx';

const at = '2026-10-19T00:00:00Z';
const now = Date.parse(at);
const hours = (n: number): number => now + n * 3_600_000;
const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

it('an old complete card read is shown, with its age; only a never-read card is pending', () => {
  const progress: TicketProgress = {
    ...pendingTicketProgress(),
    at,
    complete: true,
    reason: null,
    byNode: { found: ticketCounts([], true) },
    totals: ticketCounts([], true),
  };
  expect(ticketProgressCurrent(progress, hours(5))).toBe(true);
  expect(ticketProgressCurrent(pendingTicketProgress(), hours(5))).toBe(false);
  expect(readOnce(at, hours(5))).toBe(true);
  expect(readOnce(null, hours(5))).toBe(false);
  expect(cardAge({ at }, hours(2))).toEqual({
    words: 'cards 2 hours ago',
    detail: expect.stringContaining('Cards read'),
    failed: false,
  });
  expect(cardAge({ at: '' }, now)?.words).toBe('cards not read yet');
});

it('a failed card read keeps the last values and says so', () => {
  const age = cardAge(
    { at, lastFailure: { at: new Date(hours(1)).toISOString(), error: 'GitHub reserve reached' } },
    hours(1),
  );
  expect(age?.words).toBe('cards 1 hour ago · last card read failed');
  expect(age?.detail).toContain('GitHub reserve reached');
  expect(
    cardAge({ at: new Date(hours(2)).toISOString(), lastFailure: { at, error: 'x' } }, hours(2))
      ?.failed,
  ).toBe(false);
});

it('a skipped merge read keeps the last good merge figures, labelled with their time', () => {
  const good = new Date(hours(-1)).toISOString();
  const skipped = { at, skipped: 'rate limit: graphql has 1200 left, under 1500', partial: false };
  expect(githubMetricsShown(skipped, false, good, now)).toBe(true);
  // Never read: the only run was skipped, so its time is the figures' time.
  expect(githubMetricsShown(skipped, false, at, now)).toBe(false);
  expect(githubMetricsShown(skipped, true, good, now)).toBe(false);

  const snapshot = buildSnapshot({
    audit: JSON.parse(fixture('audit.json')) as Audit,
    flow: JSON.parse(fixture('flow.json')) as Flow,
    plan: parseBuildUnits(fixture('build-units.md')),
    generatedAt: at,
    github: { repo: 'Demo/product', prsThrough: null, issuesThrough: null, lastRun: skipped },
    openState: { at: good, queued: 2 },
  });
  const html = renderToStaticMarkup(
    <Overview
      s={snapshot}
      tickets={undefined}
      snapFailed={null}
      now={now}
      statsTab="merges"
      setStatsTab={() => {}}
      setTip={() => {}}
      tip={null}
      showTip={() => {}}
      hideTip={() => {}}
      showUnmapped={false}
      setShowUnmapped={() => {}}
    />,
  );
  expect(html).not.toContain('pending a fresh complete GitHub read');
  expect(html).toContain('Merges as of');
  expect(html).toContain('1 hour ago');
  expect(html).toMatch(/Queued<\/span><span class="big">2</);
});
