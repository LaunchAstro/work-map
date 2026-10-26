// SPDX-License-Identifier: AGPL-3.0-only
//
// Which plan units and tickets a merged pull request belongs to, without guessing.
//
// A link counts only when it is stated, in this order of trust:
//   backfill  an approved entry in mapping.json; it replaces everything below
//   declared  a body line "Ticket: C80", "Tickets: C80, C81", "Unit: U32", or "Ticket: none" (outside the plan)
//   title     a ticket or unit ID in the title or the branch name
//   roadmap   a link to a unit's issue on the roadmap tracker, as build-units.md cites it ("U01 (#671)")
// A declared line replaces title and roadmap links. An ID found only elsewhere in the body is a
// candidate: shown beside the pull request, never counted.

import type { LinkVia, PrLink } from './contract.ts';
import { issueKey, issueRefs } from './issues.ts';
import type { Plan } from './plan.ts';

const repoOf = (url: string): string => new URL(url).pathname.split('/').slice(1, 3).join('/');

export interface PrInput {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly url: string;
  readonly mergedAt: string;
  readonly updatedAt: string;
  readonly headRefName: string;
  readonly labels: readonly string[];
}
export interface BackfillEntry {
  readonly ids?: readonly string[];
  readonly none?: boolean;
  readonly approvedBy?: string;
  readonly note?: string;
}
export interface Refs {
  readonly links: PrLink[];
  readonly outside: boolean;
  readonly candidates: { unit: string; ticket: string | null }[];
  readonly notes: string[];
  /** Tickets filed as issues that the PR names (Ticket: #n, Refs #n, Closes #n), as "Owner/repo#n". */
  readonly issues: string[];
}

export function idMatcher(ids: Iterable<string>): RegExp {
  const alt = [...ids]
    .toSorted((a, b) => b.length - a.length)
    .map((s) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
    .join('|');
  // Not part of a longer ID: C71 does not match inside C71-CHAIN-3, C71_X, NOT_C71 or C710, nor MP-1-2 inside MP-1-20.
  return new RegExp(`(?<![A-Za-z0-9_-])(${alt})(?![A-Za-z0-9_]|-[A-Za-z0-9])`, 'g');
}

export function linkFor(id: string, plan: Plan): { unit: string; ticket: string | null } | null {
  if (plan.units[id]) return { unit: id, ticket: null };
  const unit = plan.tickets[id];
  return unit === undefined ? null : { unit, ticket: id };
}

export const DECLARED: RegExp = /^[ \t>*-]*\**(tickets?|units?)\**[ \t]*:\**[ \t]*(.+)$/gim;
// Only an exact reference: "example-org/example-app-roadmap#671" standing alone, or the issue's github.com address,
// each ending at the number: no further path, query or word may follow ("/671/x", "/671.5", "#671-x").
const roadmapRef = (repo: string): RegExp => {
  const escaped = repo.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(
    `(?:(?<![A-Za-z0-9./-])${escaped}#(\\d+)|(?<![A-Za-z0-9./-])https:\\/\\/github\\.com\\/${escaped}\\/issues\\/(\\d+))(?![A-Za-z0-9/%?-]|[._][A-Za-z0-9])`,
    'g',
  );
};
const ID_SHAPED = /^[A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)*$/;

/**
 * The leading ID list of a declaration: "C80, C81", "U32" or "none". The first word that is not an ID ends the
 * list, so "C80, the About page" is C80 alone, and "none, fixed a C80 flake" is none alone.
 */
export function declaredIds(text: string): {
  ids: string[];
  none: boolean;
  complete: boolean;
  issues: string[];
} {
  const ids: string[] = [];
  const issues: string[] = [];
  let none = false;
  let complete = false;
  for (const raw of text.trim().split(/\s*[,;]\s*|\s+/)) {
    // Brackets and a trailing colon around an ID are allowed: "(S0-1)", "[S0-1]", "S0-1:".
    const id = raw.replaceAll(/^[`*([]+|[`*.)\]:]+$/g, '');
    if (id === '') continue;
    if (/^none$/i.test(id)) none = true;
    else if (ID_SHAPED.test(id) && /\d/.test(id)) ids.push(id);
    // A ticket filed as an issue: "#12", "tools#5", "example-org/example-app#12".
    else if (/^(?:(?:[A-Za-z0-9-]+\/)?[A-Za-z0-9._-]+)?#\d+$/.test(id)) issues.push(id);
    else {
      // "Ticket: C80 complete" (or done, or in brackets) marks the tickets as finished by this PR.
      complete = /^(complete[sd]?|done|finished)$/i.test(id);
      break;
    }
  }
  return { ids, none, complete, issues };
}

export function refsFor(
  pr: PrInput,
  plan: Plan,
  matcher: RegExp,
  backfill: Readonly<Record<string, BackfillEntry>>,
  context?: { productRepo: string; roadmapRepo: string },
): Refs {
  const defaultRepo = context?.productRepo ?? repoOf(pr.url);
  const tracker = context?.roadmapRepo ?? `${defaultRepo}-roadmap`;
  const notes: string[] = [];
  const body = pr.body ?? '';
  const found = (text: string): string[] => [
    ...new Set([...text.matchAll(matcher)].map((m) => m[1] ?? '')),
  ];
  const links: PrLink[] = [];
  const add = (id: string, via: LinkVia, complete = false): boolean => {
    const l = linkFor(id, plan);
    if (!l) return false;
    if (!links.some((x) => x.unit === l.unit && x.ticket === l.ticket))
      links.push({ ...l, via, complete });
    return true;
  };

  let outside = false;
  const entry = backfill[String(pr.number)];
  if (entry) {
    outside = entry.none === true;
    for (const id of entry.ids ?? [])
      if (!add(id, 'backfill'))
        notes.push(`backfill names ${id}, which is not a plan ticket or unit`);
  } else {
    // A "Ticket:" or "Unit:" line counts as a declaration only when it starts with an ID or none.
    const declared = [...body.matchAll(DECLARED)]
      .map((m) => declaredIds(m[2] ?? ''))
      .filter((d) => d.none || d.ids.length > 0 || d.issues.length > 0);
    if (declared.length > 0) {
      const ids = declared.flatMap((d) => d.ids);
      const done = new Set(declared.filter((d) => d.complete).flatMap((d) => d.ids));
      const none = declared.some((d) => d.none);
      if (none && ids.length > 0)
        notes.push(`declares both none and ${ids.join(', ')}, so it is not placed`);
      else if (none) outside = true;
      else
        for (const id of ids)
          if (!add(id, 'declared', done.has(id)))
            notes.push(`declares ${id}, which is not a plan ticket or unit`);
    } else {
      for (const id of found(`${pr.title}\n${pr.headRefName}`)) add(id, 'title');
      for (const m of body.matchAll(roadmapRef(tracker))) {
        const n = m[1] ?? m[2] ?? '';
        const unit = plan.unitIssues[n];
        if (unit === undefined)
          notes.push(`links roadmap issue #${n}, which is not a unit issue the plan cites`);
        else add(unit, 'roadmap');
      }
    }
  }
  if (links.length > 0) outside = false;

  const candidates: { unit: string; ticket: string | null }[] = [];
  for (const id of found(body)) {
    const l = linkFor(id, plan);
    if (!l) continue;
    const counted = links.some(
      (x) => x.unit === l.unit && (x.ticket === l.ticket || x.ticket === null),
    );
    if (!counted && !candidates.some((c) => c.unit === l.unit && c.ticket === l.ticket))
      candidates.push(l);
  }
  const issues = new Set(issueRefs(body, defaultRepo));
  for (const m of body.matchAll(DECLARED))
    for (const ref of declaredIds(m[2] ?? '').issues) {
      const key = issueKey(ref, defaultRepo);
      if (key) issues.add(key);
    }
  return { links, outside, candidates, notes: [...new Set(notes)], issues: [...issues] };
}
