// The Kettle example's GitHub read, made up and written where the collector keeps its own, so the snapshot
// command can draw the map with no GitHub login and no network. Times count back from `now`.
//
//   node examples/demo/seed.ts <data folder>

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PrInput } from '../../src/core/refs.ts';
import type { LedgerPr } from '../../src/core/loading-bay.ts';
import type { OpenPr, WorkIssue } from '../../src/core/work.ts';
import type { GithubCache } from '../../src/readers/github.ts';
import type { WorkCache } from '../../src/readers/work-github.ts';

const repo = 'example-work-map/kettle';

/** Each section's tickets, in the order they were opened: done, open or dropped. */
const tickets: Readonly<
  Record<string, readonly [prefix: string, ...[string, 'done' | 'open' | 'dropped'][]]>
> = {
  accounts: [
    'Accounts',
    ['Sign up with email', 'done'],
    ['Sign in and sign out', 'done'],
    ['Reset a forgotten password', 'done'],
    ['Edit the profile and address book', 'done'],
    ['Delete an account and its data', 'open'],
  ],
  catalogue: [
    'Catalogue',
    ['List teas with photos and prices', 'done'],
    ['Tasting notes on each tea', 'done'],
    ['Filter by type and caffeine', 'done'],
    ['Stock levels from the warehouse sheet', 'open'],
    ['Search by name', 'dropped'],
  ],
  basket: [
    'Basket',
    ['Add a tea to the basket', 'done'],
    ['Change quantities and remove items', 'done'],
    ['Keep the basket between visits', 'open'],
    ['Show delivery cost before checkout', 'open'],
  ],
  checkout: [
    'Checkout',
    ['Card payment through the payment provider', 'done'],
    ['Order confirmation email', 'open'],
    ['Order history page', 'open'],
    ['Refund an order', 'open'],
  ],
  subscriptions: [
    'Subscriptions',
    ['Choose a monthly box', 'open'],
    ['Pause or skip a month', 'open'],
    ['Cancel a subscription', 'open'],
  ],
  dispatch: [
    'Dispatch',
    ['Daily packing list', 'done'],
    ['Courier labels', 'open'],
    ['Tracking link in the dispatch email', 'open'],
  ],
  launch: [
    'Launch',
    ['Uptime and error alerts', 'open'],
    ['Privacy policy and terms pages', 'open'],
    ['Invite the first fifty customers', 'open'],
  ],
};
/** A section's first open ticket waits on the first open ticket of the section named here. */
const waitsOn: Readonly<Record<string, string>> = {
  subscriptions: 'checkout',
  dispatch: 'checkout',
  launch: 'dispatch',
};
/** Sections whose first open ticket has a pull request open. */
const inReview = ['basket', 'checkout'];

/** Writes github-cache.json and work-cache.json for the example into `data`. */
export function seed(data: string, now: Date = new Date()): void {
  const at = now.toISOString();
  const hoursAgo = (hours: number): string =>
    new Date(now.getTime() - hours * 3_600_000).toISOString().replace('.000', '');
  const issues: Record<string, WorkIssue> = {};
  const firstOpen = new Map<string, WorkIssue>();
  const merged: OpenPr[] = [];
  const open: OpenPr[] = [];
  let number = 1;
  // Done tickets close one after another, the newest two hours ago, the oldest about three weeks back.
  let closedHoursAgo = 2;
  const done = Object.values(tickets)
    .flatMap(([, ...rows]) => rows)
    .filter(([, state]) => state !== 'open').length;
  closedHoursAgo += (done - 1) * 40;
  for (const [section, [prefix, ...rows]] of Object.entries(tickets))
    for (const [title, state] of rows) {
      const key = `${repo}#${number}`;
      const closedAt = state === 'open' ? null : hoursAgo(closedHoursAgo);
      if (closedAt) closedHoursAgo -= 40;
      const issue: WorkIssue = {
        key,
        title: `${prefix}: ${title}`,
        body: 'A made-up ticket in the Kettle example project.',
        url: `https://github.com/${repo}/issues/${number}`,
        state: state === 'open' ? 'OPEN' : 'CLOSED',
        stateReason: state === 'done' ? 'COMPLETED' : state === 'dropped' ? 'NOT_PLANNED' : null,
        updatedAt: closedAt ?? hoursAgo(30),
        labels: ['ready'],
        parent: null,
        blockedBy: [],
        contextComplete: true,
        absorbedInto: null,
        closedAt,
      };
      issues[key] = issue;
      if (state === 'open' && !firstOpen.has(section)) firstOpen.set(section, issue);
      number++;
    }
  for (const [section, before] of Object.entries(waitsOn)) {
    const blocked = firstOpen.get(section)!;
    const blocker = firstOpen.get(before)!;
    issues[blocked.key] = {
      ...blocked,
      blockedBy: [{ key: blocker.key, title: blocker.title, url: blocker.url, state: 'OPEN' }],
    };
  }
  // One pull request closed each done ticket; every fourth merged without an approval.
  number = 100;
  const pr = (issue: WorkIssue, state: 'OPEN' | 'MERGED', updatedAt: string): OpenPr => {
    const head = (number * 7919).toString(16).padStart(40, '0');
    const approved = state === 'MERGED' && number % 4 !== 0;
    const ticket = issue.key.split('#')[1]!;
    const record: OpenPr = {
      key: `${repo}#${number}`,
      number,
      title: issue.title,
      body: `Closes #${ticket}`,
      url: `https://github.com/${repo}/pull/${number}`,
      headRefName: `${ticket}-${issue.title.split(':')[0]!.toLowerCase()}`,
      headRepository: repo,
      state,
      headRefOid: head,
      updatedAt,
      additions: 40 + ((number * 37) % 300),
      deletions: (number * 11) % 90,
      labels: [],
      labelsComplete: true,
      reviewDecision: approved ? 'APPROVED' : null,
      reviews: approved ? [{ state: 'APPROVED', head }] : [],
      reviewsComplete: true,
      comments: [],
      commentsComplete: true,
      issueKeys: [issue.key],
      docsOnly: false,
    };
    number++;
    return record;
  };
  for (const issue of Object.values(issues))
    if (issue.stateReason === 'COMPLETED') merged.push(pr(issue, 'MERGED', issue.closedAt!));
  for (const section of inReview) open.push(pr(firstOpen.get(section)!, 'OPEN', hoursAgo(5)));

  const ledgerPrs: LedgerPr[] = [...merged, ...open].map((p) => ({
    key: p.key,
    url: p.url,
    title: p.title,
    checkedAt: at,
    complete: true,
    status: p.state === 'MERGED' ? 'merged' : 'opened',
    reason: null,
    events: [
      { id: `${p.key}:opened`, kind: 'opened', at: p.updatedAt!, reason: null },
      ...(p.state === 'MERGED'
        ? [{ id: `${p.key}:merged`, kind: 'merged' as const, at: p.updatedAt!, reason: null }]
        : []),
    ],
  }));
  const through = { [repo]: at };
  const work: WorkCache = {
    version: 2,
    project: 'kettle',
    at,
    complete: true,
    error: null,
    issueCensus: {
      at,
      complete: true,
      error: null,
      repositories: { [repo]: { through: at, fullAt: at } },
    },
    issues,
    prs: open,
    mergedPrs: merged,
    mergedThrough: through,
    openThrough: { [repo]: { through: at, fullAt: at } },
    reposThrough: through,
    ledgerPrs,
    ledgerComplete: true,
    closedThrough: through,
    specDocuments: {},
    allReadAt: at,
    lastScope: { at, scope: 'all', reread: [repo] },
  };
  const prs: Record<string, PrInput> = Object.fromEntries(
    merged.map((p) => [
      String(p.number),
      {
        number: p.number,
        title: p.title,
        body: p.body,
        url: p.url,
        mergedAt: p.updatedAt!,
        updatedAt: p.updatedAt!,
        headRefName: p.headRefName,
        labels: [],
        labelsComplete: true,
      },
    ]),
  );
  const github: GithubCache = {
    version: 2,
    prs,
    switchOns: {},
    prsWatermark: at,
    issuesWatermark: at,
    lastRun: {
      at,
      mode: 'full',
      cost: 0,
      prsChanged: merged.length,
      skipped: null,
      partial: false,
    },
    openState: { queued: 0, at, entries: [] },
  };
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'work-cache.json'), `${JSON.stringify(work)}\n`);
  writeFileSync(join(data, 'github-cache.json'), `${JSON.stringify(github)}\n`);
}

if (import.meta.main) {
  const data = process.argv[2];
  if (!data) throw new Error('usage: node examples/demo/seed.ts <data folder>');
  seed(resolve(data));
}
