import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { readProject } from '../src/readers/project.ts';
const fixture = {
  version: 1,
  id: 'synthetic',
  title: 'Synthetic',
  roadmapRepo: 'Example/plan',
  productRepo: 'Example/app',
  repos: ['Example/app'],
  files: {
    flow: 'flow.json',
    audit: 'audit.json',
    plan: 'plan.md',
    mapping: 'mapping.json',
    sections: 'sections.json',
  },
  lanePrefix: '',
  laneRules: [],
  dependencies: [],
  ticketConventions: {
    readyLabel: 'ready',
    ticketLabels: [],
    mapLabel: 'map',
    ideaLabels: [],
    ideaPattern: '^Idea',
    specLabels: [],
    specPattern: '^Spec',
  },
};
it('accepts the exact progress variants and rejects foreign repositories, malformed issue keys and mixed modes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ticket-config-'));
  const path = join(directory, 'project.json');
  const read = (progress: unknown) => {
    writeFileSync(path, JSON.stringify({ ...fixture, progress }));
    return readProject(path).project.progress;
  };
  expect(
    read({
      basis: 'ticket-count',
      repositories: { 'Example/app': 'build' },
      issues: { 'Example/app#1': 'outside' },
    })?.basis,
  ).toBe('ticket-count');
  expect(read({ basis: 'estimated-scope', scope: 'scope.json' })).toEqual({
    basis: 'estimated-scope',
    scope: 'scope.json',
  });
  for (const progress of [
    { basis: 'ticket-count', repositories: { 'Foreign/app': 'build' } },
    { basis: 'ticket-count', repositories: {}, issues: { 'Foreign/app#1': 'build' } },
    { basis: 'ticket-count', repositories: {}, issues: { '#1': 'build' } },
    { basis: 'ticket-count', repositories: {}, scope: 'scope.json' },
    { basis: 'estimated-scope', scope: 'scope.json', repositories: {} },
  ])
    expect(() => read(progress)).toThrow();
});

it('refuses a placement naming a section the diagram does not have (#193)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ticket-config-'));
  const path = join(directory, 'project.json');
  writeFileSync(join(directory, 'flow.json'), JSON.stringify({ nodes: [{ id: 'build' }] }));
  const read = (placement: unknown) => {
    writeFileSync(
      path,
      JSON.stringify({
        ...fixture,
        progress: { basis: 'ticket-count', repositories: {}, placement },
      }),
    );
    return readProject(path).project.progress;
  };
  expect(
    read({ 'Example/app': { labels: { ui: 'build' }, titlePrefixes: { x: 'outside' } } }),
  ).toBeTruthy();
  expect(() => read({ 'Example/app': { labels: { ui: 'nowhere' } } })).toThrow(/nowhere/);
  expect(() => read({ 'Example/app': { titlePrefixes: { ui: 'nowhere' } } })).toThrow(/nowhere/);
});

it('takes the re-check settings beside ticket counting, with defaults (#204)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ticket-config-'));
  const path = join(directory, 'project.json');
  const read = (recheck: unknown) => {
    writeFileSync(
      path,
      JSON.stringify({
        ...fixture,
        progress: {
          basis: 'ticket-count',
          repositories: {},
          unitAudit: { file: 'audit.json', unitPattern: '^(U\\d+):', recheck },
        },
      }),
    );
    const progress = readProject(path).project.progress;
    return progress?.basis === 'ticket-count' ? progress.unitAudit?.recheck : undefined;
  };
  expect(read({ enabled: true })).toEqual({
    enabled: true,
    dailyCalls: 20,
    confidence: 0.6,
    deepCalls: 40,
  });
  expect(read({ enabled: false, dailyCalls: 5, confidence: 0.7, deepCalls: 60 })).toEqual({
    enabled: false,
    dailyCalls: 5,
    confidence: 0.7,
    deepCalls: 60,
  });
  for (const bad of [{}, { enabled: true, dailyCalls: 0 }, { enabled: true, extra: 1 }])
    expect(() => read(bad)).toThrow();
});

it('still accepts the old re-check settings in either place, never both (#215)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ticket-config-'));
  const path = join(directory, 'project.json');
  const read = (progress: Record<string, unknown>) => {
    writeFileSync(
      path,
      JSON.stringify({
        ...fixture,
        progress: { basis: 'ticket-count', repositories: {}, ...progress },
      }),
    );
    return readProject(path).project;
  };
  expect(read({ recheck: { enabled: true } }).progress).toMatchObject({
    recheck: { enabled: true, dailyCalls: 20, confidence: 0.6, deepCalls: 40 },
  });
  expect(
    read({ unitAudit: { file: 'a.json', unitPattern: '^(U\\d+):', recheck: { enabled: true } } })
      .progress,
  ).toMatchObject({ unitAudit: { recheck: { enabled: true, confidence: 0.6 } } });
  expect(() =>
    read({
      recheck: { enabled: true },
      unitAudit: { file: 'a.json', unitPattern: '^(U\\d+):' },
    }),
  ).toThrow();
});
