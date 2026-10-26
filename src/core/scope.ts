import { createHash } from 'node:crypto';
import type { NodeView } from './contract.ts';
import type { OpenPr } from './work.ts';
import { REVIEW_DEBT } from './snapshot.ts';
import { roundedShares, type ScopeView, type ReviewPr } from './coverage.ts';
export {
  roundedShares,
  reviewView,
  type ScopeShares,
  type ScopeView,
  type ReviewState,
  type ReviewPr,
  type ReviewView,
} from './coverage.ts';

export interface OpenScopeEstimate {
  readonly at: string;
  readonly model: string;
  readonly evidence: string;
  readonly reason: string;
  readonly units: Readonly<Record<string, { readonly built: number; readonly reason: string }>>;
}
const clamp = (n: number, max = 100): number =>
  Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
export function scopeEvidence(node: NodeView, prs: readonly OpenPr[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        node: node.id,
        description: node.text,
        units: node.units
          .map((u) => ({
            id: u.id,
            title: u.title,
            days: u.days,
            merged: Math.max(u.coded.pct, u.estimate.pct),
            auditWhy: u.audit.why,
            tickets: u.tickets.map((t) => t.id),
          }))
          .toSorted((a, b) => a.id.localeCompare(b.id)),
        prs: prs
          .map((p) => ({
            key: p.key,
            title: p.title,
            body: p.body,
            head: p.headRefOid ?? null,
            branch: p.headRefName,
            issueKeys: p.issueKeys,
            additions: p.additions ?? null,
            deletions: p.deletions ?? null,
          }))
          .toSorted((a, b) => a.key.localeCompare(b.key)),
      }),
    )
    .digest('hex');
}
export function scopeView(
  node: NodeView,
  prs: readonly OpenPr[],
  estimate?: OpenScopeEstimate,
  complete = true,
): ScopeView {
  const live = clamp(Math.min(node.coded.pct, node.on.pct));
  const baseline = clamp(Math.max(node.coded.pct, node.estimate.pct));
  const valid =
    complete &&
    prs.every(
      (p) =>
        /^[a-f0-9]{40}$/.test(p.headRefOid ?? '') &&
        Number.isFinite(p.additions) &&
        Number.isFinite(p.deletions),
    ) &&
    estimate?.units &&
    estimate.evidence === scopeEvidence(node, prs) &&
    node.units.every((u) => Number.isFinite(estimate.units[u.id]?.built)) &&
    Object.keys(estimate.units).length === node.units.length;
  const days = node.units.reduce((sum, u) => sum + u.days, 0);
  const built =
    prs.length && valid && days > 0
      ? clamp(
          node.units.reduce(
            (sum, u) =>
              sum +
              u.days *
                clamp(
                  estimate.units[u.id]!.built,
                  100 - clamp(Math.max(u.coded.pct, u.estimate.pct)),
                ),
            0,
          ) / days,
          100 - baseline,
        )
      : 0;
  const shares = { live, merged: baseline - live, built, planned: 100 - baseline - built };
  return {
    shares,
    display: roundedShares(shares),
    estimated: baseline > node.coded.pct || (prs.length > 0 && !!valid),
    pending: node.units.length === 0 || (prs.length > 0 && !valid),
    reason:
      node.units.length === 0
        ? 'This section has no approved scope weights or audit baseline yet.'
        : prs.length === 0
          ? 'No open PRs.'
          : valid
            ? estimate.reason
            : 'Open work awaits a scope estimate for the current PR heads and merged baseline; remaining scope includes this unknown work.',
    at: valid ? estimate.at : null,
  };
}
function quotedReceipt(text: string): boolean {
  let fence: { marker: string; length: number } | null = null;
  let lazyQuote = false;
  const wrappers: string[] = [];
  for (const line of text.split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (match) {
      const marker = match[1]!;
      const suffix = match[2]!;
      if (fence) {
        if (
          marker[0] === fence.marker &&
          marker.length >= fence.length &&
          /^[ \t\r]*$/.test(suffix)
        )
          fence = null;
      } else if (marker[0] !== '`' || !suffix.includes('`')) {
        fence = { marker: marker[0]!, length: marker.length };
      }
      lazyQuote = false;
      continue;
    }
    if (fence) continue;
    if (!line.trim()) lazyQuote = false;
    else if (/^ {0,3}>/.test(line)) lazyQuote = true;
    for (const tag of line.matchAll(/<(\/?)(details|blockquote|pre|code)\b[^>]*>/gi)) {
      const name = tag[2]!.toLowerCase();
      if (!tag[1]) wrappers.push(name);
      else if (wrappers.at(-1) === name) wrappers.pop();
    }
  }
  return fence !== null || lazyQuote || wrappers.length > 0;
}
export function reviewPr(
  p: OpenPr,
  receiptAuthors: readonly string[] = [],
  debtLabels: readonly string[] = REVIEW_DEBT,
): ReviewPr {
  const receipts = (p.comments ?? [])
    .flatMap((c) => {
      if (!c.author || !receiptAuthors.includes(c.author)) return [];
      const positive =
        /(?:^|\n)Reviewer: ([^\n`]+)\nModel: ([^\n`]+)\nHead SHA: ([a-f0-9]{40})\nVerdict: (approve)\nCode review: no findings\s*$/.exec(
          c.body,
        );
      const negative =
        /(?:^|\n)Reviewer: ([^\n`]+)\nModel: ([^\n`]+)\nHead SHA: ([a-f0-9]{40})\n(?:Scope: [^\n]+\n)?Verdict: (changes requested)(?:\n(?:Code review|Findings|Coverage|Scope): [^\n]*)*\s*$/.exec(
          c.body,
        );
      const match = negative ?? positive;
      if (
        !match ||
        !match[1]?.trim() ||
        !match[2]?.trim() ||
        match[3] !== p.headRefOid ||
        !Number.isFinite(Date.parse(c.createdAt)) ||
        !Number.isFinite(Date.parse(c.updatedAt)) ||
        (match[4] === 'approve' && quotedReceipt(c.body.slice(0, match.index)))
      )
        return [];
      return [
        {
          verdict: match[4],
          at: Math.max(Date.parse(c.createdAt), Date.parse(c.updatedAt)),
          url: c.url,
        },
      ];
    })
    .toSorted(
      (a, b) =>
        b.at - a.at ||
        (a.verdict === 'changes requested' ? -1 : b.verdict === 'changes requested' ? 1 : 0),
    );
  const receipt = receipts[0];
  const labels = p.labels ?? [];
  const debt = labels.filter((label) => debtLabels.includes(label));
  const opinions = p.reviews ?? [];
  const current = opinions.filter((r) => r.head === p.headRefOid && p.headRefOid);
  const complete = p.labelsComplete === true && p.reviewsComplete === true;
  const changes =
    p.reviewDecision === 'CHANGES_REQUESTED' ||
    current.some((r) => r.state === 'CHANGES_REQUESTED');
  const approved =
    receipt?.verdict === 'approve'
      ? p.commentsComplete === true && !changes
      : !receipt &&
        complete &&
        p.commentsComplete === true &&
        !debt.length &&
        !changes &&
        current.some((r) => r.state === 'APPROVED');
  const review = approved ? 'reviewed' : 'unreviewed';
  const { additions, deletions } = p;
  const sizeKnown =
    additions !== undefined &&
    deletions !== undefined &&
    Number.isFinite(additions) &&
    Number.isFinite(deletions) &&
    additions >= 0 &&
    deletions >= 0;
  return {
    key: p.key,
    title: p.title,
    url: p.url,
    state: p.state ?? 'OPEN',
    review,
    labels,
    marked: debt.length > 0,
    receiptUrl: receipt?.url ?? null,
    reason: receipt
      ? `Recorded review on current head: ${receipt.verdict}${p.commentsComplete !== true ? '; comment history incomplete' : ''}${changes ? '; changes requested in GitHub' : ''}`
      : debt.length
        ? `Marked for review: ${debt.join(', ')}`
        : !complete || p.commentsComplete !== true
          ? 'Review evidence incomplete'
          : changes
            ? 'Changes requested'
            : approved
              ? 'Approval on current PR head'
              : 'No approval on current PR head',
    changedLines: sizeKnown ? additions + deletions : null,
  };
}
