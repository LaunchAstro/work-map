/* oxlint-disable no-await-in-loop -- each case drives one page step by step. */
// The map's camera in a real browser (#115, #126, #154, #169): what the pure rules in camera.test.ts
// can't show, namely keys, focus, pointer, wheel and gesture events reaching the camera, and the
// section callout staying in the window while the camera moves.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, webkit, type Browser, type Locator, type Page } from 'playwright';
import { parseBuildUnits } from '../src/core/plan.ts';
import { buildWork, withWork } from '../src/core/work.ts';
import type { Project } from '../src/readers/project.ts';

const at = '2026-10-17T01:00:00Z';
const measures = {
  days: 0,
  coded: { pct: 0, low: 0, high: 0 },
  on: { pct: 0, switchOnsClosed: 0, switchOnsOpen: 0 },
  estimate: { pct: 0, source: 'audit', at: null, reason: '' },
  reviewed: {},
  sinceAudit: { merged: 0, prs: [] },
  inferredPrs: 0,
};
// Six stages of six cards: wider and taller than a 1080×1920 window at 100%, so the camera pans.
const stages = Array.from({ length: 6 }, (_, i) => ({
  ...measures,
  index: i + 1,
  name: `Stage ${i + 1}`,
  nodes: Array.from({ length: 6 }, (_unused, j) => ({
    ...measures,
    id: `s${i + 1}n${j + 1}`,
    title: `Section ${i + 1}.${j + 1}`,
    text: 'Example section text.',
    repo: '',
    row: j + 1,
    status: 'planned',
    units: [],
  })),
}));
const base = {
  schema: 'work-map/4',
  id: 'camera',
  type: 'map',
  title: 'Camera map',
  generatedAt: at,
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
  stages,
  prs: {},
  switchOns: [],
  frontier: [],
  fog: [],
  unmapped: { count: 0, prs: [], switchOns: [] },
  view: { title: '', lede: '', overallNote: '', footnote: '', steps: [], wires: [] },
  stats: {
    at,
    queued: null,
  },
  sweep: { inferred: 0, byVia: {}, estimates: 0, gaps: null },
  warnings: [],
};
// Every card's spec step links to a spec document, so each card carries a link to drag.
const spec = 'Example/plan:docs/SPEC.md';
const nodes = stages.flatMap((stage) => stage.nodes);
const project = {
  version: 1,
  id: 'camera',
  title: 'Camera map',
  roadmapRepo: 'Example/plan',
  productRepo: 'Example/app',
  repos: ['Example/app', 'Example/plan'],
  files: { audit: 'a', flow: 'f', plan: 'p', mapping: 'm', sections: 's' },
  lanePrefix: 'EX-',
  laneRules: [],
  ticketConventions: {
    mapLabel: 'roadmap:map',
    ideaLabels: ['idea'],
    ideaPattern: '^Idea:',
    specLabels: ['spec'],
    readyLabel: 'ready-for-agent',
    ticketLabels: ['roadmap:task'],
    specPattern: '^Spec:',
  },
  specDocuments: Object.fromEntries(nodes.map((n) => [n.id, [spec]])),
  dependencies: [],
} as unknown as Project;
const snapshot = withWork(
  base as never,
  buildWork({
    project,
    plan: parseBuildUnits(
      readFileSync(new URL('fixtures/build-units.md', import.meta.url), 'utf8'),
    ),
    nodes: nodes as never,
    issues: {},
    prs: [],
    maps: {},
    specDocuments: { [spec]: { found: true, url: 'https://example.com/spec' } },
    at,
    complete: true,
    error: null,
  }),
);

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

const frames = (page: Page, count = 2) =>
  page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame);
  }, count);
async function open(
  engine: 'chromium' | 'webkit',
  run: (page: Page) => Promise<void>,
  init?: () => void,
): Promise<void> {
  const page = await (engine === 'chromium' ? chrome : safari).newPage({
    viewport: { width: 1080, height: 1920 },
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    if (init) await page.addInitScript(init);
    await page.route('**/data/**', (route) =>
      new URL(route.request().url()).pathname === '/data/snapshot.json'
        ? route.fulfill({ json: snapshot })
        : route.fulfill({ status: 404, body: '{}' }),
    );
    await page.goto(process.env['WORK_MAP_TEST_URL']!);
    await page.locator('.zoom-readout').filter({ hasText: '100%' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await frames(page);
    await run(page);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}
const zoom = (page: Page) => page.locator('.zoom-readout').textContent();
const camera = (page: Page) => page.locator('.canvas').getAttribute('style');
/** Boxes relative to the viewport, and its native scroll. */
const geometry = (page: Page) =>
  page.evaluate(() => {
    const v = document.querySelector('.viewport')!;
    const r = v.getBoundingClientRect();
    const box = (e: Element | null) => {
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return {
        left: b.left - r.left,
        right: b.right - r.left,
        top: b.top - r.top,
        bottom: b.bottom - r.top,
      };
    };
    return {
      width: r.width,
      height: r.height,
      scroll: [v.scrollLeft, v.scrollTop],
      first: box(document.querySelector('.stage'))!,
      lastCard: box([...document.querySelectorAll('.node')].at(-1)!)!,
      callout: box(document.querySelector('.callout')),
    };
  });
async function atHome(page: Page): Promise<void> {
  await frames(page);
  const g = await geometry(page);
  expect(await zoom(page)).toBe('100%');
  expect(g.scroll).toEqual([0, 0]);
  expect(g.first.left).toBeCloseTo(12, 0);
  expect(g.first.top).toBeCloseTo(12, 0);
}
async function calloutInside(page: Page): Promise<void> {
  await frames(page);
  const { callout, width, height } = await geometry(page);
  expect(callout).not.toBeNull();
  expect(callout!.left).toBeGreaterThanOrEqual(0);
  expect(callout!.top).toBeGreaterThanOrEqual(0);
  expect(callout!.right).toBeLessThanOrEqual(width);
  expect(callout!.bottom).toBeLessThanOrEqual(height);
}
async function drag(page: Page, target: Locator, distance = 60): Promise<void> {
  const box = (await target.boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  expect(
    await target.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), { x, y }),
  ).toBe(true);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - distance, y - distance, { steps: 6 });
  await page.mouse.up();
}

for (const engine of ['chromium', 'webkit'] as const) {
  it(
    `${engine}: 0, the readout and a resize return home and the camera then holds still`,
    () =>
      open(engine, async (page) => {
        // The canvas scales by CSS zoom, never a transform scale.
        expect(await page.locator('.canvas').evaluate((el) => el.style.transform)).not.toContain(
          'scale',
        );
        await atHome(page);
        // 0 still goes home while the Zoom in button keeps focus.
        const zoomIn = page.getByRole('button', { name: 'Zoom in', exact: true });
        await zoomIn.click();
        await zoomIn.focus(); // Safari doesn't focus a clicked button
        expect(await zoomIn.evaluate((el) => el === document.activeElement)).toBe(true);
        expect(await zoom(page)).toBe('110%');
        await page.keyboard.press('0');
        await atHome(page);
        // Keyboard focus on an off-screen card moves the camera, not native scroll; 0 comes back.
        expect((await geometry(page)).lastCard.left).toBeGreaterThan(1080);
        await page.locator('.node').last().focus();
        await frames(page);
        const shown = await geometry(page);
        expect(shown.lastCard.right).toBeLessThanOrEqual(shown.width + 1);
        expect(shown.scroll).toEqual([0, 0]);
        await page.keyboard.press('0');
        await atHome(page);
        await page.setViewportSize({ width: 900, height: 1200 });
        await atHome(page);
        // The readout goes home too, and home then stops re-measuring (#126): one zoom for 60 frames.
        await zoomIn.click();
        await page.locator('.zoom-readout').click();
        await frames(page);
        const samples = await page.evaluate(async () => {
          const seen = [];
          for (let i = 0; i < 60; i++) {
            await new Promise(requestAnimationFrame);
            seen.push(document.querySelector<HTMLElement>('.canvas')!.getAttribute('style'));
          }
          return seen;
        });
        expect(new Set(samples).size).toBe(1);
        await atHome(page);
      }),
    20_000,
  );

  it(
    `${engine}: a pinned section stays in the window through zoom, resize to the 200% limit and home`,
    () =>
      open(engine, async (page) => {
        await page.locator('.viewport').focus();
        await page.keyboard.press('+');
        await page.locator('.node').last().focus();
        await frames(page);
        await page.keyboard.press('Enter');
        await page.locator('.callout').waitFor();
        await calloutInside(page);
        for (let i = 0; i < 12; i++) await page.keyboard.press('+');
        expect(await zoom(page)).toBe('200%');
        await calloutInside(page);
        await page.setViewportSize({ width: 600, height: 900 });
        await calloutInside(page);
        expect(Number.parseInt((await zoom(page))!)).toBeLessThanOrEqual(200);
        await page.keyboard.press('0');
        await calloutInside(page);
        await atHome(page);
      }),
    20_000,
  );

  it(
    `${engine}: a press on a clipped card edge opens that card without moving it away`,
    () =>
      open(engine, async (page) => {
        await page.locator('.viewport').dispatchEvent('wheel', { deltaX: 100, deltaY: 0 });
        await frames(page);
        const card = page.locator('#n-s1n1');
        const box = (await card.boundingBox())!;
        const viewport = (await page.locator('.viewport').boundingBox())!;
        expect(box.x).toBeLessThan(viewport.x);
        const [x, y] = [viewport.x + 2, box.y + box.height / 2];
        expect(
          await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.closest('.node')?.id, {
            x,
            y,
          }),
        ).toBe('n-s1n1');
        await page.mouse.move(x, y);
        await page.mouse.down();
        await frames(page);
        await page.mouse.up();
        await frames(page);
        expect(await page.locator('.callout[data-section="s1n1"]').count()).toBe(1);
      }),
    20_000,
  );

  it(
    `${engine}: drags pan from cards, links, stage headers and bars without selecting or opening anything`,
    () =>
      open(engine, async (page) => {
        let popups = 0;
        page.on('popup', () => popups++);
        for (const selector of [
          '.node >> nth=1',
          '.node .planning-link >> nth=0',
          '.stage b >> nth=0',
          '.node .bar span >> nth=0',
        ]) {
          await page.locator('.zoom-readout').click();
          const before = await camera(page);
          await drag(page, page.locator(selector));
          await frames(page);
          expect(await camera(page), selector).not.toBe(before);
          expect(await page.evaluate(() => String(getSelection()))).toBe('');
          expect(await page.locator('.callout').count()).toBe(0);
        }
        expect(popups).toBe(0);
        // A press that moves under the threshold still clicks: the same card opens.
        const card = page.locator('.node').nth(1);
        await drag(page, card, 1);
        expect(await page.locator('.callout').getAttribute('data-section')).toBe(
          (await card.getAttribute('id'))!.slice(2),
        );
        // Dragging the header's text leaves the camera where it is.
        await page.keyboard.press('Escape');
        const still = await camera(page);
        await drag(page, page.locator('header .updated'));
        expect(await camera(page)).toBe(still);
      }),
    20_000,
  );

  it(
    `${engine}: a callout keeps its own text, wheel and keys, also after a board drag`,
    () =>
      open(engine, async (page) => {
        const card = page.locator('.node').nth(1);
        await card.click();
        const callout = page.locator('.callout');
        // Space toggles a focused group.
        const summary = callout.locator('summary').first();
        await summary.focus();
        const was = await summary.evaluate((el) => (el.parentElement as HTMLDetailsElement).open);
        await page.keyboard.press('Space');
        expect(await summary.evaluate((el) => (el.parentElement as HTMLDetailsElement).open)).toBe(
          !was,
        );
        // Text selects and the wheel scrolls the callout, with the camera still.
        const before = await camera(page);
        await callout.locator('p').first().click({ clickCount: 3 });
        expect(await page.evaluate(() => String(getSelection()).trim().length)).toBeGreaterThan(0);
        for (const group of await callout.locator('details.brief-group > summary').all())
          if (!(await group.evaluate((el) => (el.parentElement as HTMLDetailsElement).open)))
            await group.click();
        await callout.evaluate((el) => (el.scrollTop = 0));
        const bounds = (await callout.boundingBox())!;
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.wheel(0, 500);
        await page.waitForFunction(() => document.querySelector('.callout')!.scrollTop > 0);
        expect(await camera(page)).toBe(before);
        // After a real board drag, Close still answers Enter and Space (a drag swallows one pointer click only).
        for (const key of ['Enter', 'Space']) {
          if (!(await callout.count())) await card.click();
          const moved = await camera(page);
          await drag(page, page.locator('.stage b').first());
          expect(await camera(page)).not.toBe(moved);
          expect(await callout.count()).toBe(1);
          // After the drag, Shift+Tab reaches Close, as a keyboard user would (Safari tabs to
          // buttons with Option held).
          const close = callout.locator('.close');
          for (let i = 0; i < 200; i++) {
            if (await close.evaluate((el) => el === document.activeElement)) break;
            await page.keyboard.press(engine === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
          }
          expect(await close.evaluate((el) => el === document.activeElement)).toBe(true);
          await page.keyboard.press(key);
          await frames(page, 1);
          expect(await callout.count(), key).toBe(0);
        }
      }),
    20_000,
  );

  for (const input of ['key', 'button'] as const) {
    const press = (page: Page, direction: 1 | -1): Promise<void> =>
      input === 'key'
        ? page.keyboard.press(direction > 0 ? '+' : '-')
        : page
            .getByRole('button', { name: direction > 0 ? 'Zoom in' : 'Zoom out', exact: true })
            .click();

    it(
      `${engine}: the − and + ${input}s step to the next whole ten, from 93% as from 100%`,
      () =>
        open(engine, async (page) => {
          for (const [start, direction, expected] of [
            [93, -1, '90%'],
            [93, 1, '100%'],
            [100, -1, '90%'],
            [100, 1, '110%'],
          ] as const) {
            await page.locator('.zoom-readout').click();
            if (start === 93)
              await page.locator('.viewport').evaluate((el) =>
                el.dispatchEvent(
                  new WheelEvent('wheel', {
                    bubbles: true,
                    cancelable: true,
                    ctrlKey: true,
                    deltaY: -Math.log(0.93) / 0.01,
                  }),
                ),
              );
            await expect.poll(() => zoom(page)).toBe(`${start}%`);
            await press(page, direction);
            await expect
              .poll(() => zoom(page), { message: `${direction} from ${start}%` })
              .toBe(expected);
          }
        }),
      20_000,
    );

    it(
      `${engine}: the − ${input} stops at the floor with the whole map shown, and + leaves it`,
      () =>
        open(engine, async (page) => {
          // The floor here is 25% of home, below whole-map fit: off the grid of whole tens.
          let readout = await zoom(page);
          for (let i = 0; i < 20; i++) {
            await press(page, -1);
            await frames(page);
            const now = await zoom(page);
            if (now === readout) break;
            readout = now;
          }
          expect(readout).toBe('25%');
          const { lastCard, width, height } = await geometry(page);
          expect(lastCard.right).toBeLessThanOrEqual(width);
          expect(lastCard.bottom).toBeLessThanOrEqual(height);
          await press(page, 1);
          await expect.poll(() => zoom(page)).toBe('30%');
        }),
      20_000,
    );
  }

  it(
    `${engine}: ctrl-wheel and Safari pinch zoom continuously around the pointer`,
    () =>
      open(engine, async (page) => {
        await page.locator('.viewport').evaluate((el) =>
          el.dispatchEvent(
            new WheelEvent('wheel', {
              bubbles: true,
              cancelable: true,
              ctrlKey: true,
              deltaY: -Math.log(1.03) / 0.01,
            }),
          ),
        );
        expect(await zoom(page)).toBe('103%');
        await page.locator('.viewport').evaluate((el) => {
          el.dispatchEvent(new Event('gesturestart', { bubbles: true, cancelable: true }));
          const event = Object.assign(
            new Event('gesturechange', { bubbles: true, cancelable: true }),
            {
              scale: 1.02,
              clientX: 500,
              clientY: 700,
            },
          );
          el.dispatchEvent(event);
        });
        expect(await zoom(page)).toBe('105%');
      }),
    20_000,
  );

  it(
    `${engine}: the map renders and zooms when reading localStorage throws`,
    () =>
      open(
        engine,
        async (page) => {
          expect(await page.locator('.node').count()).toBeGreaterThan(0);
          await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
          expect(await zoom(page)).toBe('110%');
        },
        () =>
          Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get() {
              throw new DOMException('Storage access denied', 'SecurityError');
            },
          }),
      ),
    20_000,
  );
}
