// SPDX-License-Identifier: AGPL-3.0-only
//
// Tickets filed as GitHub issues (the product repo's #12, tools#5, a roadmap map #21): a PR names one with
// "Refs #n", "Closes #n" or "Ticket: #n", and a lane with "Ticket: #n". The issue belongs to a box through its own
// Section line or plan ticket ID (C80, U92), else through its sub-issue parent map (section-map.json "maps"), else
// the parent's own Section line or ticket ID.

import type { Plan } from './plan.ts';
import { DECLARED, declaredIds, linkFor } from './refs.ts';
import { sectionOf } from './infer.ts';

export interface IssueInfo {
  readonly title: string;
  readonly body: string;
  /** The sub-issue parent, as "Owner/repo#n". */
  readonly parent: string | null;
}
export interface IssuePlacement {
  readonly box: string;
  readonly reason: string;
  readonly inferred: boolean;
}

const KEYWORD =
  /\b(?:refs?|references|closes?|closed|fix(?:es|ed)?|resolves?|resolved|part of|parent|ticket)\b:?\s+((?:[A-Za-z0-9-]+\/)?[A-Za-z0-9._-]+#\d+|#\d+|https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/issues\/\d+)/gi;
const LIST_MORE = /^\s*(?:,|and)\s*((?:[A-Za-z0-9-]+\/)?[A-Za-z0-9._-]+#\d+|#\d+)/i;

/** "#12", "tools#5", "example-org/x#9" or an issue URL, as "Owner/repo#n"; null for anything else. */
export function issueKey(ref: string, defaultRepo: string): string | null {
  const url = /^https:\/\/github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)\/issues\/(\d+)$/.exec(ref);
  if (url) return `${url[1]}#${url[2]}`;
  const m = /^(?:(?:([A-Za-z0-9-]+)\/)?([A-Za-z0-9._-]+))?#(\d+)$/.exec(ref);
  if (!m) return null;
  const owner = m[1] ?? defaultRepo.split('/')[0];
  const repo = m[2] ?? defaultRepo.split('/')[1];
  return `${owner}/${repo}#${m[3]}`;
}

/** The issues a PR body names with a keyword ("Refs #1613", "Closes #1, #2"), as "Owner/repo#n". */
export function issueRefs(text: string, defaultRepo: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(KEYWORD)) {
    let ref: string | undefined = m[1];
    let rest = text.slice((m.index ?? 0) + m[0].length);
    while (ref) {
      const key = issueKey(ref, defaultRepo);
      if (key) out.add(key);
      const more = LIST_MORE.exec(rest);
      ref = more?.[1];
      rest = more ? rest.slice(more[0].length) : '';
    }
  }
  return [...out];
}

/** The box an issue's tickets belong to, and why; null when nothing places it. */
export function issueBox(
  key: string,
  issues: Readonly<Record<string, IssueInfo>>,
  maps: Readonly<Record<string, string>>,
  boxes: ReadonlySet<string>,
  plan: Plan,
  owner: ReadonlyMap<string, string>,
  matcher: RegExp,
): IssuePlacement | null {
  // Explicit lines (Section:, Ticket:, Unit:) win; then a configured map; and only then a bare ID
  // in a title, which can be a cut or candidate number that happens to match a plan ID (#104).
  const declared = (k: string): IssuePlacement | null => {
    const info = issues[k];
    if (!info) return null;
    const section = sectionOf(info.body, boxes);
    if (section) return { box: section, reason: `${k} names Section: ${section}`, inferred: false };
    for (const d of info.body.matchAll(DECLARED))
      for (const id of declaredIds(d[2] ?? '').ids) {
        const unit = linkFor(id, plan)?.unit;
        const box = unit ? owner.get(unit) : undefined;
        if (box) return { box, reason: `${k} declares ${id}`, inferred: false };
      }
    return null;
  };
  const titled = (k: string): IssuePlacement | null => {
    for (const m of (issues[k]?.title ?? '').matchAll(matcher)) {
      const unit = linkFor(m[1] ?? '', plan)?.unit;
      const box = unit ? owner.get(unit) : undefined;
      if (box) return { box, reason: `${k} names ${m[1]}`, inferred: false };
    }
    return null;
  };
  const direct = declared(key);
  if (direct) return direct;
  // A map pointing at a box no longer on the diagram places nothing.
  const mapped = (k: string): string | undefined =>
    maps[k] === 'outside' || boxes.has(maps[k] ?? '') ? maps[k] : undefined;
  const map = mapped(key);
  if (map) return { box: map, reason: `${key} is a map of ${map}`, inferred: true };
  const parent = issues[key]?.parent;
  const parentMap = parent ? mapped(parent) : undefined;
  if (parentMap)
    return {
      box: parentMap,
      reason: `${key} is a ticket of map ${parent} (${parentMap})`,
      inferred: true,
    };
  const title = titled(key);
  if (title) return title;
  if (!parent) return null;
  const up = declared(parent) ?? titled(parent);
  return up ? { box: up.box, reason: `${key}'s parent ${up.reason}`, inferred: true } : null;
}
