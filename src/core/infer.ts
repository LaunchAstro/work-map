// SPDX-License-Identifier: AGPL-3.0-only
//
// Where a PR or a lane sits on the diagram: a "Section: <box>" line, and a lane's box from its name. The placements the
// retired sweep wrote (inferred.json) keep their shape here; they are shown as inferred, never as stated.

export type InferVia =
  'stated' | 'section' | 'issue' | 'section-map' | 'lane' | 'lane-name' | 'luna' | 'sol';

export interface Inference {
  readonly box: string; // a diagram node id, or 'outside' for work outside the plan
  readonly unit: string | null;
  readonly via: InferVia;
  readonly confidence: number;
  readonly reason: string;
  readonly at: string;
}

// The whole box id ("b2" included); "tasks-other" is not "tasks": only an exact box id counts.
const SECTION = /^[ \t>*-]*\**sections?\**[ \t]*:\**[ \t]*`?([a-z][a-z0-9-]*)`?(?![a-z0-9_-])/gim;

/** The box a "Section: tasks" line names, when it is one of the diagram's boxes. */
export function sectionOf(text: string, boxes: ReadonlySet<string>): string | null {
  for (const m of text.matchAll(SECTION)) if (boxes.has(m[1] ?? '')) return m[1] ?? null;
  return null;
}

export interface LaneRule {
  readonly pattern: string;
  readonly box: string;
}

export function laneNameBox(
  lane: string,
  rules: readonly LaneRule[] = [],
  prefix = '',
): string | null {
  const name = lane.startsWith(prefix) ? lane.slice(prefix.length) : lane;
  return rules.find((r) => new RegExp(r.pattern, 'i').test(name))?.box ?? null;
}
