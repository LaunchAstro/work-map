// Browser check for one or more served work maps at a 1080×1920 portrait window, in WebKit (Safari) and Chromium.
//
//   node scripts/browser-check.mjs
//
// WORK_MAP_URLS      map=url pairs (default "map=http://127.0.0.1:4317"); with two or more it also switches maps
// WORK_MAP_SHOTS     where screenshots go (default .local/shots)
// WORK_MAP_BASELINE  a folder of earlier screenshots: every new one must match it (anti-aliasing aside)
// WORK_MAP_TIME      the page clock (default: each map's snapshot time plus one minute)
//
// For a before/after comparison, serve both builds from frozen copies of the data (the live servers
// regenerate their snapshots every few minutes), run once to make the baseline, then again with
// WORK_MAP_BASELINE pointing at it.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { mapLinkFailures } from './browser-check-links.ts';

const maps = (process.env.WORK_MAP_URLS ?? 'map=http://127.0.0.1:4317')
  .split(',')
  .map((pair) => pair.split('='));
const out = process.env.WORK_MAP_SHOTS ?? '.local/shots';
const baseline = process.env.WORK_MAP_BASELINE;
const viewport = { width: 1080, height: 1920 };
mkdirSync(out, { recursive: true });

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

// Resolves once the stages and any callout hold still for six frames; false if they never do.
async function settled(page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        let last = '';
        let stable = 0;
        let frames = 0;
        const frame = () => {
          if (++frames > 600) return resolve(false);
          const rects = [...document.querySelectorAll('.stage, .callout')].map((e) =>
            Object.values(e.getBoundingClientRect().toJSON()).join(','),
          );
          const current = rects.join(';');
          stable = current === last ? stable + 1 : 0;
          last = current;
          if (stable >= 6) resolve(true);
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
  );
}

// Decodes both screenshots in the page and compares pixels. Sub-pixel camera positions shift
// anti-aliased edges by small amounts, so only a channel difference above 48, or more than 1% of
// pixels changing at all, counts as a different picture.
async function differs(page, before, after) {
  return page.evaluate(
    async ([a, b]) => {
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs inside the page
      const load = (data) =>
        new Promise((resolve) => {
          const image = new Image();
          image.addEventListener('load', () => resolve(image), { once: true });
          image.src = `data:image/png;base64,${data}`;
        });
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs inside the page
      const pixels = (image) => {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return 'a different size';
      const [pa, pb] = [pixels(ia), pixels(ib)];
      let changed = 0;
      let worst = 0;
      for (let i = 0; i < pa.length; i += 4) {
        const most = Math.max(
          Math.abs(pa[i] - pb[i]),
          Math.abs(pa[i + 1] - pb[i + 1]),
          Math.abs(pa[i + 2] - pb[i + 2]),
        );
        if (most > 0) changed++;
        worst = Math.max(worst, most);
      }
      const share = changed / (pa.length / 4);
      return worst > 48 || share > 0.01
        ? `${(share * 100).toFixed(2)}% of pixels changed, by up to ${worst}`
        : null;
    },
    [before.toString('base64'), after.toString('base64')],
  );
}

async function shot(page, name, label) {
  await page.mouse.move(1, 1);
  check(await settled(page), `${label}: the map comes to rest before ${name}`);
  const path = join(out, `${name}.png`);
  const image = await page.screenshot({ path });
  if (baseline) {
    const before = join(baseline, `${name}.png`);
    check(existsSync(before), `${label}: no baseline screenshot ${before}`);
    if (existsSync(before)) {
      const change = await differs(page, readFileSync(before), image);
      check(change === null, `${label}: ${name} differs from the baseline (${change})`);
    }
  }
}

const zoom = (page) => page.locator('.zoom-readout').textContent();
const firstStage = (page) =>
  page.evaluate(() => {
    const v = document.querySelector('.viewport').getBoundingClientRect();
    const stages = [...document.querySelectorAll('.stage')].map((s) => s.getBoundingClientRect());
    const last = stages[Math.min(3, stages.length - 1)];
    return {
      left: stages[0].left - v.left,
      top: stages[0].top - v.top,
      right: v.right - last.right,
    };
  });

// A card's open-bugs count for one census count (#207).
const bugWords = (bugCounts) => {
  const open = (bugCounts?.total ?? 0) - (bugCounts?.completed ?? 0);
  return `${open} open ${open === 1 ? 'bug' : 'bugs'}`;
};

async function checkMap(browserName, browser, map, url) {
  const label = `${browserName} ${map}`;
  const snapshot = await (await fetch(`${url}/data/snapshot.json`)).json();
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const time = process.env.WORK_MAP_TIME ?? new Date(Date.parse(snapshot.generatedAt) + 60_000);
  await page.clock.setFixedTime(new Date(time));
  await page.goto(url);
  await page.locator('.node').first().waitFor();
  await settled(page);
  const name = `${browserName}-${map}`;

  // Header: map links, updated, Tickets only with a ticket census, zoom at 100%, loading bay and sync.
  failures.push(...(await mapLinkFailures(page, label, maps.length)));
  check(
    ((await page.locator('.updated').textContent()) ?? '').startsWith('updated '),
    `${label}: updated`,
  );
  const tickets = page.getByRole('button', { name: 'Tickets', exact: true });
  check(
    (await tickets.count()) === (snapshot.ticketProgress ? 1 : 0),
    `${label}: Tickets shows exactly when the project has a ticket census`,
  );
  check((await zoom(page)) === '100%', `${label}: opens at 100%`);
  const buttons = ['Zoom out', 'Zoom in', 'Sync all: GitHub and round context for the whole map'];
  const counts = await Promise.all(
    buttons.map((button) => page.getByRole('button', { name: button, exact: true }).count()),
  );
  buttons.forEach((button, i) => check(counts[i] === 1, `${label}: ${button}`));
  check((await page.getByRole('spinbutton').count()) === 0, `${label}: no column-count input`);

  const header = await page.evaluate(() => {
    const inventories = [...document.querySelectorAll('.header-button')];
    return {
      height: document.querySelector('header').getBoundingClientRect().height,
      boardTop: document.querySelector('.viewport').getBoundingClientRect().top,
      tops: inventories.map((button) => button.getBoundingClientRect().top),
      buttons: inventories.map((button) => button.textContent.trim()),
    };
  });
  check(new Set(header.tops).size === 1, `${label}: inventory buttons stay on one row`);
  const expectedButtons = ['Tickets', 'Seat Gauge', 'Loading bay', 'Site versions'].filter(
    (button) => header.buttons.includes(button),
  );
  check(
    JSON.stringify(header.buttons) === JSON.stringify(expectedButtons),
    `${label}: header inventories follow the shared order`,
  );
  const calloutWidths = [];
  /* oxlint-disable no-await-in-loop -- open and close one dialog before measuring the next. */
  for (const title of ['Seat Gauge', 'Loading bay', 'Site versions']) {
    const button = page.getByRole('button', { name: title, exact: true });
    if (!(await button.count())) continue;
    await button.click({ timeout: 1500 });
    const dialog = page.getByRole('dialog');
    calloutWidths.push(await dialog.evaluate((el) => el.getBoundingClientRect().width));
    check(
      (await dialog.locator('.brief-date').count()) === 1,
      `${label}: ${title} has a snapshot line`,
    );
    check(
      (await dialog.getByRole('button', { name: `Close ${title}`, exact: true }).count()) === 1,
      `${label}: ${title} has shared controls`,
    );
    await page.keyboard.press('Escape');
  }
  /* oxlint-enable no-await-in-loop */
  check(new Set(calloutWidths).size <= 1, `${label}: header callouts have the same width`);

  // Geometry: up to four stage columns fill the width with 12px gutters, top-left; no page scroll.
  const start = await firstStage(page);
  check(
    Math.abs(start.left - 12) < 0.6 && Math.abs(start.right - 12) < 0.6 && start.top >= 0,
    `${label}: four columns fill the width at the top-left (${JSON.stringify(start)})`,
  );
  const page2 = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  check(
    page2.width <= viewport.width && page2.height <= viewport.height + 1,
    `${label}: no page scroll`,
  );

  // Cards: each has a Progress and a Review bar and the four checklist steps.
  const cards = await page.locator('.node').evaluateAll((nodes) =>
    nodes.map((n) => ({
      id: n.id,
      progress: !!n.querySelector('.progress-meter .bar'),
      review: !!n.querySelector('.review-meter .bar'),
      // The four steps, not the spec tick's own link inside one of them.
      steps: [...n.querySelectorAll('.planning-mini [aria-label]')].filter((e) =>
        /^(map|tickets|spec|build): /.test(e.getAttribute('aria-label')),
      ).length,
    })),
  );
  check(cards.length > 0, `${label}: cards render`);
  for (const card of cards)
    check(card.progress && card.review, `${label}: ${card.id} has Progress and Review bars`);
  check(
    cards.every((card) => card.steps === 4),
    `${label}: every card shows map, tickets, spec, build`,
  );
  // Every shown percentage is the colour of its own segment (white on purple), on cards, stage
  // headers and the project scope header alike.
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('.bar-label')]
      .filter((l) => getComputedStyle(l).display !== 'none')
      .map((l) => ({
        where: l.closest('.stage') ? 'stage' : l.closest('.node') ? 'card' : 'header',
        label: getComputedStyle(l).color,
        segment: getComputedStyle(l.parentElement).color,
      })),
  );
  const off = labels.filter((l) => l.label !== l.segment);
  check(
    labels.length > 0 && off.length === 0,
    `${label}: every bar label takes its segment's colour (${off.length} differ, first ${JSON.stringify(off[0])})`,
  );
  // The same card measures the same on every map at 100%: width, title size, bar height (#147).
  const size = await page.evaluate(() => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs inside the page
    const round = (n) => Math.round(n * 10) / 10;
    const card = document.querySelector('.node');
    return {
      width: round(card.getBoundingClientRect().width),
      title: round(
        parseFloat(getComputedStyle(card.querySelector('h3')).fontSize) *
          (card.getBoundingClientRect().width / card.offsetWidth),
      ),
      bar: round(card.querySelector('.bar').getBoundingClientRect().height),
      // One style per element (#146): the same line height and gaps on every map's card.
      lineHeight: round(parseFloat(getComputedStyle(card.querySelector('h3')).lineHeight)),
      gap: round(parseFloat(getComputedStyle(card).rowGap)),
      meterGap: round(parseFloat(getComputedStyle(card.querySelector('.node-meters')).rowGap)),
      // The footer meets the card's edges: left, right and bottom insets.
      footer: (() => {
        const c = card.getBoundingClientRect();
        const f = card.querySelector('.node-footer')?.getBoundingClientRect();
        return f ? [f.left - c.left, c.right - f.right, c.bottom - f.bottom].map(round) : null;
      })(),
    };
  });
  check(
    size.footer?.every((inset) => Math.abs(inset) <= 0.5),
    `${label}: the card footer meets the card's edges (insets ${size.footer?.join(', ')})`,
  );
  await shot(page, `${name}-initial`, label);

  // Camera: + and − step in whole tens; the readout returns to 100% at the top-left.
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  check((await zoom(page)) === '110%', `${label}: + steps to 110% (saw ${await zoom(page)})`);
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  check((await zoom(page)) === '100%', `${label}: − steps back to 100% (saw ${await zoom(page)})`);

  // A drag from the middle of a card pans the map, selects no text and opens nothing; a click on
  // that same card then opens its details (below).
  const target = page.locator('.node').nth(1);
  const card = await target.boundingBox();
  const before = await firstStage(page);
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.down();
  await page.mouse.move(card.x + card.width / 2 - 60, card.y + card.height / 2 - 60, { steps: 6 });
  await page.mouse.up();
  const after = await firstStage(page);
  check(
    after.left < before.left - 30 || after.top < before.top - 30,
    `${label}: a drag over a card pans (${JSON.stringify({ before, after })})`,
  );
  check(
    (await page.evaluate(() => String(getSelection()))) === '',
    `${label}: a drag over a card selects no text`,
  );
  check((await page.locator('.callout').count()) === 0, `${label}: a drag opens no callout`);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.locator('.zoom-readout').click();
  check(await settled(page), `${label}: the map comes to rest after returning to 100%`);
  const home = await firstStage(page);
  check(
    (await zoom(page)) === '100%' && Math.abs(home.left - 12) < 0.6,
    `${label}: the readout returns to 100% at the start`,
  );

  // Section details open from the card just dragged, stay inside the window, and close on Escape.
  await target.click();
  await page.locator('.callout').first().waitFor();
  const callout = await page.evaluate(() => {
    const r = document.querySelector('.callout').getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  });
  check(callout, `${label}: section details stay inside the window`);
  // Text inside the callout still selects: a triple click selects a paragraph.
  await page.locator('.callout p').first().click({ clickCount: 3 });
  check(
    (await page.evaluate(() => String(getSelection()).trim().length)) > 0,
    `${label}: text in the callout can be selected`,
  );
  await shot(page, `${name}-details`, label);
  await page.keyboard.press('Escape');
  await page.locator('.callout').first().waitFor({ state: 'detached' });

  // #207: every card and stage draws Progress, Tickets and Review; a card counts its open bugs.
  const bars = await page.evaluate(() => ({
    owners: [...document.querySelectorAll('.node, .stage')].map((el) =>
      [...el.querySelectorAll('.bar-title')].map((t) => t.textContent.trim()).join(', '),
    ),
    cards: [...document.querySelectorAll('.node')].map((el) => [
      el.id.slice(2),
      el.querySelector('.open-bugs')?.textContent,
    ]),
    bugBars: document.querySelectorAll('.bugs-bar, .bugs-meter').length,
  }));
  const ticketMap = !!snapshot.ticketProgress;
  const expected = ticketMap ? 'Progress, Tickets, Review' : 'Progress, Review';
  check(
    bars.owners.every((titles) => titles === expected),
    `${label}: every card and stage shows ${expected}`,
  );
  check(bars.bugBars === 0, `${label}: no Bugs bar`);
  const bugs = snapshot.ticketProgress?.bugs;
  if (bugs)
    for (const [id, words] of bars.cards)
      check(
        words === bugWords(bugs.byNode[id]),
        `${label}: ${id} reads ${bugWords(bugs.byNode[id])} (saw ${words})`,
      );

  // Project scope: the same three bars, with open bugs beside the momentum line.
  await page.getByRole('button', { name: 'Project scope', exact: true }).click();
  const titles = await page
    .locator('.overall-meters .ml')
    .evaluateAll((es) => es.map((e) => e.textContent.trim()));
  check(
    titles.join(', ') === expected,
    `${label}: Project scope shows ${expected} (saw ${titles.join(', ')})`,
  );
  if (bugs) {
    const line = await page.locator('.overall-meters .momentum').textContent();
    check(
      line.includes(bugWords(bugs.totals)),
      `${label}: project reads ${bugWords(bugs.totals)} (saw ${line})`,
    );
  }
  await shot(page, `${name}-scope`, label);

  check(errors.length === 0, `${label}: page errors ${errors.join(' | ')}`);
  await page.close();
  return {
    map,
    browser: browserName,
    cards: cards.length,
    size,
    header,
    calloutWidths,
    time: new Date(time).toISOString(),
  };
}

// Each map keeps its own view (#148), and switching happens in one window (#168): zoom, drag, dark
// theme, % off and Project scope on one map, switch to the other with the picker and back, and
// everything returns while the other map keeps its own. Every frame during a switch shows cards
// under a header of one height, the address never leaves the first map's origin, and a refresh
// paints the saved theme from its first frame.
// Views match when every field is equal and the canvas offsets agree within 0.05px: a home view
// measured just after a switch can differ by a thousandth of a pixel, which no one can see.
const offsets = (view) => (view.transform?.match(/-?[\d.]+/g) ?? []).map(Number);
const sameView = (a, b) => {
  const [x, y] = [offsets(a), offsets(b)];
  return (
    JSON.stringify({ ...a, transform: null }) === JSON.stringify({ ...b, transform: null }) &&
    x.length === y.length &&
    x.every((n, i) => Math.abs(n - y[i]) <= 0.05)
  );
};

async function checkReturn(browserName, browser, [map, url], [other, otherUrl]) {
  const label = `${browserName} ${map}`;
  const ids = await Promise.all(
    [url, otherUrl].map(
      async (address) => (await (await fetch(`${address}/data/snapshot.json`)).json()).id,
    ),
  );
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  // The first animation frame runs just before the first paint, once the stylesheet has loaded.
  await page.addInitScript(() => {
    requestAnimationFrame(() => {
      globalThis.firstFrame = {
        theme: document.documentElement.dataset.theme ?? 'light',
        background: getComputedStyle(document.body).backgroundColor,
      };
    });
  });
  const state = () =>
    page.evaluate(() => ({
      zoom: document.querySelector('.zoom-readout')?.textContent,
      transform: document.querySelector('.canvas')?.style.transform,
      theme: document.querySelector('.app')?.dataset.theme,
      percentages: document.querySelector('.app')?.dataset.percentages,
      tab: document.querySelector('.strip-tabs [aria-pressed=true]')?.textContent,
      background: getComputedStyle(document.body).backgroundColor,
    }));
  const switchTo = async (id) => {
    await page.evaluate(() => {
      globalThis.switchFrames = [];
      globalThis.recording = true;
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs inside the page
      const tick = () => {
        // A card is visible when it and every element above it is displayed, visible and opaque, and
        // in view when some of it is left inside the window after every clipping element above it.
        // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs inside the page
        const visible = (node) => {
          for (let el = node; el; el = el.parentElement) {
            const style = getComputedStyle(el);
            if (
              style.display === 'none' ||
              style.visibility !== 'visible' ||
              Number(style.opacity) === 0
            )
              return false;
          }
          return true;
        };
        // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs inside the page
        const inView = (node) => {
          let { left, top, right, bottom } = node.getBoundingClientRect();
          // The body's overflow belongs to the window (CSS overflow propagation), which the end covers.
          for (let el = node.parentElement; el && el !== document.body; el = el.parentElement) {
            const style = getComputedStyle(el);
            if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
            const box = el.getBoundingClientRect();
            left = Math.max(left, box.left);
            top = Math.max(top, box.top);
            right = Math.min(right, box.right);
            bottom = Math.min(bottom, box.bottom);
          }
          return (
            Math.min(right, innerWidth) > Math.max(left, 0) &&
            Math.min(bottom, innerHeight) > Math.max(top, 0)
          );
        };
        const cards = [...document.querySelectorAll('.canvas .node')];
        globalThis.switchFrames.push({
          cards: document.querySelectorAll('.node').length,
          visible: cards.some(visible),
          inView: cards.some((node) => visible(node) && inView(node)),
          header: document.querySelector('header')?.getBoundingClientRect().height ?? 0,
        });
        if (globalThis.recording) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.locator(`.map-links a[href="?map=${id}"]`).click();
    await page.waitForFunction(
      (want) =>
        document.querySelector('.map-links [aria-current=page]')?.getAttribute('href') ===
        `?map=${want}`,
      id,
    );
    await settled(page);
    const frames = await page.evaluate(() => {
      globalThis.recording = false;
      return globalThis.switchFrames;
    });
    check(
      frames.length > 0 &&
        frames.every((f) => f.cards > 0 && f.visible && f.inView && f.header === frames[0].header),
      `${label}: switching to ${id} paints cards under one header height in every frame (${frames.length} frames, ${JSON.stringify(frames.find((f) => f.cards === 0 || !f.visible || !f.inView || f.header !== frames[0].header) ?? null)})`,
    );
    check(
      new URL(page.url()).origin === new URL(url).origin,
      `${label}: switching to ${id} stays on ${new URL(url).origin} (at ${page.url()})`,
    );
  };
  try {
    await page.goto(url);
    await page.locator('.node').first().waitFor();
    await settled(page);
    await switchTo(ids[1]);
    const otherHome = await state();
    await switchTo(ids[0]);
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    const box = await page.locator('.viewport').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 140, box.y + box.height / 2 - 90, { steps: 6 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
    await page.getByRole('button', { name: /percentages/i }).click();
    await page.getByRole('button', { name: 'Project scope', exact: true }).click();
    await settled(page);
    const before = await state();
    await switchTo(ids[1]);
    const away = await state();
    check(
      sameView(away, otherHome),
      `${label}: ${other} keeps its own view while ${map} is moved (${JSON.stringify(otherHome)} → ${JSON.stringify(away)})`,
    );
    await switchTo(ids[0]);
    const back = await state();
    check(
      sameView(back, before),
      `${label}: switching away and back restores zoom, position, theme, % and tab (${JSON.stringify(before)} → ${JSON.stringify(back)})`,
    );
    await page.reload();
    await page.locator('.node').first().waitFor();
    await settled(page);
    const refreshed = await state();
    check(
      sameView(refreshed, before),
      `${label}: a refresh keeps zoom, position, theme, % and tab (${JSON.stringify(refreshed)})`,
    );
    const first = await page.evaluate(() => globalThis.firstFrame);
    check(
      first?.theme === 'dark' && first.background === before.background,
      `${label}: the first painted frame has the saved dark theme (${JSON.stringify(first)})`,
    );
    await switchTo(ids[1]);
    await page.goto(url);
    await page.locator('.node').first().waitFor();
    await settled(page);
    const homeFirst = await page.evaluate(() => globalThis.firstFrame);
    check(
      homeFirst?.theme === 'dark' && homeFirst.background === before.background,
      `${label}: the bare address paints its own saved theme after visiting ${other} (${JSON.stringify(homeFirst)})`,
    );
    return { map, browser: browserName, before, back };
  } finally {
    await context.close();
  }
}

const report = [];
for (const [browserName, type] of [
  ['webkit', webkit],
  ['chromium', chromium],
]) {
  // oxlint-disable-next-line no-await-in-loop -- one browser at a time keeps the timings honest
  const browser = await type.launch();
  try {
    for (const [map, url] of maps)
      report.push(
        // oxlint-disable-next-line no-await-in-loop -- maps share the browser, one after the other
        await checkMap(browserName, browser, map, url).catch((error) => {
          // A step that cannot run (an element that never stops moving) is a failure, not a crash.
          failures.push(`${browserName} ${map}: ${String(error.message).split('\n')[0]}`);
          return { map, browser: browserName, cards: null, time: null };
        }),
      );
    if (maps.length > 1)
      report.push(
        // oxlint-disable-next-line no-await-in-loop -- after the per-map checks, same browser
        await checkReturn(browserName, browser, maps[0], maps[1]).catch((error) => {
          failures.push(`${browserName} return: ${String(error.message).split('\n')[0]}`);
          return { map: 'return', browser: browserName };
        }),
      );
  } finally {
    // oxlint-disable-next-line no-await-in-loop -- closed before the next browser starts
    await browser.close();
  }
}
for (const browserName of ['webkit', 'chromium']) {
  const sizes = report.filter((r) => r.browser === browserName && r.size).map((r) => r.size);
  const headers = report.filter((r) => r.browser === browserName && r.header).map((r) => r.header);
  for (const key of ['height', 'boardTop'])
    check(
      headers.every((header) => Math.abs(header[key] - headers[0][key]) <= 0.5),
      `${browserName}: header ${key} matches across maps`,
    );
  const widths = report
    .filter((r) => r.browser === browserName && r.calloutWidths)
    .flatMap((r) => r.calloutWidths);
  check(
    widths.every((width) => Math.abs(width - widths[0]) <= 0.5),
    `${browserName}: header callouts have the same width across maps (${widths.join(', ')})`,
  );

  for (const key of ['width', 'title', 'bar', 'lineHeight', 'gap', 'meterGap'])
    check(
      sizes.every((size) => Math.abs(size[key] - sizes[0][key]) <= 0.5),
      `${browserName}: a card's ${key} is the same on every map (${sizes.map((size) => size[key]).join(', ')})`,
    );
}
writeFileSync(join(out, 'report.json'), `${JSON.stringify({ report, failures }, null, 2)}\n`);
console.log(JSON.stringify({ report, failures }, null, 2));
assert.deepEqual(failures, [], `${failures.length} browser check failures`);
