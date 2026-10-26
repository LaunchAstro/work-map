import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTicketProgress, type TicketProgress } from '../src/core/ticket-progress.ts';
import { auditBaseline } from '../src/core/unit-scores.ts';
import type { WorkIssue } from '../src/core/work.ts';
import type { Project } from '../src/readers/project.ts';
import { cardTone } from '../src/web/interactions.ts';
import { lastMergeAt, meters, momentum } from '../src/web/meters.ts';

// #207 (folds in #174): one module decides every bar and count for cards, stages and the header.
const project: Project = {
  version: 1,
  id: 'synthetic',
  title: 'Synthetic',
  roadmapRepo: 'Example/plan',
  productRepo: 'Example/app',
  repos: ['Example/app'],
  files: { flow: 'f', audit: 'a', plan: 'p', mapping: 'm', sections: 's' },
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
  progress: {
    basis: 'ticket-count',
    repositories: { 'Example/app': 'build' },
    bugLabels: ['bug'],
    skipLabels: ['roadmap:grilling'],
    unitAudit: { file: 'a.json', unitPattern: '^(U\\d+):' },
  },
};
const at = '2026-10-18T00:00:00Z';
const now = Date.parse(at);
const issue = (n: number, patch: Partial<WorkIssue> = {}): WorkIssue => ({
  key: `Example/app#${n}`,
  title: 'Task',
  body: '',
  url: `https://github.com/Example/app/issues/${n}`,
  state: 'OPEN',
  stateReason: null,
  parent: null,
  labels: [],
  blockedBy: [],
  contextComplete: true,
  ...patch,
});
const closed = (daysAgo: number) => ({
  state: 'CLOSED',
  stateReason: 'COMPLETED',
  closedAt: new Date(now - daysAgo * 86_400_000).toISOString(),
});
// U01 (4 days, built 0.5, live partly) open with one absorbed; one loose ticket closed 2 days ago;
// one loose open; two bugs (one fixed) and a grilling question, which the Tickets bar never counts.
const census = (extra: WorkIssue[] = []): TicketProgress =>
  buildTicketProgress({
    project,
    plan: { units: {}, tickets: {}, unitIssues: {} },
    nodes: [{ id: 'build', units: [] }],
    maps: {},
    issues: Object.fromEntries(
      [
        issue(1, { title: 'U01: Kit' }),
        issue(2, { state: 'CLOSED', stateReason: 'NOT_PLANNED', absorbedInto: 'Example/app#1' }),
        issue(3, closed(2)),
        issue(4),
        issue(5, { labels: ['bug'] }),
        issue(6, { labels: ['bug'], ...closed(1) }),
        issue(7, { labels: ['roadmap:grilling'] }),
        ...extra,
      ].map((i) => [i.key, i]),
    ),
    at,
    complete: true,
    error: null,
    unitScores: {
      asAt: '13 October 2026',
      units: { U01: auditBaseline({ days: 4, code: 0.5, live: 'partly' }, '13 October 2026') },
    },
  })!;
const work = { scope: undefined, review: undefined };

describe('one meters module (#207)', () => {
  it('Progress is live, built not live and to do, with the hover from the spec', () => {
    const m = meters({ tickets: census(), work, sections: ['build'], failed: false, now });
    // Weights 2 each (4 days over U01's two tickets; loose tickets the same average). Built: U01
    // 2 × 2 × 0.5 + the closed loose 2 = 4 of 8. Live: U01 2 × 2 × 0.25 = 1 of 8.
    expect(m.progress.segments.map((s) => [s.key, s.tone, Math.round(s.share)])).toEqual([
      ['live', 'live', 13],
      ['built', 'merged', 38],
      ['planned', 'rest', 50],
    ]);
    expect(m.progress.segments[0]!.words).toBe(
      'Live 13% · Built 50% · 50% to go · 25% from the audit',
    );
  });
  it('labels both live and built: live its share, built the whole built figure (18 Oct 2026)', () => {
    const m = meters({ tickets: census(), work, sections: ['build'], failed: false, now });
    expect(m.progress.segments.map((s) => [s.key, s.label])).toEqual([
      ['live', 13],
      ['built', 50],
      ['planned', null],
    ]);
  });
  it('label text is white on the dark purple and near-black on the light purple', () => {
    const css = readFileSync(join(import.meta.dirname, '..', 'src', 'web', 'bar.css'), 'utf8');
    const base = readFileSync(
      join(import.meta.dirname, '..', 'src', 'web', 'flow', '01-base.css'),
      'utf8',
    );
    expect(base).toMatch(/--on-accent:\s*#fff;/);
    expect(base).toMatch(/--on-merged:\s*#25202b;/);
    expect(css).toMatch(/\[data-tone='merged'\]\s*\{[^}]*color:\s*var\(--on-merged\)/);
    expect(css).toMatch(/\.bar-label\s*\{[^}]*color:\s*inherit/);
  });
  it('the three footer counts wrap instead of being cut off', () => {
    const css = readFileSync(
      join(import.meta.dirname, '..', 'src', 'web', 'flow', '09-card-footer.css'),
      'utf8',
    );
    expect(css).toMatch(/nth-last-child\(3\) ~ span\s*\{[^}]*white-space:\s*normal/);
  });
  it('Tickets counts build tickets done and left, never bugs or questions', () => {
    const m = meters({ tickets: census(), work, sections: ['build'], failed: false, now });
    expect(m.tickets?.segments[0]!.words).toBe('1 done · 3 left · 1 absorbed');
    expect(m.tickets?.meter).toBe(25);
  });
  it('counts open bugs with the fixed count, and a momentum line', () => {
    const m = meters({ tickets: census(), work, sections: ['build'], failed: false, now });
    expect(m.bugs).toEqual({ open: 1, fixed: 1 });
    expect(m.momentum).toBe('+1 ticket this week');
  });
  // #242: an old census keeps its bars and counts between Syncs; a failed read holds them.
  it('an old census keeps its bars; a failed read holds every bar and drops the counts', () => {
    const old = meters({
      tickets: census(),
      work,
      sections: ['build'],
      failed: false,
      now: now + 11 * 60_000,
    });
    expect(old.progress.pending).toBeNull();
    expect(old.bugs).toEqual({ open: 1, fixed: 1 });
    const m = meters({ tickets: census(), work, sections: ['build'], failed: true, now });
    expect(m.progress.pending).not.toBeNull();
    expect(m.tickets?.pending).not.toBeNull();
    expect(m.bugs).toBeNull();
  });
  it('a held section holds its own card, any stage or project bar over it, and no other section', () => {
    const held = { ...census(), pendingSections: ['other'] };
    const bars = (sections: readonly string[] | null) =>
      meters({ tickets: held, work, sections, failed: false, now });
    expect(bars(['build']).progress.pending).toBeNull();
    expect(bars(['build']).tickets?.pending).toBeNull();
    for (const sections of [['other'], ['build', 'other'], null]) {
      expect(bars(sections).progress.pending, String(sections)).not.toBeNull();
      expect(bars(sections).tickets?.pending, String(sections)).not.toBeNull();
    }
  });
  it('a map without unit scores reads live unknown; a scope map has no Tickets bar', () => {
    const plain = buildTicketProgress({
      project: {
        ...project,
        progress: { basis: 'ticket-count', repositories: { 'Example/app': 'build' } },
      },
      plan: { units: {}, tickets: {}, unitIssues: {} },
      nodes: [{ id: 'build', units: [] }],
      maps: {},
      issues: { 'Example/app#3': issue(3, closed(2)), 'Example/app#4': issue(4) },
      at,
      complete: true,
      error: null,
    })!;
    const m = meters({ tickets: plain, work, sections: null, failed: false, now });
    expect(m.progress.segments[0]!.words).toBe('Live unknown · Built 50% · 50% to go');
    expect(m.progress.segments.map((s) => s.tone)).toEqual(['completed', 'rest']);
    const scope = meters({ tickets: undefined, work, sections: ['build'], failed: false, now });
    expect(scope.tickets).toBeNull();
    expect(scope.bugs).toBeNull();
    expect(scope.momentum).toBeNull();
  });
});

describe('momentum (#207)', () => {
  it('says how long nothing has moved, from the last close or merge', () => {
    const counts = census().byNode['build']!;
    expect(momentum(counts, null, now + 9 * 86_400_000)).toBe('nothing moved in 11 days');
    expect(momentum(counts, now + 8 * 86_400_000, now + 9 * 86_400_000)).toBe(
      'nothing moved in 1 day',
    );
    expect(momentum(undefined, null, now)).toBeNull();
  });
  it('reads the last merge of the sections’ build PRs from the snapshot', () => {
    const snapshot = {
      sources: { github: { repo: 'Example/app' } },
      prs: { 9: { number: 9, mergedAt: '2026-10-16T00:00:00Z' } },
      work: { byNode: { build: { planning: { build: [{ key: 'Example/app#9' }] } } } },
    } as unknown as Parameters<typeof lastMergeAt>[0];
    expect(lastMergeAt(snapshot, ['build'])).toBe(Date.parse('2026-10-16T00:00:00Z'));
    expect(lastMergeAt(snapshot, ['other'])).toBeNull();
  });
});

describe('the card colour rule (#207)', () => {
  it('turns live past 90% live; with live unknown, past 90% built', () => {
    const base = { total: 10, completed: 9 };
    expect(cardTone(undefined, { ...base, pct: 95, livePct: 50 })).toBe('started');
    expect(cardTone(undefined, { ...base, pct: 95, livePct: 92 })).toBe('live90');
    expect(cardTone(undefined, { ...base, pct: 95, livePct: null })).toBe('live90');
    // Built but no ticket closed yet is started, not unstarted.
    expect(cardTone(undefined, { total: 10, completed: 0, pct: 88, livePct: 80 })).toBe('started');
    expect(cardTone(undefined, { total: 10, completed: 0, pct: 0, livePct: 0 })).toBe('unstarted');
  });
});
