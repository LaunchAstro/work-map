// SPDX-License-Identifier: AGPL-3.0-only
//
// Where a callout sits: beside a card (right, or left near the edge), or below a header button,
// right-aligned to it. Always inside the container with a 12px margin.

type Box = { left: number; top: number; right: number; bottom: number };
type Area = Box & { width: number; height: number };
export type CalloutPlace = { left: number; top: number; width: number; maxHeight: number };

const MARGIN = 12;
const WIDTH = 440;
const MIN_HEIGHT = 160;

export function placeCallout(anchor: Box, container: Area, side: 'beside' | 'below'): CalloutPlace {
  const width = Math.min(WIDTH, container.width - 2 * MARGIN);
  const clampLeft = (left: number): number =>
    Math.max(MARGIN, Math.min(left, container.width - width - MARGIN));
  if (side === 'below') {
    // Below the button when there's room; otherwise move up (over the header) to stay inside.
    const top = Math.max(
      MARGIN,
      Math.min(anchor.bottom - container.top + 8, container.height - MARGIN - MIN_HEIGHT),
    );
    return {
      left: clampLeft(anchor.right - container.left - width),
      top,
      width,
      maxHeight: Math.max(0, Math.min(720, container.height - top - MARGIN)),
    };
  }
  const left =
    anchor.right + MARGIN + width <= container.right
      ? anchor.right - container.left + MARGIN
      : anchor.left - container.left - width - MARGIN;
  const top = Math.max(MARGIN, Math.min(anchor.top - container.top, container.height - 180));
  return {
    left: clampLeft(left),
    top,
    width,
    maxHeight: Math.max(0, Math.min(600, container.height - top - MARGIN)),
  };
}
