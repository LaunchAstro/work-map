// SPDX-License-Identifier: AGPL-3.0-only
//
// #242: what one GitHub collector run reads. Every agent shares one GitHub login's GraphQL budget, so the
// automatic refresh reads as little as it can:
//   timer  the five-minute job and the post-merge kick. It reads the merge panel only (one query), and the
//          section cards only when they were never read (#245: the owner reads them on Sync, not after every merge).
//   sync   the map's Sync button. It reads the merge panel, the cards that changed, map gaps and site versions.
//   full   the explicit `--full` command. It reads every repository again, as before #242.

export type GithubScope = 'timer' | 'sync' | 'full';

export function githubScope(flags: {
  readonly sync?: boolean;
  readonly full?: boolean;
}): GithubScope {
  return flags.full ? 'full' : flags.sync ? 'sync' : 'timer';
}

/** Whether this run reads the section cards: Sync and full always; the timer only when they were never read. */
export function readsCards(
  scope: GithubScope,
  cards: { readonly at: string; readonly project: string },
  project: string,
): boolean {
  return scope !== 'timer' || !cards.at || cards.project !== project;
}

/** Whether any merged PR merged after the cards' last good read (`at`); true when they were never read. */
export function mergedSince(
  prs: Readonly<Record<string, { readonly mergedAt: string }>>,
  at: string,
): boolean {
  const read = Date.parse(at);
  if (!Number.isFinite(read)) return true;
  return Object.values(prs).some((p) => Date.parse(p.mergedAt) > read);
}
