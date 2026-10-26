import { currentSeatGauge } from '../core/seat-gauge.ts';
import { currentSpecProgress } from '../core/spec-progress.ts';
import {
  SNAPSHOT_SCHEMA,
  AGENTS_SCHEMA,
  type AgentsSnapshot,
  type Snapshot,
} from '../core/contract.ts';
import { currentTicketProgress } from '../core/ticket-progress.ts';
import { currentLoadingBay } from '../core/loading-bay.ts';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function measured(value: unknown): boolean {
  return (
    object(value) &&
    object(value['coded']) &&
    object(value['on']) &&
    object(value['estimate']) &&
    // `reviewed` is no longer required: the collector writes `{}` for one more release (#330 stops it).
    object(value['sinceAudit'])
  );
}
function planning(value: unknown): boolean {
  return (
    object(value) &&
    ['idea', 'map', 'tickets', 'spec', 'build'].every((step) => Array.isArray(value[step]))
  );
}
/** `work.offMap` (#5): every PR a full link with its state, every unread-label key a string. */
function offMap(value: unknown): boolean {
  return (
    object(value) &&
    Array.isArray(value['prs']) &&
    value['prs'].every(
      (p) =>
        object(p) &&
        typeof p['key'] === 'string' &&
        typeof p['title'] === 'string' &&
        typeof p['url'] === 'string' &&
        (p['state'] === 'OPEN' || p['state'] === 'MERGED'),
    ) &&
    Array.isArray(value['unreadLabels']) &&
    value['unreadLabels'].every((k) => typeof k === 'string')
  );
}
function date(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
export function currentSnapshot(value: unknown): Snapshot | null {
  if (
    !object(value) ||
    value['schema'] !== SNAPSHOT_SCHEMA ||
    typeof value['title'] !== 'string' ||
    typeof value['id'] !== 'string' ||
    !date(value['generatedAt']) ||
    !measured(value['totals']) ||
    !Array.isArray(value['stages']) ||
    !object(value['prs']) ||
    !object(value['sources']) ||
    !object(value['view']) ||
    !Array.isArray(value['view']['wires']) ||
    !object(value['stats']) ||
    !date(value['stats']['at']) ||
    !object(value['unmapped']) ||
    !Array.isArray(value['unmapped']['prs'])
  )
    return null;
  if (
    !value['stages'].every(
      (stage) =>
        object(stage) &&
        measured(stage) &&
        typeof stage['name'] === 'string' &&
        typeof stage['index'] === 'number' &&
        Array.isArray(stage['nodes']) &&
        stage['nodes'].every(
          (node) =>
            object(node) &&
            measured(node) &&
            typeof node['id'] === 'string' &&
            typeof node['title'] === 'string' &&
            typeof node['row'] === 'number' &&
            Array.isArray(node['units']),
        ),
    )
  )
    return null;
  const work = value['work'];
  if (work !== undefined) {
    if (
      !object(work) ||
      !object(work['byNode']) ||
      !object(work['review']) ||
      !Array.isArray(work['unplacedPrs']) ||
      (work['offMap'] !== undefined && !offMap(work['offMap']))
    )
      return null;
    if (
      !Object.values(work['byNode']).every(
        (node) =>
          object(node) &&
          object(node['scope']) &&
          object(node['scope']['shares']) &&
          object(node['scope']['display']) &&
          object(node['review']) &&
          Array.isArray(node['review']['prs']) &&
          Array.isArray(node['openPrs']) &&
          Array.isArray(node['missing']) &&
          Array.isArray(node['blockers']) &&
          planning(node['planning']),
      )
    )
      return null;
  }
  if (Object.hasOwn(value, 'ticketProgress')) {
    const { ticketProgress, ...ordinary } = value;
    const parsed = currentTicketProgress(
      ticketProgress,
      value['stages'].flatMap((stage) => stage.nodes.map((node: { id: string }) => node.id)),
    );
    if (!parsed) return currentSnapshot(ordinary);
  }
  if (object(work) && Object.hasOwn(work, 'specProgress')) {
    const { specProgress, ...ordinaryWork } = work;
    const progress = currentSpecProgress(specProgress, Date.now());
    value = {
      ...value,
      work: { ...ordinaryWork, ...(progress ? { specProgress: progress } : {}) },
    };
  }
  if (!object(value)) return null;
  if (!Object.hasOwn(value, 'loadingBay')) return value as unknown as Snapshot;
  const { loadingBay, ...ordinary } = value;
  const bay = currentLoadingBay(loadingBay);
  return { ...ordinary, ...(bay ? { loadingBay: bay } : {}) } as unknown as Snapshot;
}
export function currentAgents(value: unknown): AgentsSnapshot | null {
  if (
    !object(value) ||
    value['schema'] !== AGENTS_SCHEMA ||
    !date(value['generatedAt']) ||
    // herdr and seen.herdr may be missing (#310), but not wrong.
    (value['herdr'] !== undefined &&
      (!object(value['herdr']) || typeof value['herdr']['ok'] !== 'boolean')) ||
    !Array.isArray(value['lanes']) ||
    !object(value['byNode']) ||
    !Array.isArray(value['fog'])
  )
    return null;
  if (
    !value['lanes'].every(
      (lane) =>
        object(lane) &&
        typeof lane['lane'] === 'string' &&
        ['working', 'idle', 'blocked', 'done', 'unknown'].includes(String(lane['state'])) &&
        Array.isArray(lane['nodes']) &&
        Array.isArray(lane['tickets']) &&
        Array.isArray(lane['units']) &&
        object(lane['seen']) &&
        (lane['seen']['herdr'] === undefined || typeof lane['seen']['herdr'] === 'boolean') &&
        typeof lane['seen']['events'] === 'boolean' &&
        (lane['last'] === null ||
          (object(lane['last']) &&
            date(lane['last']['at']) &&
            typeof lane['last']['verb'] === 'string' &&
            typeof lane['last']['text'] === 'string')),
    )
  )
    return null;
  if (Object.hasOwn(value, 'seatGauge')) {
    const { seatGauge, ...base } = value;
    const gauge =
      object(seatGauge) && typeof seatGauge['project'] === 'string'
        ? currentSeatGauge(seatGauge, seatGauge['project'])
        : null;
    value = { ...base, ...(gauge ? { seatGauge: gauge } : {}) };
  }
  return value as unknown as AgentsSnapshot;
}
