/**
 * The parent a ticket closed as not planned or duplicate was absorbed into (#189). Strict rule: GitHub's
 * own duplicate link, else the closing comment (the last comment written no later than a minute after
 * the close) when it opens, after at most one leading "Label:", with "Absorbed into", "Merged into"
 * or "Duplicate of" and then an issue reference. Replaced, superseded or split work, and a ticket
 * only mentioning another one, name no parent.
 */
const LEAD = /^\s*(?:[A-Za-z-]+:\s*)?(?:absorbed into|merged into|duplicate of)\s+/i;
const REF =
  /^(?:#([1-9]\d*)|([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)#([1-9]\d*)|https:\/\/github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)\/issues\/([1-9]\d*))(?![\w/#-])/;
/** How long after the close its comment may be stamped, for GitHub writing the two apart. */
const CLOSE_SLACK_MS = 60_000;

export const closedAside = (state: string, stateReason: string | null | undefined): boolean =>
  state === 'CLOSED' && (stateReason === 'NOT_PLANNED' || stateReason === 'DUPLICATE');

export function closingParent(comment: string, repository: string): string | null {
  const lead = LEAD.exec(comment);
  if (!lead) return null;
  const ref = REF.exec(comment.slice(lead[0].length));
  if (!ref) return null;
  if (ref[1]) return `${repository}#${ref[1]}`;
  return ref[2] ? `${ref[2]}#${ref[3]}` : `${ref[4]}#${ref[5]}`;
}

export interface ClosedIssueRead {
  readonly key: string;
  readonly state: string;
  readonly stateReason: string | null;
  readonly closedAt: string | null;
  /** GitHub's duplicate link, as "Owner/repo#n". */
  readonly duplicateOf: string | null;
  /** The latest comments read, oldest first. */
  readonly comments: readonly { readonly body: string; readonly createdAt: string }[];
  readonly commentsTotal: number;
}

/** `read` is false when the closing comment fell outside the comments read. */
export function absorptionOf(issue: ClosedIssueRead): { parent: string | null; read: boolean } {
  if (!closedAside(issue.state, issue.stateReason)) return { parent: null, read: true };
  if (issue.duplicateOf) return { parent: issue.duplicateOf, read: true };
  const closed = Date.parse(issue.closedAt ?? '');
  const closing = Number.isFinite(closed)
    ? issue.comments.findLast((c) => Date.parse(c.createdAt) <= closed + CLOSE_SLACK_MS)
    : undefined;
  const repository = issue.key.split('#')[0] ?? '';
  if (closing) return { parent: closingParent(closing.body, repository), read: true };
  return { parent: null, read: issue.commentsTotal <= issue.comments.length };
}
