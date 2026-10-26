import type { NodeView } from '../core/contract.ts';
import type { SectionWork } from '../core/work.ts';
import {
  roundedShares,
  reviewView,
  type ScopeView,
  type ReviewView,
  type ReviewPr,
} from '../core/coverage.ts';

export type MeterData = {
  readonly scope: ScopeView | undefined;
  readonly review: ReviewView | undefined;
};
export type StageMeters = MeterData & { readonly sectionCount: number };

export function stageMeters(
  nodes: readonly Pick<NodeView, 'id'>[],
  byNode: Readonly<Record<string, SectionWork>> | undefined,
  sourceComplete: boolean,
): StageMeters {
  const members = [...new Map(nodes.map((node) => [node.id, node])).values()];
  const sections = members.map((node) => byNode?.[node.id]);
  const complete =
    sourceComplete &&
    members.length > 0 &&
    sections.every((section): section is SectionWork => !!section);
  // A section with no scope weights at all can't be averaged in as 0%, so the stage waits for it.
  const weighed =
    complete && !sections.some((s) => s.scope.pending && s.scope.shares.planned === 100);
  const scope = weighed
    ? (() => {
        const scopes = sections.map((section) => section.scope);
        const shares = { live: 0, merged: 0, built: 0, planned: 0 };
        for (const key of ['live', 'merged', 'built', 'planned'] as const)
          shares[key] = scopes.reduce((sum, value) => sum + value.shares[key], 0) / scopes.length;
        return {
          shares,
          display: roundedShares(shares),
          estimated: scopes.some((value) => value.estimated),
          pending: scopes.some((value) => value.pending),
          reason: `Average of ${members.length} sections`,
          at: null,
        };
      })()
    : undefined;
  const prs = sections.flatMap((section) => section?.review.prs ?? []);
  const seen = new Map<string, ReviewPr>();
  let consistent = true;
  for (const pr of prs) {
    const previous = seen.get(pr.key);
    if (previous && (previous.changedLines !== pr.changedLines || previous.review !== pr.review))
      consistent = false;
    seen.set(pr.key, pr);
  }
  return {
    sectionCount: members.length,
    scope,
    review: reviewView(
      prs,
      complete && consistent && sections.every((section) => section.review.complete),
    ),
  };
}

export const PLANNING_STEPS = ['map', 'tickets', 'spec', 'build'] as const;
export type PlanningStep = (typeof PLANNING_STEPS)[number];
/** What is known of a configured spec document, naming the branch it was checked on. */
export function specDocumentState(
  d: Pick<NonNullable<SectionWork['specDocuments']>[number], 'found' | 'branch'>,
): string {
  if (d.found === null) return 'Spec document not checked yet';
  if (d.found) return `Spec document on ${d.branch ?? 'the default branch'}`;
  return d.branch === null
    ? 'Spec document missing (no default branch)'
    : `Spec document missing on ${d.branch}`;
}
/** The spec step's evidence, spec issues apart from spec documents; other steps have none. */
export function planningStepTip(
  step: PlanningStep,
  work: SectionWork | undefined,
): string | undefined {
  if (step !== 'spec' || !work) return undefined;
  const documents = work.specDocuments ?? [];
  const issues = work.planning.spec.filter((link) => !documents.some((d) => d.key === link.key));
  return [
    ...(issues.length
      ? issues.map((link) => `Spec issue: ${link.key} ${link.title}`)
      : ['Spec issue: none']),
    ...documents.map((d) => `${specDocumentState(d)}: ${d.path} (${d.repository})`),
  ].join('\n');
}
