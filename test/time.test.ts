// Only an ISO 8601 time with Z or a ±hh:mm offset is converted to AEST; any other text is shown
// exactly as written, so nothing depends on the viewer's zone or on how a parser reads free text (#152).
import { expect, it } from 'vitest';
import { shortTime, stamp } from '../src/core/time.ts';

it.each([
  ['2026-10-17T01:00:00.000Z', '17/10/2026, 11:00:00 am'],
  ['2026-10-17T01:00:00Z', '17/10/2026, 11:00:00 am'],
  ['2026-10-17T11:00:00+10:00', '17/10/2026, 11:00:00 am'],
  ['2026-10-16T18:00-07:00', '17/10/2026, 11:00:00 am'],
  ['2024-02-29T23:30:00-07:00', '01/03/2024, 4:30:00 pm'],
  ['0099-01-01T11:00:00+10:00', '01/01/99, 11:00:00 am'],
  ['0004-02-29T01:00:00Z', '29/02/4, 11:00:00 am'],
])('converts %s', (at, shown) => {
  expect(stamp(at)).toBe(shown);
});

it.each([
  '13 October 2026',
  '2026-10-13',
  '2026-10-17T01:00:00',
  '2026-10-17T11:00:00+1000',
  '2026-10-17 01:00:00Z',
  '2026-02-30T01:00:00Z',
  '2026-02-29T01:00:00+10:00',
  '2026-04-31T01:00:00-07:00',
  '0001-02-29T01:00:00Z',
  '2026-13-01T00:00:00Z',
  '2026-10-17T24:00:00Z',
  '2026-10-17T01:60:00Z',
  '2026-10-17T01:00:00+24:00',
  '13 October 2026, 8:45 pm UTC',
  '13 October 2026 20:45:00 GMT+0000 (Coordinated Universal Time)',
  '13 October 2026 20:45:00 (previous run UTC)',
  '20:45 2026-10-13',
  '20:45 13 Oct 2026+0100',
  '13 October 2026, about 8:45 pm AEST',
  'not recorded',
])('shows %s exactly as written', (at) => {
  expect(stamp(at)).toBe(at);
});

it('shows UTC+10 in every viewer zone, across midnight and for historical dates', () => {
  const saved = process.env['TZ'];
  try {
    for (const zone of ['UTC', 'Australia/Sydney', 'America/Los_Angeles', 'Pacific/Auckland']) {
      process.env['TZ'] = zone;
      expect(stamp('2026-10-16T15:00:00Z'), zone).toBe('17/10/2026, 1:00:00 am');
      expect(shortTime('2026-10-16T15:00:00Z'), zone).toBe('17 Oct, 1:00 am');
      // Fixed UTC+10, not Brisbane's historical local mean time (+10:12:08 before 1895).
      expect(stamp('1894-01-01T01:00:00Z'), zone).toBe('01/01/1894, 11:00:00 am');
      expect(shortTime('1894-01-01T01:00:00Z'), zone).toBe('1 Jan, 11:00 am');
    }
  } finally {
    if (saved === undefined) delete process.env['TZ'];
    else process.env['TZ'] = saved;
  }
});
