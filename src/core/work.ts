import { buildSpecProgress, type SpecProgress } from './spec-progress.ts';
import type { NodeView, Snapshot, Wire, PrView } from './contract.ts';
import type { Plan } from './plan.ts';
import type { IssueInfo } from './issues.ts';
import { issueBox, issueKey } from './issues.ts';
import { closingIssueKeys, proseIssueKeys } from './prose-links.ts';
import { idMatcher, refsFor } from './refs.ts';
import { sectionOf } from './infer.ts';
import {
  scopeView,
  reviewPr,
  reviewView,
  type OpenScopeEstimate,
  type ScopeView,
  type ReviewView,
} from './scope.ts';
import type { buildTicketProgress, TicketProgress } from './ticket-progress.ts';
import type { Project } from '../readers/project.ts';

export type BuildState = 'live' | 'merged' | 'built' | 'planned';
export interface WorkIssue extends IssueInfo {
  readonly key: string;
  readonly url: string;
  readonly state: string;
  readonly stateReason?: string | null;
  readonly updatedAt?: string;
  readonly labels: readonly string[];
  readonly blockedBy: readonly { key: string; title: string; url: string; state: string }[];
  readonly contextComplete: boolean;
  /** The parent a ticket closed as not planned or duplicate was absorbed into (#189); absent until read. */
  readonly absorbedInto?: string | null;
  /** When GitHub closed it; absent in caches written before #204. */
  readonly closedAt?: string | null;
}
export interface OpenPr {
  readonly key: string;
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly url: string;
  readonly headRefName: string;
  readonly headRepository?: string | null;
  readonly issueKeys: readonly string[];
  readonly state?: 'OPEN' | 'MERGED';
  readonly updatedAt?: string;
  readonly headRefOid?: string;
  readonly additions?: number;
  readonly deletions?: number;
  readonly labels?: readonly string[];
  readonly labelsComplete?: boolean;
  /** TN-37: GitHub returned every closing reference; absent in older caches, which counts as complete. */
  readonly closingComplete?: boolean;
  readonly reviewDecision?: string | null;
  readonly reviews?: readonly { state: string; head: string | null }[];
  readonly reviewsComplete?: boolean;
  readonly comments?: readonly {
    author: string | null;
    body: string;
    createdAt: string;
    updatedAt: string;
    url: string;
  }[];
  readonly commentsComplete?: boolean;
  /** Every changed file is documentation (docs/** or *.md); absent when the files were not read. */
  readonly docsOnly?: boolean;
}
export interface SectionWork {
  readonly state: BuildState;
  readonly shares: ScopeView['shares'];
  readonly scope: ScopeView;
  readonly review: ReviewView;
  readonly openPrs: readonly { key: string; title: string; url: string; inferred: boolean }[];
  readonly planning: Readonly<
    Record<
      'idea' | 'map' | 'spec' | 'build',
      readonly { key: string; title: string; url: string }[]
    >
  > & {
    /** State, labels and whether an open PR names it; absent in snapshots written before #231. */
    readonly tickets: readonly {
      key: string;
      title: string;
      url: string;
      state?: string;
      labels?: readonly string[];
      inPr?: boolean;
    }[];
  };
  readonly missing: readonly string[];
  readonly blockers: readonly {
    key: string;
    title: string;
    url: string;
    section: string | null;
    ticket: string;
  }[];
  /** Configured spec documents; found is null until the collector has checked the default branch. */
  readonly specDocuments?: readonly {
    key: string;
    repository: string;
    path: string;
    url: string | null;
    found: boolean | null;
    /** The default branch it was checked on; null until checked or for an empty repository. */
    branch: string | null;
  }[];
  /** PRs whose placement looks wrong, with the reason (absent in snapshots written before it existed). */
  readonly warnings?: readonly { key: string; title: string; url: string; reason: string }[];
}
export interface WorkView {
  readonly specProgress?: SpecProgress;
  readonly at: string;
  readonly complete: boolean;
  readonly error: string | null;
  /** #242: a newer read that failed or stopped; the values here stay those of the read at `at`. */
  readonly lastFailure?: { readonly at: string; readonly error: string };
  readonly byNode: Readonly<Record<string, SectionWork>>;
  readonly review: ReviewView;
  readonly unplacedPrs: readonly { key: string; title: string; url: string }[];
  /**
   * Only on a map whose config sets `progress.notPlaced: "sections"`: the open and merged PRs no
   * section places, PRs declared outside the plan left out, and the tickets on no section whose
   * labels were cut short where bug or skip labels decide a ticket's kind.
   */
  readonly offMap?: {
    readonly prs: readonly { key: string; title: string; url: string; state: 'OPEN' | 'MERGED' }[];
    readonly unreadLabels: readonly string[];
  };
  readonly wires: readonly Wire[];
}
const issueLink = (i: WorkIssue): { key: string; title: string; url: string } => ({
  key: i.key,
  title: i.title,
  url: i.url,
});

/**
 * Where a PR sits: its declared section, then its units, then the tickets it names (as the given
 * ticket placement decides), its lane, history, prose links and the repository default (#121).
 * Shared with ticket progress, which places tickets by the PR that closed them (#191).
 */
export function prPlacer(input: {
  project: Project;
  plan: Plan;
  nodes: readonly Pick<NodeView, 'id' | 'units'>[];
  mergedPrs?: readonly PrView[] | undefined;
  prLanes?: Readonly<Record<string, string>> | undefined;
}): (
  p: OpenPr,
  placement: (ticket: string) => string | null,
) => { box: string | undefined | null; inferred: boolean } {
  const { project, plan } = input;
  const boxes = new Set(input.nodes.map((n) => n.id));
  const owner = new Map(input.nodes.flatMap((n) => n.units.map((u) => [u.id, n.id] as const)));
  const matcher = idMatcher([...Object.keys(plan.units), ...Object.keys(plan.tickets)]);
  return (p, placement) => {
    const repository = p.key.split('#')[0] ?? project.productRepo;
    const ref = refsFor(
      { ...p, mergedAt: '', updatedAt: '', labels: [] },
      plan,
      matcher,
      {},
      { productRepo: repository, roadmapRepo: project.roadmapRepo },
    );
    const section = sectionOf(p.body ?? '', boxes);
    const unitBox = ref.links.map((l) => owner.get(l.unit)).find((b) => b !== undefined);
    const issuePlace = [...p.issueKeys, ...ref.issues].map(placement).find((b) => b !== null);
    const historical = (input.mergedPrs ?? []).find(
      (pr) => p.key === `${project.productRepo}#${pr.number}`,
    );
    const fallback =
      historical?.links.map((l) => owner.get(l.unit)).find(Boolean) ?? historical?.inferred?.box;
    // Placed issues named in prose ("For #49") place the PR only when they all agree on one section.
    const prose = new Set(
      proseIssueKeys(p.body ?? '', repository).flatMap((k) => placement(k) ?? []),
    );
    const repositoryDefault =
      project.progress?.basis === 'ticket-count'
        ? project.progress.repositories[repository]
        : undefined;
    return {
      box:
        section ??
        unitBox ??
        (ref.outside
          ? null
          : (placement(p.key) ??
            issuePlace ??
            input.prLanes?.[p.key] ??
            fallback ??
            (prose.size === 1 ? [...prose][0] : undefined) ??
            repositoryDefault)),
      inferred: !section && !unitBox,
    };
  };
}

/**
 * Ticket progress's closing input from the work cache's merged PRs (#191): each PR closes GitHub's
 * closing links plus every ticket in its body's closing lists, and sits where `prPlacer` puts it.
 */
export function closingFrom(input: {
  project: Project;
  plan: Plan;
  nodes: readonly Pick<NodeView, 'id' | 'units'>[];
  closedBy: readonly OpenPr[];
  mergedPrs?: readonly PrView[] | undefined;
  prLanes?: Readonly<Record<string, string>> | undefined;
}): NonNullable<Parameters<typeof buildTicketProgress>[0]['closing']> {
  const place = prPlacer(input);
  const byKey = new Map(input.closedBy.map((p) => [p.key, p]));
  return {
    prs: input.closedBy.map((p) => ({
      key: p.key,
      closes: [
        ...new Set([
          ...p.issueKeys,
          ...closingIssueKeys(p.body ?? '', p.key.split('#')[0] ?? input.project.productRepo),
        ]),
      ],
    })),
    place: (key, placement) => {
      const pr = byKey.get(key);
      return pr ? place(pr, placement).box : undefined;
    },
  };
}

export function buildWork(input: {
  project: Project;
  ticketProgress?: TicketProgress | undefined;
  plan: Plan;
  nodes: readonly NodeView[];
  issues: Readonly<Record<string, WorkIssue>>;
  prs: readonly OpenPr[];
  mergedPrs?: readonly PrView[];
  trackedMergedPrs?: readonly OpenPr[];
  openEstimates?: Readonly<Record<string, OpenScopeEstimate>>;
  prLanes?: Readonly<Record<string, string>>;
  maps: Readonly<Record<string, string>>;
  /** Sections that own at least one path glob in the section map; absent without a section map. */
  ownedSections?: readonly string[];
  specDocuments?:
    Readonly<Record<string, { found: boolean; branch?: string | null; url: string }>> | undefined;
  at: string;
  complete: boolean;
  error: string | null;
  lastFailure?: { readonly at: string; readonly error: string } | undefined;
}): WorkView {
  const { project, nodes, issues, plan, maps } = input;
  const boxes = new Set(nodes.map((n) => n.id));
  const planningSections = new Set(project.planningSections ?? []);
  const owner = new Map(nodes.flatMap((n) => n.units.map((u) => [u.id, n.id] as const)));
  const matcher = idMatcher([...Object.keys(plan.units), ...Object.keys(plan.tickets)]);
  const ticketSections = new Map(
    [
      ...(input.ticketProgress?.totals.tickets ?? []),
      ...(input.ticketProgress?.bugs?.totals.tickets ?? []),
      ...(input.ticketProgress?.skipped ?? []),
      ...(input.ticketProgress?.outside ?? []),
      ...(input.ticketProgress?.unplaced ?? []),
    ].map((ticket) => [ticket.key, ticket.section]),
  );
  const placement = (k: string): string | null =>
    input.ticketProgress && issues[k]
      ? (ticketSections.get(k) ?? null)
      : (issueBox(k, issues, maps, boxes, plan, owner, matcher)?.box ?? null);
  // The sections each map's descendant tickets sit in. A map whose tickets span several sections
  // is an umbrella: it ticks a section's map step, or lends it a spec, only when placed there (#102).
  const under = new Map<string, Set<string>>();
  for (const i of Object.values(issues)) {
    const box = placement(i.key);
    if (!box) continue;
    const seen = new Set<string>();
    for (let up = i.parent; up && !seen.has(up); up = issues[up]?.parent ?? null) {
      seen.add(up);
      under.set(up, (under.get(up) ?? new Set<string>()).add(box));
    }
  }
  const mapFor = (key: string, box: string): boolean => {
    const placed = placement(key);
    if (placed) return placed === box;
    const sections = under.get(key);
    return !sections || (sections.size === 1 && sections.has(box));
  };
  const place = prPlacer(input);
  const placePr = (p: OpenPr): { box: string | undefined | null; inferred: boolean } =>
    place(p, placement);
  const byNode: Record<string, SectionWork> = {};
  const wires: Wire[] = [];
  const placedPrs = new Set<string>();
  for (const n of nodes) {
    const here = Object.values(issues).filter((i) => placement(i.key) === n.id);
    const related = new Map(here.map((i) => [i.key, i]));
    for (const issue of here) {
      let parent = issue.parent;
      const visited = new Set<string>();
      while (parent && !visited.has(parent)) {
        visited.add(parent);
        const ancestor = issues[parent];
        if (!ancestor) break;
        related.set(parent, ancestor);
        parent = ancestor.parent;
      }
    }
    const isMap = (i: WorkIssue): boolean => i.labels.includes(project.ticketConventions.mapLabel);
    for (const [key, i] of related) if (isMap(i) && !mapFor(key, n.id)) related.delete(key);
    const contextMaps = new Set([...related.values()].filter(isMap).map((i) => i.key));
    const isSpec = (i: WorkIssue): boolean =>
      new RegExp(project.ticketConventions.specPattern, 'i').test(i.title) ||
      i.labels.some((label) => project.ticketConventions.specLabels.includes(label));
    // A sibling spec counts here only if it is placed here, or placed nowhere under this
    // section's own map (#103).
    for (const issue of Object.values(issues))
      if (
        isSpec(issue) &&
        issue.parent &&
        contextMaps.has(issue.parent) &&
        (placement(issue.key) ?? n.id) === n.id
      )
        related.set(issue.key, issue);
    const context = [...related.values()];
    const specDocuments = (project.specDocuments?.[n.id] ?? []).map((key) => {
      const read = input.specDocuments?.[key];
      return {
        key,
        repository: key.slice(0, key.indexOf(':')),
        path: key.slice(key.indexOf(':') + 1),
        url: read?.url ?? null,
        found: read?.found ?? null,
        branch: read?.branch ?? null,
      };
    });
    const planning: SectionWork['planning'] = {
      idea: context
        .filter(
          (i) =>
            i.labels.some((label) => project.ticketConventions.ideaLabels.includes(label)) ||
            new RegExp(project.ticketConventions.ideaPattern, 'i').test(i.title),
        )
        .map(issueLink),
      map: context
        .filter((i) => i.labels.includes(project.ticketConventions.mapLabel))
        .map(issueLink),
      tickets: here
        .filter(
          (i) =>
            i.labels.some((label) =>
              [
                project.ticketConventions.readyLabel,
                ...project.ticketConventions.ticketLabels,
                ...(Object.entries(project.ticketConventions.ticketLabelsByRepository ?? {}).find(
                  ([repository]) => repository.toLowerCase() === i.key.split('#')[0]?.toLowerCase(),
                )?.[1] ?? []),
              ].includes(label),
            ) && !isSpec(i),
        )
        .map((i) => ({
          key: i.key,
          title: i.title,
          url: i.url,
          state: i.state,
          labels: i.labels,
          inPr: input.prs.some((p) => p.issueKeys.includes(i.key)),
        })),
      // A spec placed in another section never ticks this one, even as an ancestor. An
      // unplaced ancestor spec over several sections is an umbrella too (#103).
      spec: [
        ...context.filter((i) => isSpec(i) && mapFor(i.key, n.id)).map(issueLink),
        ...specDocuments
          .filter((d) => d.found)
          .map((d) => ({ key: d.key, title: d.path, url: d.url! })),
      ],
      build: [],
    };
    const open = input.prs.filter((p) => placePr(p).box === n.id);
    const openPrs = open.map((p) => {
      placedPrs.add(p.key);
      return { key: p.key, title: p.title, url: p.url, inferred: placePr(p).inferred };
    });
    const tracked = (input.trackedMergedPrs ?? []).filter((p) => placePr(p).box === n.id);
    // Documentation declared into a product section that owns no paths is usually tooling docs.
    const warnings = [...open, ...tracked]
      .filter(
        (p) =>
          p.docsOnly &&
          input.ownedSections &&
          !input.ownedSections.includes(n.id) &&
          sectionOf(p.body ?? '', boxes) === n.id,
      )
      .map((p) => ({
        key: p.key,
        title: p.title,
        url: p.url,
        reason: `Declares Section: ${n.id} but only changes documentation, and ${n.id} owns no product paths in the section map. Tooling and agent docs belong to Section: outside.`,
      }));
    const blockers: SectionWork['blockers'][number][] = [];
    for (const i of here.filter((candidate) => candidate.state === 'OPEN')) {
      const deps = [...i.blockedBy];
      const body =
        /^[ \t]*(?:#+[ \t]*)?Blocked by[ \t]*:?[ \t]*\n?([\s\S]*?)(?=\n[ \t]*#{1,6}[ \t]+|(?![\s\S]))/im.exec(
          i.body,
        )?.[1];
      const textKeys = new Set<string>();
      for (const m of (body ?? '').matchAll(
        /https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/issues\/\d+|(?:[A-Za-z0-9-]+\/)?[A-Za-z0-9._-]+#\d+|#\d+/g,
      )) {
        const key = issueKey(m[0], i.key.split('#')[0] ?? project.productRepo);
        if (key) textKeys.add(key);
      }
      for (const key of textKeys) {
        const dep = issues[key];
        if (dep && !deps.some((d) => d.key === key))
          deps.push({ key, title: dep.title, url: dep.url, state: dep.state });
      }
      for (const d of deps.filter(
        (dependency) => (issues[dependency.key]?.state ?? dependency.state) === 'OPEN',
      )) {
        const section = placement(d.key);
        blockers.push({ ...d, section, ticket: i.key });
        if (section && section !== n.id)
          wires.push({ from: [section, 'r'], to: [n.id, 'l'], kind: 'blocked', label: 'waits on' });
      }
    }
    const scope = scopeView(n, open, input.openEstimates?.[n.id], input.complete);
    const { live, merged } = scope.shares;
    const mergedPrs = (input.mergedPrs ?? []).filter(
      (p) => p.links.some((l) => owner.get(l.unit) === n.id) || p.inferred?.box === n.id,
    );
    const legacy = mergedPrs.filter(
      (p) =>
        !(input.trackedMergedPrs ?? []).some((t) => t.key === `${project.productRepo}#${p.number}`),
    );
    const review = reviewView(
      [
        ...tracked,
        ...open,
        ...legacy.map((p) => ({
          key: `${project.productRepo}#${p.number}`,
          number: p.number,
          title: p.title,
          body: null,
          url: p.url,
          headRefName: '',
          issueKeys: [],
          state: 'MERGED' as const,
          labels: p.labels,
        })),
      ].map((p) => reviewPr(p, project.reviewReceiptAuthors ?? [], project.reviewDebtLabels)),
      input.complete,
    );
    // Documentation is build work only in a configured planning section.
    const builds = (p: OpenPr): boolean => !p.docsOnly || planningSections.has(n.id);
    const build = [
      ...tracked.filter(builds).map((p) => ({ key: p.key, title: p.title, url: p.url })),
      ...openPrs.filter((_, i) => builds(open[i]!)),
      ...legacy.map((p) => ({
        key: `${project.productRepo}#${p.number}`,
        title: p.title,
        url: p.url,
      })),
    ];
    const state: BuildState =
      openPrs.length > 0
        ? 'built'
        : merged > 0 || (live === 0 && n.sinceAudit.merged > 0)
          ? 'merged'
          : live > 0
            ? 'live'
            : 'planned';
    const missing = Object.entries(planning)
      .filter(([step, values]) => step !== 'build' && values.length === 0)
      .map(([step]) => step);
    if (build.length === 0) missing.push('build');
    if (
      !input.complete ||
      here.some((i) => !i.contextComplete) ||
      [...open, ...tracked].some((p) => p.closingComplete === false)
    )
      missing.push('context');
    byNode[n.id] = {
      state,
      shares: scope.shares,
      scope,
      review,
      openPrs,
      planning: { ...planning, build },
      missing,
      blockers: blockers.filter((b, i, all) => all.findIndex((d) => d.key === b.key) === i),
      warnings,
      ...(specDocuments.length ? { specDocuments } : {}),
    };
  }
  for (const d of project.dependencies)
    if (boxes.has(d.from) && boxes.has(d.to))
      wires.push({ from: [d.from, 'r'], to: [d.to, 'l'], kind: 'dash', label: d.label });
  return {
    specProgress: buildSpecProgress({
      membership: project.specMembership,
      sections: nodes.map((n) => n.id),
      repos: project.repos,
      issues,
      at: input.at,
      complete: input.complete,
      error: input.error,
      now: Date.now(),
    }),
    at: input.at,
    complete: input.complete,
    error: input.error,
    ...(input.lastFailure ? { lastFailure: input.lastFailure } : {}),
    byNode,
    review: reviewView(
      Object.values(byNode).flatMap((n) => n.review.prs),
      input.complete,
    ),
    unplacedPrs: input.prs
      .filter((p) => !placedPrs.has(p.key))
      .map((p) => ({ key: p.key, title: p.title, url: p.url })),
    ...(project.progress?.basis === 'ticket-count' && project.progress.notPlaced === 'sections'
      ? {
          offMap: {
            prs: [
              ...input.prs.map((p) => ({ p, state: 'OPEN' as const })),
              ...(input.trackedMergedPrs ?? []).map((p) => ({ p, state: 'MERGED' as const })),
            ]
              .filter(({ p }) => {
                const box = placePr(p).box;
                return box !== null && !(box !== undefined && boxes.has(box));
              })
              .map(({ p, state }) => ({ key: p.key, title: p.title, url: p.url, state })),
            // As ticket progress holds a section whose labels were cut short (#88): a hidden label can
            // turn a loose card into a question or a loose question into a bug, so either may count.
            unreadLabels:
              project.progress.bugLabels?.length || project.progress.skipLabels?.length
                ? [
                    ...(input.ticketProgress?.unplaced ?? []),
                    ...(input.ticketProgress?.skipped ?? []).filter(
                      (t) => t.section !== 'outside' && !(t.section && boxes.has(t.section)),
                    ),
                  ]
                    .filter((t) => !issues[t.key]?.contextComplete)
                    .map((t) => t.key)
                : [],
          },
        }
      : {}),
    wires: wires.filter(
      (w, i, all) =>
        all.findIndex(
          (x) => x.from[0] === w.from[0] && x.to[0] === w.to[0] && x.kind === w.kind,
        ) === i,
    ),
  };
}

export function withWork(snapshot: Snapshot, work: WorkView): Snapshot {
  return {
    ...snapshot,
    work,
    view: { ...snapshot.view, wires: [...snapshot.view.wires, ...work.wires] },
  };
}
