// @vitest-environment jsdom
// TN-49: the header's "updated" time keeps its date unless the snapshot is from today, in AEST.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import { Header } from '../src/web/Header.tsx';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
// 14:40Z on the 18th is 12:40 am on 19 Oct in AEST.
const snapshot = buildSnapshot({
  audit: JSON.parse(fixture('audit.json')) as Audit,
  flow: JSON.parse(fixture('flow.json')) as Flow,
  plan: parseBuildUnits(fixture('build-units.md')),
  generatedAt: '2026-10-18T14:40:00.000Z',
});
function updated(now: string): string {
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(
    <Header
      maps={{ data: null, failed: null }}
      s={snapshot}
      a={null}
      snapFailed={null}
      versions={{ data: null, failed: null }}
      tickets={undefined}
      seatGauge={null}
      now={Date.parse(now)}
      camera={{ zoom: 100, zoomStep: () => {}, home: () => {} }}
      showPercentages={true}
      setShowPercentages={() => {}}
      showAgents={true}
      setShowAgents={() => {}}
      theme="light"
      setTheme={() => {}}
      syncState={{ state: 'idle' }}
      syncMap={async () => {}}
    />,
  );
  return root.querySelector('.updated')!.textContent!.split(' · ')[0]!;
}

it('shows the date when the snapshot is from an earlier day', () => {
  expect(updated('2026-10-20T01:00:00.000Z')).toBe('updated 19 Oct, 12:40 am');
});

it('shows only the time when the snapshot is from today', () => {
  expect(updated('2026-10-18T20:00:00.000Z')).toBe('updated 12:40 am');
});

it('shows the date when the snapshot is from the same day a year earlier', () => {
  expect(updated('2027-10-18T20:00:00.000Z')).toBe('updated 19 Oct, 12:40 am');
});
