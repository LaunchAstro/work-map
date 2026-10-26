import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mapLinkFailures } from '../scripts/browser-check-links.ts';
import { MapLinks } from '../src/web/MapLinks.tsx';
import type { MapLink } from '../src/core/map-links.ts';

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});
afterAll(async () => browser?.close());

const map = (id: string): MapLink => ({ id, title: `${id} map`, url: 'http://127.0.0.1:4317/' });
// The real header component, rendered as the page renders it.
const show = (maps: readonly MapLink[] | null, id: string) =>
  page.setContent(renderToStaticMarkup(createElement(MapLinks, { maps, id, title: `${id} map` })));

it('accepts a map checked on its own, with or without a map list', async () => {
  await show(null, 'demo');
  expect(await mapLinkFailures(page, 'demo', 1)).toEqual([]);
  await show([map('demo')], 'demo');
  expect(await mapLinkFailures(page, 'demo', 1)).toEqual([]);
});

it('still needs every map linked and the current one marked when given two maps', async () => {
  await show([map('one'), map('two')], 'one');
  expect(await mapLinkFailures(page, 'one', 2)).toEqual([]);
  await show(null, 'one');
  expect(await mapLinkFailures(page, 'one', 2)).toEqual([
    'one: both maps are linked',
    'one: the current map is marked',
  ]);
});
