import { z } from 'zod';
import type { Project } from '../readers/project.ts';
import type { NodeView } from './contract.ts';
import { issueBox } from './issues.ts';
import type { Plan } from './plan.ts';
import { idMatcher } from './refs.ts';
import type { WorkIssue } from './work.ts';
import { readOnce } from './freshness.ts';
import { closedAside } from './absorption.ts';
import { sectionKey, type UnitScore, type UnitScores } from './unit-scores.ts';

export interface ProgressTicket {
  readonly key: string;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly stateReason: string | null;
  readonly section: string | null;
  readonly mapping: string;
  /** For a ticket closed aside: the parent its closing named, as read (#189). */
  readonly absorbedInto?: string | null | undefined;
  /** For a ticket closed aside: the last parent in its chain, whose state it counts by (#189). */
  readonly follows?: Absorption | null | undefined;
  /** Version 2 only: the audited code score of the open build unit a ticket not done is or follows (#194). */
  readonly audit?: UnitAudit | undefined;
  /** When GitHub closed it, for momentum (#204). */
  readonly closedAt?: string | null | undefined;
  /** Version 3, a work card on a map with unit scores: its weight and its unit's built and live (#204). */
  readonly share?: TicketShare | undefined;
}
export interface TicketShare {
  /** The build unit it is or follows; null for a loose ticket; `section:<id>` for a section score (#215). */
  readonly unit: string | null;
  /** Its unit's days split over the unit's tickets, or the map's average days per unit ticket. */
  readonly weight: number;
  /** The unit's built share, 0 to 1; a done ticket counts 1 whatever this says. */
  readonly built: number;
  /** The unit's live share, never above the ticket's built. */
  readonly live: number;
  readonly by: 'audit' | 'luna' | 'deep' | null;
  readonly at: string | null;
}
export interface UnitAudit {
  readonly unit: string;
  /** Share of the unit's code on main, 0 to 1. */
  readonly code: number;
  readonly asAt: string;
}
export interface Absorption {
  readonly parent: string;
  /** The parent's state; null when it cannot be read, which counts as open. */
  readonly state: string | null;
  readonly stateReason: string | null;
  readonly note: string | null;
}
const TicketSchema: z.ZodType<ProgressTicket> = z.strictObject({
  key: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+#[1-9]\d*$/),
  title: z.string(),
  url: z.url().refine((url) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/[1-9]\d*$/.test(url)),
  state: z.string(),
  stateReason: z.string().nullable(),
  section: z.string().nullable(),
  mapping: z.string(),
  absorbedInto: z.string().nullable().optional(),
  follows: z
    .strictObject({
      parent: z.string(),
      state: z.string().nullable(),
      stateReason: z.string().nullable(),
      note: z.string().nullable(),
    })
    .nullable()
    .optional(),
  audit: z
    .strictObject({ unit: z.string().min(1), code: z.number().min(0).max(1), asAt: z.string() })
    .optional(),
  closedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  share: z
    .strictObject({
      unit: z.string().min(1).nullable(),
      weight: z.number().positive().max(1e6),
      built: z.number().min(0).max(1),
      live: z.number().min(0).max(1),
      by: z.enum(['audit', 'luna', 'deep']).nullable(),
      at: z.string().nullable(),
    })
    .optional(),
});
export interface TicketCounts {
  readonly completed: number;
  /** Every ticket but the dropped ones. */
  readonly total: number;
  /** Closed as absorbed into a parent and counted by that parent's state. */
  readonly absorbed: number;
  /** Closed as not planned or duplicate with no parent: listed, out of the total. */
  readonly dropped: number;
  readonly unknown: number;
  /** Credit open tickets earn from their build unit's score (#194), in tickets. */
  readonly audited: number;
  /** Built share in percent: weighted by unit size when tickets carry shares (#204), else by count. */
  readonly pct: number | null;
  /** Sum of the counted tickets' weights (each 1 without shares). */
  readonly weight?: number | undefined;
  /** Weighted built: done tickets in full, open ones by their unit's built share. */
  readonly built?: number | undefined;
  /** Weighted live; null when no ticket carries a share (live unknown). */
  readonly live?: number | null | undefined;
  readonly livePct?: number | null | undefined;
  /** Weighted built that open tickets take from the audit and from the score store's re-checks and deep syncs. */
  readonly fromAudit?: number | undefined;
  readonly fromLuna?: number | undefined;
  readonly tickets: readonly ProgressTicket[];
}
export const TICKET_PROGRESS_SCHEMA = 'work-map-ticket-progress/3';
export interface TicketProgress {
  readonly schema: typeof TICKET_PROGRESS_SCHEMA;
  readonly basis: 'ticket-count';
  readonly at: string | null;
  readonly complete: boolean;
  readonly reason: string | null;
  readonly byNode: Readonly<Record<string, TicketCounts>>;
  readonly totals: TicketCounts;
  readonly unplaced: readonly ProgressTicket[];
  readonly outside: readonly ProgressTicket[];
  readonly missing: readonly string[];
  /** Bug cards found by checks, per section: the Bugs bar. Never part of `byNode` or `totals`. */
  readonly bugs?: BugCounts | undefined;
  /** Question cards (grilling, research, prototype), counted nowhere. */
  readonly skipped?: readonly ProgressTicket[] | undefined;
  /** Sections whose percentages wait because a card placed there had its labels cut short. */
  readonly pendingSections?: readonly string[] | undefined;
}
export interface BugCounts {
  readonly byNode: Readonly<Record<string, TicketCounts>>;
  readonly totals: TicketCounts;
}
type Kind = 'work' | 'bug' | 'question';
const matches = (labels: readonly string[], patterns: readonly string[] = []): boolean =>
  labels.some((label) =>
    patterns.some((p) => (p.endsWith('*') ? label.startsWith(p.slice(0, -1)) : label === p)),
  );
type Status = 'done' | 'open' | 'dropped' | 'unknown';
const plainStatus = (state: string | null, stateReason: string | null | undefined): Status =>
  state === null || state === 'OPEN'
    ? 'open'
    : state === 'CLOSED' && stateReason === 'COMPLETED'
      ? 'done'
      : closedAside(state, stateReason)
        ? 'dropped'
        : 'unknown';
/** #189: a ticket closed aside follows the parent it was absorbed into; with none it is dropped. */
export const statusOf = (t: ProgressTicket): Status =>
  closedAside(t.state, t.stateReason)
    ? t.follows
      ? plainStatus(t.follows.state, t.follows.stateReason)
      : 'dropped'
    : plainStatus(t.state, t.stateReason);
export const isAbsorbed = (t: ProgressTicket): boolean =>
  closedAside(t.state, t.stateReason) && !!t.follows && statusOf(t) !== 'dropped';
interface ChainLink {
  readonly key: string;
  readonly state: string;
  readonly stateReason?: string | null | undefined;
  readonly absorbedInto?: string | null | undefined;
  readonly contextComplete?: boolean;
}
/**
 * The last parent in a closed-aside ticket's chain, and whether the chain is settled: every closed-aside
 * link on it, the ticket included, was read in full. The census and the browser's check both use it.
 */
function followChain(
  start: ChainLink,
  lookup: (key: string) => ChainLink | undefined,
): { follows: Absorption | null; settled: boolean } {
  const seen = new Set([start.key]);
  let settled = start.contextComplete !== false;
  let key = start.absorbedInto;
  while (key) {
    if (seen.has(key))
      return {
        follows: { parent: key, state: null, stateReason: null, note: 'Absorption loop' },
        settled,
      };
    seen.add(key);
    const parent = lookup(key);
    if (!parent)
      return {
        follows: {
          parent: key,
          state: null,
          stateReason: null,
          note: 'Parent outside the issue census',
        },
        settled,
      };
    if (!closedAside(parent.state, parent.stateReason))
      return {
        follows: {
          parent: key,
          state: parent.state,
          stateReason: parent.stateReason ?? null,
          note: null,
        },
        settled,
      };
    settled &&= parent.contextComplete !== false;
    if (!parent.absorbedInto)
      return {
        follows: {
          parent: key,
          state: parent.state,
          stateReason: parent.stateReason ?? null,
          note: null,
        },
        settled,
      };
    key = parent.absorbedInto;
  }
  return { follows: null, settled };
}
/** Absorbed and dropped counts, worded the same on every hover and summary (#189). */
export const asideWords = (counts: TicketCounts | undefined): string =>
  `${counts?.audited ? ` · ${Number(counts.audited.toFixed(1))} by audit` : ''}${counts?.absorbed ? ` · ${counts.absorbed} absorbed` : ''}${counts?.dropped ? ` · ${counts.dropped} dropped` : ''}`;
const sum = (list: readonly ProgressTicket[], value: (t: ProgressTicket) => number): number =>
  list.reduce((acc, t) => acc + value(t), 0);
/**
 * Days of work left (#232): the counted weight minus the weighted built, both in unit days when the
 * tickets carry their unit's share; null where they don't (a map with no units) or the read isn't current.
 */
export function daysLeft(c: TicketCounts | undefined): number | null {
  if (!c || c.pct === null || c.live == null || c.weight === undefined || c.built === undefined)
    return null;
  return Math.max(0, c.weight - c.built);
}

export function ticketCounts(tickets: readonly ProgressTicket[], complete: boolean): TicketCounts {
  const unique = [...new Map(tickets.map((t) => [t.key, t])).values()];
  const count = (status: Status): number => unique.filter((t) => statusOf(t) === status).length;
  const dropped = count('dropped');
  const total = unique.length - dropped;
  const completed = count('done');
  const unknown = count('unknown');
  const counted = unique.filter((t) => statusOf(t) !== 'dropped');
  const open = counted.filter((t) => statusOf(t) === 'open');
  const audited = sum(open, (t) => t.share?.built ?? t.audit?.code ?? 0);
  const weight = sum(counted, (t) => t.share?.weight ?? 1);
  const builtOf = (t: ProgressTicket): number =>
    statusOf(t) === 'done'
      ? 1
      : statusOf(t) === 'open'
        ? (t.share?.built ?? t.audit?.code ?? 0)
        : 0;
  const built = sum(counted, (t) => (t.share?.weight ?? 1) * builtOf(t));
  const shared = counted.some((t) => t.share);
  const live = shared
    ? sum(counted, (t) => (t.share ? t.share.weight * Math.min(t.share.live, builtOf(t)) : 0))
    : null;
  const from = (...by: string[]): number =>
    sum(
      open.filter((t) => by.includes(t.share?.by ?? '')),
      (t) => t.share!.weight * t.share!.built,
    );
  const current = complete && !unknown && total > 0;
  return {
    completed,
    total,
    absorbed: unique.filter(isAbsorbed).length,
    dropped,
    unknown,
    audited,
    // Without shares the count rule stands exactly as version 2 wrote it, so old snapshots still check.
    pct: !current ? null : shared ? (built / weight) * 100 : ((completed + audited) / total) * 100,
    weight,
    built,
    live,
    livePct: current && live !== null && weight ? (live / weight) * 100 : null,
    fromAudit: from('audit'),
    fromLuna: from('luna', 'deep'),
    tickets: unique,
  };
}
/**
 * #215: each work card's share of its section's score, on a map without build units. Every card weighs 1,
 * so stages and the header weigh sections by counted cards. Closed cards count fully built, so open cards
 * take what the score adds above them: the section's built is the higher of its score and its ticket count.
 * The score's live is spread so the section's live is the score's, never above any card's built.
 */
function sectionShares(
  scores: Readonly<Record<string, UnitScore>> | undefined,
  cards: readonly ProgressTicket[],
): Map<ProgressTicket, TicketShare> {
  const shares = new Map<ProgressTicket, TicketShare>();
  if (!scores) return shares;
  for (const [id, score] of Object.entries(scores)) {
    const list = cards.filter((t) => t.section === id);
    const n = list.length;
    const done = list.filter((t) => statusOf(t) === 'done').length;
    const open = list.filter((t) => statusOf(t) === 'open').length;
    const live = Math.min(score.live, score.built);
    const built = open ? Math.min(1, Math.max(0, (score.built * n - done) / open)) : 0;
    const openLive = Math.min(live, built);
    const doneLive = done ? Math.min(1, Math.max(0, (live * n - open * openLive) / done)) : 0;
    const base = { unit: sectionKey(id), weight: 1, by: score.by, at: score.at };
    for (const t of list)
      shares.set(
        t,
        statusOf(t) === 'done'
          ? { ...base, built: 1, live: doneLive }
          : { ...base, built, live: openLive },
      );
  }
  return shares;
}
/** A configured name's section, own keys only. */
const named = <T>(table: Readonly<Record<string, T>> | undefined, name: string): T | undefined =>
  table && Object.hasOwn(table, name) ? table[name] : undefined;
export function buildTicketProgress(input: {
  project: Project;
  nodes: readonly Pick<NodeView, 'id' | 'units'>[];
  plan: Plan;
  maps: Readonly<Record<string, string>>;
  issues: Readonly<Record<string, WorkIssue>>;
  at: string;
  complete: boolean;
  error: string | null;
  /** Merged PRs and the tickets each closed, with where a PR sits once tickets are mapped (#191). */
  closing?: {
    readonly prs: readonly { readonly key: string; readonly closes: readonly string[] }[];
    /** The PR's section given each ticket's mapped section: null outside, undefined unplaced. */
    readonly place: (
      pr: string,
      placement: (ticket: string) => string | null,
    ) => string | null | undefined;
  };
  /** Effective score per build unit, from the project's `unitAudit` file and the score store (#204). */
  unitScores?: UnitScores | undefined;
  /** On a map without build units, each scored section's standing score (#215). */
  sectionScores?: Readonly<Record<string, UnitScore>> | undefined;
}): TicketProgress | undefined {
  const settings = input.project.progress;
  if (settings?.basis !== 'ticket-count') return undefined;
  const sections = new Set(input.nodes.map((node) => node.id));
  for (const destination of [
    ...Object.values(settings.repositories),
    ...Object.values(settings.issues ?? {}),
    ...Object.values(settings.placement ?? {}).flatMap((rule) =>
      Object.values(rule.labels ?? {}).concat(Object.values(rule.titlePrefixes ?? {})),
    ),
  ])
    if (destination !== 'outside' && !sections.has(destination))
      throw new Error(`Unknown ticket progress section: ${destination}`);
  for (const repository of [
    ...Object.keys(settings.repositories),
    ...Object.keys(settings.issues ?? {}).map((key) => key.split('#')[0] ?? ''),
    ...Object.keys(settings.placement ?? {}),
  ])
    if (!input.project.repos.includes(repository))
      throw new Error(`Unknown ticket progress repository: ${repository}`);
  if (Object.values(settings.repositories).includes('outside'))
    throw new Error('Repository ticket progress requires a section');
  const owner = new Map(
    input.nodes.flatMap((node) => node.units.map((unit) => [unit.id, node.id] as const)),
  );
  const matcher = idMatcher([...Object.keys(input.plan.units), ...Object.keys(input.plan.tickets)]);
  const resolve = (
    key: string,
    visited = new Set<string>(),
  ): { section: string; mapping: string } | null => {
    if (visited.has(key)) return null;
    visited.add(key);
    const override = settings.issues?.[key];
    const issue = input.issues[key];
    if (!issue) {
      const mapped = override ?? input.maps[key];
      return mapped && (sections.has(mapped) || mapped === 'outside')
        ? {
            section: mapped,
            mapping: `${key} ${override ? 'project progress override' : 'section map'}`,
          }
        : null;
    }
    // Keep the parent so its configured map outranks a bare title ID (#104); the parent issue
    // itself is left out, so its own placement still resolves through the recursion below.
    // A parent's progress override outranks its section-map entry here as it does when resolved.
    const parentOverride = issue.parent ? settings.issues?.[issue.parent] : undefined;
    const direct = issueBox(
      key,
      { [key]: issue },
      parentOverride && issue.parent
        ? { ...input.maps, [issue.parent]: parentOverride }
        : input.maps,
      sections,
      input.plan,
      owner,
      matcher,
    );
    if (override)
      return {
        section: override,
        mapping: `${key} project progress override${direct && direct.box !== override ? `; supersedes ${direct.reason}` : ''}`,
      };
    if (direct) return { section: direct.box, mapping: direct.reason };
    const number = key.startsWith(`${input.project.roadmapRepo}#`) ? key.split('#')[1] : undefined;
    const unit = number ? input.plan.unitIssues[number] : undefined;
    const planSection = unit ? owner.get(unit) : undefined;
    if (planSection) return { section: planSection, mapping: `${key} plan unit ${unit}` };
    const parent = issue.parent ? resolve(issue.parent, visited) : null;
    return parent ? { section: parent.section, mapping: `${key} parent: ${parent.mapping}` } : null;
  };
  const census = (key: string): WorkIssue | undefined =>
    input.project.repos.includes(key.split('#')[0] ?? '') ? input.issues[key] : undefined;
  const unsettled = new Set<string>();
  const aside = (issue: WorkIssue): Pick<ProgressTicket, 'absorbedInto' | 'follows'> => {
    const chain = followChain(issue, census);
    if (!chain.settled) unsettled.add(issue.key);
    return { absorbedInto: issue.absorbedInto ?? null, follows: chain.follows };
  };
  const kind = new Map<string, Kind>();
  const byMaps = Object.values(input.issues)
    .filter((issue) => input.project.repos.includes(issue.key.split('#')[0] ?? ''))
    .map((issue): ProgressTicket => {
      kind.set(
        issue.key,
        matches(issue.labels, settings.bugLabels)
          ? 'bug'
          : matches(issue.labels, settings.skipLabels)
            ? 'question'
            : 'work',
      );
      const explicit = resolve(issue.key);
      const chain = closedAside(issue.state, issue.stateReason) ? aside(issue) : undefined;
      const repository = issue.key.split('#')[0] ?? '';
      const fallback = settings.repositories[repository];
      return {
        key: issue.key,
        title: issue.title,
        url: issue.url,
        state: issue.state,
        stateReason: issue.stateReason ?? null,
        section: explicit?.section ?? fallback ?? null,
        mapping:
          explicit?.mapping ??
          (fallback ? `${repository} project repository default` : 'No section mapping'),
        absorbedInto: chain?.absorbedInto,
        follows: chain?.follows,
        closedAt: issue.closedAt ?? null,
      };
    });
  // #191: a ticket no map places follows the merged PR that closed it, then its repository's label
  // or title-prefix rule. PRs are placed once, against the sections the maps decided.
  const mappedSection = new Map(byMaps.map((t) => [t.key, t.section]));
  const placement = (key: string): string | null =>
    mappedSection.has(key) ? (mappedSection.get(key) ?? null) : (resolve(key)?.section ?? null);
  const closedBy = new Map<string, Set<string>>();
  for (const pr of input.closing?.prs ?? [])
    for (const key of pr.closes) closedBy.set(key, (closedBy.get(key) ?? new Set()).add(pr.key));
  const prSection = new Map<string, string | null | undefined>();
  const placeOf = (pr: string): string | null | undefined => {
    if (!prSection.has(pr)) {
      const box = input.closing?.place(pr, placement);
      prSection.set(pr, box === null || (box !== undefined && sections.has(box)) ? box : undefined);
    }
    return prSection.get(pr);
  };
  const placeUnmapped = (t: ProgressTicket): ProgressTicket => {
    if (t.section) return t;
    const closers = [...(closedBy.get(t.key) ?? [])].toSorted();
    const placed = closers.flatMap((pr) => {
      const box = placeOf(pr);
      return box === undefined ? [] : [{ pr, box }];
    });
    const found = new Set(placed.map((p) => p.box));
    if (found.size === 1)
      return {
        ...t,
        section: placed[0]!.box ?? 'outside',
        mapping: `${t.key} closed by ${placed.map((p) => p.pr).join(', ')}`,
      };
    const disagree =
      found.size > 1
        ? `; closing PRs disagree: ${placed.map((p) => `${p.pr} ${p.box ?? 'outside'}`).join(', ')}`
        : '';
    const rule = settings.placement?.[t.key.split('#')[0] ?? ''];
    const labels = (input.issues[t.key]?.labels ?? []).flatMap((label) => {
      const box = named(rule?.labels, label);
      return box ? [{ label, box }] : [];
    });
    if (labels.length && new Set(labels.map((l) => l.box)).size === 1)
      return {
        ...t,
        section: labels[0]!.box,
        mapping: `${t.key} label ${labels.map((l) => l.label).join(', ')} (project placement)${disagree}`,
      };
    const prefix = /^([^:]+):/.exec(t.title)?.[1]?.trim().toLowerCase();
    const byPrefix = Object.entries(rule?.titlePrefixes ?? {}).find(
      ([name]) => name.toLowerCase() === prefix,
    );
    if (byPrefix)
      return {
        ...t,
        section: byPrefix[1],
        mapping: `${t.key} title prefix ${byPrefix[0]} (project placement)${disagree}`,
      };
    return disagree ? { ...t, mapping: `${t.mapping}${disagree}` } : t;
  };
  // #204: each work card weighs its unit's audit days split over the unit's cards; a card in no scored
  // unit weighs the map's average days per unit card, so both share one scale.
  const unitPattern = settings.unitAudit && new RegExp(settings.unitAudit.unitPattern);
  const scores = input.unitScores;
  const unitOf = (t: ProgressTicket): string | null =>
    (unitPattern && unitPattern.exec(input.issues[t.follows?.parent ?? t.key]?.title ?? '')?.[1]) ||
    null;
  const placedAll = byMaps.map(placeUnmapped);
  const shareable = new Set(
    placedAll.filter((t) => kind.get(t.key) === 'work' && statusOf(t) !== 'dropped'),
  );
  const perUnit = new Map<string, number>();
  for (const t of shareable) {
    const unit = unitOf(t);
    if (unit && scores && named(scores.units, unit))
      perUnit.set(unit, (perUnit.get(unit) ?? 0) + 1);
  }
  const unitTickets = [...perUnit.values()].reduce((a, b) => a + b, 0);
  const unitDays = [...perUnit.keys()].reduce((a, u) => a + named(scores!.units, u)!.days, 0);
  const average = unitTickets ? unitDays / unitTickets : 1;
  const shareOf = (t: ProgressTicket): TicketShare => {
    const unit = unitOf(t);
    const score = unit && scores ? named(scores.units, unit) : undefined;
    return score
      ? {
          unit,
          weight: score.days / perUnit.get(unit!)!,
          built: score.built,
          live: Math.min(score.live, score.built),
          by: score.by,
          at: score.at,
        }
      : { unit, weight: average, built: 0, live: 0, by: null, at: null };
  };
  const bySection = sectionShares(
    unitPattern ? undefined : input.sectionScores,
    [...shareable].filter((t) => !!t.section && sections.has(t.section)),
  );
  const withShare = (t: ProgressTicket): ProgressTicket =>
    unitPattern && scores && shareable.has(t)
      ? { ...t, share: shareOf(t) }
      : bySection.has(t)
        ? { ...t, share: bySection.get(t)! }
        : t;
  const all = placedAll.map(withShare);
  const skipped = all.filter((t) => kind.get(t.key) === 'question');
  const tickets = all.filter((t) => kind.get(t.key) !== 'question');
  const unplaced = tickets.filter(
    (t) => !t.section || (!sections.has(t.section) && t.section !== 'outside'),
  );
  const outside = tickets.filter((t) => t.section === 'outside');
  const missing = Object.keys(settings.issues ?? {}).filter((key) => !input.issues[key]);
  // Cards no section owns are listed as unplaced; they don't hold the placed counts pending (#88).
  const complete = input.complete && !missing.length;
  const placed = tickets.filter((t) => !!t.section && sections.has(t.section));
  const mapped = placed.filter((t) => kind.get(t.key) === 'work');
  const bugs = placed.filter((t) => kind.get(t.key) === 'bug');
  // A placed card whose labels GitHub cut short may carry a bug or skip label nobody read, so with
  // label lists configured its section waits for a full read. Unplaced cards hold nothing.
  const labelled = !!(settings.bugLabels?.length || settings.skipLabels?.length);
  // A placed card whose absorption chain was not read in full waits too, whatever the labels (#189).
  const pendingSections = [
    ...new Set(
      [...placed, ...skipped.filter((t) => !!t.section && sections.has(t.section))]
        .filter((t) => (labelled && !input.issues[t.key]?.contextComplete) || unsettled.has(t.key))
        .map((t) => t.section!),
    ),
  ].toSorted();
  const perSection = (list: readonly ProgressTicket[]): Record<string, TicketCounts> =>
    Object.fromEntries(
      [...sections].map((id) => [
        id,
        ticketCounts(
          list.filter((t) => t.section === id),
          complete && !pendingSections.includes(id),
        ),
      ]),
    );
  const allCurrent = complete && !pendingSections.length;
  return {
    schema: TICKET_PROGRESS_SCHEMA,
    basis: 'ticket-count',
    at: input.at || null,
    complete,
    reason:
      input.error ??
      (!input.complete
        ? 'GitHub issue census incomplete'
        : missing.length
          ? 'Ticket mappings incomplete'
          : pendingSections.length
            ? `Issue labels incomplete in ${pendingSections.join(', ')}`
            : null),
    byNode: perSection(mapped),
    totals: ticketCounts(mapped, allCurrent),
    unplaced,
    outside,
    missing,
    bugs: { byNode: perSection(bugs), totals: ticketCounts(bugs, allCurrent) },
    skipped,
    pendingSections,
  };
}
const counts = z.strictObject({
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  absorbed: z.number().int().nonnegative(),
  dropped: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  audited: z.number().nonnegative().default(0),
  pct: z.number().min(0).max(100).nullable(),
  weight: z.number().nonnegative().optional(),
  built: z.number().nonnegative().optional(),
  live: z.number().nonnegative().nullable().optional(),
  livePct: z.number().min(0).max(100).nullable().optional(),
  fromAudit: z.number().nonnegative().optional(),
  fromLuna: z.number().nonnegative().optional(),
  tickets: z.array(TicketSchema),
});
const schema = z.strictObject({
  schema: z.enum(['work-map-ticket-progress/2', TICKET_PROGRESS_SCHEMA]),
  basis: z.literal('ticket-count'),
  at: z.iso.datetime({ offset: true }).nullable(),
  complete: z.boolean(),
  reason: z.string().nullable(),
  byNode: z.record(z.string(), counts),
  totals: counts,
  unplaced: z.array(TicketSchema),
  outside: z.array(TicketSchema),
  missing: z.array(z.string()),
  bugs: z.strictObject({ byNode: z.record(z.string(), counts), totals: counts }).optional(),
  skipped: z.array(TicketSchema).optional(),
  pendingSections: z.array(z.string()).optional(),
});
/** Every ticket in a by-section count, with the section it is filed under. */
const flatten = (
  byNode: Readonly<Record<string, TicketCounts>>,
): { id: string; ticket: ProgressTicket }[] =>
  Object.entries(byNode).flatMap(([id, group]) => group.tickets.map((t) => ({ id, ticket: t })));
/** Whether a rollup holds exactly the placed tickets, unchanged. */
const rollup = (rows: readonly { ticket: ProgressTicket }[], totals: TicketCounts): boolean => {
  const expected = new Map(rows.map(({ ticket }) => [ticket.key, JSON.stringify(ticket)]));
  return (
    expected.size === totals.tickets.length &&
    totals.tickets.every((t) => expected.get(t.key) === JSON.stringify(t))
  );
};
export function currentTicketProgress(
  value: unknown,
  sections?: readonly string[],
): TicketProgress | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return null;
  const p = parsed.data;
  const v3 = p.schema === TICKET_PROGRESS_SCHEMA;
  const held = new Set(p.pendingSections ?? []);
  const groups: [TicketCounts, boolean][] = [
    [p.totals, p.complete && !held.size],
    ...Object.entries(p.byNode).map(([id, g]): [TicketCounts, boolean] => [
      g,
      p.complete && !held.has(id),
    ]),
    ...(p.bugs
      ? [
          [p.bugs.totals, p.complete && !held.size] as [TicketCounts, boolean],
          ...Object.entries(p.bugs.byNode).map(([id, g]): [TicketCounts, boolean] => [
            g,
            p.complete && !held.has(id),
          ]),
        ]
      : []),
  ];
  for (const [group, current] of groups) {
    if (new Set(group.tickets.map((t) => t.key)).size !== group.tickets.length) return null;
    const actual = ticketCounts(group.tickets, current);
    if (
      actual.completed !== group.completed ||
      actual.total !== group.total ||
      actual.absorbed !== group.absorbed ||
      actual.dropped !== group.dropped ||
      actual.unknown !== group.unknown ||
      actual.audited !== group.audited ||
      actual.pct !== group.pct ||
      (v3 &&
        (actual.weight !== group.weight ||
          actual.built !== group.built ||
          actual.live !== group.live ||
          actual.livePct !== group.livePct ||
          actual.fromAudit !== group.fromAudit ||
          actual.fromLuna !== group.fromLuna))
    )
      return null;
  }
  const placed = flatten(p.byNode);
  const placedBugs = p.bugs ? flatten(p.bugs.byNode) : [];
  if ([...placed, ...placedBugs].some(({ id, ticket }) => ticket.section !== id)) return null;
  const sameSections = (byNode: Readonly<Record<string, TicketCounts>>): boolean =>
    !sections ||
    (sections.length === Object.keys(byNode).length &&
      sections.every((id) => Object.hasOwn(byNode, id)));
  if (!sameSections(p.byNode) || (p.bugs && !sameSections(p.bugs.byNode))) return null;
  const inventory = [
    ...placed.map(({ ticket }) => ticket),
    ...placedBugs.map(({ ticket }) => ticket),
    ...p.unplaced,
    ...p.outside,
    ...(p.skipped ?? []),
  ];
  if (new Set(inventory.map((t) => t.key)).size !== inventory.length || inventory.length > 20_000)
    return null;
  if (inventory.some((t) => t.url !== `https://github.com/${t.key.replace('#', '/issues/')}`))
    return null;
  if (
    p.outside.some((t) => t.section !== 'outside') ||
    p.unplaced.some((t) => t.section && Object.hasOwn(p.byNode, t.section))
  )
    return null;
  if (p.complete && (p.missing.length || !p.at)) return null;
  // Every closed-aside ticket's parent is worked out again from the stored inventory (#189).
  const read = new Map(inventory.map((t) => [t.key, t]));
  if (inventory.some((t) => (t.audit && (v3 || statusOf(t) !== 'open')) || (t.share && !v3)))
    return null;
  // Version 3: shares sit on work cards only, and a ticket of a unit carries that unit's one score.
  const placedBugKeys = new Set(placedBugs.map(({ ticket }) => ticket.key));
  const unitScore = new Map<string, string>();
  for (const t of inventory) {
    if (!t.share) continue;
    if (placedBugKeys.has(t.key) || statusOf(t) === 'dropped' || t.share.live > t.share.built)
      return null;
    if (t.share.unit === null) continue;
    // A section share (#215) sits only on its own section's cards; its closed and open cards differ.
    const section = t.share.unit.startsWith('section:');
    if (section && t.share.unit !== sectionKey(t.section ?? '')) return null;
    const { weight: _, ...score } = t.share;
    const key = section ? `${t.share.unit} ${statusOf(t) === 'done'}` : t.share.unit;
    const seen = unitScore.get(key);
    if (seen !== undefined && seen !== JSON.stringify(score)) return null;
    unitScore.set(key, JSON.stringify(score));
  }
  for (const t of inventory) {
    const expected = closedAside(t.state, t.stateReason)
      ? followChain(t, (key) => read.get(key)).follows
      : null;
    if (
      (!closedAside(t.state, t.stateReason) && t.absorbedInto != null) ||
      JSON.stringify(expected) !== JSON.stringify(t.follows ?? null)
    )
      return null;
  }
  if (!rollup(placed, p.totals) || (p.bugs && !rollup(placedBugs, p.bugs.totals))) return null;
  if (v3) return p as TicketProgress;
  // A version 2 snapshot reads as version 3 with every count recomputed (old fields unchanged).
  const upgrade = (byNode: Readonly<Record<string, TicketCounts>>) =>
    Object.fromEntries(
      Object.entries(byNode).map(([id, g]) => [id, ticketCounts(g.tickets, g.pct !== null)]),
    );
  return {
    ...p,
    schema: TICKET_PROGRESS_SCHEMA,
    byNode: upgrade(p.byNode),
    totals: ticketCounts(p.totals.tickets, p.totals.pct !== null),
    ...(p.bugs
      ? {
          bugs: {
            byNode: upgrade(p.bugs.byNode),
            totals: ticketCounts(p.bugs.totals.tickets, p.bugs.totals.pct !== null),
          },
        }
      : {}),
  } as TicketProgress;
}
export function ticketProgressCurrent(
  progress: TicketProgress | undefined,
  now: number = Date.now(),
  failed: boolean = false,
): boolean {
  if (!progress?.at || failed || !progress.complete) return false;
  // #242: the census keeps its last complete read between Syncs; its age is shown, not judged.
  return readOnce(progress.at, now);
}

export function selectedTicketCounts(
  progress: TicketProgress,
  sections: readonly string[],
  which: 'work' | 'bugs' = 'work',
): TicketCounts {
  const byNode = which === 'work' ? progress.byNode : (progress.bugs?.byNode ?? {});
  const held = new Set(progress.pendingSections ?? []);
  return ticketCounts(
    sections.flatMap((id) => byNode[id]?.tickets ?? []),
    progress.complete && sections.every((id) => !!byNode[id] && !held.has(id)),
  );
}

export type CensusKind = 'build' | 'fixes' | 'decisions' | 'unplaced' | 'outside';
export interface TicketCensus {
  /** Closed as completed, absorbed ones apart. */
  readonly done: number;
  /** Open on GitHub. */
  readonly open: number;
  /** Closed aside into a parent still open, or done; counted by neither done nor open. */
  readonly absorbedOpen: number;
  readonly absorbedDone: number;
  readonly dropped: number;
  readonly unknown: number;
  readonly kinds: readonly { kind: CensusKind; done: number; open: number }[];
}
/**
 * #225: every ticket on the map's repositories once, whatever its kind or placement, for the header.
 * Cards and stages keep counting build work only.
 */
export function ticketCensus(progress: TicketProgress): TicketCensus {
  const groups: [CensusKind, readonly ProgressTicket[]][] = [
    ['build', progress.totals.tickets],
    ['fixes', progress.bugs?.totals.tickets ?? []],
    ['decisions', progress.skipped ?? []],
    ['unplaced', progress.unplaced],
    ['outside', progress.outside],
  ];
  const plain = (list: readonly ProgressTicket[], status: Status): number =>
    list.filter((t) => !isAbsorbed(t) && statusOf(t) === status).length;
  const all = groups.flatMap(([, list]) => list);
  const absorbed = all.filter(isAbsorbed);
  return {
    done: plain(all, 'done'),
    open: plain(all, 'open'),
    absorbedOpen: absorbed.filter((t) => statusOf(t) === 'open').length,
    absorbedDone: absorbed.filter((t) => statusOf(t) === 'done').length,
    dropped: plain(all, 'dropped'),
    // An absorbed ticket whose parent's closure is unknown is unknown too, so the parts add up.
    unknown: all.filter((t) => statusOf(t) === 'unknown').length,
    kinds: groups.map(([kind, list]) => ({
      kind,
      done: plain(list, 'done'),
      open: plain(list, 'open'),
    })),
  };
}

/** Whether a map counts tickets for progress: configured so, or already carrying a ticket census. */
export function ticketCountMap(
  snapshot: { readonly progressBasis?: unknown; readonly ticketProgress?: unknown } | null,
): boolean {
  return snapshot?.progressBasis === 'ticket-count' || snapshot?.ticketProgress !== undefined;
}

export function pendingTicketProgress(): TicketProgress {
  return {
    schema: TICKET_PROGRESS_SCHEMA,
    basis: 'ticket-count',
    at: null,
    complete: false,
    reason: 'Full issue census pending',
    byNode: {},
    totals: ticketCounts([], false),
    unplaced: [],
    outside: [],
    missing: [],
  };
}
