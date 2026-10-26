import { z } from 'zod';
import { fresh, readOnce } from './freshness.ts';
import type { Project } from '../readers/project.ts';

interface SessionTokens {
  responses: number;
  input: number;
  output: number;
  thinking: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}
interface SessionSource {
  machine: string;
  session_id: string;
  workspace: string;
  pane: string;
  tool: string;
  model: string | null;
  effort: string | null;
  repo: string | null;
  /**
   * Seat Gauge's GitHub `owner/name` for the session's remote; null when it has none or is malformed,
   * and missing from reports saved before it existed.
   */
  repository?: string | null | undefined;
  section: string | null;
  seat: string | null;
  branch: string | null;
  started_at: string | null;
  closed_at: string | null;
  status: string;
  as_of: string;
  stale: boolean;
  tokens: SessionTokens | null;
  usd: number | null;
}
export interface SeatGaugeSession {
  id: string;
  source: SessionSource;
  repository: string | null;
  section: string | null;
  prs: string[];
  tickets: string[];
  /** The ticket link the branch alone added, beside the PRs' closing references. */
  branchTicket?: string | null | undefined;
  elapsedSeconds: number | null;
  state: 'current' | 'pending';
  reason: string;
}
export interface SeatGaugeReport {
  schema: 'work-map-seat-gauge/1';
  project: string;
  at: string | null;
  readAt: string;
  githubAt: string | null;
  /** The work read behind section placements; branch placement expires with it. */
  placementsAt?: string | null;
  state: 'current' | 'pending';
  reason: string;
  sessions: SeatGaugeSession[];
  unmapped: number;
}
const text = z.string().max(512);
const identity = text.min(1);
const date = z.iso.datetime({ offset: true });
const optionalText = text.nullish().transform((value) => value ?? null);
const optionalDate = date.nullish().transform((value) => value ?? null);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const GITHUB_REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const repository = z.string().regex(GITHUB_REPOSITORY);
const issueKey = z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+#[1-9]\d*$/);
const Tokens: z.ZodType<SessionTokens> = z.object({
  responses: count,
  input: count,
  output: count,
  thinking: count,
  cacheRead: count,
  cacheWrite5m: count,
  cacheWrite1h: count,
});
const Source: z.ZodType<SessionSource> = z.object({
  machine: identity,
  session_id: identity,
  workspace: text,
  pane: text,
  tool: text,
  model: optionalText,
  effort: optionalText,
  repo: optionalText,
  // Newer than the rest of the row: absent from older Seat Gauge versions, and a malformed value falls
  // back to the label map rather than failing the whole publication.
  repository: z
    .unknown()
    .optional()
    .transform((value) =>
      typeof value === 'string' && GITHUB_REPOSITORY.test(value) ? value : null,
    ),
  section: optionalText,
  seat: optionalText,
  branch: optionalText,
  started_at: optionalDate,
  closed_at: optionalDate,
  status: text,
  as_of: date,
  stale: z.boolean(),
  tokens: Tokens.nullish().transform((value) => value ?? null),
  usd: z
    .number()
    .finite()
    .nonnegative()
    .nullish()
    .transform((value) => value ?? null),
});
const Publication = z.object({
  version: z.literal(1),
  updated: date,
  sessions: z.array(Source).max(5000),
  problems: z.record(z.string(), z.string()),
});
const Row: z.ZodType<SeatGaugeSession> = z.object({
  id: identity.max(1100),
  source: Source,
  repository: repository.nullable(),
  section: identity.nullable(),
  prs: z.array(issueKey).max(1000),
  tickets: z.array(issueKey).max(10000),
  branchTicket: issueKey.nullable().optional(),
  elapsedSeconds: count.nullable(),
  state: z.enum(['current', 'pending']),
  reason: text,
});
const Report: z.ZodType<SeatGaugeReport> = z.object({
  schema: z.literal('work-map-seat-gauge/1'),
  project: identity,
  at: date.nullable(),
  readAt: date,
  githubAt: date.nullable(),
  state: z.enum(['current', 'pending']),
  reason: text,
  sessions: z.array(Row).max(5000),
  placementsAt: date.nullable().default(null),
  unmapped: count.default(0),
});
const Cache = z.object({
  project: identity,
  at: date.nullable(),
  complete: z.literal(true),
  error: z.null(),
  prs: z
    .array(
      z.object({
        key: issueKey,
        headRefName: text,
        headRepository: repository.nullish(),
        issueKeys: z.array(issueKey),
        state: z.literal('OPEN').optional(),
      }),
    )
    .max(10000),
});
const Keyed = z.array(z.object({ key: issueKey, section: identity.nullish() })).max(100_000);
const Snapshot = z.object({
  id: identity,
  ticketProgress: z
    .object({
      totals: z.object({ tickets: Keyed }),
      bugs: z.object({ totals: z.object({ tickets: Keyed }) }).nullish(),
      skipped: Keyed.nullish(),
      outside: Keyed.nullish(),
    })
    .nullish(),
  work: z.object({
    at: date.nullable(),
    byNode: z.record(
      z.string(),
      z.object({
        openPrs: z.array(z.object({ key: issueKey })),
        planning: z.object({ tickets: z.array(z.object({ key: issueKey })) }),
      }),
    ),
  }),
});
function placed(keyed: z.infer<typeof Keyed>): (readonly [string, string])[] {
  return keyed.flatMap((t) => (t.section ? [[t.key.toLowerCase(), t.section] as const] : []));
}
/** Where the map placed each ticket and open PR, keyed by lower-case issue key. */
export interface SeatGaugePlacements {
  readonly at: string;
  readonly tickets: ReadonlyMap<string, string>;
  readonly prs: ReadonlyMap<string, string>;
}
/** Reads placements from the GitHub collector's snapshot when it is this project's and was read (#242). */
export function seatGaugePlacements(
  snapshot: unknown,
  project: string,
  now: Date,
): SeatGaugePlacements | null {
  const parsed = Snapshot.safeParse(snapshot);
  if (!parsed.success || parsed.data.id !== project) return null;
  const { ticketProgress: progress, work } = parsed.data;
  if (!work.at || !readOnce(work.at, now.getTime())) return null;
  const nodes = Object.entries(work.byNode);
  return {
    at: work.at,
    tickets: new Map([
      ...nodes.flatMap(([id, n]) =>
        n.planning.tickets.map((t) => [t.key.toLowerCase(), id] as const),
      ),
      ...(progress
        ? [
            ...placed(progress.totals.tickets),
            ...placed(progress.bugs?.totals.tickets ?? []),
            ...placed(progress.skipped ?? []),
            ...placed(progress.outside ?? []),
          ]
        : []),
    ]),
    prs: new Map(
      nodes.flatMap(([id, n]) => n.openPrs.map((pr) => [pr.key.toLowerCase(), id] as const)),
    ),
  };
}
const SEAT_GAUGE_MAX_AGE = 90_000;
function elapsed(source: z.infer<typeof Source>): number | null {
  return source.started_at &&
    Date.parse(source.started_at) <= Date.parse(source.closed_at ?? source.as_of)
    ? Math.floor(
        (Date.parse(source.closed_at ?? source.as_of) - Date.parse(source.started_at)) / 1000,
      )
    : null;
}
function sourceCurrent(source: z.infer<typeof Source>, at: string | null, now: number): boolean {
  const end = Date.parse(source.closed_at ?? source.as_of);
  return (
    fresh(at, now, SEAT_GAUGE_MAX_AGE) &&
    fresh(source.as_of, now, SEAT_GAUGE_MAX_AGE) &&
    Date.parse(source.as_of) <= Date.parse(at!) &&
    end <= Date.parse(source.as_of) &&
    (!source.started_at || Date.parse(source.started_at) <= end) &&
    ['working', 'idle', 'blocked', 'done', 'closed', 'superseded'].includes(source.status) &&
    (source.closed_at !== null) === ['closed', 'superseded'].includes(source.status)
  );
}
/** When the next time in this report ages past the window `currentSeatGauge` checks it against. */
export function seatGaugeExpiry(report: SeatGaugeReport, now: number): number | null {
  const dates = [report.at, report.readAt, ...report.sessions.map((row) => row.source.as_of)];
  const next = Math.min(
    // #242: GitHub placements keep their last read, so only Seat Gauge's own times expire.
    ...dates
      .map((at) => Date.parse(at ?? '') + SEAT_GAUGE_MAX_AGE + 1)
      .filter((deadline) => deadline > now),
  );
  return Number.isFinite(next) ? next : null;
}
function pending(row: SeatGaugeSession, reason: string): SeatGaugeSession {
  return { ...row, state: 'pending', reason };
}
/** #248: a session still open in its pane; closed ones keep their totals but are no longer agents at work. */
export function sessionOpen(row: SeatGaugeSession): boolean {
  return row.source.closed_at === null;
}
/** #252: how long a card keeps its last observed agents when Seat Gauge publications stop arriving. */
const AGENT_HOLD = 15 * 60_000;
/** A card's agents: the sessions open on it, working first, else the one that closed there last. */
export interface CardAgents {
  readonly open: readonly SeatGaugeSession[];
  readonly last: SeatGaugeSession | null;
}
/**
 * #252: presence comes from the last publication, not the 90-second check `currentSeatGauge` applies,
 * which the publication, collector and window cadences together overrun, dropping every agent at once.
 */
export function cardAgents(
  report: SeatGaugeReport | null,
  section: string,
  now: number,
): CardAgents {
  const here = report?.sessions.filter((row) => row.section === section) ?? [];
  const held = !!report?.at && now - Date.parse(report.at) <= AGENT_HOLD;
  const open = held
    ? here
        .filter(sessionOpen)
        .toSorted(
          (a, b) =>
            Number(b.source.status === 'working') - Number(a.source.status === 'working') ||
            (Date.parse(b.source.started_at ?? '') || 0) -
              (Date.parse(a.source.started_at ?? '') || 0),
        )
    : [];
  const last = open.length
    ? null
    : (here
        .filter((row) => !sessionOpen(row))
        .toSorted((a, b) => Date.parse(b.source.closed_at!) - Date.parse(a.source.closed_at!))[0] ??
      null);
  return { open, last };
}
export function currentSeatGauge(
  value: unknown,
  project: string,
  now: number = Date.now(),
  failed: boolean = false,
): SeatGaugeReport | null {
  const parsed = Report.safeParse(value);
  if (!parsed.success || parsed.data.project !== project) return null;
  const parsedReport = parsed.data;
  const report = {
    ...parsedReport,
    sessions: parsedReport.sessions.filter((row) => row.repository !== null),
    unmapped:
      parsedReport.unmapped + parsedReport.sessions.filter((row) => row.repository === null).length,
  };
  const ids = new Set<string>();
  if (
    report.sessions.some(
      (row) =>
        row.id !== JSON.stringify([row.source.machine, row.source.session_id]) ||
        ids.has(row.id) ||
        !ids.add(row.id),
    )
  )
    return null;
  const valid =
    !failed &&
    report.state === 'current' &&
    fresh(report.readAt, now, SEAT_GAUGE_MAX_AGE) &&
    fresh(report.at, now, SEAT_GAUGE_MAX_AGE);
  const sessions = report.sessions.map((row) => {
    const qualified =
      valid &&
      readOnce(report.githubAt, now) &&
      sourceCurrent(row.source, report.at, now) &&
      row.section &&
      // A lane placed by its workspace has no branch; its PR or ticket is the evidence (#248).
      (row.prs.length > 0 || row.tickets.length > 0) &&
      (!report.placementsAt || readOnce(report.placementsAt, now)) &&
      row.elapsedSeconds === elapsed(row.source);
    return qualified || row.state === 'pending'
      ? row
      : pending(row, failed ? 'Seat Gauge read failed' : 'Fresh mapped session evidence pending');
  });
  return {
    ...report,
    state: valid ? 'current' : 'pending',
    reason: valid ? report.reason : 'Fresh Seat Gauge publication pending',
    sessions,
  };
}
/** #248: the PR or ticket a lane's workspace names, under the project's workspace pattern. */
function ruleKey(source: SessionSource, project: Project): string | null {
  const rule = project.seatGauge?.workspace;
  const number = rule ? new RegExp(rule.pattern).exec(source.workspace)?.[1] : undefined;
  return rule && number && /^[1-9]\d*$/.test(number) ? `${rule.repository}#${number}` : null;
}
interface Label {
  readonly repo: string | null;
  readonly section: string | null;
  /** The ticket number the label carries before its seat, if any. */
  readonly number: string | null;
}
/**
 * #313: lane labels carry a ticket number before the seat (`LBL-Fix-27-Seat`), which Seat Gauge's
 * split from the right reads as section `27` of repo `LBL-Fix`. The first number after the first
 * part, or after a mapped repo label's own parts (`SITE-2-...`), and before the seat is the ticket,
 * with the repo and section before it. A label with no such number keeps Seat Gauge's split, and so
 * does every label of a project with its own workspace pattern, which reads its labels alone.
 */
function label(source: SessionSource, project: Project): Label {
  const kept = { repo: source.repo, section: source.section, number: null };
  if (project.seatGauge?.workspace) return kept;
  const parts = source.workspace.split('-');
  const mappings = project.seatGauge?.repositories ?? {};
  const start = Math.max(
    1,
    ...Object.keys(mappings)
      .filter((key) => source.workspace.startsWith(`${key}-`))
      .map((key) => key.split('-').length),
  );
  const at = parts.findIndex(
    (part, i) => i >= start && i < parts.length - 1 && /^[1-9]\d*[a-z]?$/.test(part),
  );
  const before = parts.slice(0, at);
  if (at < 0 || before.some((part) => !part)) return kept;
  const whole = before.join('-');
  const [repo, section] =
    before.length === 1 || Object.hasOwn(mappings, whole)
      ? [whole, null]
      : [before.slice(0, -1).join('-'), before.at(-1)!];
  return { repo, section, number: /^[1-9]\d*/.exec(parts[at]!)![0] };
}
/**
 * The PR or ticket a session's workspace names: the project's workspace pattern decides when it has
 * one, else the label's ticket number in the session's repository (#313).
 */
function workspaceKey(
  source: SessionSource,
  project: Project,
  sessionRepository: string | null,
): string | null {
  if (project.seatGauge?.workspace) return ruleKey(source, project);
  const { number } = label(source, project);
  return sessionRepository && number ? `${sessionRepository}#${number}` : null;
}
/** The workspace's key when it names a ticket rather than one of the session's PRs. */
function workspaceTicket(
  source: SessionSource,
  project: Project,
  sessionRepository: string | null,
  prs: readonly string[],
): string | null {
  const key = workspaceKey(source, project, sessionRepository);
  return key && !prs.some((pr) => pr.toLowerCase() === key.toLowerCase()) ? key : null;
}
/**
 * The session's repository: the one Seat Gauge names from its remote, else the project's label map,
 * else the workspace pattern's. A named repository outside the project is not this project's session.
 */
function mappedRepository(source: SessionSource, project: Project): string | null {
  if (source.repository) {
    const named = source.repository.toLowerCase();
    return project.repos.find((repo) => repo.toLowerCase() === named) ?? null;
  }
  const mappings = project.seatGauge?.repositories ?? {};
  const { repo: labelRepo } = label(source, project);
  const labelled =
    labelRepo && Object.hasOwn(mappings, labelRepo) ? mappings[labelRepo] : undefined;
  const mapped = labelled ?? ruleKey(source, project)?.split('#')[0];
  return mapped && project.repos.some((repo) => repo.toLowerCase() === mapped.toLowerCase())
    ? mapped
    : null;
}
/** The branch's ticket, read by the project's pattern, in the session's own repository. */
function branchTicketOf(
  project: Project,
  repo: string | null,
  branch: string | null,
): string | null {
  const pattern = project.seatGauge?.branchTicket;
  const number = pattern && branch ? new RegExp(pattern).exec(branch)?.[1] : undefined;
  if (!repo || !number || !/^[1-9]\d*$/.test(number)) return null;
  return `${project.repos.find((r) => r.toLowerCase() === repo.toLowerCase()) ?? repo}#${number}`;
}
interface Placement {
  readonly section: string | null;
  readonly ticketSection: string | null;
  readonly tickets: string[];
  readonly branchTicket: string | null;
}
/**
 * Places a session from its PRs and branch under the current config and placements (#158): the
 * open PR's placement wins, then the branch ticket's section, then an exact producer section.
 * A ticket its workspace names stands in for a branch ticket (#248). Null means unplaced: under a
 * branch or workspace pattern, a session with neither a PR nor a ticket placed on a section stays
 * an anonymous count, whatever the placement evidence's state.
 */
function place(
  project: Project,
  sections: ReadonlySet<string>,
  placements: SeatGaugePlacements | null,
  session: {
    repository: string | null;
    branch: string | null;
    section: string | null;
    workspaceTicket: string | null;
  },
  prs: readonly string[],
  closing: readonly string[],
): Placement | null {
  const ticket =
    branchTicketOf(project, session.repository, session.branch) ?? session.workspaceTicket;
  const ticketSection = ticket ? (placements?.tickets.get(ticket.toLowerCase()) ?? null) : null;
  if (
    (project.seatGauge?.branchTicket || project.seatGauge?.workspace) &&
    !prs.length &&
    !(ticketSection && sections.has(ticketSection))
  )
    return null;
  const linked = ticket && (ticketSection || prs.length) ? ticket : null;
  return {
    section:
      [
        ...prs.map((pr) => placements?.prs.get(pr.toLowerCase())),
        ticketSection,
        session.section,
      ].find((node): node is string => !!node && sections.has(node)) ?? null,
    ticketSection,
    tickets: [...new Set([...(linked ? [linked] : []), ...closing])],
    branchTicket: linked && !closing.includes(linked) ? linked : null,
  };
}
export function seatGaugeFailure(
  previous: unknown,
  project: Project,
  now: Date,
  sections: ReadonlySet<string> = new Set(),
  placements: SeatGaugePlacements | null = null,
): SeatGaugeReport {
  const old = currentSeatGauge(previous, project.id, now.getTime(), true);
  // A retained row is placed again under the current config, as a successful read would place it;
  // one the current config cannot place joins the anonymous count.
  const sessions = (old?.sessions ?? []).flatMap((row) => {
    if (mappedRepository(row.source, project)?.toLowerCase() !== row.repository?.toLowerCase())
      return [];
    const where = place(
      project,
      sections,
      placements,
      {
        repository: row.repository,
        branch: row.source.branch,
        section: label(row.source, project).section,
        workspaceTicket: workspaceTicket(row.source, project, row.repository, row.prs),
      },
      row.prs,
      // A row saved before branch links existed has no branchTicket; its tickets then came from
      // its PRs alone, so a row with no PR has no closing references to keep.
      row.branchTicket === undefined
        ? row.prs.length
          ? row.tickets
          : []
        : row.tickets.filter((key) => key !== row.branchTicket),
    );
    return where
      ? [
          {
            ...row,
            section: where.section,
            tickets: where.tickets,
            branchTicket: where.branchTicket,
          },
        ]
      : [];
  });
  return {
    schema: 'work-map-seat-gauge/1',
    project: project.id,
    at: old?.at ?? null,
    readAt: now.toISOString(),
    githubAt: old?.githubAt ?? null,
    placementsAt: old?.placementsAt ?? null,
    state: 'pending',
    reason: 'Seat Gauge publication unavailable or invalid',
    sessions,
    unmapped: (old?.unmapped ?? 0) + (old?.sessions.length ?? 0) - sessions.length,
  };
}
export function buildSeatGauge(
  raw: unknown,
  project: Project,
  sections: ReadonlySet<string>,
  work: unknown,
  now: Date,
  previous: unknown = null,
  placements: SeatGaugePlacements | null = null,
): SeatGaugeReport {
  const parsed = Publication.safeParse(raw);
  if (!parsed.success) return seatGaugeFailure(previous, project, now, sections, placements);
  const log = parsed.data;
  const cache = Cache.safeParse(work);
  const github =
    cache.success && cache.data.project === project.id && readOnce(cache.data.at, now.getTime())
      ? cache.data
      : null;
  const configured = new Set(project.repos.map((repo) => repo.toLowerCase()));
  const grouped = new Map<string, z.infer<typeof Source>[]>();
  for (const source of log.sessions) {
    const id = JSON.stringify([source.machine, source.session_id]);
    const group = grouped.get(id) ?? [];
    group.push(source);
    grouped.set(id, group);
  }
  const sessions: SeatGaugeSession[] = [];
  let unmapped = 0;
  for (const [id, group] of grouped) {
    const source = group[0]!;
    const repo = mappedRepository(source, project);
    if (
      !repo ||
      group.some(
        (candidate) => mappedRepository(candidate, project)?.toLowerCase() !== repo.toLowerCase(),
      )
    ) {
      unmapped++;
      continue;
    }
    const named = workspaceKey(source, project, repo)?.toLowerCase() ?? null;
    const matched = github
      ? github.prs.filter(
          (pr) =>
            ((!!source.branch &&
              pr.headRepository?.toLowerCase() === repo.toLowerCase() &&
              pr.headRefName === source.branch) ||
              pr.key.toLowerCase() === named) &&
            configured.has(pr.key.split('#')[0]!.toLowerCase()),
        )
      : [];
    const prs = matched.map((pr) => pr.key);
    const where = place(
      project,
      sections,
      placements,
      {
        repository: repo,
        branch: github ? source.branch : null,
        section: label(source, project).section,
        workspaceTicket: github ? workspaceTicket(source, project, repo, prs) : null,
      },
      prs,
      matched
        .flatMap((pr) => pr.issueKeys)
        .filter((key) => configured.has(key.split('#')[0]!.toLowerCase())),
    );
    if (!where) {
      unmapped++;
      continue;
    }
    const { section, ticketSection } = where;
    const conflict = group.some(
      (candidate) => JSON.stringify(candidate) !== JSON.stringify(source),
    );
    const pendingReason = conflict
      ? 'Conflicting session observations'
      : !sourceCurrent(source, log.updated, now.getTime())
        ? 'Fresh session observation pending'
        : Object.hasOwn(log.problems, source.machine)
          ? 'Machine observation failed'
          : !github
            ? 'Current GitHub branch evidence pending'
            : !prs.length && !ticketSection
              ? 'Exact repository and branch match pending'
              : !section
                ? 'Configured section match pending'
                : null;
    sessions.push({
      id,
      source,
      repository: repo,
      section,
      prs: [...new Set(prs)],
      tickets: where.tickets,
      branchTicket: where.branchTicket,
      elapsedSeconds: elapsed(source),
      state: pendingReason ? 'pending' : 'current',
      reason:
        pendingReason ??
        (prs.length
          ? 'Current branch associated; whole-session totals'
          : 'Branch ticket associated; whole-session totals'),
    });
  }
  // A machine's problem pends only that machine's rows, above; the report stays current.
  const current = fresh(log.updated, now.getTime(), SEAT_GAUGE_MAX_AGE);
  return {
    schema: 'work-map-seat-gauge/1',
    project: project.id,
    at: log.updated,
    readAt: now.toISOString(),
    githubAt: github?.at ?? null,
    placementsAt: placements?.at ?? null,
    state: current ? 'current' : 'pending',
    reason: current ? 'Seat Gauge session publication' : 'Fresh Seat Gauge publication pending',
    sessions,
    unmapped,
  };
}
