import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { iconSvg } from '../scripts/make-icon.ts';
import { typeOf } from '../src/cli/serve-paths.ts';

const file = (path: string): Buffer => readFileSync(new URL(`../${path}`, import.meta.url));
// A PNG's width and height sit in its IHDR chunk, 16 bytes in.
const size = (png: Buffer): [number, number] => [png.readUInt32BE(16), png.readUInt32BE(20)];

it('gives the page the work map icon, drawn by its script', () => {
  const page = file('index.html').toString();
  expect(page).toContain('<link rel="icon" href="/icon.svg" type="image/svg+xml" />');
  expect(page).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
  // The committed files are what scripts/make-icon.ts draws, so a change to the drawing can't be forgotten.
  expect(file('public/icon.svg').toString()).toBe(iconSvg());
  expect(size(file('public/apple-touch-icon.png'))).toEqual([180, 180]);
  expect(size(file('public/icon-1024.png'))).toEqual([1024, 1024]);
  // The local server sends them as images.
  expect(typeOf('/x/icon.svg')).toBe('image/svg+xml');
  expect(typeOf('/x/apple-touch-icon.png')).toBe('image/png');
});
