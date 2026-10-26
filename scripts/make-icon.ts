// Draw the work map's icon and write it to public/.
//
//   node scripts/make-icon.ts
//
// The icon matches Seat Gauge's: the same dark rounded tile, violet for work done, a dim track for
// work to come and white for where things stand. Here the gauge becomes the map itself: four stage
// columns of section cards, the done ones violet, one white card where work is up to, the rest track.
// It writes public/icon.svg (the drawing), public/apple-touch-icon.png (180 px, full bleed: the icon
// Safari uses for a Dock web app) and public/icon-1024.png (on the macOS icon grid, for choosing by
// hand in a web app's settings).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const VIOLET = '#745cee';
const TRACK = 'rgba(255,255,255,0.12)';
const WHITE = '#f2f2f2';

/**
 * The icon on a 1024 point canvas, as Seat Gauge's: an 824 point tile, 100 in from each edge.
 * `fullBleed` crops to the tile with square corners, as Apple asks of a touch icon (Safari rounds it).
 */
export function iconSvg({ fullBleed = false }: { fullBleed?: boolean } = {}): string {
  const columns = [253, 425, 597, 769];
  const rows = [347, 512, 677];
  // Each column top to bottom: d done, n now, t to come.
  const stages = ['ddd', 'ddt', 'dnt', 'ttt'];
  const ink: Readonly<Record<string, string>> = { d: VIOLET, n: WHITE, t: TRACK };
  const cards = columns.flatMap((x, c) =>
    rows.map(
      (y, r) =>
        `<rect x="${x - 66}" y="${y - 52}" width="132" height="104" rx="28" fill="${ink[stages[c]?.[r] ?? 't']}"/>`,
    ),
  );
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fullBleed ? '100 100 824 824' : '0 0 1024 1024'}">`,
    '<defs><linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="#1c1c22"/><stop offset="1" stop-color="#0b0b0e"/>',
    '</linearGradient></defs>',
    `<rect x="100" y="100" width="824" height="824" rx="${fullBleed ? 0 : 185}" fill="url(#tile)"/>`,
    ...cards,
    '</svg>',
    '',
  ].join('\n');
}

const out = (name: string): string => fileURLToPath(new URL(`../public/${name}`, import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { chromium } = await import('playwright');
  const svg = iconSvg();
  writeFileSync(out('icon.svg'), svg);
  const browser = await chromium.launch();
  try {
    for (const [name, px, drawing] of [
      ['apple-touch-icon.png', 180, iconSvg({ fullBleed: true })],
      ['icon-1024.png', 1024, svg],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- one page per size, in turn
      const page = await browser.newPage({ viewport: { width: px, height: px } });
      // oxlint-disable-next-line no-await-in-loop -- as above
      await page.setContent(
        `<body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(drawing).toString('base64')}" width="${px}" height="${px}" style="display:block"></body>`,
      );
      // oxlint-disable-next-line no-await-in-loop -- as above
      await page.screenshot({ path: out(name), omitBackground: true });
      // oxlint-disable-next-line no-await-in-loop -- as above
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log('wrote public/icon.svg, public/apple-touch-icon.png and public/icon-1024.png');
}
