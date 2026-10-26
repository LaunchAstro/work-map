// SPDX-License-Identifier: AGPL-3.0-only
import { readSeatGauge } from '../readers/seat-gauge.ts';
import { seatGaugePlacements } from '../core/seat-gauge.ts';
import { buildLoadingBay, SEAT_GAUGE_PENDING } from '../core/loading-bay.ts';
import { VersionSitesSchema, currentVersions, type VersionSite } from '../core/versions.ts';
import { failedVersions, refreshVersions } from '../readers/versions.ts';
import { refreshMapGaps } from '../readers/map-gaps.ts';
import { currentMapGapReport, mapGapCollectionFailure } from '../core/map-gaps.ts';
import { createHash } from 'node:crypto';

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { readProject } from '../readers/project.ts';
import { refreshWork, emptyWorkCache, type WorkCache } from '../readers/work-github.ts';
import { readSourceFindings } from '../readers/source-findings.ts';
import { buildTicketProgress } from '../core/ticket-progress.ts';
import { buildWork, closingFrom, withWork } from '../core/work.ts';
import { readUnitScores, readUnitScoreStore } from '../readers/unit-audit.ts';
import { sectionScores } from '../core/unit-scores.ts';
import type { OpenScopeEstimate } from '../core/scope.ts';
import type { AgentsSnapshot } from '../core/contract.ts';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  buildAgents,
  emptyEventsState,
  foldEvents,
  lanePrBoxes,
  type EventsState,
} from '../core/agents.ts';
import type { GithubRunLog } from '../core/contract.ts';
import { checkTables, type Plan } from '../core/plan.ts';
import { buildSnapshot, type BoxEstimate } from '../core/snapshot.ts';
import type { Inference } from '../core/infer.ts';
import { issueBox, type IssueInfo, type IssuePlacement } from '../core/issues.ts';
import { idMatcher } from '../core/refs.ts';
import type { SectionMapFile } from '../core/sections.ts';
import type { Snapshot } from '../core/contract.ts';
import {
  currentCache,
  LIGHT_FLOOR,
  MIN_FLOOR,
  refresh,
  type GithubCache,
} from '../readers/github.ts';
import { githubScope, mergedSince, readsCards, type GithubScope } from '../core/refresh-scope.ts';
import {
  briefBoxes,
  newestRound,
  prBoxes,
  readFrom,
  readJson,
  readRoadmap,
} from '../readers/local.ts';

const app = fileURLToPath(new URL('../..', import.meta.url));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    data: { type: 'string', default: join(app, '.data') },
    round: { type: 'string' },
    floor: { type: 'string', default: String(MIN_FLOOR) },
    'repo-root': { type: 'string' },
    project: { type: 'string', default: process.env['WORK_MAP_PROJECT'] },
    // #242: github alone is the automatic refresh (the merge panel; the cards only after a new merge).
    sync: { type: 'boolean', default: false },
    full: { type: 'boolean', default: false },
  },
});
const data = resolve(values.data);
if (!values.project) throw new Error('Pass --project CONFIG or set WORK_MAP_PROJECT');
const { project, root: repoRoot } = readProject(values.project, values['repo-root']);
const mappingPath = resolve(repoRoot, project.files.mapping);
const sectionPath = resolve(repoRoot, project.files.sections);
/** The sections that own at least one path glob; nothing without a section map. */
const ownedSectionsOf = (map: SectionMapFile | null): { ownedSections?: string[] } =>
  map
    ? {
        ownedSections: Object.entries(map.boxes).flatMap(([id, globs]) =>
          globs.length ? [id] : [],
        ),
      }
    : {};
mkdirSync(data, { recursive: true });

function writeAtomic(name: string, value: unknown): void {
  const path = join(data, name);
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);
}

function writeSnapshot(cache: GithubCache): void {
  const files = readRoadmap(repoRoot, mappingPath, project.files);
  const snap = buildSnapshot({
    project,
    audit: files.audit,
    flow: files.flow,
    plan: files.plan,
    mapping: files.mapping,
    prs: Object.values(cache.prs),
    switchOns: Object.values(cache.switchOns),
    generatedAt: new Date().toISOString(),
    roadmapCommit: files.commit,
    github: {
      repo: project.productRepo,
      prsThrough: cache.prsWatermark,
      issuesThrough: cache.issuesWatermark,
      lastRun: cache.lastRun,
    },
    inferred: readJson<Record<string, Inference>>(join(data, 'inferred.json'), {}),
    estimates: readJson<Record<string, BoxEstimate>>(join(data, 'estimates.json'), {}),
    sourceFindings: readSourceFindings(data),
    openState: cache.openState ?? null,
  });
  const workCache = readJson<WorkCache>(join(data, 'work-cache.json'), emptyWorkCache(project.id));
  const sectionMap = readJson<SectionMapFile | null>(sectionPath, null);
  const maps = sectionMap?.maps ?? {};
  const nodes = snap.stages.flatMap((stage) => stage.nodes);
  const owner = new Map(nodes.flatMap((n) => n.units.map((u) => [u.id, n.id] as const)));
  const boxes = new Set(files.flow.nodes.map((n) => n.id));
  const events = readJson<EventsState>(join(data, 'agents-state.json'), emptyEventsState());
  const prLanes = lanePrBoxes({
    events,
    plan: files.plan,
    owner,
    boxes,
    issueBox: issueBoxes(workCache.issues, maps, files.plan, owner, boxes),
    briefBox: events.file
      ? briefBoxes(
          dirname(events.file),
          Object.keys(events.lanes),
          files.plan,
          owner,
          project.lanePrefix,
        )
      : new Map(),
    laneRules: project.laneRules,
    lanePrefix: project.lanePrefix,
    repository: project.productRepo,
  });
  const ticketProgress = buildTicketProgress({
    project,
    plan: files.plan,
    nodes,
    closing: closingFrom({
      project,
      plan: files.plan,
      nodes,
      closedBy: workCache.mergedPrs ?? [],
      mergedPrs: Object.values(snap.prs),
      prLanes,
    }),
    ...(project.progress?.basis === 'ticket-count' && project.progress.unitAudit
      ? {
          unitScores: readUnitScores(repoRoot, project.progress.unitAudit.file, {
            store: join(data, 'unit-scores.json'),
            floor: project.progress.unitAudit.recheck?.confidence,
          }),
        }
      : project.progress?.basis === 'ticket-count' && project.progress.recheck
        ? {
            // #215: a map without build units takes each section's score from the store.
            sectionScores: sectionScores(
              readUnitScoreStore(join(data, 'unit-scores.json')),
              nodes.map((node) => node.id),
              project.progress.recheck.confidence,
            ),
          }
        : {}),
    issues: workCache.issues,
    maps,
    at: workCache.issueCensus?.at ?? workCache.at,
    complete: workCache.issueCensus?.complete ?? false,
    error:
      workCache.issueCensus?.error ?? (workCache.issueCensus ? null : 'Full issue census pending'),
  });
  const work = buildWork({
    ticketProgress,
    project,
    plan: files.plan,
    nodes,
    issues: workCache.issues,
    prs: workCache.prs,
    mergedPrs: Object.values(snap.prs),
    trackedMergedPrs: workCache.mergedPrs ?? [],
    openEstimates: readJson<Record<string, OpenScopeEstimate>>(
      join(data, 'open-scope-estimates.json'),
      {},
    ),
    prLanes,
    maps,
    ...ownedSectionsOf(sectionMap),
    specDocuments: workCache.specDocuments,
    at: workCache.at,
    complete: workCache.complete,
    error: workCache.error,
    lastFailure: workCache.lastFailure,
  });
  const gaps = currentMapGapReport(readJson<unknown>(join(data, 'map-gaps.json'), null));
  const mapGaps =
    sectionMap &&
    gaps?.repo === project.productRepo &&
    gaps.mapDigest === createHash('sha256').update(JSON.stringify(sectionMap)).digest('hex')
      ? gaps
      : null;
  writeAtomic(
    'snapshot.json',
    withWork(
      {
        ...snap,
        generatedAt: new Date().toISOString(),
        mapGaps,
        title: project.title,
        loadingBay: buildLoadingBay(workCache, project.ledgerPrReadyLabel ?? null),
        ...(project.progress ? { progressBasis: project.progress.basis } : {}),
        ...(ticketProgress ? { ticketProgress } : {}),
      },
      work,
    ),
  );
}

type GhRun = (args: readonly string[], timeout?: number, maxBuffer?: number) => Promise<string>;

const ghRun: GhRun = async (args, timeout, maxBuffer = 256 * 1024 * 1024) =>
  execFileSync('gh', [...args], {
    encoding: 'utf8',
    maxBuffer,
    ...(timeout === undefined ? {} : { timeout }),
  });

function issueBoxes(
  issues: Record<string, IssueInfo>,
  maps: Readonly<Record<string, string>>,
  plan: Plan,
  owner: ReadonlyMap<string, string>,
  boxes: ReadonlySet<string>,
): Map<string, IssuePlacement> {
  const matcher = idMatcher([...Object.keys(plan.tickets), ...Object.keys(plan.units)]);
  const out = new Map<string, IssuePlacement>();
  for (const k of Object.keys(issues)) {
    const b = issueBox(k, issues, maps, boxes, plan, owner, matcher);
    if (b) out.set(k, b);
  }
  return out;
}

/** Map gaps and site versions: read on Sync only (#242). */
async function refreshExtras(work: WorkCache, tagged: (reader: string) => GhRun): Promise<void> {
  let previousGapReport: unknown = null;
  try {
    previousGapReport = readJson<unknown>(join(data, 'map-gaps.json'), null);
    const map = readJson<SectionMapFile | null>(sectionPath, null);
    if (map?.repo === project.productRepo) {
      const gaps = await refreshMapGaps({
        map,
        prs: [...(work.mergedPrs ?? []), ...work.prs],
        inventoryComplete: work.complete,
        run: (args, timeoutMs) => tagged('mapGaps')(args, timeoutMs, 8 * 1024 * 1024),
        now: new Date(),
        previousCache: readJson<unknown>(join(data, 'map-gap-cache.json'), null),
        previousReport: previousGapReport,
      });
      writeAtomic('map-gap-cache.json', gaps.cache);
      writeAtomic('map-gaps.json', gaps.report);
    } else writeAtomic('map-gaps.json', null);
  } catch {
    writeAtomic(
      'map-gaps.json',
      mapGapCollectionFailure(previousGapReport, project.productRepo, new Date()),
    );
  }
  let previousVersions = null;
  try {
    previousVersions = currentVersions(readJson<unknown>(join(data, 'versions.json'), null));
  } catch {}
  const configPath = join(data, 'versions.config.json');
  let sites: readonly VersionSite[];
  try {
    if (!existsSync(configPath)) {
      if (existsSync(join(data, 'versions.json')))
        writeAtomic('versions.json', {
          schema: 'work-map-versions/1',
          repo: project.productRepo,
          checkedAt: new Date().toISOString(),
          main: null,
          sites: [],
        });
      return;
    }
    sites = VersionSitesSchema.parse(JSON.parse(readFileSync(configPath, 'utf8')));
  } catch {
    writeAtomic('versions.json', {
      schema: 'work-map-versions/1',
      repo: project.productRepo,
      checkedAt: new Date().toISOString(),
      main: null,
      sites: [],
      error: 'Version configuration is invalid; site comparison is pending',
    });
    return;
  }
  // TN-50: a read that breaks keeps the last sites, pending with their dates, not an empty card.
  const checkedAt = new Date();
  try {
    const versions = await refreshVersions({
      repo: project.productRepo,
      sites,
      run: (args) => tagged('versions')(args, 5_000, 8 * 1024 * 1024),
      now: checkedAt,
      previous: previousVersions,
    });
    writeAtomic('versions.json', versions);
  } catch {
    writeAtomic(
      'versions.json',
      failedVersions(
        project.productRepo,
        previousVersions,
        checkedAt,
        'Version read failed; site comparison is pending',
      ),
    );
  }
}

async function github(): Promise<void> {
  const cachePath = join(data, 'github-cache.json');
  const cache = currentCache(readJson<unknown>(cachePath, null));
  const started = Date.now();
  const githubCalls = { restRateLimit: 0, graphql: 0, restOther: 0 };
  // #242: every GraphQL call's cost, by the part of the map it reads for.
  const points: Record<string, number[]> = {};
  const tagged =
    (reader: string): GhRun =>
    async (args, timeout, maxBuffer) => {
      if (args[1] === 'rate_limit') githubCalls.restRateLimit++;
      else if (args[1] === 'graphql') githubCalls.graphql++;
      else githubCalls.restOther++;
      const out = await ghRun(args, timeout, maxBuffer);
      if (args[1] === 'graphql') {
        const cost = /"rateLimit":\{"cost":(\d+)/.exec(out.slice(0, 200))?.[1];
        // -1 marks a call whose cost the answer did not carry; the log counts them apart.
        (points[reader] ??= []).push(cost === undefined ? -1 : Number(cost));
      }
      return out;
    };
  const scope: GithubScope = githubScope({ sync: values.sync, full: values.full });
  const asked = Math.max(MIN_FLOOR, Number(values.floor) || MIN_FLOOR);
  const floor = scope === 'timer' ? Math.max(LIGHT_FLOOR, asked) : asked;
  const res = await refresh({
    cache,
    run: tagged('merges'),
    floor,
    now: new Date(),
    repo: project.productRepo,
    switchOnTitle: project.switchOnTitle,
  });
  writeAtomic('github-cache.json', res.cache);
  const oldWork = readJson<WorkCache>(join(data, 'work-cache.json'), emptyWorkCache(project.id));
  const readCards = readsCards(scope, oldWork, project.id);
  const work = readCards
    ? await refreshWork({
        project,
        cache: oldWork,
        run: tagged('cards'),
        now: new Date(),
        scope: scope === 'full' ? 'all' : 'changed',
        floor,
        // Search can lag a merge by seconds; after one, the product repository is read directly.
        ...(mergedSince(res.cache.prs, oldWork.at) ? { alwaysRead: [project.productRepo] } : {}),
      })
    : oldWork;
  if (readCards) writeAtomic('work-cache.json', work);
  // Map gaps and site versions belong to Sync, not to the automatic refresh.
  if (scope !== 'timer') await refreshExtras(work, tagged);
  if (work.error) console.error(work.error);
  const log: GithubRunLog & {
    ms?: number;
    prsCached?: number;
    snapshotError?: string;
    githubCalls: typeof githubCalls;
    scope: GithubScope;
    cardsRead: boolean;
    cardsReread?: readonly string[];
    graphqlPoints: number;
    graphqlCosts: Record<string, number[]>;
    graphqlCostUnknown: number;
  } = {
    ...res.log,
    githubCalls,
    scope,
    cardsRead: readCards,
    ...(readCards && work.lastScope && !work.lastFailure
      ? { cardsReread: work.lastScope.reread }
      : {}),
    graphqlPoints: Object.values(points)
      .flat()
      .reduce((sum, cost) => sum + Math.max(0, cost), 0),
    graphqlCosts: points,
    graphqlCostUnknown: Object.values(points)
      .flat()
      .filter((cost) => cost < 0).length,
    prsCached: Object.keys(res.cache.prs).length,
  };
  try {
    writeSnapshot(res.cache);
  } catch (error) {
    log.snapshotError = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  }
  if (log.error !== undefined || log.snapshotError !== undefined) process.exitCode = 1;
  log.ms = Date.now() - started;
  appendFileSync(join(data, 'runs.jsonl'), `${JSON.stringify(log)}\n`);
  console.log(JSON.stringify(log));
}

function agents(): void {
  const files = readRoadmap(repoRoot, mappingPath, project.files);
  const { owner } = checkTables(files.audit, files.flow, files.plan);
  let st = readJson<EventsState>(join(data, 'agents-state.json'), emptyEventsState());
  if (st.version !== 2) st = emptyEventsState();
  // OA_ROUND_ROOT is the older name, still set by jobs installed before WORK_MAP_ROUND_ROOT.
  // An empty value counts as unset.
  const base =
    process.env['WORK_MAP_ROUND_ROOT'] || process.env['OA_ROUND_ROOT'] || join(repoRoot, '.local');
  const file = values.round ? join(values.round, 'events.log') : newestRound(base);
  let round: { events: string; lastEventAt: string | null } | null = null;
  if (file && existsSync(file)) {
    let { text, reset } = readFrom(file, st.file === file ? st.offset : 0);
    if (reset) {
      st = emptyEventsState();
      text = readFrom(file, 0).text;
    }
    st = foldEvents(st, file, text, files.plan, project.productRepo);
    writeAtomic('agents-state.json', st);
    round = { events: file.replace(homedir(), '~'), lastEventAt: st.lastAt };
  }
  const before = readJson<AgentsSnapshot | null>(join(data, 'agents.json'), null);
  const boxes = new Set(files.flow.nodes.map((n) => n.id));
  const workFile = readJson<unknown>(join(data, 'work-cache.json'), undefined);
  const lastSnapshot = readJson<unknown>(join(data, 'snapshot.json'), null);
  const current = buildAgents({
    prefix: project.lanePrefix,
    laneRules: project.laneRules,
    events: st,
    round,
    herdr: { ok: false, error: SEAT_GAUGE_PENDING },
    plan: files.plan,
    owner,
    now: new Date(),
    boxes,
    briefBox: file
      ? briefBoxes(dirname(file), Object.keys(st.lanes), files.plan, owner, project.lanePrefix)
      : new Map(),
    prBox: prBoxes(lastSnapshot as Snapshot | null, owner),
    issueBox: issueBoxes(
      ((workFile === undefined ? emptyWorkCache(project.id) : workFile) as WorkCache).issues,
      readJson<SectionMapFile | null>(sectionPath, null)?.maps ?? {},
      files.plan,
      owner,
      boxes,
    ),
  });
  writeAtomic('agents.json', {
    ...current,
    lanes: current.lanes.map((lane) => Object.assign({}, lane, { state: 'unknown' as const })),
    seatGauge: readSeatGauge(
      project,
      boxes,
      workFile ?? null,
      before?.seatGauge,
      seatGaugePlacements(lastSnapshot, project.id, new Date()),
    ),
    agentSource: { state: 'pending', reason: SEAT_GAUGE_PENDING },
  });
}

const mode = positionals[0];
if (mode === 'github') await github();
else if (mode === 'agents') agents();
else if (mode === 'snapshot')
  writeSnapshot(currentCache(readJson<unknown>(join(data, 'github-cache.json'), null)));
else {
  console.error(
    'usage: node src/cli/generate.ts github|agents|snapshot --project CONFIG [--data DIR] [--round DIR] [--floor N] [--repo-root DIR]',
  );
  process.exitCode = 2;
}
