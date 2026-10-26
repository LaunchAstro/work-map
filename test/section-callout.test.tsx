// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { buildSnapshot } from '../src/core/snapshot.ts';
import { parseBuildUnits, type Audit, type Flow } from '../src/core/plan.ts';
import {
  pendingTicketProgress,
  ticketCounts,
  type ProgressTicket,
} from '../src/core/ticket-progress.ts';
import { SectionCallout } from '../src/web/SectionCallout.tsx';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const at = '2026-10-17T01:00:00Z';
const snapshot = buildSnapshot({
  audit: JSON.parse(fixture('audit.json')) as Audit,
  flow: JSON.parse(fixture('flow.json')) as Flow,
  plan: parseBuildUnits(fixture('build-units.md')),
  generatedAt: at,
});
const [node, other] = snapshot.stages.flatMap((stage) => stage.nodes);
const question = (n: number, section: string): ProgressTicket => ({
  key: `Example/app#${n}`,
  title: `Question ${n}`,
  url: `https://github.com/Example/app/issues/${n}`,
  section,
  mapping: 'Repository default',
  state: 'OPEN',
  stateReason: null,
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it('a section’s details list only its own questions left out (#88)', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const host = document.createElement('div');
  const anchor = document.createElement('button');
  document.body.append(host, anchor);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <SectionCallout
          n={node!}
          snapshot={{
            ...snapshot,
            progressBasis: 'ticket-count',
            ticketProgress: {
              ...pendingTicketProgress(),
              at,
              complete: true,
              reason: null,
              byNode: { [node!.id]: ticketCounts([], true) },
              skipped: [question(1, node!.id), question(2, other!.id)],
            },
          }}
          snapshotFailed={false}
          anchor={anchor}
          viewport={host}
          view={{ x: 0, y: 0, scale: 1 }}
          close={() => {}}
          keyboard={false}
          ticketFailed={false}
          now={Date.parse(at)}
        />,
      ),
    );
    const group = [...host.querySelectorAll('details')].find(
      (element) => element.querySelector('h3')?.textContent === 'Questions left out',
    );
    expect([...group!.querySelectorAll('a')].map((a) => a.href)).toEqual([
      'https://github.com/Example/app/issues/1',
    ]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    anchor.remove();
  }
});
