import { expect, it } from 'vitest';
import { placeCallout } from '../src/web/callout-place.ts';

const container = { left: 0, top: 0, right: 1080, bottom: 1920, width: 1080, height: 1920 };
it('places a card callout beside the card, flipping left near the right edge', () => {
  const right = placeCallout({ left: 100, top: 400, right: 300, bottom: 700 }, container, 'beside');
  expect(right).toMatchObject({ left: 312, top: 400 });
  const left = placeCallout({ left: 800, top: 400, right: 1000, bottom: 700 }, container, 'beside');
  expect(left.left).toBe(800 - 440 - 12);
});
it('places a header callout below its button, right-aligned and inside the window', () => {
  const below = placeCallout({ left: 730, top: 60, right: 830, bottom: 90 }, container, 'below');
  expect(below.top).toBe(98);
  expect(below.left + 440).toBe(830);
  const edge = placeCallout({ left: 1040, top: 60, right: 1078, bottom: 90 }, container, 'below');
  expect(edge.left + 440).toBeLessThanOrEqual(1080 - 12);
  expect(below.maxHeight).toBe(Math.min(720, 1920 - 98 - 12));
  const narrow = placeCallout(
    { left: 10, top: 60, right: 50, bottom: 90 },
    { ...container, right: 300, width: 300 },
    'below',
  );
  expect(narrow.left).toBe(12);
  expect(narrow.width).toBe(276);
});
it('keeps a header callout inside a window too short to fit it below its button', () => {
  const short = { left: 0, top: 0, right: 900, bottom: 110, width: 900, height: 110 };
  const placed = placeCallout({ left: 700, top: 60, right: 800, bottom: 92 }, short, 'below');
  expect(placed.maxHeight).toBeGreaterThanOrEqual(0);
  expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(110 - 12);
});
