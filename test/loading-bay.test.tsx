// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { buildLoadingBay, currentLoadingBay, type LedgerPr } from '../src/core/loading-bay.ts';
import { emptyWorkCache, refreshWork } from '../src/readers/work-github.ts';
import type { Project } from '../src/readers/project.ts';
import { LoadingBay, LoadingBayContents } from '../src/web/LoadingBay.tsx';

const at = '2026-10-15T01:00:00.000Z';
const now = Date.parse(at);
const pr: LedgerPr = {
  key: 'Acme/app#4',
  title: 'Feature',
  url: 'https://github.com/Acme/app/pull/4',
  checkedAt: at,
  complete: true,
  status: 'merged',
  reason: null,
  events: [{ id: 'merged', kind: 'merged', at, reason: null }],
};
const bay = buildLoadingBay({
  ...emptyWorkCache('demo'),
  at,
  complete: true,
  ledgerComplete: true,
  ledgerPrs: [pr],
});
it.each(['present', 'missing'])(
  'does not publish or render a current description claim from retained %s data',
  (state) => {
    const retained = {
      ...pr,
      terminal: true,
      pointers: {
        state,
        checkedAt: at,
        why: 'Retained description must not appear',
        leftUndone: ['Acme/app#7'],
        closes: ['Acme/app#9'],
      },
    };
    const publication = buildLoadingBay({
      ...emptyWorkCache('demo'),
      at,
      complete: true,
      ledgerComplete: true,
      ledgerPrs: [retained],
    });
    expect(publication.prs[0]).not.toHaveProperty('pointers');
    expect(publication.prs[0]).not.toHaveProperty('terminal');
    const browser = currentLoadingBay({ ...publication, prs: [retained] });
    expect(browser?.prs[0]).not.toHaveProperty('pointers');
    expect(browser?.prs[0]).not.toHaveProperty('terminal');
    const html = renderToStaticMarkup(
      createElement(LoadingBayContents, {
        data: { ...publication, prs: [retained] },
        failed: false,
        now,
      }),
    );
    expect(html).toContain('Change descriptions pending follow-up.');
    expect(html).not.toMatch(
      /description pointers|Description incomplete|Change description<\/th>/i,
    );
    expect(html).not.toContain('Retained description must not appear');
    expect(html).not.toContain('/issues/7');
    expect(html).not.toContain('/issues/9');
    expect(html).toContain('merged');
  },
);
it('renders the loading bay independently of missing Seat Gauge and retains dated history on failure', () => {
  const html = renderToStaticMarkup(
    createElement(LoadingBayContents, { data: bay, failed: false, now }),
  );
  expect(html).toContain('Change descriptions pending follow-up.');
  expect(html).toContain('Session totals are shown separately in Seat Gauge.');
  expect(html).toContain('PR readiness pending');
  expect(html).not.toContain('Agent / worked on');
  for (const props of [
    { failed: true, now },
    { failed: false, now: now + 600_001 },
  ]) {
    const pending = renderToStaticMarkup(
      createElement(LoadingBayContents, { data: bay, ...props }),
    );
    expect(pending).toContain('Change descriptions pending follow-up.');
    expect(pending).toContain('Dated history');
    expect(pending).toContain('merged');
  }
});
it('validates the optional publication independently', () => {
  expect(currentLoadingBay(bay)).not.toBeNull();
  expect(currentLoadingBay({ ...bay, prs: [pr, pr] })).toBeNull();
  expect(currentLoadingBay({ ...bay, prs: [{ ...pr, checkedAt: 'yesterday' }] })).toBeNull();
});
it('groups the loading bay by milestone in the standard callout groups, with no table', () => {
  const dropped: LedgerPr = {
    ...pr,
    key: 'Acme/app#5',
    url: 'https://github.com/Acme/app/pull/5',
    title: 'Dropped change',
    status: 'dropped',
    reason: 'failed_checks',
    events: [{ id: 'd', kind: 'dropped', at, reason: 'failed_checks' }],
  };
  const data = buildLoadingBay({
    ...emptyWorkCache('demo'),
    at,
    complete: true,
    ledgerComplete: true,
    ledgerPrs: [pr, dropped],
  });
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(
    createElement(LoadingBayContents, { data, failed: false, now }),
  );
  expect(root.querySelector('table')).toBeNull();
  const groups = [...root.querySelectorAll('details.brief-group')].map(
    (g) => g.querySelector('summary')?.textContent,
  );
  expect(groups).toEqual(['Dropped1', 'Merged1', 'Sources and status4']);
  const row = root.querySelector('details.brief-group .brief-row')!;
  expect(row.querySelector('a.brief-row-title')?.getAttribute('href')).toBe(dropped.url);
  expect(row.querySelector('.brief-key')?.textContent).toBe('Acme/app#5');
  expect(row.textContent).toContain('Dropped change');
  expect(row.textContent).toContain('dropped · ');
  expect(row.textContent).toContain('failed_checks');
  expect(row.querySelector('details summary')?.textContent).toBe('Dated history');
});
it('shows loading-bay times in the cards’ time zone, not the viewer’s daylight-saving zone', () => {
  const zone = process.env['TZ'];
  process.env['TZ'] = 'Australia/Sydney';
  try {
    const html = renderToStaticMarkup(
      createElement(LoadingBayContents, { data: bay, failed: false, now }),
    );
    // 01:00 UTC is 11:00 am in Brisbane, as the cards show it; Sydney's daylight time would say 12:00 pm.
    expect(html).toContain('as of 15/10/2026, 11:00:00 am');
    expect(html).not.toContain('12:00:00 pm');
  } finally {
    if (zone === undefined) delete process.env['TZ'];
    else process.env['TZ'] = zone;
  }
});
it('marks the loading bay snapshot pending after a failed, incomplete or missing read, and its rows dated', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const host = document.createElement('div');
  host.className = 'app';
  document.body.append(host);
  const root = createRoot(host);
  const line = () => host.querySelector('.callout > .brief-date')?.textContent;
  const row = () => host.querySelector('.brief-row > p')?.textContent;
  try {
    await act(async () =>
      root.render(createElement(LoadingBay, { data: bay, failed: false, now })),
    );
    await act(async () => host.querySelector<HTMLButtonElement>('.header-button')!.click());
    expect(line()).not.toContain('pending');
    expect(row()).not.toContain('(dated)');
    for (const props of [
      { data: bay, failed: true, now },
      { data: { ...bay, complete: false }, failed: false, now },
      { data: undefined, failed: false, now },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- each read replaces the last on the open callout
      await act(async () => root.render(createElement(LoadingBay, props)));
      expect(line()).toMatch(/^GitHub as of .* · pending$/);
      if (props.data) expect(row()).toContain('(dated)');
    }
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
it('a read with one PR whose labels GitHub cut short still gives a complete loading bay (TN-37)', async () => {
  const project: Project = {
    version: 1,
    id: 'demo',
    title: 'Demo',
    roadmapRepo: 'Acme/roadmap',
    productRepo: 'Acme/app',
    repos: ['Acme/app'],
    files: { flow: 'a', audit: 'b', plan: 'c', mapping: 'd', sections: 'e' },
    lanePrefix: 'L-',
    laneRules: [],
    ticketConventions: {
      readyLabel: 'merge-ready',
      ticketLabels: [],
      mapLabel: 'map',
      ideaLabels: [],
      ideaPattern: 'idea',
      specLabels: [],
      specPattern: 'spec',
    },
    dependencies: [],
  };
  const merged = {
    number: 4,
    title: 'Feature',
    body: null,
    url: 'https://github.com/Acme/app/pull/4',
    createdAt: at,
    updatedAt: at,
    headRefName: 'b-4',
    headRepository: { nameWithOwner: 'Acme/app' },
    labels: { totalCount: 101, nodes: Array.from({ length: 100 }, (_, n) => ({ name: `l${n}` })) },
    latestOpinionatedReviews: { totalCount: 0, nodes: [] },
    comments: { totalCount: 0, nodes: [] },
    closingIssuesReferences: { totalCount: 0, nodes: [] },
    timelineItems: {
      totalCount: 1,
      pageInfo: { hasNextPage: false },
      nodes: [{ kind: 'MergedEvent', id: 'm4', createdAt: at }],
    },
    files: { totalCount: 1, nodes: [{ path: 'src/app.ts' }] },
  };
  const cache = await refreshWork({
    project,
    cache: emptyWorkCache('demo'),
    now: new Date(now),
    run: async (args) => {
      if (args[1] === 'rate_limit')
        return JSON.stringify({
          resources: { core: { remaining: 5000 }, graphql: { remaining: 5000 } },
        });
      const state = /states:(\w+)/.exec(args.find((a) => a.startsWith('query=')) ?? '')?.[1];
      return JSON.stringify({
        data: {
          rateLimit: { remaining: 5000 },
          repository: {
            [state ? 'pullRequests' : 'issues']: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: state === 'MERGED' ? [merged] : [],
            },
          },
        },
      });
    },
  });
  expect(buildLoadingBay(cache)).toMatchObject({ complete: true, reason: null });
  expect(cache.truncated).toBe(true);
  expect(cache.mergedPrs?.[0]?.labelsComplete).toBe(false);
});
