// @vitest-environment jsdom
// TN-43: versions are read on Sync only, so a good read stays shown with its time between Syncs;
// only a failed browser read is stale.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VersionsSnapshot } from '../src/core/versions.ts';
import { SiteVersions } from '../src/web/SiteVersions.tsx';

const checkedAt = '2026-10-15T01:00:00.000Z';
const data: VersionsSnapshot = {
  schema: 'work-map-versions/1',
  repo: 'Example/site',
  checkedAt,
  main: 'a'.repeat(40),
  sites: [
    {
      name: 'Example site',
      origin: 'https://site.example.com',
      buildUrl: 'https://site.example.com/build.json',
      state: 'current',
      build: 'b'.repeat(12),
      sha: 'b'.repeat(40),
      merges: 3,
      reason: 'Served build resolved',
      lastKnown: null,
    },
  ],
};
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  // Eleven minutes after the read.
  vi.setSystemTime(Date.parse(checkedAt) + 11 * 60_000);
  host = document.createElement('div');
  host.className = 'app';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function open(failed: boolean): Promise<string> {
  await act(async () => root.render(createElement(SiteVersions, { data, failed })));
  await act(async () => host.querySelector<HTMLButtonElement>('.header-button')!.click());
  return host.querySelector('.callout')!.textContent!;
}

it('keeps a good read checked eleven minutes ago, with its time', async () => {
  const text = await open(false);
  expect(text).toContain('3 merges not live');
  expect(text).toContain('Checked ');
  expect(text).not.toContain('Merge distance pending');
  expect(text).not.toContain('Stale');
});

it('marks a failed browser read stale', async () => {
  const text = await open(true);
  expect(text).toContain('Merge distance pending');
  expect(text).toContain('Stale');
});
