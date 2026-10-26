// SPDX-License-Identifier: AGPL-3.0-only

import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { Snapshot } from '../core/contract.ts';
import { sectionOf } from '../core/infer.ts';
import { idMatcher } from '../core/refs.ts';
import { parseBuildUnits, type Audit, type Flow, type Plan } from '../core/plan.ts';
import type { Mapping } from '../core/snapshot.ts';

export interface RoadmapFiles {
  readonly audit: Audit;
  readonly flow: Flow;
  readonly plan: Plan;
  readonly mapping: Mapping;
  readonly commit: string | null;
}

export function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
}

export function readRoadmap(
  repoRoot: string,
  mappingPath: string,
  paths: { audit: string; flow: string; plan: string },
): RoadmapFiles {
  let commit: string | null = null;
  try {
    commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {}
  return {
    audit: JSON.parse(readFileSync(resolve(repoRoot, paths.audit), 'utf8')) as Audit,
    flow: JSON.parse(readFileSync(resolve(repoRoot, paths.flow), 'utf8')) as Flow,
    plan: parseBuildUnits(readFileSync(resolve(repoRoot, paths.plan), 'utf8')),
    mapping: readJson<Mapping>(mappingPath, {}),
    commit,
  };
}

/** The newest round folder with an events.log under `base`. */
export function newestRound(base: string): string | null {
  if (!existsSync(base)) return null;
  const logs = readdirSync(base)
    .filter((n) => n.startsWith('round-'))
    .map((n) => join(base, n, 'events.log'))
    .filter((p) => existsSync(p));
  return logs.toSorted((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}

/** The bytes after `offset`; `reset` when the file is now shorter than that (it was replaced). */
export function readFrom(file: string, offset: number): { text: string; reset: boolean } {
  const size = statSync(file).size;
  if (size <= offset) return { text: '', reset: size < offset };
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    return { text: buf.toString('utf8'), reset: false };
  } finally {
    closeSync(fd);
  }
}

/** The box each lane's brief names (round/briefs/<file naming the lane>): a Section line, else its first plan ticket. */
export function briefBoxes(
  roundDir: string,
  lanes: readonly string[],
  plan: Plan,
  owner: ReadonlyMap<string, string>,
  prefix = '',
): Map<string, string> {
  const out = new Map<string, string>();
  const dir = join(roundDir, 'briefs');
  if (!existsSync(dir)) return out;
  const names = readdirSync(dir).filter((n) => n.endsWith('.md'));
  const boxes = new Set(owner.values());
  const matcher = idMatcher(Object.keys(plan.tickets));
  const shortName = (name: string): string =>
    (name.toLowerCase().startsWith(prefix.toLowerCase())
      ? name.slice(prefix.length)
      : name
    ).toLowerCase();
  for (const lane of lanes) {
    const short = shortName(lane);
    const file = names.find((n) => shortName(n.replace(/\.md$/i, '')) === short);
    if (!file) continue;
    const text = readFileSync(join(dir, file), 'utf8');
    const section = sectionOf(text, boxes);
    const ticket = [...text.matchAll(matcher)][0]?.[1];
    const unit = ticket ? plan.tickets[ticket] : undefined;
    const box = section ?? (unit ? owner.get(unit) : undefined);
    if (box) out.set(lane, box);
  }
  return out;
}

/** Each placed PR's box, from the last snapshot: its stated unit's box, else its kept inferred placement. */
export function prBoxes(
  snap: Snapshot | null,
  owner: ReadonlyMap<string, string>,
): Map<number, string> {
  const out = new Map<number, string>();
  for (const p of Object.values(snap?.prs ?? {})) {
    const unit = p.links[0]?.unit;
    const box = unit ? owner.get(unit) : p.inferred?.box;
    if (box) out.set(p.number, box);
  }
  return out;
}
