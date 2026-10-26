/* oxlint-disable no-await-in-loop -- each isolated project view opens and closes its dialogs in order. */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, webkit, type Browser, type Route } from 'playwright';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits } from '../src/core/plan.ts';
import { pendingTicketProgress } from '../src/core/ticket-progress.ts';
import type { SeatGaugeReport } from '../src/core/seat-gauge.ts';

const at = '2026-10-17T01:00:00Z';
const fixture = (name: string): string =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const base = buildSnapshot({
  audit: JSON.parse(fixture('audit.json')),
  flow: JSON.parse(fixture('flow.json')),
  plan: parseBuildUnits(fixture('build-units.md')),
  generatedAt: at,
});
const report: SeatGaugeReport = {
  schema: 'work-map-seat-gauge/1',
  project: base.id,
  at,
  readAt: at,
  githubAt: at,
  state: 'current',
  reason: 'Invented session publication',
  unmapped: 3,
  sessions: [
    {
      id: JSON.stringify(['machine', 'session']),
      repository: 'Example/product',
      section: base.stages[0]!.nodes[0]!.id,
      prs: ['Example/product#2'],
      tickets: ['Example/product#1'],
      elapsedSeconds: 60,
      state: 'current',
      reason: 'Current observation',
      source: {
        machine: 'machine',
        session_id: 'session',
        workspace: 'One session',
        pane: '',
        tool: 'codex',
        model: null,
        effort: null,
        repo: 'Example/product',
        section: base.stages[0]!.nodes[0]!.id,
        seat: null,
        branch: 'work',
        started_at: '2026-10-17T00:59:00Z',
        closed_at: null,
        status: 'working',
        as_of: at,
        stale: false,
        tokens: {
          responses: 1,
          input: 111,
          output: 222,
          thinking: 22,
          cacheRead: 333,
          cacheWrite5m: 444,
          cacheWrite1h: 555,
        },
        usd: 0.1234,
      },
    },
  ],
};
const versions = {
  schema: 'work-map-versions/1',
  repo: 'Example/product',
  checkedAt: at,
  main: 'a'.repeat(40),
  sites: [
    {
      name: 'Preview site',
      origin: 'https://example.test',
      buildUrl: 'https://example.test/build.json',
      state: 'current',
      build: 'a'.repeat(12),
      sha: 'a'.repeat(40),
      merges: 2,
      reason: 'Verified',
      lastKnown: null,
    },
  ],
};
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
  it(`${engine} keeps header controls on one row and uses the loading bay callout for sessions and versions`, async () => {
    const browser = engine === 'chromium' ? chrome : safari;
    const measurements = [];
    for (const hasVersions of [true, false]) {
      const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
      try {
        await page.clock.setFixedTime(new Date(at));
        await page.route('**/data/**', (route) => {
          const name = new URL(route.request().url()).pathname.split('/').at(-1);
          const data =
            name === 'snapshot.json'
              ? {
                  ...base,
                  progressBasis: 'ticket-count',
                  ticketProgress: pendingTicketProgress(),
                  loadingBay: {
                    schema: 'work-map-loading-bay/1',
                    githubAt: at,
                    readyLabel: null,
                    complete: true,
                    reason: null,
                    prs: [],
                  },
                }
              : name === 'agents.json'
                ? {
                    schema: 'work-map-agents/2',
                    generatedAt: at,
                    herdr: { ok: false },
                    lanes: [],
                    byNode: {},
                    fog: [],
                    seatGauge: report,
                  }
                : name === 'versions.json' && hasVersions
                  ? versions
                  : null;
          return data ? route.fulfill({ json: data }) : route.fulfill({ status: 404, body: '{}' });
        });
        await page.goto(process.env['WORK_MAP_TEST_URL']!);
        await page.getByRole('button', { name: 'Loading bay', exact: true }).waitFor();
        expect(await page.getByRole('button', { name: 'Seat Gauge', exact: true }).count()).toBe(1);
        expect(await page.getByRole('button', { name: 'Site versions', exact: true }).count()).toBe(
          hasVersions ? 1 : 0,
        );
        measurements.push(
          await page.evaluate(() => {
            const buttons = [...document.querySelectorAll('.header-button')];
            return {
              height: document.querySelector('header')!.getBoundingClientRect().height,
              boardTop: document.querySelector('.viewport')!.getBoundingClientRect().top,
              labels: buttons.map((el) => el.textContent),
              tops: buttons.map((el) => el.getBoundingClientRect().top),
            };
          }),
        );
        for (const theme of ['light', 'dark']) {
          if (theme === 'dark')
            await page
              .getByRole('button', { name: 'Switch to dark theme', exact: true })
              .click({ timeout: 1500 });
          const widths = [];
          for (const name of [
            'Loading bay',
            'Seat Gauge',
            ...(hasVersions ? ['Site versions'] : []),
          ]) {
            await page.getByRole('button', { name, exact: true }).click({ timeout: 1500 });
            const dialog = page.getByRole('dialog');
            widths.push(await dialog.evaluate((el) => el.getBoundingClientRect().width));
            expect(await dialog.getByRole('button', { name: /Close/ }).count()).toBe(1);
            expect(await dialog.locator('.brief-date').count()).toBe(1);
            if (name === 'Seat Gauge') {
              expect(await dialog.textContent()).toContain('Qualified agents working');
              await dialog
                .locator('.brief-group > summary')
                .filter({ hasText: 'One session' })
                .click({ timeout: 1500 });
              expect(await dialog.textContent()).toContain('list-price USD 0.1234');
              expect(await dialog.textContent()).toContain('3 unmapped sessions');
            }
            if (name === 'Site versions') {
              await dialog
                .locator('.brief-group > summary')
                .filter({ hasText: 'Preview site' })
                .click({ timeout: 1500 });
              expect(await dialog.textContent()).toContain('2 merges not live');
            }
            await page.keyboard.press('Escape');
          }
          expect(new Set(widths).size).toBe(1);
        }
        expect(await page.locator('.strip').textContent()).not.toContain('Seat Gauge pending');
        expect(new Set(measurements.at(-1)!.tops).size).toBe(1);
        expect(measurements.at(-1)!.labels).toEqual([
          'Tickets',
          'Seat Gauge',
          'Loading bay',
          ...(hasVersions ? ['Site versions'] : []),
        ]);
      } finally {
        await page.close();
      }
    }
    expect(measurements[0]!.height).toBe(measurements[1]!.height);
    expect(measurements[0]!.boardTop).toBe(measurements[1]!.boardTop);
  }, 20_000);
}

it('keeps a header callout under its button as the header grows, and inside a short window', async () => {
  const page = await chrome.newPage({ viewport: { width: 1080, height: 1920 } });
  try {
    await page.clock.setFixedTime(new Date(at));
    await page.route('**/data/**', (route) =>
      new URL(route.request().url()).pathname === '/data/snapshot.json'
        ? route.fulfill({
            json: {
              ...base,
              loadingBay: {
                schema: 'work-map-loading-bay/1',
                githubAt: at,
                readyLabel: null,
                complete: true,
                reason: null,
                prs: [],
              },
            },
          })
        : route.fulfill({ status: 404, body: '{}' }),
    );
    await page.goto(process.env['WORK_MAP_TEST_URL']!);
    const button = page.getByRole('button', { name: 'Loading bay', exact: true });
    await button.click();
    // Let fonts and the first data settle: either can resize the button and move the callout alone.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const below = async () => (await button.boundingBox())!;
    const callout = async () => (await page.getByRole('dialog').boundingBox())!;
    const first = await below();
    expect((await callout()).y).toBe(first.y + first.height + 8);
    // Content above the button grows while the callout is open: the button moves down, the window does not change.
    await page.locator('header').evaluate((header) => {
      const added = document.createElement('div');
      added.style.height = '60px';
      header.prepend(added);
    });
    await expect.poll(async () => (await below()).y).toBeGreaterThan(first.y);
    const moved = await below();
    await expect.poll(async () => (await callout()).y).toBe(moved.y + moved.height + 8);
    // A window that only just shows the button keeps the whole callout inside it.
    const height = Math.ceil(moved.y + moved.height) + 20;
    await page.setViewportSize({ width: 1080, height });
    await expect
      .poll(async () => {
        const box = await callout();
        return box.y + box.height;
      })
      .toBeLessThanOrEqual(height - 12);
  } finally {
    await page.close();
  }
}, 20_000);

// The map picker switches maps in this window (#168): a click on a map's link, not the address.
const maps = [
  { id: 'alpha', title: 'Alpha work map', url: 'http://127.0.0.1:12101/' },
  { id: 'beta', title: 'Beta work map', url: 'http://127.0.0.1:12102/' },
];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}
async function openMaps(options: {
  betaRead?: () => Promise<void>;
  sync?: (route: Route) => Promise<void>;
}) {
  const page = await chrome.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.clock.setFixedTime(new Date(at));
  const reads: string[] = [];
  await page.route('**/data/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const beta = path.startsWith('/m/beta/');
    if (path.endsWith('/snapshot.json')) {
      reads.push(path);
      if (beta) await options.betaRead?.();
      await route.fulfill({
        json: { ...base, id: beta ? 'beta' : 'alpha', title: beta ? 'Beta' : 'Alpha' },
      });
    } else if (path === '/data/maps.json') await route.fulfill({ json: maps });
    else if (path === '/data/versions.json') await route.fulfill({ json: versions });
    else await route.fulfill({ status: 404, body: '{}' });
  });
  if (options.sync) await page.route('**/sync', options.sync);
  await page.goto(process.env['WORK_MAP_TEST_URL']!);
  await page.locator('.node').first().waitFor();
  const selected = () => page.locator('.map-links [aria-current=page]').getAttribute('href');
  await expect.poll(selected).toBe('?map=alpha');
  const pick = (id: string) => page.locator(`.map-links a[href="?map=${id}"]`).click();
  return { page, reads, selected, pick };
}
it('a map picked with no versions file never shows the previous map’s site versions', async () => {
  const { page, selected, pick } = await openMaps({});
  try {
    await page.getByRole('button', { name: 'Site versions', exact: true }).click();
    expect(await page.getByRole('dialog').textContent()).toContain('Preview site');
    await page.keyboard.press('Escape');
    await pick('beta');
    await expect.poll(selected).toBe('?map=beta');
    await expect.poll(() => page.locator('header h1').textContent()).toBe('Beta');
    expect(new URL(page.url()).search).toBe('?map=beta');
    const button = page.getByRole('button', { name: 'Site versions', exact: true });
    if (await button.count()) await button.click();
    expect(await page.locator('body').textContent()).not.toContain('Preview site');
  } finally {
    await page.close();
  }
}, 20_000);
it('a second pick back to the shown map cancels a switch still loading', async () => {
  let betaReads = 0;
  const release = deferred();
  const { page, selected, pick } = await openMaps({
    betaRead: () => {
      betaReads++;
      return release.promise;
    },
  });
  try {
    await pick('beta');
    await expect.poll(() => betaReads).toBe(1);
    await pick('alpha');
    const answered = page.waitForResponse((r) => r.url().endsWith('/m/beta/data/snapshot.json'));
    release.resolve();
    await answered;
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    expect(new URL(page.url()).search).toBe('?map=alpha');
    expect(await selected()).toBe('?map=alpha');
    expect(await page.locator('header h1').textContent()).toBe('Alpha');
  } finally {
    release.resolve();
    await page.close();
  }
}, 20_000);
it('a Sync pressed on one map and answered after a pick never brings that map back', async () => {
  let posted = 0;
  const release = deferred();
  const { page, reads, selected, pick } = await openMaps({
    sync: async (route) => {
      posted++;
      await release.promise;
      await route.fulfill({
        json: { status: 'failed', reason: 'Invented stopped collector', versionsRequired: false },
      });
    },
  });
  try {
    const sync = page.getByRole('button', {
      name: 'Sync all: GitHub and round context for the whole map',
      exact: true,
    });
    await sync.click();
    await expect.poll(() => posted).toBe(1);
    await pick('beta');
    await expect.poll(selected).toBe('?map=beta');
    const alphaReads = reads.filter((path) => path === '/data/snapshot.json').length;
    release.resolve();
    await expect
      .poll(() => reads.filter((path) => path === '/data/snapshot.json').length)
      .toBeGreaterThan(alphaReads);
    await expect.poll(() => page.locator('.sync-controls button').textContent()).toBe('Sync all');
    expect(new URL(page.url()).search).toBe('?map=beta');
    expect(await selected()).toBe('?map=beta');
    expect(await page.locator('header h1').textContent()).toBe('Beta');
  } finally {
    release.resolve();
    await page.close();
  }
}, 20_000);
