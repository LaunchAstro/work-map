// A project may name the zone and locale its map shows times in. Unset, the zone is the one of the machine
// making the map, sent to the screen in the snapshot, so two viewers in different zones still see the same time.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { displayFor, hourLabel, sameDay, shortTime, showTimesIn, stamp } from '../src/core/time.ts';
import type { PrView } from '../src/core/contract.ts';
import { clockHours } from '../src/web/activity.ts';
import type { Snapshot } from '../src/core/contract.ts';
import { readProject } from '../src/readers/project.ts';
import { seed } from '../examples/demo/seed.ts';

const roadmap = join(import.meta.dirname, '../examples/demo/roadmap');

function inZone<T>(zone: string, run: () => T): T {
  const saved = process.env['TZ'];
  process.env['TZ'] = zone;
  try {
    return run();
  } finally {
    if (saved === undefined) delete process.env['TZ'];
    else process.env['TZ'] = saved;
  }
}

function project(settings: Record<string, unknown>): string {
  const file = join(mkdtempSync(join(tmpdir(), 'work-map-display-')), 'project.json');
  const base = JSON.parse(readFileSync(join(roadmap, 'project.json'), 'utf8'));
  writeFileSync(file, JSON.stringify({ ...base, ...settings }));
  return file;
}

afterEach(() => showTimesIn(undefined));

it('shows every time in the zone and locale the snapshot names, whatever the viewer is in', () => {
  inZone('America/Los_Angeles', () => {
    showTimesIn({ timeZone: 'Europe/London', locale: 'en-GB' });
    expect(stamp('2026-10-16T15:00:00Z')).toBe('16/10/2026, 16:00:00');
    expect(shortTime('2026-10-16T15:00:00Z')).toBe('16 Oct, 16:00');
    expect(hourLabel('2026-10-16T15:00:00Z')).toBe('16');
    // 11:30 pm and 12:30 am the next day in London, though one calendar day in Los Angeles.
    expect(sameDay(Date.parse('2026-10-16T22:30:00Z'), Date.parse('2026-10-16T23:30:00Z'))).toBe(
      false,
    );
  });
});

it('keeps UTC+10 in Australian English for a snapshot that names no display', () => {
  inZone('America/Los_Angeles', () => {
    showTimesIn({ timeZone: 'Europe/London', locale: 'en-GB' });
    showTimesIn(undefined);
    expect(stamp('2026-10-16T15:00:00Z')).toBe('17/10/2026, 1:00:00 am');
    expect(shortTime('2026-10-16T15:00:00Z')).toBe('17 Oct, 1:00 am');
  });
});

// Each field falls back alone: a browser without the locale still shows the map's zone, and one without the
// zone still writes in the map's locale.
it('replaces only the zone or locale this screen cannot show, keeping the other', () => {
  for (const timeZone of ['Mars/Olympus_Mons', '+01:00']) {
    showTimesIn({ timeZone, locale: 'en-GB' });
    expect(stamp('2026-10-16T15:00:00Z'), timeZone).toBe('17/10/2026, 01:00:00');
  }
  // The second locale is well formed, but no runtime has it: it would otherwise write in the viewer's own.
  for (const locale of ['not a locale!', 'zz-ZZ']) {
    showTimesIn({ timeZone: 'Europe/London', locale });
    expect(stamp('2026-10-16T15:00:00Z'), locale).toBe('16/10/2026, 4:00:00 pm');
  }
  for (const display of [null, { timeZone: 10, locale: ['en-GB'] }]) {
    showTimesIn(display as never);
    expect(stamp('2026-10-16T15:00:00Z')).toBe('17/10/2026, 1:00:00 am');
  }
});

it("takes the project's zone and locale, else the zone of the machine making the map and Australian English", () => {
  expect(inZone('Asia/Tokyo', () => displayFor({}))).toEqual({
    timeZone: 'Asia/Tokyo',
    locale: 'en-AU',
  });
  expect(
    inZone('Asia/Tokyo', () => displayFor({ timeZone: 'Europe/London', locale: 'en-GB' })),
  ).toEqual({ timeZone: 'Europe/London', locale: 'en-GB' });
});

it('reads a zone and locale from project.json and refuses ones that are not real', () => {
  const read = readProject(project({ timeZone: 'Europe/London', locale: 'en-GB' }), roadmap);
  expect([read.project.timeZone, read.project.locale]).toEqual(['Europe/London', 'en-GB']);
  expect(readProject(project({}), roadmap).project.timeZone).toBeUndefined();
  expect(() => readProject(project({ timeZone: 'Mars/Olympus_Mons' }), roadmap)).toThrow(
    /timeZone/,
  );
  // A UTC offset is not an IANA zone name.
  expect(() => readProject(project({ timeZone: '+01:00' }), roadmap)).toThrow(/timeZone/);
  expect(() => readProject(project({ locale: 'not a locale!' }), roadmap)).toThrow(/locale/);
  expect(() => readProject(project({ locale: 'zz-ZZ' }), roadmap)).toThrow(/locale/);
});

// The example's offline snapshot command, as the map's timer runs it, in a machine zone of its own.
function generated(settings: Record<string, unknown>, zone: string): Snapshot {
  const data = mkdtempSync(join(tmpdir(), 'work-map-display-data-'));
  seed(data, new Date('2026-10-20T06:00:00Z'));
  execFileSync(
    process.execPath,
    [
      'src/cli/generate.ts',
      'snapshot',
      '--project',
      project(settings),
      '--repo-root',
      roadmap,
      '--data',
      data,
    ],
    { stdio: 'ignore', env: { ...process.env, TZ: zone, GH_TOKEN: '', GITHUB_TOKEN: '' } },
  );
  return JSON.parse(readFileSync(join(data, 'snapshot.json'), 'utf8')) as Snapshot;
}

it("writes the project's display into the snapshot, else the machine's zone", () => {
  expect(generated({ timeZone: 'Europe/London', locale: 'en-GB' }, 'Asia/Tokyo').display).toEqual({
    timeZone: 'Europe/London',
    locale: 'en-GB',
  });
  expect(generated({}, 'Asia/Tokyo').display).toEqual({ timeZone: 'Asia/Tokyo', locale: 'en-AU' });
});

it("starts the merge chart's bars on the map zone's own clock hours, half-hour zones too", () => {
  showTimesIn({ timeZone: 'Asia/Kolkata', locale: 'en-AU' });
  // Read at 9:10 am in Kolkata (UTC+5:30); merges at 8:40 am and 9:05 am.
  const merged = Object.fromEntries(
    ['2026-10-19T03:10:00Z', '2026-10-19T03:35:00Z'].map((at, i) => [
      i,
      { mergedAt: at } as PrView,
    ]),
  );
  const hours = clockHours(merged, '2026-10-19T03:40:00Z', 2);
  expect(hours.map((h) => [hourLabel(h.start), h.count])).toEqual([
    ['8 am', 1],
    ['9 am', 1],
  ]);
  expect(hours.map((h) => [h.start, h.end])).toEqual([
    ['2026-10-19T02:30:00.000Z', '2026-10-19T03:30:00.000Z'],
    ['2026-10-19T03:30:00.000Z', '2026-10-19T03:40:00.000Z'],
  ]);
});

const bars = (merges: string[], at: string, count: number) =>
  clockHours(
    Object.fromEntries(merges.map((m, i) => [i, { mergedAt: m } as PrView])),
    at,
    count,
  ).map((h) => [hourLabel(h.start), h.start, h.count]);

it('keeps one bar per clock hour across a half-hour daylight-saving change', () => {
  showTimesIn({ timeZone: 'Australia/Lord_Howe', locale: 'en-AU' });
  // 4 Oct: at 2 am the clock goes to 2:30 am, so the 2 am hour is half an hour long. A merge at 1:10 am.
  expect(bars(['2026-10-03T14:40:00Z'], '2026-10-03T17:10:00Z', 4)).toEqual([
    ['1 am', '2026-10-03T14:30:00.000Z', 1],
    ['2 am', '2026-10-03T15:30:00.000Z', 0],
    ['3 am', '2026-10-03T16:00:00.000Z', 0],
    ['4 am', '2026-10-03T17:00:00.000Z', 0],
  ]);
  // 5 Apr: at 2 am the clock goes back to 1:30 am, so the 1 am hour is an hour and a half long.
  const autumn = bars(['2026-04-04T14:10:00Z', '2026-04-04T15:10:00Z'], '2026-04-04T15:40:00Z', 3);
  expect(autumn).toEqual([
    ['12 am', '2026-04-04T13:00:00.000Z', 0],
    ['1 am', '2026-04-04T14:00:00.000Z', 2],
    ['2 am', '2026-04-04T15:30:00.000Z', 0],
  ]);
});
