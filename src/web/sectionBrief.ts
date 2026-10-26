// SPDX-License-Identifier: AGPL-3.0-only
import { currentSpecProgress, type SpecProgress } from '../core/spec-progress.ts';
import type { NodeView, Snapshot } from '../core/contract.ts';
import type { SectionWork } from '../core/work.ts';
import { stamp } from '../core/time.ts';
import { pct } from './words.ts';
import { specDocumentState } from './stage.ts';

export type BriefLink = { readonly title: string; readonly url: string };
export type BriefRow = {
  readonly key: string;
  readonly title: string;
  readonly url: string | null;
  readonly details: readonly string[];
  readonly links: readonly BriefLink[];
};
export type BriefGroup = {
  readonly id: string;
  readonly title: string;
  readonly expanded: boolean;
  readonly rows: readonly BriefRow[];
};
export type SectionBrief = {
  readonly title: string;
  readonly section: string;
  readonly source: readonly string[];
  readonly groups: readonly BriefGroup[];
};

const references = (links: readonly (BriefLink & { readonly key: string })[]): BriefRow[] =>
  links.map((link) => ({ ...link, details: [], links: [] }));
const prRow = (pr: SectionWork['review']['prs'][number]): BriefRow => ({
  key: pr.key,
  title: pr.title,
  url: pr.url,
  details: [
    pr.state === 'MERGED' ? 'Merged' : 'Open',
    pr.reason,
    ...(pr.labels.length ? [`Labels: ${pr.labels.join(', ')}`] : []),
  ],
  links: pr.receiptUrl ? [{ title: 'Review receipt', url: pr.receiptUrl }] : [],
});

// Open tickets in build order (#231): those in an open PR, then unblocked,
// then blocked, each by issue number.
const issueNumber = (key: string): number => Number(key.split('#')[1] ?? 0);
function nextUp(work: SectionWork | undefined): BriefRow[] {
  const blockedBy = (key: string): string[] =>
    (work?.blockers ?? []).filter((b) => b.ticket === key).map((b) => b.key);
  const rank = (t: { key: string; inPr?: boolean }): number =>
    t.inPr ? 0 : blockedBy(t.key).length ? 2 : 1;
  const open = (work?.planning.tickets ?? [])
    .filter((t) => t.state === 'OPEN')
    .toSorted((a, b) => rank(a) - rank(b) || issueNumber(a.key) - issueNumber(b.key));
  if (!open.length)
    return [
      { key: 'none', title: 'No open tickets in this section', url: null, details: [], links: [] },
    ];
  return open.map((t) => {
    const blockers = blockedBy(t.key);
    return {
      key: t.key,
      title: t.title,
      url: t.url,
      details: [
        t.inPr ? 'In a pull request' : blockers.length ? 'Blocked' : 'Ready',
        ...(t.labels?.length ? [`Labels: ${t.labels.join(', ')}`] : []),
        ...(blockers.length ? [`Blocked by ${blockers.join(', ')}`] : []),
      ],
      links: [],
    };
  });
}

/** Merged PRs with no review and no review-debt mark: the card's count and the pop-up's list (#234). */
export function unreviewedMerged(work: SectionWork | undefined): SectionWork['review']['prs'] {
  const open = new Set(work?.openPrs.map((pr) => pr.key));
  return (work?.review.prs ?? []).filter(
    (pr) => !open.has(pr.key) && !pr.marked && pr.review === 'unreviewed',
  );
}

function specClosureLabel(report: SpecProgress | null, section: string): string {
  const count = report?.bySection[section];
  return count?.pct == null
    ? 'Ticket closure: pending'
    : `Ticket closure: ${count.built}/${count.total} specs built (${Math.round(count.pct)}%)`;
}

export function buildSectionBrief(
  snapshot: Snapshot,
  node: NodeView,
  failed = false,
): SectionBrief {
  const progress = currentSpecProgress(snapshot.work?.specProgress, Date.now(), failed);
  const ticketProgress = snapshot.ticketProgress;
  const ticketCount = ticketProgress?.byNode[node.id];
  const work = snapshot.work?.byNode[node.id];
  const open = new Set(work?.openPrs.map((pr) => pr.key));
  const tracked = new Set([...(work?.review.prs.map((pr) => pr.key) ?? []), ...open]);
  const closed = work?.review.prs.filter((pr) => !open.has(pr.key)) ?? [];
  // Snapshots written before placement warnings existed have none.
  const warnings = work?.warnings ?? [];
  const groups: BriefGroup[] = [
    ...(warnings.length
      ? [
          {
            id: 'placement-warnings',
            title: 'Placement warnings',
            expanded: true,
            rows: warnings.map((warning) => ({
              key: warning.key,
              title: warning.title,
              url: warning.url,
              details: [warning.reason],
              links: [],
            })),
          },
        ]
      : []),
    ...(ticketProgress
      ? [
          {
            id: 'ticket-progress',
            title: 'Ticket completion inventory',
            expanded: true,
            rows: (ticketCount?.tickets ?? []).map((ticket) => ({
              key: ticket.key,
              title: ticket.title,
              url: ticket.url,
              details: [
                `${ticket.state} / ${ticket.stateReason ?? 'closure reason unknown'}`,
                ticket.mapping,
              ],
              links: [],
            })),
          },
        ]
      : []),
    {
      id: 'next-up',
      title: 'Next up',
      expanded: true,
      rows: nextUp(work),
    },
    {
      id: 'ticket-closure',
      title: 'Spec ticket closure',
      expanded: true,
      rows: progress
        ? progress.specs
            .filter((spec) => spec.section === node.id)
            .map((spec) => ({
              key: spec.key,
              title: `Spec ${spec.state}`,
              url: `https://github.com/${spec.key.replace('#', '/issues/')}`,
              details: [
                spec.reason,
                `${spec.closed}/${spec.tickets.length} tickets observed closed at ${stamp(progress.at)}`,
              ],
              links: spec.tickets.map((key) => ({
                title: key,
                url: `https://github.com/${key.replace('#', '/issues/')}`,
              })),
            }))
        : [],
    },
    {
      id: 'spec',
      title: 'Specifications',
      expanded: true,
      rows: [
        ...(work?.planning.spec ?? [])
          .filter((link) => !work?.specDocuments?.some((d) => d.key === link.key))
          .map((link) => ({
            key: link.key,
            title: link.title,
            url: link.url,
            details: ['Spec issue'],
            links: [],
          })),
        ...(work?.specDocuments ?? []).map((d) => ({
          key: d.key,
          title: d.path,
          url: d.found ? d.url : null,
          details: [specDocumentState(d)],
          links: [],
        })),
      ],
    },
    {
      id: 'scope',
      title: 'Scope units',
      expanded: true,
      rows: node.units.map((unit) => ({
        key: unit.id,
        title: unit.title,
        url:
          work?.planning.tickets.find((link) => link.title.startsWith(`${unit.id}:`))?.url ?? null,
        details: [
          `Estimated code ${pct(unit.estimate.pct)} · recorded live state: ${unit.audit.live}`,
          ...(unit.audit.why ? [`Audit evidence: ${unit.audit.why}`] : []),
          ...(unit.estimate.source !== 'audit'
            ? [
                `Estimate (${unit.estimate.source === 'sol' ? 'from PR titles only' : 'tickets named complete'}${unit.estimate.at ? `, ${stamp(unit.estimate.at)}` : ''}): ${unit.estimate.reason}`,
              ]
            : []),
          `Tickets: ${unit.tickets.map((ticket) => ticket.id).join(', ') || 'none recorded'}`,
        ],
        links: [
          ...new Set([...unit.unitPrs, ...unit.tickets.flatMap((ticket) => ticket.prs)]),
        ].flatMap((number) => {
          const pr = snapshot.prs[String(number)];
          return pr ? [{ title: `PR #${number}`, url: pr.url }] : [];
        }),
      })),
    },
    {
      id: 'open',
      title: 'Open build work',
      expanded: true,
      rows: (work?.openPrs ?? []).map((pr) => {
        const review = work?.review.prs.find((entry) => entry.key === pr.key);
        return {
          key: pr.key,
          title: pr.title,
          url: pr.url,
          details: [
            review?.reason ?? 'Review evidence not recorded',
            ...(pr.inferred ? ['Section placement inferred'] : []),
          ],
          links: review?.receiptUrl ? [{ title: 'Review receipt', url: review.receiptUrl }] : [],
        };
      }),
    },
    {
      id: 'marked',
      title: 'Marked for review',
      expanded: true,
      rows: closed.filter((pr) => pr.marked).map(prRow),
    },
    {
      id: 'unmarked',
      title: 'Unreviewed, unmarked',
      expanded: false,
      rows: unreviewedMerged(work).map(prRow),
    },
    {
      id: 'reviewed',
      title: 'Reviewed',
      expanded: false,
      rows: closed.filter((pr) => pr.review === 'reviewed').map(prRow),
    },
    {
      id: 'dependencies',
      title: 'Open dependencies',
      expanded: true,
      rows: (work?.blockers ?? []).map((blocker) => ({
        key: `${blocker.ticket}:${blocker.key}`,
        title: `${blocker.key} · ${blocker.title}`,
        url: blocker.url,
        details: [
          `Blocks ${blocker.ticket}`,
          blocker.section === node.id
            ? 'Within this section'
            : blocker.section
              ? `Section: ${blocker.section}`
              : 'Section not recorded',
        ],
        links: [],
      })),
    },
    {
      id: 'plan',
      title: 'Plan and ticket references',
      expanded: false,
      rows: references([
        ...new Map(
          [
            ...(work?.planning.idea ?? []),
            ...(work?.planning.map ?? []),
            ...(work?.planning.tickets ?? []),
          ].map((link) => [link.key, link]),
        ).values(),
      ]),
    },
    {
      id: 'build',
      title: 'Other build references',
      expanded: false,
      rows: references((work?.planning.build ?? []).filter((link) => !tracked.has(link.key))),
    },
    {
      id: 'mentions',
      title: 'Additional PR mentions',
      expanded: false,
      rows: [...new Set(node.units.flatMap((unit) => unit.candidatePrs))].flatMap((number) => {
        const pr = snapshot.prs[String(number)];
        return pr && !tracked.has(`${snapshot.sources.github?.repo}#${number}`)
          ? [
              {
                key: `mention-${number}`,
                title: `#${number} · ${pr.title}`,
                url: pr.url,
                details: ['Mentioned in unit context; not evidence that the unit is complete'],
                links: [],
              },
            ]
          : [];
      }),
    },
  ];
  return {
    title: node.title,
    section: node.id,
    source: [
      `Section context: ${node.text}`,
      specClosureLabel(progress, node.id),
      `GitHub ticket states read ${progress?.at ? stamp(progress.at) : 'not recorded'}; ${progress?.reason ?? 'Explicit spec membership unavailable'}`,
      'Built from ticket closure does not establish merged, deployed or live',
      ...(node.units.length ? [] : ['Scope: pending approved weights and audit evidence']),
      ...(ticketProgress
        ? [
            `Ticket completion: ${ticketCount?.completed ?? 0}/${ticketCount?.total ?? 0}; absorbed ${ticketCount?.absorbed ?? 0}; dropped ${ticketCount?.dropped ?? 0}; unknown closure ${ticketCount?.unknown ?? 0}`,
            `Issue census: ${ticketProgress.at ? stamp(ticketProgress.at) : 'pending'}; ${ticketProgress.complete ? 'complete' : 'incomplete'}; unplaced ${ticketProgress.unplaced.length}; missing ${ticketProgress.missing.length}`,
            'Ticket closure does not establish reviewed, merged, deployed or live scope.',
          ]
        : []),
      `Snapshot: ${stamp(snapshot.generatedAt)}`,
      ...(snapshot.sources.audit ? [`Audit: ${stamp(snapshot.sources.audit.asAt)}`] : []),
      `Roadmap commit: ${snapshot.sources.plan.commit ?? 'not recorded'}`,
      `Product repository: ${snapshot.sources.github?.repo ?? 'not recorded'}`,
      `Planning evidence: ${snapshot.work?.complete ? 'complete' : 'incomplete'}`,
      ...(snapshot.work?.error ? [snapshot.work.error] : []),
      ...(work
        ? [
            ...(node.units.length
              ? [
                  `Scope: live ${pct(work.shares.live)}, merged not live ${pct(work.shares.merged)}, built not merged ${pct(work.shares.built)}, planned ${pct(work.shares.planned)}`,
                ]
              : []),
            `Scope estimate: ${work.scope.pending ? 'pending' : 'recorded'} · ${work.scope.reason}`,
            `Review collection: ${work.review.complete ? 'complete' : 'incomplete'}`,
            ...(work.missing.length ? [`Missing context: ${work.missing.join(', ')}`] : []),
          ]
        : ['Section work evidence not recorded']),
    ],
    groups,
  };
}

const line = (text: string): string =>
  text.replace(/[\r\n]+/g, ' ').replace(/([\\`*_[\]<>#])/g, '\\$1');
const link = (item: BriefLink): string => `[${line(item.title)}](${item.url})`;

export function sectionBriefMarkdown(brief: SectionBrief): string {
  return (
    [
      `# ${line(brief.title)}`,
      `Section: ${brief.section}`,
      'Use the linked specifications, plan and build records to choose the next work. The following is recorded snapshot context.',
      ...brief.source.map((text) => `- ${line(text)}`),
      ...brief.groups.flatMap((group) => [
        `## ${group.title}`,
        ...(group.rows.length
          ? group.rows.flatMap((row) => [
              `### ${row.url ? link({ title: `${row.key} · ${row.title}`, url: row.url }) : line(`${row.key} · ${row.title}`)}`,
              ...row.details.map((text) => `- ${line(text)}`),
              ...row.links.map((item) => `- ${link(item)}`),
            ])
          : ['No records supplied.']),
      ]),
    ].join('\n\n') + '\n'
  );
}
