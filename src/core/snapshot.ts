// SPDX-License-Identifier: AGPL-3.0-only
//
// Builds the live roadmap snapshot: stage → box → unit → ticket → pull requests, with three separate
// numbers at every level (coded, reviewed, switched on). Pure: everything it reads is passed in.

import {
  SNAPSHOT_SCHEMA,
  type FogItem,
  type FrontierItem,
  type GithubRunLog,
  type Estimate,
  type Measures,
  type NodeView,
  type PrView,
  type Snapshot,
  type Stats,
  type StageView,
  type SwitchOnView,
  type UnitView,
} from './contract.ts';
import {
  checkTables,
  liveFactor,
  parseAsAt,
  type Audit,
  type AuditUnit,
  type Flow,
  type Plan,
} from './plan.ts';
import type { Inference } from './infer.ts';
import { displayFor } from './time.ts';
import { idMatcher, refsFor, type BackfillEntry, type PrInput } from './refs.ts';

export const REVIEW_DEBT: readonly string[] = ['needs-sol', 'unreviewed', 'needs-second-model'];

export interface SwitchOnInput {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly closedAt: string | null;
  readonly updatedAt: string;
}
export interface SwitchOnEntry {
  readonly units?: readonly string[];
  readonly approvedBy?: string;
  readonly note?: string;
}
export interface Mapping {
  readonly prs?: Readonly<Record<string, BackfillEntry>>;
  readonly switchOns?: Readonly<Record<string, SwitchOnEntry>>;
}
export interface SnapshotInput {
  readonly project?: {
    id: string;
    title: string;
    productRepo: string;
    roadmapRepo: string;
    files?: { audit: string; plan: string; flow: string; mapping?: string };
    timeZone?: string | undefined;
    locale?: string | undefined;
  };
  readonly audit: Audit;
  readonly flow: Flow;
  readonly plan: Plan;
  readonly mapping?: Mapping;
  readonly prs?: readonly PrInput[];
  readonly switchOns?: readonly SwitchOnInput[];
  readonly generatedAt: string;
  readonly roadmapCommit?: string | null;
  readonly github?: {
    readonly repo: string;
    readonly prsThrough: string | null;
    readonly issuesThrough: string | null;
    readonly lastRun: GithubRunLog | null;
  } | null;
  /** The placements (inferred.json) and box re-estimates (estimates.json) the retired sweep left. */
  readonly inferred?: Readonly<Record<string, Inference>>;
  readonly estimates?: Readonly<Record<string, BoxEstimate>>;
  /** The newest native source-audit finding per unit; it holds a title-only raise at the audit. */
  readonly sourceFindings?: Readonly<Record<string, SourceFinding>>;
  readonly openState?: {
    readonly at?: string;
    readonly queued: number | null;
    readonly entries?: Stats['queueEntries'];
  } | null;
}

/** A re-estimate of one box from its tickets and merged PRs, with its reason. */
export interface BoxEstimate {
  readonly at: string;
  readonly model: string;
  readonly reason: string;
  readonly units: Readonly<Record<string, { readonly coded: number; readonly reason: string }>>;
  readonly prs: readonly number[];
  /** The PRs and their last-update times the estimate was made from. */
  readonly evidence?: string;
}

/** One unit's verdict from a native source audit (`<data>/code-audits/<run>/summary.json`). */
export interface SourceFinding {
  readonly at: string;
  readonly sha: string;
  readonly status: string;
}

/** The merge queue at the last GitHub read, dated. */
export function mergeStats(
  now: string,
  open: { readonly queued: number | null; readonly entries?: Stats['queueEntries'] } | null,
): Stats {
  return {
    at: now,
    queued: open?.queued ?? null,
    ...(open?.entries ? { queueEntries: open.entries } : {}),
  };
}

const r1 = (x: number): number => Math.round(x * 10) / 10;
// Percentages are kept exact and rounded only where they are shown, as render.mjs does: rounding twice can
// turn 52.47 into 53.

/** The approved entries of a mapping.json section; an entry without approvedBy is pending and not used. */
export function approved<T extends { readonly approvedBy?: string }>(
  section: Readonly<Record<string, T>> = {},
): { used: Record<string, T>; pending: string[] } {
  const used: Record<string, T> = {};
  const pending: string[] = [];
  for (const [k, v] of Object.entries(section)) {
    if (k.startsWith('_')) continue;
    if (typeof v.approvedBy === 'string' && v.approvedBy.trim() !== '') used[k] = v;
    else pending.push(k);
  }
  return { used, pending };
}

export function buildSnapshot(input: SnapshotInput): Snapshot {
  const { audit, flow, plan, mapping = {} } = input;
  const { warnings, owner } = checkTables(audit, flow, plan);
  const auditAt = parseAsAt(audit.asAt);
  const backfill = approved(mapping.prs);
  const switchMap = approved(mapping.switchOns);
  for (const [num, e] of Object.entries(switchMap.used))
    for (const u of e.units ?? [])
      if (!audit.units[u])
        throw new Error(`mapping.json switch-on #${num} names unknown unit ${u}`);
  const unitOf = (u: string): AuditUnit => {
    const x = audit.units[u];
    if (!x) throw new Error(`unknown unit ${u}`);
    return x;
  };
  const matcher = idMatcher([...Object.keys(plan.tickets), ...Object.keys(plan.units)]);

  const prs: Record<string, PrView> = {};
  const sorted = [...(input.prs ?? [])].toSorted((a, b) => b.mergedAt.localeCompare(a.mergedAt));
  for (const pr of sorted) {
    const labels = [...pr.labels].toSorted();
    const ref = refsFor(pr, plan, matcher, backfill.used, input.project);
    prs[String(pr.number)] = {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      mergedAt: pr.mergedAt,
      labels,
      sinceAudit: Date.parse(pr.mergedAt) > Date.parse(auditAt.at),
      class: ref.links.length > 0 ? 'mapped' : ref.outside ? 'outside' : 'unmapped',
      inferred: null,
      links: ref.links,
      candidates: ref.candidates,
      notes: ref.notes,
    };
  }
  const allPrs = Object.values(prs);
  // Kept sweep placements for PRs that state nothing: an 'outside' placement classes the PR outside the plan.
  for (const p of allPrs) {
    const inf = input.inferred?.[String(p.number)];
    if (p.class !== 'unmapped' || !inf) continue;
    const valid = inf.box === 'outside' || flow.nodes.some((n) => n.id === inf.box);
    if (!valid) continue;
    prs[String(p.number)] = {
      ...p,
      class: inf.box === 'outside' ? 'outside' : 'inferred',
      inferred: inf.unit && owner.get(inf.unit) !== inf.box ? { ...inf, unit: null } : inf,
    };
  }
  const placed = Object.values(prs);

  const switchOns: SwitchOnView[] = (input.switchOns ?? [])
    .map((i) => {
      const e = switchMap.used[String(i.number)];
      return {
        number: i.number,
        title: i.title,
        url: i.url,
        state: i.state,
        closedAt: i.closedAt,
        units: e?.units ?? [],
        mapped: e !== undefined,
      };
    })
    .toSorted((a, b) => a.number - b.number);

  const share = (units: readonly string[], f: (x: AuditUnit) => number): number => {
    const all = units.reduce((s, u) => s + unitOf(u).days, 0);
    return all ? (100 * units.reduce((s, u) => s + unitOf(u).days * f(unitOf(u)), 0)) / all : 0;
  };
  const auditTime = Date.parse(auditAt.at);
  // A unit's live estimate: a box re-estimate newer than the audit, else tickets named complete, else the audit.
  const unitEstimate = (u: string): Estimate => {
    const x = unitOf(u);
    const box = owner.get(u) ?? '';
    const sol = input.estimates?.[box];
    const solUnit = sol?.units[u];
    // A re-estimate reads only merged PR titles, so a newer source audit that found the unit short of
    // implemented keeps it at the audit figure.
    const finding = input.sourceFindings?.[u];
    if (
      sol &&
      solUnit &&
      Date.parse(sol.at) > auditTime &&
      finding &&
      Date.parse(finding.at) > auditTime &&
      !finding.status.startsWith('implemented')
    )
      return {
        pct: 100 * x.code,
        source: 'sol',
        at: sol.at,
        reason: `held at the audit: the source audit of ${finding.at.slice(0, 10)} found ${u} ${finding.status.replaceAll('-', ' ')}, and PR titles alone cannot raise it (the re-estimate proposed ${Math.round(100 * solUnit.coded)}%)`,
      };
    if (sol && solUnit && Date.parse(sol.at) > auditTime)
      return {
        // Never below the audit as it stands now, even if the audit was corrected after the re-estimate.
        pct: 100 * Math.min(1, Math.max(x.code, solUnit.coded)),
        source: 'sol',
        at: sol.at,
        reason: solUnit.reason,
      };
    const tickets = plan.units[u]?.tickets ?? [];
    const done = tickets.filter((t) =>
      placed.some(
        (p) =>
          p.class === 'mapped' && p.links.some((l) => l.unit === u && l.ticket === t && l.complete),
      ),
    );
    if (tickets.length > 0 && done.length / tickets.length > x.code)
      return {
        pct: (100 * done.length) / tickets.length,
        source: 'tickets',
        at: null,
        reason: `${done.length} of ${tickets.length} tickets named complete by a merged PR`,
      };
    return { pct: 100 * x.code, source: 'audit', at: null, reason: 'the audit' };
  };
  const measures = (units: readonly string[], boxes: ReadonlySet<string> = new Set()): Measures => {
    const set = new Set(units);
    const list = placed.filter(
      (p) =>
        (p.class === 'mapped' && p.links.some((l) => set.has(l.unit))) ||
        (p.class === 'inferred' &&
          p.inferred !== null &&
          (boxes.has(p.inferred.box) || (p.inferred.unit !== null && set.has(p.inferred.unit)))),
    );
    const sw = switchOns.filter((s) => s.units.some((u) => set.has(u)));
    const since = list.filter((p) => p.sinceAudit).map((p) => p.number);
    const ests = units.map((u) => ({ u, e: unitEstimate(u) }));
    const days = units.reduce((s, u) => s + unitOf(u).days, 0);
    const source = ests.some((x) => x.e.source === 'sol')
      ? 'sol'
      : ests.some((x) => x.e.source === 'tickets')
        ? 'tickets'
        : 'audit';
    const one = boxes.size === 1 ? input.estimates?.[[...boxes][0] ?? ''] : undefined;
    const boxEstimate = one && Date.parse(one.at) > auditTime ? one : undefined;
    const moved = ests.filter((x) => x.e.source !== 'audit');
    return {
      days: r1(days),
      coded: {
        pct: share(units, (x) => x.code),
        low: share(units, (x) => x.low),
        high: share(units, (x) => x.high),
      },
      on: {
        pct: share(units, (x) => x.code * liveFactor(x.live)),
        switchOnsClosed: sw.filter((s) => s.state === 'CLOSED').length,
        switchOnsOpen: sw.filter((s) => s.state !== 'CLOSED').length,
      },
      reviewed: {},
      sinceAudit: { merged: since.length, prs: since },
      inferredPrs: list.filter((p) => p.class === 'inferred').length,
      estimate: {
        pct: days ? ests.reduce((s, x) => s + unitOf(x.u).days * x.e.pct, 0) / days : 0,
        source,
        at: boxEstimate
          ? boxEstimate.at
          : (moved.map((x) => x.e.at).find((a) => a !== null) ?? null),
        reason: boxEstimate
          ? boxEstimate.reason
          : moved.length > 0
            ? moved.map((x) => `${x.u}: ${x.e.reason}`).join('; ')
            : 'the audit',
      },
    };
  };
  const prsOf = (u: string, ticket: string | null): number[] =>
    placed
      .filter(
        (p) => p.class === 'mapped' && p.links.some((l) => l.unit === u && l.ticket === ticket),
      )
      .map((p) => p.number);

  const unitView = (u: string): UnitView => {
    const x = unitOf(u);
    return {
      id: u,
      title: x.title,
      ...measures([u]),
      days: x.days,
      audit: { code: x.code, low: x.low, high: x.high, live: x.live, why: x.why ?? '' },
      tickets: (plan.units[u]?.tickets ?? []).map((t) => ({ id: t, prs: prsOf(u, t) })),
      unitPrs: prsOf(u, null),
      candidatePrs: placed
        .filter((p) => p.candidates.some((c) => c.unit === u))
        .map((p) => p.number),
      switchOns: switchOns.filter((s) => s.units.includes(u)).map((s) => s.number),
    };
  };

  const stages: StageView[] = flow.stages.map((name, i) => {
    const nodes: NodeView[] = flow.nodes
      .filter((n) => n.stage === i + 1 && n.units !== undefined)
      .toSorted((a, b) => a.row - b.row)
      .map((n) => {
        const units = n.units ?? [];
        const m = measures(units, new Set([n.id]));
        const c = Math.round(m.coded.pct);
        const status =
          c === 0 ? 'planned' : c >= 95 && Math.round(m.on.pct) >= c - 2 ? 'built' : 'in-progress';
        return {
          id: n.id,
          title: n.title,
          repo: n.repo,
          text: n.text,
          row: n.row,
          status,
          days: m.days,
          coded: m.coded,
          on: m.on,
          reviewed: m.reviewed,
          sinceAudit: m.sinceAudit,
          inferredPrs: m.inferredPrs,
          estimate: m.estimate,
          units: units.map(unitView),
        };
      });
    return {
      index: i + 1,
      name,
      ...measures(
        nodes.flatMap((n) => n.units.map((u) => u.id)),
        new Set(nodes.map((n) => n.id)),
      ),
      nodes,
    };
  });

  const every = Object.keys(audit.units);
  const totals = measures(every, new Set(flow.nodes.map((n) => n.id)));
  const unmapped = placed.filter((p) => p.class === 'unmapped');
  const outside = placed.filter((p) => p.class === 'outside').length;

  const frontier: FrontierItem[] = stages
    .flatMap((s) => s.nodes.flatMap((n) => n.units))
    .filter((u) => u.sinceAudit.merged > 0)
    .map((u) => ({
      id: u.id,
      key: u.id,
      title: u.title,
      type: 'unit' as const,
      mergedSinceAudit: u.sinceAudit.merged,
    }))
    .toSorted((a, b) => b.mergedSinceAudit - a.mergedSinceAudit || a.id.localeCompare(b.id));

  const fog: FogItem[] = [];
  if (unmapped.length > 0)
    fog.push({
      id: 'unmapped-prs',
      text: `${unmapped.length} merged pull requests name no plan ticket or unit, so they count towards no box.`,
    });
  const swUnmapped = switchOns.filter((s) => !s.mapped);
  if (swUnmapped.length > 0)
    fog.push({
      id: 'unmapped-switch-ons',
      text: `${swUnmapped.length} switch-on issues are not mapped to a unit yet: ${swUnmapped.map((s) => `#${s.number}`).join(', ')}.`,
    });
  if (!auditAt.exact)
    fog.push({
      id: 'audit-time',
      text: 'The audit gives a day but no time, so its day counts as before the audit.',
    });
  for (const [i, w] of warnings.entries()) fog.push({ id: `warning-${i + 1}`, text: w });

  return {
    schema: SNAPSHOT_SCHEMA,
    id: input.project?.id ?? 'fixture-build',
    type: 'map',
    title: flow.title,
    generatedAt: input.generatedAt,
    // The zone and locale of the map, not of whoever opens it.
    ...(input.project ? { display: displayFor(input.project) } : {}),
    destination: {
      id: 'destination',
      text: `Every planned unit coded and switched on: ${every.length} units, about ${Math.round(totals.days)} estimate-days.`,
    },
    sources: {
      audit: {
        asAt: audit.asAt,
        at: auditAt.at,
        exactTime: auditAt.exact,
        file: input.project?.files?.audit ?? 'audit.json',
      },
      plan: {
        file: input.project?.files?.plan ?? 'build-units.md',
        boxes: input.project?.files?.flow ?? 'flow.json',
        commit: input.roadmapCommit ?? null,
      },
      github: input.github ?? null,
      mapping: {
        file: input.project?.files?.mapping ?? 'mapping.json',
        approvedPrs: Object.keys(backfill.used).length,
        pendingPrs: backfill.pending.length,
        approvedSwitchOns: Object.keys(switchMap.used).length,
        pendingSwitchOns: switchMap.pending.length,
      },
    },
    totals: {
      ...totals,
      units: every.length,
      prs: {
        merged: placed.length,
        mapped: placed.length - unmapped.length - outside,
        outside,
        unmapped: unmapped.length,
        sinceAudit: placed.filter((p) => p.sinceAudit).length,
      },
    },
    stages,
    prs,
    switchOns,
    frontier,
    fog,
    unmapped: {
      count: unmapped.length,
      prs: unmapped.map((p) => p.number),
      switchOns: swUnmapped.map((s) => s.number),
    },
    stats: mergeStats(
      input.openState?.at ?? input.github?.lastRun?.at ?? input.generatedAt,
      input.openState ?? null,
    ),
    sweep: {
      inferred: placed.filter((p) => p.inferred !== null).length,
      byVia: placed.reduce<Record<string, number>>((acc, p) => {
        if (p.inferred) acc[p.inferred.via] = (acc[p.inferred.via] ?? 0) + 1;
        return acc;
      }, {}),
      estimates: Object.keys(input.estimates ?? {}).length,
      gaps: null,
    },
    view: {
      title: flow.title,
      lede: flow.lede,
      overallNote: flow.overallNote ?? '',
      footnote: flow.footnote ?? '',
      steps: flow.steps ?? [],
      wires: flow.wires,
    },
    warnings,
  };
}
