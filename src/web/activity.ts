import type { PrView } from '../core/contract.ts';
import { hourStart } from '../core/time.ts';

export type MergeHour = { start: string; end: string; count: number };
export type MergeAxis = { readonly ceiling: number; readonly ticks: readonly number[] };

export function mergeAxis(hours: readonly Pick<MergeHour, 'count'>[]): MergeAxis {
  const max = Math.max(0, ...hours.map((hour) => hour.count));
  if (max === 0) return { ceiling: 1, ticks: [0, 1] };
  const target = Math.max(1, max / 3);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 5, 10].find((factor) => factor * magnitude >= target)! * magnitude;
  const ceiling = Math.ceil(max / step) * step;
  return { ceiling, ticks: Array.from({ length: ceiling / step + 1 }, (_, i) => i * step) };
}

export function mergeHours(
  prs: Readonly<Record<string, PrView>>,
  at: string,
  hours = 6,
): MergeHour[] {
  const end = Date.parse(at);
  if (!Number.isFinite(end)) return [];
  const hour = 3_600_000;
  return Array.from({ length: hours }, (_, i) => {
    const start = end - (hours - i) * hour;
    const until = start + hour;
    return {
      start: new Date(start).toISOString(),
      end: new Date(until).toISOString(),
      count: Object.values(prs).filter((pr) => {
        const merged = Date.parse(pr.mergedAt);
        return merged > start && merged <= until;
      }).length,
    };
  });
}

/**
 * #257: clock hours for the merge chart, oldest first, the newest being the hour so far. The hours are the
 * map zone's, which may be half an hour off UTC's or change length with daylight saving, so each bar starts
 * where that zone's clock started its hour.
 */
export function clockHours(
  prs: Readonly<Record<string, PrView>>,
  at: string,
  hours: number,
): MergeHour[] {
  const end = Date.parse(at);
  if (!Number.isFinite(end) || hours < 1) return [];
  const starts = [hourStart(end)];
  while (starts.length < hours) starts.unshift(hourStart(starts[0]! - 1));
  return starts.map((start, i) => {
    const until = starts[i + 1] ?? end;
    // Each bar starts on its hour; only the hour so far also holds the moment of the read.
    const last = i === hours - 1;
    return {
      start: new Date(start).toISOString(),
      end: new Date(until).toISOString(),
      count: Object.values(prs).filter((pr) => {
        const merged = Date.parse(pr.mergedAt);
        return merged >= start && (last ? merged <= until : merged < until);
      }).length,
    };
  });
}
