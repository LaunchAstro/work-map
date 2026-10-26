// SPDX-License-Identifier: AGPL-3.0-only
// #147: at 100% a card is the same size on screen however many stages the map has. Runs against the
// dev server test/browser-proof-server.ts starts, in Chromium and WebKit.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, webkit, type Browser } from 'playwright';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits } from '../src/core/plan.ts';
import { reviewView } from '../src/core/coverage.ts';

const at = '2026-10-17T01:00:00Z';
const fixture = (name: string): string =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const base = buildSnapshot({
  audit: JSON.parse(fixture('audit.json')),
  flow: JSON.parse(fixture('flow.json')),
  plan: parseBuildUnits(fixture('build-units.md')),
  generatedAt: at,
});
/** One card per stage, each with invented work so its bars draw. */
function snapshot(stageCount: number) {
  const template = base.stages[0]!;
  const stages = Array.from({ length: stageCount }, (_, i) => ({
    ...template,
    index: i + 1,
    name: `Stage ${i + 1}`,
    nodes: [{ ...template.nodes[0]!, id: `section-${i + 1}`, units: [] }],
  }));
  const shares = { live: 60, merged: 20, built: 0, planned: 20 };
  return {
    ...base,
    view: { ...base.view, wires: [] },
    stages,
    work: {
      at,
      complete: true,
      error: null,
      review: reviewView([], true),
      unplacedPrs: [],
      wires: [],
      byNode: Object.fromEntries(
        stages.map((stage) => [
          stage.nodes[0]!.id,
          {
            state: 'built',
            shares,
            scope: {
              shares,
              display: shares,
              estimated: false,
              pending: false,
              reason: 'Invented',
              at,
            },
            review: reviewView([], true),
            openPrs: [],
            planning: { idea: [], map: [], tickets: [], spec: [], build: [] },
            missing: [],
            blockers: [],
          },
        ]),
      ),
    },
  };
}
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
async function measure(browser: Browser, stageCount: number) {
  const context = await browser.newContext({ viewport: { width: 1080, height: 1920 } });
  try {
    const page = await context.newPage();
    const data = snapshot(stageCount);
    await page.clock.setFixedTime(new Date(at));
    await page.route('**/data/**', (route) =>
      new URL(route.request().url()).pathname === '/data/snapshot.json'
        ? route.fulfill({ json: data })
        : route.fulfill({ status: 404, body: '{}' }),
    );
    await page.goto(process.env['WORK_MAP_TEST_URL']!);
    await page.locator('.node').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.locator('.zoom-readout').textContent()).toBe('100%');
    // Wait until the layout holds still before reading pixels.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const widths: number[] = [];
          for (let i = 0; i < 8; i++) {
            // oxlint-disable-next-line no-await-in-loop -- sample successive animation frames
            await new Promise(requestAnimationFrame);
            widths.push(document.querySelector('.node')!.getBoundingClientRect().width);
          }
          return Math.max(...widths) - Math.min(...widths);
        }),
      )
      .toBeLessThan(0.01);
    return await page
      .locator('.node')
      .first()
      .evaluate((card) => {
        const scale = card.getBoundingClientRect().width / (card as HTMLElement).offsetWidth;
        return {
          width: card.getBoundingClientRect().width,
          title: parseFloat(getComputedStyle(card.querySelector('h3')!).fontSize) * scale,
          bar: card.querySelector('.bar')!.getBoundingClientRect().height,
          gap: parseFloat(getComputedStyle(card.parentElement!).columnGap) * scale,
        };
      });
  } finally {
    await context.close();
  }
}
for (const engine of ['chromium', 'webkit'] as const)
  it(`${engine} draws a card the same size at 100% with two stages or four`, async () => {
    const browser = engine === 'chromium' ? chrome : safari;
    const two = await measure(browser, 2);
    const four = await measure(browser, 4);
    for (const key of ['width', 'title', 'bar', 'gap'] as const)
      expect(Math.abs(two[key] - four[key]), key).toBeLessThanOrEqual(0.5);
  }, 20_000);
