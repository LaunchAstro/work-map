// SPDX-License-Identifier: AGPL-3.0-only
// #97: every bar's frame is a real 1px border, which browsers snap to whole pixels at any zoom; an
// inset shadow is not. The map camera zooms the canvas with CSS zoom (Board.tsx), often fractionally.
/* oxlint-disable no-await-in-loop -- each zoom is measured after the previous one is applied. */
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, webkit, type Browser } from 'playwright';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { reviewView, type ReviewPr, type ScopeView } from '../src/core/coverage.ts';
import type { SectionWork } from '../src/core/work.ts';
import { parseBuildUnits } from '../src/core/plan.ts';
import { pendingTicketProgress, ticketCounts } from '../src/core/ticket-progress.ts';
import { Bar, type TipControls } from '../src/web/Bar.tsx';
import { progressBar, reviewBar } from '../src/web/bar-models.ts';
import type { MeterData } from '../src/web/stage.ts';

const shares = { live: 60, merged: 20, built: 0, planned: 20 };
const work: MeterData = {
  scope: {
    shares,
    display: shares,
    estimated: false,
    pending: false,
    reason: 'Invented scope',
    at: null,
  },
  review: { pct: 36, prs: [], complete: true } as unknown as MeterData['review'],
};
const tips: TipControls = { tip: null, showTip: () => {}, hideTip: () => {} };
const markup = renderToStaticMarkup(
  <>
    <Bar id="p" model={progressBar(work)} {...tips} />
    <Bar id="r" model={reviewBar(work)} {...tips} />
  </>,
);
const css = readFileSync(new URL('../src/web/bar.css', import.meta.url), 'utf8');
let chrome: Browser;
let safari: Browser;
beforeAll(async () => {
  chrome = await chromium.launch();
  safari = await webkit.launch();
});
afterAll(async () => {
  await chrome?.close();
  await safari?.close();
});

for (const engine of ['chromium', 'webkit'] as const) {
  it(`${engine} frames bars with solid 1px borders and no shadow at fractional zoom`, async () => {
    const page = await (engine === 'chromium' ? chrome : safari).newPage();
    try {
      await page.setContent(
        `<style>*{box-sizing:border-box}:root{--ink:#000;--paper:#fff;--rule:#aaa;--accent:#745cee;--on-accent:#fff;--font-mono:monospace}${css}</style><div class="app"><div class="canvas" style="width:500px">${markup}</div></div>`,
      );
      for (const zoom of [1, 0.868, 1.02]) {
        await page.locator('.canvas').evaluate((el, z) => {
          (el as HTMLElement).style.zoom = String(z);
        }, zoom);
        const frames = await page.locator('.bar').evaluateAll((bars) =>
          bars.map((bar) => {
            const style = getComputedStyle(bar);
            return {
              widths: [
                style.borderTopWidth,
                style.borderRightWidth,
                style.borderBottomWidth,
                style.borderLeftWidth,
              ].map(parseFloat),
              style: style.borderTopStyle,
              shadow: style.boxShadow,
              overlay: getComputedStyle(bar, '::after').boxShadow,
            };
          }),
        );
        expect(frames).toHaveLength(2);
        for (const frame of frames) {
          // Chromium reports the zoomed border in unzoomed CSS pixels; WebKit reports 1.
          expect(frame.widths[0]).toBeCloseTo(engine === 'webkit' ? 1 : 1 / zoom, 4);
          expect(new Set(frame.widths).size).toBe(1);
          expect(frame).toMatchObject({ style: 'solid', shadow: 'none', overlay: 'none' });
        }
      }
    } finally {
      await page.close();
    }
  });
}

// "Hide percentages" (Header.tsx) hides every bar label on the map, however wide; a second press
// shows them again. The snapshot gives every bar kind visible labels first: Progress and Tickets
// from ticket counts, Review from each section's reviewed PR lines.
const base = buildSnapshot({
  audit: JSON.parse(readFileSync(new URL('fixtures/audit.json', import.meta.url), 'utf8')),
  flow: JSON.parse(readFileSync(new URL('fixtures/flow.json', import.meta.url), 'utf8')),
  plan: parseBuildUnits(readFileSync(new URL('fixtures/build-units.md', import.meta.url), 'utf8')),
  generatedAt: new Date().toISOString(),
});
// Three of four tickets done in 'found', so its Tickets bar carries labels.
const counts = ticketCounts(
  Array.from({ length: 4 }, (_, i) => ({
    key: `Example/app#${i + 1}`,
    url: `https://github.com/Example/app/issues/${i + 1}`,
    title: `Ticket ${i + 1}`,
    section: 'found',
    mapping: 'Repository default',
    state: i < 3 ? 'CLOSED' : 'OPEN',
    stateReason: i < 3 ? 'COMPLETED' : null,
  })),
  true,
);
const nodeIds = base.stages.flatMap((stage) => stage.nodes.map((node) => node.id));
// Each section has one reviewed PR of 40 lines and one unreviewed of 60: Review reads 40%.
const reviewPrs = (id: string): ReviewPr[] =>
  (['reviewed', 'unreviewed'] as const).map((review, i) => ({
    key: `Example/app#${id}-${i}`,
    title: `${id} PR ${i}`,
    url: `https://github.com/Example/app/pull/${i + 100}`,
    state: 'MERGED',
    review,
    marked: false,
    receiptUrl: null,
    reason: review,
    labels: [],
    changedLines: review === 'reviewed' ? 40 : 60,
  }));
const sectionShares = { live: 50, merged: 0, built: 0, planned: 50 };
const sectionScope: ScopeView = {
  shares: sectionShares,
  display: sectionShares,
  estimated: false,
  pending: false,
  reason: 'Invented scope',
  at: null,
};
const sectionWork = (id: string): SectionWork => ({
  state: 'live',
  shares: sectionShares,
  scope: sectionScope,
  review: reviewView(reviewPrs(id), true),
  openPrs: [],
  planning: { idea: [], map: [], spec: [], build: [], tickets: [] },
  missing: [],
  blockers: [],
});
const snapshot = {
  ...base,
  progressBasis: 'ticket-count',
  ticketProgress: {
    ...pendingTicketProgress(),
    at: base.generatedAt,
    complete: true,
    reason: null,
    byNode: Object.fromEntries(
      nodeIds.map((id) => [id, id === 'found' ? counts : ticketCounts([], true)]),
    ),
    totals: counts,
  },
  work: {
    at: base.generatedAt,
    complete: true,
    error: null,
    byNode: Object.fromEntries(nodeIds.map((id) => [id, sectionWork(id)])),
    review: reviewView(nodeIds.flatMap(reviewPrs), true),
    unplacedPrs: [],
    wires: [],
  },
};
const KINDS = { progress: '.scope-bar', tickets: '.ticket-bar', review: '.review-bar' } as const;
for (const engine of ['chromium', 'webkit'] as const) {
  it(`${engine} hides every bar label with Hide percentages and shows them with Show percentages`, async () => {
    const page = await (engine === 'chromium' ? chrome : safari).newPage({
      viewport: { width: 1080, height: 1920 },
    });
    try {
      await page.route('**/data/**', (route) =>
        new URL(route.request().url()).pathname === '/data/snapshot.json'
          ? route.fulfill({ json: snapshot })
          : route.fulfill({ status: 404, body: '{}' }),
      );
      await page.goto(process.env['WORK_MAP_TEST_URL']!);
      await page.locator('.node .bar-label').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      // Visible labels on the whole map and per bar kind, read from the page's own computed style.
      const count = () =>
        page.evaluate(
          (kinds) => {
            const tally = (visibleOnly: boolean) =>
              Object.fromEntries(
                Object.entries(kinds).map(([kind, bar]) => [
                  kind,
                  [...document.querySelectorAll(`${bar} .bar-label`)].filter(
                    (el) => !visibleOnly || getComputedStyle(el).display !== 'none',
                  ).length,
                ]),
              );
            return { all: tally(false), shown: tally(true) };
          },
          { map: '', ...KINDS },
        );
      const shown = async () => (await count()).shown;
      const before = await count();
      for (const kind of Object.keys(KINDS)) expect(before.all[kind], kind).toBeGreaterThan(0);
      // Before the press every label shows, on every bar kind and anywhere else on the map.
      expect(before.shown).toEqual(before.all);
      await page.getByRole('button', { name: 'Hide percentages', exact: true }).click();
      expect(await shown()).toEqual({ map: 0, progress: 0, tickets: 0, review: 0 });
      await page.getByRole('button', { name: 'Show percentages', exact: true }).click();
      expect(await shown()).toEqual(before.all);
    } finally {
      await page.close();
    }
  });
}
