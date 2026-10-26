// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import { App } from '../src/web/App.tsx';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const alpha = buildSnapshot({
  audit: JSON.parse(fixture('audit.json')) as Audit,
  flow: JSON.parse(fixture('flow.json')) as Flow,
  plan: parseBuildUnits(fixture('build-units.md')),
  generatedAt: new Date().toISOString(),
});
const beta = { ...alpha, id: 'beta', title: 'Beta roadmap' };
const sections = alpha.stages.flatMap((stage) => stage.nodes.map((node) => node.id));
const json = (value: unknown): Response => new Response(JSON.stringify(value));

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 20));
  });
}

it('while B’s snapshot is still loading, A’s board stays painted (#184)', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  let releaseBeta: (() => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const map = url.startsWith('/m/beta/') ? 'beta' : 'alpha';
      const file = url.slice(url.lastIndexOf('/') + 1);
      if (file === 'snapshot.json') {
        if (map === 'alpha') return json(alpha);
        await new Promise<void>((done) => (releaseBeta = done));
        return json(beta);
      }
      return new Response(null, { status: 404 });
    }),
  );
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
  await settle();
  const cards = (): string[] =>
    [...container.querySelectorAll('.node')].map((card) => card.textContent ?? '');
  const title = (): string => container.querySelector('header')?.textContent ?? '';
  expect(cards()).toHaveLength(sections.length);
  expect(title()).not.toContain('Beta');

  history.pushState(null, '', '/?map=beta');
  await act(async () => {
    globalThis.dispatchEvent(new PopStateEvent('popstate'));
  });
  await settle();
  // A's board is still painted while B's snapshot is read.
  expect(cards()).toHaveLength(sections.length);
  expect(releaseBeta).toBeDefined();
  expect(title()).not.toContain('Beta');

  await act(async () => releaseBeta?.());
  await settle();
  // Then B's own board is painted.
  expect(cards()).toHaveLength(sections.length);
  expect(title()).toContain('Beta work map');
});

it('a map with no versions file never shows the previous map’s site versions (#168)', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  const versions = {
    schema: 'work-map-versions/1',
    repo: 'Example/alpha',
    checkedAt: new Date().toISOString(),
    main: null,
    sites: [
      {
        name: 'Alpha private client site',
        origin: 'https://alpha.example.com',
        buildUrl: 'https://alpha.example.com/build.json',
        state: 'pending',
        build: null,
        sha: null,
        merges: null,
        reason: 'Invented evidence',
        lastKnown: null,
      },
    ],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const map = url.startsWith('/m/beta/') ? 'beta' : 'alpha';
      const file = url.slice(url.lastIndexOf('/') + 1);
      if (file === 'snapshot.json') return json(map === 'alpha' ? alpha : beta);
      if (file === 'versions.json' && map === 'alpha') return json(versions);
      return new Response(null, { status: 404 });
    }),
  );
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
  await settle();
  const button = (): HTMLButtonElement | undefined =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Site versions');
  await act(async () => button()?.click());
  expect(document.body.textContent).toContain('Alpha private client site');
  await act(async () => button()?.click());

  history.pushState(null, '', '/?map=beta');
  await act(async () => {
    globalThis.dispatchEvent(new PopStateEvent('popstate'));
  });
  await settle();
  expect(container.querySelector('header')?.textContent).toContain('Beta work map');
  await act(async () => button()?.click());
  expect(document.body.textContent).not.toContain('Alpha private client site');
  container.remove();
});
