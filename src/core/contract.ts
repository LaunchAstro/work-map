import type { MapGapReport } from './map-gaps.ts';
// SPDX-License-Identifier: AGPL-3.0-only
//
// The live roadmap's two read models, as files carry them. Types only: the snapshot is a
// map (the whole build), its sections are the stages and boxes, its tickets are the plan's units and
// tickets, its frontier is where work moved since the audit, and its fog is what it cannot place.
// CONTRACT.md explains each field.

import type { Inference } from './infer.ts';
import type { TimeDisplay } from './time.ts';
import type { WorkView } from './work.ts';

export const SNAPSHOT_SCHEMA = 'work-map/4';
export const AGENTS_SCHEMA = 'work-map-agents/2';

export type Live = 'yes' | 'partly' | 'no';
export type BoxStatus = 'built' | 'in-progress' | 'planned';
export type PrClass = 'mapped' | 'inferred' | 'outside' | 'unmapped';
export type LinkVia = 'backfill' | 'declared' | 'title' | 'roadmap';
export type LaneState = 'working' | 'idle' | 'blocked' | 'done' | 'unknown';

/** Coded, from the audit: estimate-day weighted share of the units' code, with its range. */
export interface Coded {
  readonly pct: number;
  readonly low: number;
  readonly high: number;
}
/** Switched on, from the audit (a unit's code counts in full when live, half when partly), plus switch-on issues. */
export interface On {
  readonly pct: number;
  readonly switchOnsClosed: number;
  readonly switchOnsOpen: number;
}
export interface SinceAudit {
  readonly merged: number;
  readonly prs: readonly number[];
}
/** The numbers every level carries, kept separate and never blended. */
export interface Measures {
  readonly days: number;
  readonly coded: Coded;
  readonly on: On;
  /** Empty: kept because the screen's input check requires it; the work view's review coverage is shown. */
  readonly reviewed: Readonly<Record<string, never>>;
  readonly sinceAudit: SinceAudit;
  /** Of the merged PRs counted here, how many are placed by the retired sweep's inferred.json, not stated. */
  readonly inferredPrs: number;
  readonly estimate: Estimate;
}

/**
 * The live estimate of the coded share, flagged as an estimate beside the audit. Per unit: the section re-estimate when it
 * is newer than the audit; otherwise the share of the unit's tickets a merged PR names as complete, when that is
 * above the audit; otherwise the audit. Boxes and stages weight units by estimate-days, as the audit does.
 */
export interface Estimate {
  readonly pct: number;
  readonly source: 'sol' | 'tickets' | 'audit';
  readonly at: string | null;
  readonly reason: string;
}

/** The merge queue at the last GitHub read. */
export interface Stats {
  readonly at: string;
  readonly queued: number | null;
  /** The merge queue's first entries at the last good read; absent in snapshots written before #242. */
  readonly queueEntries?: readonly {
    readonly position: number;
    readonly number: number;
    readonly title: string;
    readonly url: string;
    readonly enqueuedAt: string;
  }[];
}

export interface TicketView {
  readonly id: string;
  readonly prs: readonly number[];
}
export interface UnitView extends Measures {
  readonly id: string;
  readonly title: string;
  readonly audit: {
    readonly code: number;
    readonly low: number;
    readonly high: number;
    readonly live: Live;
    readonly why: string;
  };
  readonly tickets: readonly TicketView[];
  /** Pull requests linked to the unit itself ("Unit: U32"), not to one of its tickets. */
  readonly unitPrs: readonly number[];
  /** Pull requests that only mention one of its tickets in the body: shown, never counted. */
  readonly candidatePrs: readonly number[];
  readonly switchOns: readonly number[];
}
/** A box of the diagram (a section of the map). */
export interface NodeView extends Measures {
  readonly id: string;
  readonly title: string;
  readonly repo: string;
  readonly text: string;
  readonly row: number;
  readonly status: BoxStatus;
  readonly units: readonly UnitView[];
}
export interface StageView extends Measures {
  readonly index: number;
  readonly name: string;
  readonly nodes: readonly NodeView[];
}

export interface PrLink {
  readonly unit: string;
  readonly ticket: string | null;
  readonly via: LinkVia;
  /** The PR says it finishes this ticket ("Ticket: C80 complete"). */
  readonly complete: boolean;
}
export interface PrView {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly mergedAt: string;
  readonly labels: readonly string[];
  readonly sinceAudit: boolean;
  readonly class: PrClass;
  /** The retired sweep's kept placement, for a PR that states none. */
  readonly inferred: Inference | null;
  readonly links: readonly PrLink[];
  readonly candidates: readonly { readonly unit: string; readonly ticket: string | null }[];
  readonly notes: readonly string[];
}
export interface SwitchOnView {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly closedAt: string | null;
  readonly units: readonly string[];
  readonly mapped: boolean;
}

/** The frontier: the units where merged work moved since the audit. */
export interface FrontierItem {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly type: 'unit';
  readonly mergedSinceAudit: number;
}
/** The fog: what the snapshot cannot place, said plainly. */
export interface FogItem {
  readonly id: string;
  readonly text: string;
}

export interface Wire {
  readonly from: readonly (string | number)[];
  readonly to: readonly (string | number)[];
  readonly gap?: number;
  readonly lane?: number;
  readonly kind?: string;
  readonly label?: string;
}
/** The diagram's own words and wires, from the project's flow JSON, so a reader can draw it. */
export interface DiagramView {
  readonly title: string;
  readonly lede: string;
  readonly overallNote: string;
  readonly footnote: string;
  readonly steps: readonly { readonly title: string; readonly text: string }[];
  readonly wires: readonly Wire[];
}

export interface GithubRunLog {
  readonly at: string;
  readonly mode?: 'full' | 'incremental';
  readonly calls?: { readonly restRateLimit: number; readonly graphql: number };
  readonly cost?: number;
  readonly remaining?: { readonly core: number | null; readonly graphql: number | null } | null;
  readonly prsChanged?: number;
  readonly switchOnsChanged?: number;
  readonly skipped?: string | null;
  readonly partial?: boolean;
  readonly error?: string;
}

export interface Snapshot {
  readonly progressBasis?: 'estimated-scope' | 'ticket-count';
  readonly ticketProgress?: import('./ticket-progress.ts').TicketProgress | undefined;
  readonly loadingBay?: import('./loading-bay.ts').LoadingBay;
  readonly work?: WorkView;
  readonly mapGaps?: MapGapReport | null;
  readonly schema: typeof SNAPSHOT_SCHEMA;
  readonly id: string;
  readonly type: 'map';
  readonly title: string;
  readonly generatedAt: string;
  /** The zone and locale every time on this map is shown in, whoever views it; older snapshots have none. */
  readonly display?: TimeDisplay | undefined;
  readonly destination: FogItem;
  readonly sources: {
    readonly audit: {
      readonly asAt: string;
      readonly at: string;
      readonly exactTime: boolean;
      readonly file: string;
    };
    readonly plan: {
      readonly file: string;
      readonly boxes: string;
      readonly commit: string | null;
    };
    readonly github: {
      readonly repo: string;
      readonly prsThrough: string | null;
      readonly issuesThrough: string | null;
      readonly lastRun: GithubRunLog | null;
    } | null;
    readonly mapping: {
      readonly file: string;
      readonly approvedPrs: number;
      readonly pendingPrs: number;
      readonly approvedSwitchOns: number;
      readonly pendingSwitchOns: number;
    };
  };
  readonly totals: Measures & {
    readonly units: number;
    readonly prs: {
      readonly merged: number;
      readonly mapped: number;
      readonly outside: number;
      readonly unmapped: number;
      readonly sinceAudit: number;
    };
  };
  readonly stages: readonly StageView[];
  readonly prs: Readonly<Record<string, PrView>>;
  readonly switchOns: readonly SwitchOnView[];
  readonly frontier: readonly FrontierItem[];
  readonly fog: readonly FogItem[];
  readonly unmapped: {
    readonly count: number;
    readonly prs: readonly number[];
    readonly switchOns: readonly number[];
  };
  readonly view: DiagramView;
  readonly stats: Stats;
  readonly sweep: {
    readonly inferred: number;
    readonly byVia: Readonly<Record<string, number>>;
    readonly estimates: number;
    /** Always null since the sweep was retired; map gaps are `mapGaps`. */
    readonly gaps: null;
  };
  readonly warnings: readonly string[];
}

export interface LaneView {
  readonly lane: string;
  readonly workspace: {
    readonly id: string;
    readonly label: string;
    readonly pane: string | null;
    readonly title: string | null;
  } | null;
  readonly state: LaneState;
  /** `herdr` is always false and readers accept it missing; the collector stops writing it in #310. */
  readonly seen: { readonly herdr?: boolean; readonly events: boolean };
  readonly machine: string | null;
  readonly tickets: readonly string[];
  readonly units: readonly string[];
  readonly nodes: readonly string[];
  /** How the lane's box is known: named (section, ticket) or inferred (brief, lane-name, prs); null when unknown. */
  readonly boxVia: 'section' | 'ticket' | 'issue' | 'brief' | 'lane-name' | 'prs' | null;
  readonly bootedAt: string | null;
  readonly closedAt: string | null;
  readonly last: { readonly at: string; readonly verb: string; readonly text: string } | null;
}
export interface AgentsSnapshot {
  readonly seatGauge?: import('./seat-gauge.ts').SeatGaugeReport;
  readonly agentSource?: { readonly state: 'pending'; readonly reason: string };
  readonly schema: typeof AGENTS_SCHEMA;
  readonly generatedAt: string;
  readonly round: { readonly events: string; readonly lastEventAt: string | null } | null;
  /** Always `ok: false` since herdr stopped being read; readers accept it missing, and #310 stops writing it. */
  readonly herdr?: { readonly ok: boolean; readonly error: string | null };
  readonly lanes: readonly LaneView[];
  readonly byNode: Readonly<Record<string, readonly string[]>>;
  readonly fog: readonly FogItem[];
}
