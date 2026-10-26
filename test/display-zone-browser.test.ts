// The screen shows times in the zone and locale the map's snapshot names, not the viewer's own.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, webkit, type Browser } from 'playwright';

// 1 pm UTC: 2 pm in London, 6 am in Los Angeles, 11 pm at UTC+10.
const at = '2026-10-17T13:00:00Z';
const measures = {
  days: 0,
  coded: { pct: 0, low: 0, high: 0 },
  on: { pct: 0, switchOnsClosed: 0, switchOnsOpen: 0 },
  estimate: { pct: 0, source: 'audit', at: null, reason: '' },
  reviewed: {},
  sinceAudit: { merged: 0, prs: [] },
  inferredPrs: 0,
};
const snapshot = (display?: unknown) => ({
  schema: 'work-map/4',
  id: 'zone',
  type: 'map',
  title: 'Zone map',
  generatedAt: at,
  ...(display ? { display } : {}),
  destination: { id: 'end', text: '' },
  sources: {
    audit: { asAt: at, at, exactTime: true, file: '' },
    plan: { file: '', boxes: '', commit: null },
    github: null,
    mapping: { file: '', approvedPrs: 0, pendingPrs: 0, approvedSwitchOns: 0, pendingSwitchOns: 0 },
  },
  totals: {
    ...measures,
    units: 0,
    prs: { merged: 0, mapped: 0, outside: 0, unmapped: 0, sinceAudit: 0 },
  },
  stages: [
    {
      ...measures,
      index: 1,
      name: 'Stage 1',
      nodes: [
        {
          ...measures,
          id: 'one',
          title: 'Section one',
          text: 'Example section text.',
          repo: '',
          row: 1,
          status: 'planned',
          units: [],
        },
      ],
    },
  ],
  prs: {},
  switchOns: [],
  frontier: [],
  fog: [],
  unmapped: { count: 0, prs: [], switchOns: [] },
  view: { title: '', lede: '', overallNote: '', footnote: '', steps: [], wires: [] },
  stats: { at, queued: null },
  sweep: { inferred: 0, byVia: {}, estimates: 0, gaps: null },
  warnings: [],
});

let browsers: Browser[] = [];
beforeAll(async () => {
  browsers = [await chromium.launch(), await webkit.launch()];
});
afterAll(async () => {
  await Promise.all(browsers.map((browser) => browser.close()));
});

async function updated(browser: Browser, display?: unknown): Promise<string> {
  const page = await browser.newPage({ timezoneId: 'America/Los_Angeles', locale: 'en-US' });
  try {
    await page.route('**/data/**', (route) =>
      new URL(route.request().url()).pathname === '/data/snapshot.json'
        ? route.fulfill({ json: snapshot(display) })
        : route.fulfill({ status: 404, body: '{}' }),
    );
    await page.goto(process.env['WORK_MAP_TEST_URL']!);
    const shown = page.locator('.updated').filter({ hasText: 'Oct' });
    await shown.waitFor();
    return (await shown.textContent()) ?? '';
  } finally {
    await page.close();
  }
}

it("shows the snapshot's zone and locale to a viewer in another zone", async () => {
  const texts = await Promise.all(
    browsers.map((browser) => updated(browser, { timeZone: 'Europe/London', locale: 'en-GB' })),
  );
  // WebKit joins the day and time with "at", Chromium with a comma.
  for (const text of texts) expect(text).toMatch(/17 Oct(,| at) 14:00/);
});

it('shows UTC+10 in Australian English when the snapshot names no zone', async () => {
  const texts = await Promise.all(browsers.map((browser) => updated(browser)));
  for (const text of texts) expect(text).toMatch(/17 Oct(,| at) 11:00 pm/);
});
