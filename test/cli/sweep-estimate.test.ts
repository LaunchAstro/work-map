import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, type BoxEstimate, type SourceFinding } from '../../src/core/snapshot.ts';
import { parseBuildUnits, type Audit, type Flow } from '../../src/core/plan.ts';
import { readSourceFindings } from '../../src/readers/source-findings.ts';
import { buildSectionBrief, sectionBriefMarkdown } from '../../src/web/sectionBrief.ts';

const fx = (s: string): string =>
  readFileSync(new URL(`../fixtures/${s}`, import.meta.url), 'utf8');
const audit = JSON.parse(fx('audit.json')) as Audit; // 13 Oct 2026; U03 coded 0.5, in box "tasks"
const flow = JSON.parse(fx('flow.json')) as Flow;
const plan = parseBuildUnits(fx('build-units.md'));
const raise: Record<string, BoxEstimate> = {
  tasks: {
    at: '2026-10-15T16:44:47.952Z',
    model: 'example-model',
    reason: 'Merged PR titles support progress.',
    units: { U03: { coded: 0.95, reason: 'Titles say the paid path landed.' } },
    prs: [1542, 1543],
  },
};
const unit = (findings?: Record<string, SourceFinding>) => {
  const snap = buildSnapshot({
    audit,
    flow,
    plan,
    generatedAt: '2026-10-16T01:00:00Z',
    estimates: raise,
    ...(findings ? { sourceFindings: findings } : {}),
  });
  const node = snap.stages.flatMap((s) => s.nodes).find((n) => n.id === 'tasks')!;
  return { snap, node, view: node.units.find((u) => u.id === 'U03')! };
};
const partly: SourceFinding = {
  at: '2026-10-14T22:15:12.236Z',
  sha: '5aef51644bf6cc69d24654ee3d20320ef2c4d71c',
  status: 'partly-implemented',
};

describe('re-estimates from PR titles', () => {
  it('a PR-title raise is refused when a newer source audit disagrees', () => {
    expect(unit().view.estimate.pct).toBe(95);
    const held = unit({ U03: partly });
    expect(held.view.estimate.pct).toBe(50);
    expect(held.view.estimate.reason).toContain('partly implemented');
    expect(held.view.estimate.reason).toContain('PR titles alone');
    expect(held.node.estimate.pct).toBe(50);
    // An older source audit, or one that found the unit implemented, does not hold the raise.
    expect(unit({ U03: { ...partly, at: '2026-10-12T00:00:00Z' } }).view.estimate.pct).toBe(95);
    expect(
      unit({ U03: { ...partly, status: 'implemented-runtime-unverified' } }).view.estimate.pct,
    ).toBe(95);
    // The figure never drops below the audit, held or not.
    expect(held.view.estimate.pct).toBeGreaterThanOrEqual(100 * (audit.units['U03']?.code ?? 0));
  });

  it('labels re-estimates as from PR titles only in the section details', () => {
    const { snap, node } = unit();
    const text = sectionBriefMarkdown(buildSectionBrief(snap, node));
    expect(text).toContain('Estimate (from PR titles only, 16/10/2026, 2:44:47 am)');
    const held = unit({ U03: partly });
    expect(sectionBriefMarkdown(buildSectionBrief(held.snap, held.node))).toContain(
      'source audit of 2026-10-14 found U03 partly implemented',
    );
  });

  it('reads the newest native source finding per unit and skips malformed reports', () => {
    const data = mkdtempSync(join(tmpdir(), 'wm-source-findings-'));
    const report = (name: string, body: unknown): void => {
      mkdirSync(join(data, 'code-audits', name), { recursive: true });
      writeFileSync(join(data, 'code-audits', name, 'summary.json'), JSON.stringify(body));
    };
    report('older', {
      productHead: 'a'.repeat(40),
      completedAt: '2026-10-13T00:00:00Z',
      findings: [
        { unit: 'U03', status: 'implemented-runtime-unverified' },
        { unit: 'U04', status: 'partly-implemented' },
      ],
    });
    report('newer', {
      productHead: 'b'.repeat(40),
      completedAt: '2026-10-14T22:15:12.236Z',
      findings: [{ unit: 'U03', status: 'partly-implemented' }],
    });
    report('broken', { completedAt: 'not a date', findings: 'none' });
    expect(readSourceFindings(data)).toEqual({
      U03: { at: '2026-10-14T22:15:12.236Z', sha: 'b'.repeat(40), status: 'partly-implemented' },
      U04: { at: '2026-10-13T00:00:00Z', sha: 'a'.repeat(40), status: 'partly-implemented' },
    });
    expect(readSourceFindings(join(data, 'missing'))).toEqual({});
  });
  it('compares native finding times to the microsecond, so the newer report wins', () => {
    const data = mkdtempSync(join(tmpdir(), 'wm-source-findings-'));
    const folder = join(data, 'code-audits');
    for (const run of ['run-a', 'run-b']) mkdirSync(join(folder, run), { recursive: true });
    // The earlier report goes to whichever run the reader meets first.
    for (const [index, run] of readdirSync(folder).entries())
      writeFileSync(
        join(folder, run, 'summary.json'),
        JSON.stringify({
          productHead: 'a'.repeat(40),
          completedAt: index === 0 ? '2026-10-14T22:15:12.236100Z' : '2026-10-14T22:15:12.236629Z',
          findings: [
            {
              unit: 'U03',
              status: index === 0 ? 'implemented-runtime-unverified' : 'partly-implemented',
            },
          ],
        }),
      );
    expect(readSourceFindings(data)['U03']).toMatchObject({
      at: '2026-10-14T22:15:12.236629Z',
      status: 'partly-implemented',
    });
  });
});
