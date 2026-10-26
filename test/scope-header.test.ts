// Project scope header (#93, #143): three shared bars, a graph-only merge tab, and a Tickets callout.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits } from '../src/core/plan.ts';
import { pendingTicketProgress, ticketCounts } from '../src/core/ticket-progress.ts';
import { reviewView } from '../src/core/coverage.ts';

const at = '2026-10-16T01:00:00Z';
const fixture = (name: string): string =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const base = buildSnapshot({
  audit: JSON.parse(fixture('audit.json')),
  flow: JSON.parse(fixture('flow.json')),
  plan: parseBuildUnits(fixture('build-units.md')),
  generatedAt: at,
});
const tickets = Array.from({ length: 4 }, (_, i) => ({
  key: `Example/app#${i + 1}`,
  url: `https://github.com/Example/app/issues/${i + 1}`,
  title: `Ticket ${i + 1}`,
  section: 'found',
  mapping: 'Repository default',
  state: i < 3 ? 'CLOSED' : 'OPEN',
  stateReason: i < 3 ? 'COMPLETED' : null,
}));
const counts = ticketCounts(tickets, true);
// Every bug fixed in 'found' (#143): the Bugs bar reads 100%, yet the card stays unpurpled.
const bugs = ticketCounts(
  Array.from({ length: 5 }, (_, i) => ({
    ...tickets[0]!,
    key: `Example/app#${i + 11}`,
    url: `https://github.com/Example/app/issues/${i + 11}`,
    title: `Bug ${i + 11}`,
    state: 'CLOSED',
    stateReason: 'COMPLETED',
  })),
  true,
);
// A census covering every section (as currentSnapshot requires) and a fresh GitHub read, so the
// merge graph renders.
const ticketSnapshot = {
  ...base,
  sources: {
    ...base.sources,
    github: {
      repo: 'Example/app',
      prsThrough: at,
      issuesThrough: at,
      lastRun: { at, partial: false, error: null },
    },
  },
  progressBasis: 'ticket-count',
  ticketProgress: {
    ...pendingTicketProgress(),
    at,
    complete: true,
    reason: null,
    byNode: Object.fromEntries(
      base.stages.flatMap((stage) =>
        stage.nodes.map((node) => [node.id, node.id === 'found' ? counts : ticketCounts([], true)]),
      ),
    ),
    totals: counts,
  },
};
const bugSnapshot = {
  ...ticketSnapshot,
  ticketProgress: {
    ...ticketSnapshot.ticketProgress,
    bugs: {
      byNode: Object.fromEntries(
        base.stages.flatMap((stage) =>
          stage.nodes.map((node) => [node.id, node.id === 'found' ? bugs : ticketCounts([], true)]),
        ),
      ),
      totals: bugs,
    },
  },
};
let server: ViteDevServer;
let browser: Browser;
beforeAll(async () => {
  server = await createServer({ server: { port: 0, host: '127.0.0.1' } });
  await server.listen();
  browser = await chromium.launch();
}, 30_000);
afterAll(async () => {
  await browser?.close();
  await server?.close();
});
async function open(data: unknown) {
  const context = await browser.newContext({ viewport: { width: 1080, height: 1920 } });
  const page = await context.newPage();
  await page.clock.install({ time: new Date(at) });
  await page.route('**/data/**', (route) =>
    new URL(route.request().url()).pathname === '/data/snapshot.json'
      ? route.fulfill({ json: data })
      : route.fulfill({ status: 404, body: '{}' }),
  );
  await page.goto(server.resolvedUrls!.local[0]!);
  await page.locator('.node').first().waitFor();
  return { page, context };
}

// #207: Progress (live / built / to do), Tickets and Review on every surface; the Bugs bar is gone
// and open bugs are a count.
it('shows Progress, Tickets and Review as shared bars on Project scope, with open bugs counted', async () => {
  const { page, context } = await open(bugSnapshot);
  try {
    await page.getByRole('button', { name: 'Project scope', exact: true }).click();
    const rows = page.locator('.overall-meters .m');
    expect(await rows.locator('.ml').allTextContents()).toEqual(['Progress', 'Tickets', 'Review']);
    expect(await rows.locator('.bar').count()).toBe(3);
    expect(await rows.nth(0).locator('.bar').getAttribute('aria-label')).toContain(
      'Live unknown · Built 75% · 25% to go',
    );
    expect(await rows.nth(1).locator('.bar').getAttribute('aria-label')).toBe(
      'Tickets · 3 done · 1 left',
    );
    expect(await page.locator('.overall-meters .momentum').textContent()).toContain(
      '0 open bugs · 5 fixed',
    );
    expect(await page.locator('.overall-meters .mb').count()).toBe(0);
  } finally {
    await context.close();
  }
});
it('draws Progress, Tickets and Review on every card and stage; fixed bugs never turn a card purple', async () => {
  const { page, context } = await open(bugSnapshot);
  try {
    for (const owner of ['.node', '.stage'])
      for (const titles of await page
        .locator(owner)
        .evaluateAll((els) =>
          els.map((el) => [...el.querySelectorAll('.bar-title')].map((t) => t.textContent)),
        ))
        expect(titles).toEqual(['Progress', 'Tickets', 'Review']);
    expect(await page.locator('.bugs-bar').count()).toBe(0);
    expect(await page.locator('#n-found .open-bugs').textContent()).toBe('0 open bugs');
    expect(await page.locator('#n-found .open-bugs').getAttribute('title')).toBe('5 fixed');
    expect(await page.locator('#n-found').getAttribute('data-progress')).not.toBe('live90');
  } finally {
    await context.close();
  }
});
// With a census or without: the merge graph, its stats and no bar, again after a trip to scope.
it.each([
  ['with', ticketSnapshot],
  ['without', { ...base, sources: ticketSnapshot.sources }],
])(
  'keeps Merge progress to the merge graph, with no ticket bar squeezing it, %s a ticket census',
  async (_, data) => {
    const { page, context } = await open(data);
    try {
      const graph = page.locator('.overview-panel .merge-graph > button');
      expect(await graph.count()).toBe(12);
      expect(await page.locator('.overview-panel .bar').count()).toBe(0);
      expect(await page.locator('.merge-summary .ml').allTextContents()).toEqual([
        'Average',
        'Last hour',
        'Queued',
      ]);
      expect(await page.getByText('Ticket inventory and mappings').count()).toBe(0);
      await page.getByRole('button', { name: 'Project scope', exact: true }).click();
      expect(await graph.count()).toBe(0);
      await page.getByRole('button', { name: 'Merge progress', exact: true }).click();
      expect(await graph.count()).toBe(12);
      expect(await page.locator('.merge-summary .ml').count()).toBe(3);
    } finally {
      await context.close();
    }
  },
);
it('opens the ticket inventory from the header toolbar, and hides it without a census', async () => {
  const { page, context } = await open(ticketSnapshot);
  try {
    await page.locator('header').getByRole('button', { name: 'Tickets' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ticket inventory and mappings' });
    const groups = dialog.locator('details.brief-group');
    expect(await groups.locator('> summary h3').allTextContents()).toEqual([
      'Completed',
      'All mapped tickets',
      'Mapping exceptions',
    ]);
    await groups.nth(0).locator('summary').click();
    expect(await groups.nth(0).locator('a').count()).toBe(3);
    await groups.nth(1).locator('summary').click();
    expect(await groups.nth(1).locator('a').count()).toBe(4);
  } finally {
    await context.close();
  }
  const plain = await open(base);
  try {
    expect(await plain.page.getByRole('button', { name: 'Tickets' }).count()).toBe(0);
  } finally {
    await plain.context.close();
  }
});
it('shows a header bar tooltip on focus, above the map viewport', async () => {
  const { page, context } = await open(ticketSnapshot);
  try {
    await page.getByRole('button', { name: 'Project scope', exact: true }).click();
    await page.locator('.overall-meters .ticket-bar [data-k=completed]').focus();
    const tooltip = page.locator('#scope-tooltip');
    expect(await tooltip.textContent()).toContain('3 done');
    expect(await tooltip.isVisible()).toBe(true);
  } finally {
    await context.close();
  }
});
it('updates an open bar tooltip when the snapshot refreshes', async () => {
  const live = structuredClone(ticketSnapshot);
  const { page, context } = await open(live);
  try {
    const anchor = page.locator('#n-found .ticket-bar [data-k=completed]');
    await anchor.focus();
    expect(await page.locator('#scope-tooltip').textContent()).toContain('3 done');
    // The next read (served as JSON when requested) has one ticket done.
    const reopened = structuredClone(tickets);
    for (const t of reopened.slice(1)) Object.assign(t, { state: 'OPEN', stateReason: null });
    const fewer = ticketCounts(reopened, true);
    live.ticketProgress.byNode['found'] = fewer;
    live.ticketProgress.totals = fewer;
    await page.clock.fastForward(60_000);
    await expect.poll(() => page.locator('#scope-tooltip').textContent()).toContain('1 done');
  } finally {
    await context.close();
  }
});
it('never calls a fully coded project that is not yet live Not built', async () => {
  // Every section merged and none live: the project bar says so, with no Not built segment.
  const coded = withScopes({
    found: { live: 0, merged: 100 },
    tasks: { live: 0, merged: 100 },
    fix: { live: 0, merged: 100 },
  });
  const { page, context } = await open(coded);
  try {
    await page.getByRole('button', { name: 'Project scope', exact: true }).click();
    const words = await page
      .locator('.overall-meters .m')
      .first()
      .locator('.bar')
      .getAttribute('aria-label');
    expect(words).toContain('Merged, not live · 100%');
    expect(words).not.toContain('Not built');
  } finally {
    await context.close();
  }
});

// A map without a ticket census: the project's Progress weighs every section the same, across
// stages, from the work.
const nodes = base.stages.flatMap((stage) => stage.nodes);
function withScopes(scopes: Record<string, { live: number; merged?: number; pending?: boolean }>) {
  const review = reviewView([], true);
  return {
    ...base,
    work: {
      at,
      complete: true,
      error: null,
      review,
      unplacedPrs: [],
      wires: [],
      byNode: Object.fromEntries(
        nodes.map((node) => {
          const { live, merged = 0, pending = false } = scopes[node.id]!;
          const shares = { live, merged, built: 0, planned: 100 - live - merged };
          const scope = { shares, display: shares, estimated: false, pending };
          return [
            node.id,
            {
              state: 'live',
              shares,
              scope: { ...scope, reason: 'Invented scope', at },
              review,
              openPrs: [],
              planning: { idea: [], map: [], tickets: [], spec: [], build: [] },
              missing: [],
              blockers: [],
            },
          ];
        }),
      ),
    },
  };
}
/** The project's Progress on Project scope: whether it is pending, and its live width. */
async function projectProgress(data: unknown): Promise<{ pending: string | null; live: number }> {
  const { page, context } = await open(data);
  try {
    await page.getByRole('button', { name: 'Project scope', exact: true }).click();
    const progress = page.locator('.overall-meters .scope-bar');
    return {
      pending: await progress.getAttribute('data-pending'),
      live: await progress
        .locator('[data-k]')
        .first()
        .evaluate((el) =>
          el.getAttribute('data-k') === 'live'
            ? Number.parseFloat((el as HTMLElement).style.width)
            : 0,
        ),
    };
  } finally {
    await context.close();
  }
}
it('weighs every section the same in the project Progress, and holds it for a section without weights', async () => {
  // 'found' is alone in the first stage: equal sections give 40% live, equal stages would give 30%.
  const fromWork = await projectProgress(
    withScopes({ found: { live: 0 }, tasks: { live: 60 }, fix: { live: 60 } }),
  );
  expect(fromWork).toEqual({ pending: 'no', live: 40 });
  const unweighted = await projectProgress(
    withScopes({ found: { live: 0, pending: true }, tasks: { live: 60 }, fix: { live: 60 } }),
  );
  expect(unweighted.pending).toBe('yes');
});
// A pointer over a bar segment shows its words, as focus does.
it('shows a project Progress segment’s words on hover', async () => {
  const { page, context } = await open(
    withScopes({ found: { live: 0 }, tasks: { live: 60 }, fix: { live: 60 } }),
  );
  try {
    await page.getByRole('button', { name: 'Project scope', exact: true }).click();
    const tooltip = page.locator('#scope-tooltip');
    expect(await tooltip.count()).toBe(0);
    await page.locator('.overall-meters .scope-bar [data-k=live]').hover();
    expect(await tooltip.allTextContents()).toEqual(['Live40%']);
    await page.locator('.overall-meters .scope-bar [data-k=planned]').hover();
    expect(await tooltip.allTextContents()).toEqual(['Not built60%']);
  } finally {
    await context.close();
  }
});
// An estimated-scope map (#118) weighs its own effort, not audit units: with every section's scope
// known, the project Progress shows, though no section has a unit.
it('shows the project Progress from known estimated scopes, with no audit units', async () => {
  const audit = JSON.parse(fixture('audit.json'));
  const flow = JSON.parse(fixture('flow.json'));
  audit.units = {};
  for (const node of flow.nodes) node.units = [];
  const unitless = buildSnapshot({
    audit,
    flow,
    plan: parseBuildUnits('# Build units\n\n## Units by wave\n'),
    generatedAt: at,
  });
  expect(unitless.stages.flatMap((stage) => stage.nodes).every((node) => !node.units.length)).toBe(
    true,
  );
  const data = withScopes({ found: { live: 0 }, tasks: { live: 0 }, fix: { live: 0 } });
  for (const section of Object.values(data.work.byNode)) {
    const shares = { live: 0, merged: 10, built: 0, planned: 90 };
    Object.assign(section, {
      shares,
      scope: { ...section.scope, shares, display: shares, estimated: true },
    });
  }
  const { page, context } = await open({
    ...unitless,
    progressBasis: 'estimated-scope',
    work: data.work,
  });
  try {
    await page.getByRole('button', { name: 'Project scope', exact: true }).click();
    const progress = page.locator('.overall-meters .scope-bar');
    expect(await progress.getAttribute('data-pending')).toBe('no');
    expect(await progress.getAttribute('aria-label')).toContain('Merged, not live · 10%');
  } finally {
    await context.close();
  }
});
it('holds the project Progress when a snapshot refresh fails', async () => {
  const { page, context } = await open(
    withScopes({ found: { live: 0 }, tasks: { live: 60 }, fix: { live: 60 } }),
  );
  try {
    await page.getByRole('button', { name: 'Project scope', exact: true }).click();
    const progress = page.locator('.overall-meters .scope-bar');
    expect(await progress.getAttribute('data-pending')).toBe('no');
    await page.route('**/data/snapshot.json', (route) =>
      route.fulfill({ status: 503, body: '{}' }),
    );
    await page.clock.runFor(60_001);
    await page.getByText(/refresh failed/).waitFor();
    expect(await progress.getAttribute('data-pending')).toBe('yes');
  } finally {
    await context.close();
  }
});
it('opens header callouts folded, keeps them for clicks inside, and closes them on Escape or a click elsewhere', async () => {
  const { page, context } = await open({
    ...ticketSnapshot,
    loadingBay: {
      schema: 'work-map-loading-bay/1',
      githubAt: null,
      readyLabel: null,
      complete: false,
      reason: 'Publication pending',
      prs: [],
    },
  });
  try {
    await page.locator('header').getByRole('button', { name: 'Tickets', exact: true }).click();
    const inventory = page.getByRole('dialog', { name: 'Ticket inventory and mappings' });
    const groups = inventory.locator('details.brief-group');
    expect(await groups.nth(0).getAttribute('open')).toBeNull();
    await groups.nth(1).locator('summary').click();
    expect(await groups.nth(1).locator('a').first().getAttribute('href')).toBe(
      'https://github.com/Example/app/issues/1',
    );
    await page.keyboard.press('Escape');
    expect(await inventory.count()).toBe(0);
    const button = page.getByRole('button', { name: 'Loading bay', exact: true });
    await button.click();
    const bay = page.getByRole('dialog', { name: 'GitHub loading bay' });
    expect(await bay.locator('.brief-date').textContent()).toContain('pending');
    await bay.getByText('Sources and status', { exact: true }).click();
    expect(await bay.isVisible()).toBe(true);
    await page.keyboard.press('Escape');
    expect(await bay.count()).toBe(0);
    await button.click();
    await page.getByRole('button', { name: 'Project scope', exact: true }).click();
    expect(await bay.count()).toBe(0);
  } finally {
    await context.close();
  }
});
