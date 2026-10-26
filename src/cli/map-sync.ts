import {
  currentTicketProgress,
  ticketCountMap,
  ticketProgressCurrent,
} from '../core/ticket-progress.ts';
import { SEAT_GAUGE_PENDING } from '../core/loading-bay.ts';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { SNAPSHOT_SCHEMA, AGENTS_SCHEMA } from '../core/contract.ts';
import type { SyncResult } from '../core/sync.ts';
import { currentVersions } from '../core/versions.ts';

export type SyncSettings = {
  app: string;
  data: string;
  node: string;
  project: string;
  roadmap: string;
};
export type Collector = (mode: 'github' | 'agents', settings: SyncSettings) => Promise<void>;
export function isLocalReadRequest(req: Pick<IncomingMessage, 'headers'>, port: number): boolean {
  return (
    req.headers.host === `127.0.0.1:${port}` &&
    (req.headers.origin === undefined || req.headers.origin === `http://127.0.0.1:${port}`)
  );
}
export function isLocalSyncRequest(
  req: Pick<IncomingMessage, 'method' | 'url' | 'headers'>,
  port: number,
): boolean {
  const origin = `http://127.0.0.1:${port}`;
  return (
    req.method === 'POST' &&
    req.url === '/sync' &&
    req.headers.host === `127.0.0.1:${port}` &&
    req.headers.origin === origin &&
    req.headers['x-work-map-sync'] === '1' &&
    req.headers['content-type'] === 'application/json' &&
    (req.headers['sec-fetch-site'] === undefined ||
      req.headers['sec-fetch-site'] === 'same-origin') &&
    req.headers['transfer-encoding'] === undefined &&
    (req.headers['content-length'] === undefined || req.headers['content-length'] === '0')
  );
}
export async function runCollector(
  mode: 'github' | 'agents',
  settings: SyncSettings,
  deadline = 300_000,
): Promise<void> {
  const child = spawn(
    settings.node,
    [
      join(settings.app, 'src/cli/generate.ts'),
      mode,
      // #242: the Sync button reads the cards that changed too; the timer alone reads only the merge panel.
      ...(mode === 'github' ? ['--sync'] : []),
      '--project',
      settings.project,
      '--repo-root',
      settings.roadmap,
      '--data',
      settings.data,
    ],
    { cwd: settings.app, detached: true, stdio: 'ignore' },
  );
  await new Promise<void>((resolve, reject) => {
    let expired = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals): void => {
      if (child.pid)
        try {
          process.kill(-child.pid, signal);
        } catch {}
    };
    const timer = setTimeout(() => {
      expired = true;
      kill('SIGTERM');
      escalation = setTimeout(() => kill('SIGKILL'), 500);
    }, deadline);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (escalation) clearTimeout(escalation);
      if (expired) kill('SIGKILL');
      if (expired) reject(new Error('Refresh timed out'));
      else if (code === 75) reject(new Error('Collectors are busy; try Sync again'));
      else if (code !== 0)
        reject(new Error(`${mode === 'github' ? 'GitHub' : 'Lane'} read failed`));
      else resolve();
    });
  });
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
function writtenSince(value: unknown, since: number): value is string {
  return (
    typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) >= since
  );
}
export function syncEvidence(
  snapshot: unknown,
  agents: unknown,
  githubStart: number,
  agentsStart: number,
  versions?: { required: boolean; value: unknown },
): SyncResult {
  const s = record(snapshot),
    a = record(agents);
  const run = record(record(record(s['sources'])['github'])['lastRun']);
  const work = record(s['work']);
  // An agents file without herdr (#310) reads as herdr not ok.
  const herdr: Record<string, unknown> =
    a['herdr'] === undefined ? { ok: false } : record(a['herdr']);
  const reasons: string[] = [];
  const warnings: string[] = [];
  const versionsRequired = versions?.required ?? false;
  const v = versionsRequired ? currentVersions(versions?.value) : null;
  if (
    s['schema'] !== SNAPSHOT_SCHEMA ||
    typeof s['id'] !== 'string' ||
    !Array.isArray(s['stages']) ||
    !s['prs'] ||
    typeof s['prs'] !== 'object' ||
    a['schema'] !== AGENTS_SCHEMA ||
    !Array.isArray(a['lanes'])
  )
    return { status: 'failed', reason: 'Published data has an invalid contract', versionsRequired };
  if (!writtenSince(s['generatedAt'], githubStart) || !writtenSince(run['at'], githubStart))
    reasons.push('GitHub data is not fresh');
  if (run['error'] || run['partial'] !== false || run['skipped'])
    reasons.push('GitHub read is incomplete');
  if (!writtenSince(work['at'], githubStart) || work['complete'] !== true || work['error'])
    reasons.push('Planning read is incomplete');
  if (ticketCountMap(s)) {
    const tickets = currentTicketProgress(s['ticketProgress']);
    if (!tickets || !ticketProgressCurrent(tickets) || !writtenSince(tickets.at, githubStart))
      reasons.push('Ticket issue census is incomplete');
  }
  const source = record(a['agentSource']);
  const intentionallyPending =
    source['state'] === 'pending' &&
    source['reason'] === SEAT_GAUGE_PENDING &&
    herdr['ok'] === false;
  if (
    !writtenSince(a['generatedAt'], agentsStart) ||
    (!intentionallyPending && (herdr['ok'] !== true || herdr['error']))
  )
    reasons.push('Lane read is incomplete');
  if (
    versionsRequired &&
    (!v ||
      !writtenSince(v.checkedAt, githubStart) ||
      v.error ||
      v.sites.length === 0 ||
      v.sites.some((site) => site.state !== 'current'))
  )
    // #206: a site version fault is its own warning; it no longer makes the whole Sync incomplete.
    warnings.push('Site version read is incomplete');
  const warned = warnings.length ? { warnings } : {};
  return reasons.length
    ? { status: 'incomplete', reasons, versionsRequired, ...warned }
    : {
        status: 'complete',
        snapshotAt: String(s['generatedAt']),
        agentsAt: String(a['generatedAt']),
        versionsRequired,
        ...(v ? { versionsAt: v.checkedAt } : {}),
        ...warned,
      };
}
export function createMapSync(
  settings: SyncSettings,
  collect: Collector = runCollector,
): { run(): Promise<SyncResult> } {
  let running: Promise<SyncResult> | null = null;
  const run = (): Promise<SyncResult> => {
    if (running) return running;
    running = (async (): Promise<SyncResult> => {
      const versionsRequired = existsSync(join(settings.data, 'versions.config.json'));
      try {
        const githubStart = Date.now();
        await collect('github', settings);
        const agentsStart = Date.now();
        await collect('agents', settings);
        const [s, a] = await Promise.all(
          ['snapshot.json', 'agents.json'].map(
            async (name) =>
              JSON.parse(await readFile(join(settings.data, name), 'utf8')) as unknown,
          ),
        );
        let v: unknown = null;
        if (versionsRequired) {
          try {
            v = JSON.parse(await readFile(join(settings.data, 'versions.json'), 'utf8'));
          } catch {}
        }
        return syncEvidence(s, a, githubStart, agentsStart, {
          required: versionsRequired,
          value: v,
        });
      } catch (error) {
        return {
          status: 'failed',
          reason: error instanceof Error ? error.message.slice(0, 180) : 'Refresh failed',
          versionsRequired,
        };
      }
    })().finally(() => {
      running = null;
    });
    return running;
  };
  return { run };
}
