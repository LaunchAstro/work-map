export type ScopeShares = Readonly<Record<'live' | 'merged' | 'built' | 'planned', number>>;
export interface ScopeView {
  readonly shares: ScopeShares;
  readonly display: ScopeShares;
  readonly estimated: boolean;
  readonly pending: boolean;
  readonly reason: string;
  readonly at: string | null;
}
export function roundedShares(shares: ScopeShares): ScopeShares {
  const keys = ['live', 'merged', 'built', 'planned'] as const;
  const rounded = keys.map((k) => Math.floor(shares[k]));
  const order = keys
    .map((k, i) => ({ i, fraction: shares[k] - rounded[i]! }))
    .toSorted((a, b) => b.fraction - a.fraction || a.i - b.i);
  const remainder = 100 - rounded.reduce((sum, n) => sum + n, 0);
  for (const { i } of order.slice(0, remainder)) rounded[i] = (rounded[i] ?? 0) + 1;
  return { live: rounded[0]!, merged: rounded[1]!, built: rounded[2]!, planned: rounded[3]! };
}
export type ReviewState = 'unreviewed' | 'reviewed';
export interface ReviewPr {
  readonly key: string;
  readonly title: string;
  readonly url: string;
  readonly state: 'OPEN' | 'MERGED';
  readonly review: ReviewState;
  readonly marked: boolean;
  readonly receiptUrl: string | null;
  readonly reason: string;
  readonly labels: readonly string[];
  readonly changedLines: number | null;
}
export interface ReviewView {
  readonly denominator: 'tracked PR code changes';
  readonly pct: number | null;
  readonly reviewedLines: number;
  readonly totalLines: number;
  readonly complete: boolean;
  readonly prs: readonly ReviewPr[];
}
export function reviewView(prs: readonly ReviewPr[], complete: boolean): ReviewView {
  const unique = [...new Map(prs.map((p) => [p.key, p])).values()];
  const totalLines = unique.reduce((sum, p) => sum + (p.changedLines ?? 0), 0);
  const reviewedLines = unique.reduce(
    (sum, p) => sum + (p.review === 'reviewed' ? (p.changedLines ?? 0) : 0),
    0,
  );
  const known = complete && unique.every((p) => p.changedLines !== null);
  return {
    denominator: 'tracked PR code changes',
    pct: known && totalLines > 0 ? (100 * reviewedLines) / totalLines : null,
    reviewedLines,
    totalLines,
    complete: known,
    prs: unique,
  };
}
