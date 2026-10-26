// SPDX-License-Identifier: AGPL-3.0-only
//
// The roadmap's own tables, read: the plan's ticket-to-unit rows (docs/build-units.md), the audit
// (the completion JSON beside the diagram) and the diagram's boxes (the flow JSON).

import type { Live, Wire } from './contract.ts';

export interface Plan {
  readonly units: Readonly<
    Record<string, { readonly title: string; readonly tickets: readonly string[] }>
  >;
  readonly tickets: Readonly<Record<string, string>>;
  /** Roadmap tracker issues the plan cites for a unit: "U01 (#671)". */
  readonly unitIssues: Readonly<Record<string, string>>;
}

export interface AuditUnit {
  readonly days: number;
  readonly code: number;
  readonly low: number;
  readonly high: number;
  readonly live: Live;
  readonly title: string;
  readonly why?: string;
}
export interface Audit {
  readonly asAt: string;
  readonly units: Readonly<Record<string, AuditUnit>>;
}

export interface FlowNode {
  readonly id: string;
  readonly title: string;
  readonly repo: string;
  readonly text: string;
  readonly stage: number;
  readonly row: number;
  readonly units?: readonly string[];
}
export interface Flow {
  readonly title: string;
  readonly lede: string;
  readonly overallNote?: string;
  readonly footnote?: string;
  readonly stages: readonly string[];
  readonly nodes: readonly FlowNode[];
  readonly wires: readonly Wire[];
  readonly steps?: readonly { readonly title: string; readonly text: string }[];
}

const ID = /^[A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)*$/;

/** Only the unit tables under "## Units by wave" count: | Unit | Title | What it covers | Tickets absorbed | Components owned | Days |. */
export function parseBuildUnits(md: string): Plan {
  const start = md.indexOf('\n## Units by wave');
  if (start < 0) throw new Error('build-units.md has no "## Units by wave" section');
  const next = md.indexOf('\n## ', start + 1);
  const section = md.slice(start, next < 0 ? undefined : next);

  const units: Record<string, { title: string; tickets: string[] }> = {};
  const tickets: Record<string, string> = {};
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cols = line
      .trim()
      .replaceAll(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
    const [unit, title = '', , absorbed = ''] = cols;
    if (cols.length < 6 || unit === undefined || !/^U\d+$/.test(unit)) continue;
    const entry = (units[unit] ??= { title, tickets: [] });
    for (const raw of absorbed.split(/,\s*|\s+and\s+/)) {
      const id = raw.replace(/\s*\(.*$/, '').trim();
      if (!id) continue;
      if (!ID.test(id)) throw new Error(`${unit}: cannot read ticket "${raw}"`);
      const had = tickets[id];
      if (had !== undefined && had !== unit)
        throw new Error(`${id} is in two units: ${had} and ${unit}`);
      tickets[id] = unit;
      if (!entry.tickets.includes(id)) entry.tickets.push(id);
    }
  }

  const unitIssues: Record<string, string> = {};
  for (const m of md.matchAll(/\b(U\d+) \(#(\d+)\)/g)) {
    const [, unit = '', n = ''] = m;
    const had = unitIssues[n];
    if (had !== undefined && had !== unit)
      throw new Error(`roadmap issue #${n} is cited for ${had} and ${unit}`);
    unitIssues[n] = unit;
  }
  return { units, tickets, unitIssues };
}

const LIVE: Readonly<Record<Live, number>> = { yes: 1, partly: 0.5, no: 0 };
export const liveFactor = (l: Live): number => LIVE[l];

/** The same checks render.mjs makes, so the live view and the README diagram never disagree on the tables. */
export function checkTables(
  audit: Audit,
  flow: Flow,
  plan: Plan,
): { owner: Map<string, string>; warnings: string[] } {
  const owner = new Map<string, string>();
  for (const n of flow.nodes)
    for (const u of n.units ?? []) {
      if (!audit.units[u]) throw new Error(`${n.id}: unknown unit ${u}`);
      const had = owner.get(u);
      if (had !== undefined) throw new Error(`${u} is in two boxes: ${had} and ${n.id}`);
      owner.set(u, n.id);
    }
  for (const [u, x] of Object.entries(audit.units)) {
    if (!owner.has(u)) throw new Error(`${u} is in no box`);
    if (!(x.days > 0)) throw new Error(`${u}: days must be above 0`);
    for (const k of ['code', 'low', 'high'] as const)
      if (!(x[k] >= 0 && x[k] <= 1)) throw new Error(`${u}: ${k} must be a fraction from 0 to 1`);
    if (!(x.low <= x.code && x.code <= x.high)) throw new Error(`${u}: needs low <= code <= high`);
    if (!(x.live in LIVE)) throw new Error(`${u}: live is yes, partly or no`);
  }
  const warnings: string[] = [];
  for (const u of Object.keys(audit.units))
    if (!plan.units[u])
      warnings.push(`${u} is audited but has no row in build-units.md, so it has no tickets`);
  for (const u of Object.keys(plan.units))
    if (!audit.units[u])
      warnings.push(`${u} has tickets in build-units.md but is not in the audit`);
  return { owner, warnings };
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * The audit's free-text "asAt" ("13 October 2026, about 8:45 pm AEST") as a time. With no time of day it takes
 * the end of that day, so nothing merged that day is counted as after the audit. AEST is UTC+10 all year.
 */
export function parseAsAt(text: string): { at: string; exact: boolean } {
  const d = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(text);
  const month = d ? MONTHS.indexOf((d[2] ?? '').toLowerCase()) : -1;
  if (!d || month < 0) throw new Error(`cannot read the audit date "${text}"`);
  const t = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*AEST/i.exec(text);
  // With no time, the last millisecond of the day: nothing merged that day counts as after the audit.
  const at = t
    ? new Date(
        Date.UTC(
          Number(d[3]),
          month,
          Number(d[1]),
          (Number(t[1]) % 12) + ((t[3] ?? '').toLowerCase() === 'pm' ? 12 : 0) - 10,
          Number(t[2] ?? 0),
        ),
      )
    : new Date(Date.UTC(Number(d[3]), month, Number(d[1]) + 1, -10) - 1);
  return { at: at.toISOString(), exact: t !== null };
}
