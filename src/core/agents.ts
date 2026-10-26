// SPDX-License-Identifier: AGPL-3.0-only
//
// Which lanes are on which boxes, from the round's events.log. Pure: the reader passes it in.
//
// A lane is any name that wrote a BOOTED line to events.log. A lane's ticket comes only from its own BOOTED or
// TICKET line naming it ("Ticket: C80", "Unit: U32"), the same rule as pull requests; each such line replaces the
// last, and a boot without one clears it. Without one, its box is unknown.
// State is unknown, unless the log says it wrapped or was closed, which is done; a closed lane drops out after
// twelve hours.

import {
  AGENTS_SCHEMA,
  type AgentsSnapshot,
  type FogItem,
  type LaneState,
  type LaneView,
} from './contract.ts';
import type { Plan } from './plan.ts';
import { laneNameBox, type LaneRule } from './infer.ts';
import { issueKey, type IssuePlacement } from './issues.ts';
import { declaredIds, linkFor } from './refs.ts';

export interface EventLane {
  lane: string;
  bootedAt: string | null;
  closedAt: string | null;
  machine: string | null;
  tickets: string[];
  /** The box its own BOOTED or TICKET line names with "Section: <box>". */
  section: string | null;
  /** PRs it opened or pushed, from its PR-OPENED, PUSHING, FIX-PUSHED and READY lines. */
  prs: number[];
  /** Tickets filed as issues that its BOOTED or TICKET line names, as "Owner/repo#n". */
  issues?: string[];
  last: { at: string; verb: string; text: string } | null;
}
export interface EventsState {
  /** 2 since lanes carry section and prs; an older state is read again from the start. */
  version: 2;
  file: string | null;
  offset: number;
  lastAt: string | null;
  lanes: Record<string, EventLane>;
}

const LINE = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) (\S+) (\S+) ?(.*)$/;
const PR_VERBS = new Set(['PR-OPENED', 'PUSHING', 'FIX-PUSHED', 'READY']);
const DECL = /\b(?:tickets?|units?)\s*:\s*([A-Za-z0-9 ,;#/._-]+)/gi;

export const emptyEventsState = (): EventsState => ({
  version: 2,
  file: null,
  offset: 0,
  lastAt: null,
  lanes: {},
});

/** Folds the bytes added since the last read; a partial last line waits for the next read. */
export function foldEvents(
  state: EventsState,
  file: string,
  text: string,
  plan: Plan,
  productRepo = '',
): EventsState {
  const same = state.file === file;
  const next: EventsState = same ? structuredClone(state) : { ...emptyEventsState(), file };
  const end = text.lastIndexOf('\n') + 1;
  for (const line of text.slice(0, end).split('\n')) {
    const m = LINE.exec(line);
    if (!m) continue;
    const [, at = '', actor = '', verb = '', rest = ''] = m;
    next.lastAt = at;
    if (verb === 'BOOTED') {
      const had = next.lanes[actor];
      next.lanes[actor] = {
        lane: actor,
        bootedAt: at,
        closedAt: null,
        tickets: [],
        issues: [],
        section: null,
        prs: had?.prs ?? [],
        last: had?.last ?? null,
        machine: /\bmachine=(\S+)/.exec(rest)?.[1] ?? null,
      };
    }
    if (actor === 'ORCH' && verb === 'CLOSED') {
      const name = /^(\S+)/.exec(rest)?.[1];
      if (name !== undefined)
        for (const n of [name, name.replace(/-[A-Za-z]+$/, '')]) {
          const l = next.lanes[n];
          if (l) l.closedAt = at;
        }
    }
    const lane = next.lanes[actor];
    if (!lane) continue;
    if (verb === 'WRAPPED') lane.closedAt = at;
    lane.last = { at, verb, text: rest.slice(0, 240) };
    if (PR_VERBS.has(verb))
      for (const n of rest.matchAll(/#(\d{3,6})\b/g)) {
        const num = Number(n[1]);
        if (!lane.prs.includes(num)) lane.prs.push(num);
      }
    if (verb !== 'BOOTED' && verb !== 'TICKET') continue;
    lane.section = /\bsections?\s*:\s*`?([a-z][a-z0-9-]*)(?![a-z0-9_-])/i.exec(rest)?.[1] ?? null;
    // Each BOOTED or TICKET line sets the lane's tickets afresh: none, no line, or only unknown IDs is no ticket.
    const ids: string[] = [];
    const issues: string[] = [];
    let none = false;
    for (const d of rest.matchAll(DECL)) {
      const x = declaredIds(d[1] ?? '');
      none ||= x.none;
      ids.push(...x.ids.filter((id) => linkFor(id, plan) !== null));
      for (const ref of x.issues) {
        const key = issueKey(ref, productRepo);
        if (key) issues.push(key);
      }
    }
    lane.tickets = none ? [] : [...new Set(ids)];
    lane.issues = none ? [] : [...new Set(issues)];
  }
  next.offset = (same ? state.offset : 0) + Buffer.byteLength(text.slice(0, end));
  return next;
}

export interface LanesInput {
  readonly events: EventsState;
  readonly round: { readonly events: string; readonly lastEventAt: string | null } | null;
  readonly herdr: { readonly ok: boolean; readonly error: string | null };
  readonly plan: Plan;
  readonly owner: ReadonlyMap<string, string>;
  readonly now: Date;
  readonly prefix?: string;
  readonly laneRules?: readonly LaneRule[];
  readonly keepClosedHours?: number;
  /** The diagram's box ids, the box a lane's brief names, and the inferred box of each PR. */
  readonly boxes?: ReadonlySet<string>;
  readonly briefBox?: ReadonlyMap<string, string>;
  readonly prBox?: ReadonlyMap<number, string>;
  /** Each ticket issue's box (issues.ts), for lanes whose Ticket: names an issue. */
  readonly issueBox?: ReadonlyMap<string, IssuePlacement>;
}

export function buildAgents(input: LanesInput): AgentsSnapshot {
  const { events, plan, owner, now, prefix = '', keepClosedHours = 12 } = input;
  const lanes: LaneView[] = [];
  for (const name of Object.keys(events.lanes).toSorted()) {
    const ev = events.lanes[name];
    // A closed lane drops out twelve hours after the log says it closed; an open one stays, as unknown.
    if (ev?.closedAt && now.getTime() - Date.parse(ev.closedAt) > keepClosedHours * 3_600_000)
      continue;
    const state: LaneState = ev?.closedAt ? 'done' : 'unknown';
    const tickets = ev?.tickets ?? [];
    const units = unitsOf(tickets, plan);
    const box = laneBox({
      name,
      ev,
      units,
      owner,
      boxes: input.boxes,
      briefBox: input.briefBox,
      prBox: input.prBox,
      issueBox: input.issueBox,
      laneRules: input.laneRules,
      lanePrefix: prefix,
    });
    lanes.push({
      lane: name,
      workspace: null,
      state,
      // herdr is no longer read; seen.herdr and herdr below are kept for one release so an open previous
      // screen passes its check (removal is #310).
      seen: { herdr: false, events: ev !== undefined },
      machine: ev?.machine ?? null,
      tickets,
      units,
      nodes: box ? [box.box] : [],
      boxVia: box?.via ?? null,
      bootedAt: ev?.bootedAt ?? null,
      closedAt: ev?.closedAt ?? null,
      last: ev?.last ?? null,
    });
  }
  const byNode: Record<string, string[]> = {};
  for (const l of lanes) for (const n of l.nodes) (byNode[n] ??= []).push(l.lane);

  const fog: FogItem[] = [];
  const open = lanes.filter((l) => l.state !== 'done');
  const noBox = open.filter((l) => l.nodes.length === 0);
  const guessed = open.filter(
    (l) => l.boxVia !== null && l.boxVia !== 'section' && l.boxVia !== 'ticket',
  );
  if (noBox.length > 0)
    fog.push({
      id: 'lanes-no-ticket',
      text: `${noBox.length} open lanes name no box and none could be inferred, so their box is unknown: ${noBox.map((l) => l.lane).join(', ')}.`,
    });
  if (guessed.length > 0)
    fog.push({
      id: 'lanes-inferred',
      text: `${guessed.length} open lanes name no box, so it is inferred from the lane's name, brief or PRs: ${guessed.map((l) => `${l.lane} (${l.boxVia})`).join(', ')}.`,
    });
  if (!input.round)
    fog.push({
      id: 'round',
      text: 'No round events.log was found, so lanes and tickets come from the last log read, if any.',
    });

  return {
    schema: AGENTS_SCHEMA,
    generatedAt: now.toISOString(),
    round: input.round,
    herdr: input.herdr,
    lanes,
    byNode,
    fog,
  };
}

export type LaneBoxVia = 'section' | 'ticket' | 'issue' | 'brief' | 'lane-name' | 'prs';

/** The units a lane's tickets belong to, each once. */
function unitsOf(tickets: readonly string[], plan: Plan): string[] {
  const units = tickets.map((t) => linkFor(t, plan)?.unit);
  return [...new Set(units.filter((u): u is string => u !== undefined))];
}

/**
 * Each lane's PRs keyed to the lane's box, closed lanes included. Where lanes name one PR, the
 * lane whose last line is latest wins, and at the same time the later lane name.
 */
export function lanePrBoxes(input: {
  readonly events: EventsState;
  readonly plan: Plan;
  readonly owner: ReadonlyMap<string, string>;
  readonly boxes: ReadonlySet<string>;
  readonly briefBox: ReadonlyMap<string, string>;
  readonly issueBox: ReadonlyMap<string, IssuePlacement>;
  readonly laneRules: readonly LaneRule[];
  readonly lanePrefix: string;
  readonly repository: string;
}): Record<string, string> {
  const { events } = input;
  const at = (name: string): string => events.lanes[name]?.last?.at ?? '';
  const byName = Object.keys(events.lanes).toSorted();
  const out: Record<string, string> = {};
  // toSorted is stable, so lanes with the same last time stay in name order.
  for (const name of byName.toSorted((a, b) => at(a).localeCompare(at(b)))) {
    const ev = events.lanes[name];
    const placed = laneBox({
      name,
      ev,
      units: unitsOf(ev?.tickets ?? [], input.plan),
      owner: input.owner,
      boxes: input.boxes,
      briefBox: input.briefBox,
      prBox: undefined,
      issueBox: input.issueBox,
      laneRules: input.laneRules,
      lanePrefix: input.lanePrefix,
    });
    if (!placed) continue;
    for (const number of ev?.prs ?? []) out[`${input.repository}#${number}`] = placed.box;
  }
  return out;
}

/** A lane's box: what it names first (Section, then ticket), then what can be inferred (brief, name, its PRs). */
export function laneBox(x: {
  readonly name: string;
  readonly laneRules?: readonly LaneRule[] | undefined;
  readonly lanePrefix?: string | undefined;
  readonly ev: EventLane | undefined;
  readonly units: readonly string[];
  readonly owner: ReadonlyMap<string, string>;
  readonly boxes: ReadonlySet<string> | undefined;
  readonly briefBox: ReadonlyMap<string, string> | undefined;
  readonly prBox: ReadonlyMap<number, string> | undefined;
  readonly issueBox?: ReadonlyMap<string, IssuePlacement> | undefined;
}): { box: string; via: LaneBoxVia } | null {
  const section = x.ev?.section;
  if (section && (!x.boxes || x.boxes.has(section))) return { box: section, via: 'section' };
  const fromTicket = x.units.map((u) => x.owner.get(u)).find((b) => b !== undefined);
  if (fromTicket) return { box: fromTicket, via: 'ticket' };
  const fromIssue = (x.ev?.issues ?? [])
    .map((k) => x.issueBox?.get(k))
    .find((b) => b !== undefined && b.box !== 'outside');
  if (fromIssue) return { box: fromIssue.box, via: fromIssue.inferred ? 'issue' : 'ticket' };
  const brief = x.briefBox?.get(x.name);
  if (brief) return { box: brief, via: 'brief' };
  const byName = laneNameBox(x.name, x.laneRules, x.lanePrefix);
  if (byName) return { box: byName, via: 'lane-name' };
  const votes = new Map<string, number>();
  for (const n of x.ev?.prs ?? []) {
    const b = x.prBox?.get(n);
    if (b && b !== 'outside') votes.set(b, (votes.get(b) ?? 0) + 1);
  }
  const best = [...votes.entries()].toSorted((a, b) => b[1] - a[1])[0];
  return best ? { box: best[0], via: 'prs' } : null;
}
