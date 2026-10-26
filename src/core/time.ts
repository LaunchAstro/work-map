// SPDX-License-Identifier: AGPL-3.0-only
//
// How the map shows a time. Every card, callout and title uses one zone and locale, the ones the map's
// snapshot names, so two times for the same instant never differ by the viewer's zone or daylight saving.

/** The zone and locale every time on a map is shown in. */
export interface TimeDisplay {
  readonly timeZone: string;
  readonly locale: string;
}

/**
 * For a snapshot that names no display, or one this screen can't show: UTC+10 at every date (the IANA
 * name's sign is reversed) in Australian English, as every map was shown before maps named their own.
 */
const FIXED: TimeDisplay = { timeZone: 'Etc/GMT-10', locale: 'en-AU' };

/** Whether the runtime knows this IANA zone name. It also takes UTC offsets such as +01:00, which aren't. */
export function isTimeZone(zone: string): boolean {
  if (!/^[A-Za-z]/.test(zone)) return false;
  try {
    return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone !== '';
  } catch {
    return false;
  }
}
/** Whether the runtime writes dates in this BCP 47 locale, rather than quietly in another. */
export function isLocale(locale: string): boolean {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([locale]).length === 1;
  } catch {
    return false;
  }
}

/** A project's display: its own zone and locale, else the zone of the machine making the map and en-AU. */
export const displayFor = (settings: {
  readonly timeZone?: string | undefined;
  readonly locale?: string | undefined;
}): TimeDisplay => ({
  timeZone: settings.timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone,
  locale: settings.locale ?? 'en-AU',
});

function formats(display: TimeDisplay) {
  const zoned = (options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat =>
    new Intl.DateTimeFormat(display.locale, { timeZone: display.timeZone, ...options });
  return {
    display,
    short: zoned({ day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }),
    hour: zoned({ hour: 'numeric' }),
    clock: zoned({ hour: 'numeric', minute: '2-digit' }),
    date: zoned({ year: 'numeric', month: 'numeric', day: 'numeric' }),
    // Plain digits whatever the locale, for reading the clock back.
    clockParts: new Intl.DateTimeFormat('en-US', {
      timeZone: display.timeZone,
      hourCycle: 'h23',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }),
  };
}
let shown = formats(FIXED);
let asked: readonly [unknown, unknown] | null = null;

/**
 * Shows every later time in the display the map's snapshot names. A zone or locale missing, or one this
 * screen can't show, is replaced by FIXED's on its own, so the other still holds.
 */
export function showTimesIn(display: TimeDisplay | undefined): void {
  // The snapshot is read from disk, so its display is checked here, not trusted.
  const timeZone: unknown = display?.timeZone;
  const locale: unknown = display?.locale;
  // The page asks on every render; check again only when the snapshot names something new.
  if (asked && asked[0] === timeZone && asked[1] === locale) return;
  asked = [timeZone, locale];
  const next: TimeDisplay = {
    timeZone: typeof timeZone === 'string' && isTimeZone(timeZone) ? timeZone : FIXED.timeZone,
    locale: typeof locale === 'string' && isLocale(locale) ? locale : FIXED.locale,
  };
  if (next.timeZone !== shown.display.timeZone || next.locale !== shown.display.locale)
    shown = formats(next);
}

function clock(at: number): { hour: number; minute: number; second: number } {
  const part = Object.fromEntries(
    shown.clockParts.formatToParts(at).map((p) => [p.type, Number(p.value)]),
  );
  return { hour: part['hour'] ?? 0, minute: part['minute'] ?? 0, second: part['second'] ?? 0 };
}
/**
 * The first moment of the map zone's clock hour that holds this moment. A daylight-saving change can make
 * that hour shorter (the clock jumped past its start) or longer (the clock went back into it).
 */
export function hourStart(at: number): number {
  const { hour } = clock(at);
  const back = (t: number): number => {
    const { minute, second } = clock(t);
    return Math.floor(t / 1000) * 1000 - (minute * 60 + second) * 1000;
  };
  let start = back(at);
  // Jumped forward: the minutes count from a start the clock never showed.
  for (let step = 0; step < 4 && clock(start).hour !== hour; step++) start += 15 * 60_000;
  // Went back: the moment before the start still shows this hour.
  for (let step = 0; step < 4 && clock(start - 1).hour === hour; step++) start = back(start - 1);
  return start;
}

/** For example "14 Oct, 12:40 am". */
export const shortTime = (at: string): string => shown.short.format(new Date(at));
/** Whether two moments fall on the same date in the map's zone, year included. */
export const sameDay = (a: number, b: number): boolean =>
  shown.date.format(a) === shown.date.format(b);
/** For example "1 pm": a merge-chart bar's starting hour (#257). */
export const hourLabel = (at: string): string => shown.hour.format(new Date(at));
/** For example "1:00 pm – 1:30 pm". */
export const hourSpan = (from: string, to: string): string =>
  `${shown.clock.format(new Date(from))} – ${shown.clock.format(new Date(to))}`;
// The one format converted: an ISO 8601 time with Z or a ±hh:mm offset, as every generated
// timestamp is written, on a real calendar day and clock time.
const ISO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/;
function isoTime(at: string): boolean {
  const match = ISO.exec(at);
  if (!match) return false;
  const [y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0, oh = 0, om = 0] = match
    .slice(1)
    .map((part) => Number(part ?? 0));
  // setUTCFullYear, unlike Date.UTC, keeps years 0000–0099 as written.
  const day = new Date(0);
  day.setUTCFullYear(y, mo - 1, d);
  return (
    day.getUTCFullYear() === y &&
    day.getUTCMonth() === mo - 1 &&
    day.getUTCDate() === d &&
    h <= 23 &&
    mi <= 59 &&
    s <= 59 &&
    oh <= 23 &&
    om <= 59
  );
}
/**
 * For example "14/10/2026, 12:40:05 am", the callouts' format. Only an ISO time with Z or an offset
 * is converted; any other text, a bare date or a person's note, is shown exactly as written.
 */
export const stamp = (at: string): string =>
  isoTime(at) && Number.isFinite(Date.parse(at))
    ? new Date(at).toLocaleString(shown.display.locale, { timeZone: shown.display.timeZone })
    : at;
