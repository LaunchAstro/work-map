// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import type { WorkIssue } from './work.ts';
import { readOnce } from './freshness.ts';
import { closedAside } from './absorption.ts';

export interface SpecMembership {
  section: string;
  complete: boolean;
  specs: { key: string; complete: boolean; tickets: string[] }[];
}
const key = z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+#[1-9][0-9]*$/);
const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;
const SET_ASIDE = 'Every mapped ticket was closed as not planned or duplicate';
export const SpecMembershipSchema: z.ZodType<SpecMembership[]> = z
  .array(
    z.strictObject({
      section: z.string().min(1).max(200),
      complete: z.boolean(),
      specs: z
        .array(
          z.strictObject({
            key,
            complete: z.boolean(),
            tickets: z.array(key).max(2000).refine(unique),
          }),
        )
        .max(1000),
    }),
  )
  .max(200)
  .refine(
    (sections) =>
      unique(sections.map((section) => section.section)) &&
      validMembers(sections.flatMap((section) => section.specs)),
  );
function validMembers(specs: readonly { key: string; tickets: readonly string[] }[]): boolean {
  const specKeys = new Set(specs.map((spec) => spec.key.toLowerCase()));
  const members = specs.flatMap((spec) => [spec.key, ...spec.tickets]);
  return (
    specKeys.size === specs.length &&
    new Set(members.map((member) => member.toLowerCase())).size <= 200 &&
    specs.every((spec) => {
      const tickets = spec.tickets.map((ticket) => ticket.toLowerCase());
      return unique(tickets) && tickets.every((ticket) => !specKeys.has(ticket));
    })
  );
}

export interface SpecProgress {
  source: 'github-ticket-closure';
  at: string;
  reason: string;
  specs: {
    key: string;
    section: string;
    tickets: string[];
    closed: number;
    state: 'built' | 'open' | 'pending';
    reason: string;
  }[];
  bySection: Record<string, { total: number; built: number; pending: number; pct: number | null }>;
}
const pendingSection = (total = 0): SpecProgress['bySection'][string] => ({
  total,
  built: 0,
  pending: total,
  pct: null,
});
export function buildSpecProgress(input: {
  membership: unknown;
  sections: readonly string[];
  repos: readonly string[];
  issues: Readonly<Record<string, WorkIssue>>;
  at: string;
  complete: boolean;
  error: string | null;
  now: number;
}): SpecProgress {
  const result: SpecProgress = {
    source: 'github-ticket-closure',
    at: input.at,
    reason: 'Explicit spec membership is unavailable',
    specs: [],
    bySection: Object.fromEntries(input.sections.map((section) => [section, pendingSection()])),
  };
  const parsed = SpecMembershipSchema.safeParse(input.membership);
  if (!parsed.success) return result;
  const membership = parsed.data;
  if (
    membership.some(
      (section) =>
        !input.sections.includes(section.section) ||
        section.specs.some((spec) =>
          [spec.key, ...spec.tickets].some((k) => !input.repos.includes(k.split('#')[0]!)),
        ),
    )
  ) {
    result.reason = 'Spec membership names an unknown section or repository';
    return result;
  }
  const current = input.complete && !input.error && readOnce(input.at, input.now);
  result.reason = current
    ? 'GitHub ticket states and explicit project membership'
    : 'GitHub ticket evidence is incomplete or stale';
  for (const section of membership) {
    const specs = section.specs.map((spec) => {
      const tickets = spec.tickets.map((k) => input.issues[k]);
      const source = input.issues[spec.key];
      const qualified =
        current &&
        section.complete &&
        spec.complete &&
        tickets.length > 0 &&
        source?.key === spec.key &&
        source.contextComplete &&
        tickets.every(
          (ticket, i) =>
            ticket?.key === spec.tickets[i] &&
            ticket?.contextComplete &&
            (ticket.state === 'OPEN' || ticket.state === 'CLOSED'),
        );
      const closed = tickets.filter((ticket) => ticket?.state === 'CLOSED').length;
      // Not planned and duplicate closures are not built work; a spec of only those stays open.
      const remaining = tickets.filter(
        (ticket) => ticket && !closedAside(ticket.state, ticket.stateReason),
      );
      const finished =
        remaining.length > 0 && remaining.every((ticket) => ticket?.state === 'CLOSED');
      return {
        key: spec.key,
        section: section.section,
        tickets: spec.tickets,
        closed,
        state: !qualified
          ? ('pending' as const)
          : finished
            ? ('built' as const)
            : ('open' as const),
        reason: !current
          ? result.reason
          : !qualified
            ? 'Complete non-empty membership and ticket evidence required'
            : finished
              ? 'All explicitly mapped tickets are closed'
              : remaining.length === 0
                ? SET_ASIDE
                : 'Mapped tickets remain open',
      };
    });
    result.specs.push(...specs);
    const built = specs.filter((spec) => spec.state === 'built').length;
    const pending = specs.filter((spec) => spec.state === 'pending').length;
    result.bySection[section.section] = {
      total: specs.length,
      built,
      pending,
      pct:
        current && section.complete && specs.length > 0 && pending === 0
          ? (built / specs.length) * 100
          : null,
    };
  }
  return result;
}

const count = z.number().int().nonnegative();
const ReportSchema: z.ZodType<SpecProgress> = z.strictObject({
  source: z.literal('github-ticket-closure'),
  at: z.string(),
  reason: z.string(),
  specs: z.array(
    z.strictObject({
      key,
      section: z.string(),
      tickets: z.array(key),
      closed: count,
      state: z.enum(['built', 'open', 'pending']),
      reason: z.string(),
    }),
  ),
  bySection: z.record(
    z.string(),
    z.strictObject({
      total: count,
      built: count,
      pending: count,
      pct: z.number().min(0).max(100).nullable(),
    }),
  ),
});
/** Recheck at display time: a fresh publication cannot refresh an old GitHub observation. */
export function currentSpecProgress(
  value: unknown,
  now: number,
  failed = false,
): SpecProgress | null {
  const parsed = ReportSchema.safeParse(value);
  if (!parsed.success) return null;
  const report = parsed.data;
  if (
    !validMembers(report.specs) ||
    report.specs.some(
      (spec) =>
        !Object.hasOwn(report.bySection, spec.section) ||
        spec.closed > spec.tickets.length ||
        (spec.state === 'built' && (!spec.tickets.length || spec.closed !== spec.tickets.length)) ||
        // An open spec has every ticket closed only when all were closed as not planned or duplicate.
        (spec.state === 'open' &&
          (!spec.tickets.length ||
            (spec.closed === spec.tickets.length && spec.reason !== SET_ASIDE))),
    )
  )
    return null;
  for (const [section, counts] of Object.entries(report.bySection)) {
    const specs = report.specs.filter((spec) => spec.section === section);
    const built = specs.filter((spec) => spec.state === 'built').length;
    const pending = specs.filter((spec) => spec.state === 'pending').length;
    if (
      counts.total !== specs.length ||
      counts.built !== built ||
      counts.pending !== pending ||
      (counts.pct !== null &&
        (!specs.length || pending > 0 || counts.pct !== (built / specs.length) * 100))
    )
      return null;
  }
  if (!failed && readOnce(report.at, now)) return report;
  const reason = failed
    ? 'Latest snapshot read failed; ticket progress is pending'
    : 'GitHub ticket evidence is stale or future-dated';
  return {
    ...report,
    reason,
    specs: report.specs.map((spec) => ({ ...spec, state: 'pending', reason })),
    bySection: Object.fromEntries(
      Object.entries(report.bySection).map(([section, counts]) => [
        section,
        pendingSection(counts.total),
      ]),
    ),
  };
}
