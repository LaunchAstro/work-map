import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { SpecMembershipSchema, type SpecMembership } from '../core/spec-progress.ts';
import { isLocale, isTimeZone } from '../core/time.ts';

const repo = z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/);
/** A regular expression with at least one capture group. */
const capturing = z
  .string()
  .max(256)
  .refine((s) => {
    try {
      return (new RegExp(`${s}|`).exec('')?.length ?? 0) > 1;
    } catch {
      return false;
    }
  });
const relative = z
  .string()
  .min(1)
  .refine((s) => !isAbsolute(s) && !s.split(/[\\/]/).includes('..'));
/** `owner/repo:path`, a file on that repository's default branch; the path goes into a GraphQL string. */
const specDocument = z
  .string()
  .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+:[A-Za-z0-9._ -][A-Za-z0-9._/ -]*$/)
  .refine(
    (s) =>
      !s
        .slice(s.indexOf(':') + 1)
        .split('/')
        .includes('..'),
  );
/**
 * The retired re-checks' settings. Only `confidence` is read: the floor a kept score in
 * unit-scores.json must meet. The others are accepted so existing configs still load.
 */
export interface RecheckConfig {
  readonly enabled: boolean;
  readonly dailyCalls: number;
  readonly confidence: number;
  readonly deepCalls: number;
}
const recheckSchema = z.strictObject({
  enabled: z.boolean(),
  dailyCalls: z.number().int().min(1).max(200).default(20),
  confidence: z.number().min(0).max(1).default(0.6),
  deepCalls: z.number().int().min(1).max(200).default(40),
});
const ProjectSchema: z.ZodType<Project> = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  title: z.string().min(1),
  roadmapRepo: repo,
  productRepo: repo,
  repos: z.array(repo).min(1),
  files: z.object({
    flow: relative,
    audit: relative,
    plan: relative,
    mapping: relative,
    sections: relative,
  }),
  lanePrefix: z.string(),
  laneRules: z.array(
    z.object({
      pattern: z.string().refine((s) => {
        try {
          return new RegExp(s).source.length > 0;
        } catch {
          return false;
        }
      }),
      box: z.string(),
    }),
  ),
  ticketConventions: z.object({
    readyLabel: z.string(),
    ticketLabels: z.array(z.string()).default([]),
    ticketLabelsByRepository: z.record(repo, z.array(z.string().min(1))).optional(),
    mapLabel: z.string(),
    ideaLabels: z.array(z.string()),
    ideaPattern: z.string().refine((s) => {
      try {
        return new RegExp(s).source.length > 0;
      } catch {
        return false;
      }
    }),
    specLabels: z.array(z.string()),
    specPattern: z.string().refine((s) => {
      try {
        return new RegExp(s).source.length > 0;
      } catch {
        return false;
      }
    }),
  }),
  seatGauge: z
    .object({
      repositories: z.record(z.string().min(1).max(512), repo),
      // A branch pattern whose first capture group is the ticket number in the session's repository.
      branchTicket: capturing.optional(),
      // #248: a workspace pattern whose first capture group is a PR or ticket number in `repository`.
      workspace: z.object({ pattern: capturing, repository: repo }).optional(),
    })
    .optional(),
  specMembership: SpecMembershipSchema.optional(),
  ledgerPrReadyLabel: z.string().min(1).optional(),
  reviewReceiptAuthors: z.array(z.string().regex(/^[A-Za-z0-9-]+$/)).optional(),
  reviewDebtLabels: z.array(z.string().min(1)).optional(),
  // A GitHub search phrase, so no quotes or backslashes. GitHub trims titles, so outer spaces never match; it caps
  // a search at 256 characters, and this search shares its query with the merged pull requests.
  switchOnTitle: z
    .string()
    .min(1)
    .max(100)
    .refine(
      (s) => s === s.trim() && !/["\\\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(s),
      'one line with no outer spaces, quotes, backslashes or control characters',
    )
    .optional(),
  planningSections: z.array(z.string().min(1)).optional(),
  timeZone: z.string().refine(isTimeZone, 'an IANA time zone, such as Europe/London').optional(),
  locale: z.string().refine(isLocale, 'a BCP 47 locale, such as en-GB').optional(),
  specDocuments: z.record(z.string().min(1), z.array(specDocument)).optional(),
  progress: z
    .discriminatedUnion('basis', [
      z.strictObject({ basis: z.literal('estimated-scope'), scope: relative }),
      z.strictObject({
        basis: z.literal('ticket-count'),
        repositories: z.record(repo, z.string().min(1)),
        issues: z
          .record(z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+#[1-9]\d*$/), z.string().min(1))
          .optional(),
        bugLabels: z.array(z.string().min(1)).optional(),
        skipLabels: z.array(z.string().min(1)).optional(),
        notPlaced: z.literal('sections').optional(),
        placement: z
          .record(
            repo,
            z.strictObject({
              labels: z.record(z.string().min(1), z.string().min(1)).optional(),
              titlePrefixes: z.record(z.string().min(1), z.string().min(1)).optional(),
            }),
          )
          .optional(),
        unitAudit: z
          .strictObject({
            file: z.string().min(1),
            unitPattern: z.string().refine((pattern) => {
              try {
                return new RegExp(`${pattern}|`).exec('')!.length > 1;
              } catch {
                return false;
              }
            }, 'unitPattern must be a valid pattern with a capture group'),
            recheck: recheckSchema.optional(),
          })
          .optional(),
        recheck: recheckSchema.optional(),
      }),
    ])
    .optional(),
  dependencies: z.array(z.object({ from: z.string(), to: z.string(), label: z.string() })),
});
export interface Project {
  readonly version: 1;
  readonly id: string;
  readonly title: string;
  readonly roadmapRepo: string;
  readonly productRepo: string;
  readonly repos: string[];
  readonly files: { flow: string; audit: string; plan: string; mapping: string; sections: string };
  readonly lanePrefix: string;
  readonly laneRules: { pattern: string; box: string }[];
  readonly ticketConventions: {
    readyLabel: string;
    ticketLabels: string[];
    ticketLabelsByRepository?: Readonly<Record<string, readonly string[]>> | undefined;
    mapLabel: string;
    ideaLabels: string[];
    ideaPattern: string;
    specLabels: string[];
    specPattern: string;
  };
  readonly seatGauge?:
    | {
        readonly repositories: Readonly<Record<string, string>>;
        readonly branchTicket?: string | undefined;
        readonly workspace?: { readonly pattern: string; readonly repository: string } | undefined;
      }
    | undefined;
  readonly specMembership?: SpecMembership[] | undefined;
  readonly ledgerPrReadyLabel?: string | undefined;
  readonly reviewReceiptAuthors?: readonly string[] | undefined;
  /** The IANA zone the map shows times in; unset, the zone of the machine making the map. */
  readonly timeZone?: string | undefined;
  /** The locale times are written in; unset, en-AU. */
  readonly locale?: string | undefined;
  /** Labels that keep a pull request unreviewed; unset, needs-sol, unreviewed and needs-second-model. */
  readonly reviewDebtLabels?: readonly string[] | undefined;
  /** The title switch-on issues start with, any case; unset, Switch-on. */
  readonly switchOnTitle?: string | undefined;
  /** Sections whose build work is planning documents, so docs-only PRs tick build there. */
  readonly planningSections?: readonly string[] | undefined;
  /** Spec documents per section, as `owner/repo:path` on the default branch; each ticks spec when it exists. */
  readonly specDocuments?: Readonly<Record<string, readonly string[]>> | undefined;
  readonly progress?:
    | { readonly basis: 'estimated-scope'; readonly scope: string }
    | {
        readonly basis: 'ticket-count';
        readonly repositories: Readonly<Record<string, string>>;
        readonly issues?: Readonly<Record<string, string>> | undefined;
        /** Labels of bugs found by checks: counted in Bugs, never in Progress. `x*` matches a prefix. */
        readonly bugLabels?: readonly string[] | undefined;
        /** Labels of question cards (grilling, research, prototype): counted nowhere. */
        readonly skipLabels?: readonly string[] | undefined;
        /**
         * `sections`: the header's Not placed counts tickets, PRs and files no section places, each
         * apart, and leaves out the plan-unit count. Without it the header keeps its one figure.
         */
        readonly notPlaced?: 'sections' | undefined;
        /**
         * Per repository, the section a label or a title prefix (the text before the title's first
         * colon, any case) names, for tickets no map or closing PR places (#191).
         */
        readonly placement?:
          | Readonly<
              Record<
                string,
                {
                  readonly labels?: Readonly<Record<string, string>> | undefined;
                  readonly titlePrefixes?: Readonly<Record<string, string>> | undefined;
                }
              >
            >
          | undefined;
        /**
         * Build-unit audit scores (#194): `file` (repository-relative JSON with `asAt` and
         * `units.<id>.code`, 0 to 1) and `unitPattern`, whose first group reads the unit id from a
         * ticket title.
         */
        readonly unitAudit?:
          | {
              readonly file: string;
              readonly unitPattern: string;
              /** The confidence a kept re-check score needs to stand (#204). */
              readonly recheck?: RecheckConfig | undefined;
            }
          | undefined;
        /** On a map without build units, the same floor for kept section scores (#215). */
        readonly recheck?: RecheckConfig | undefined;
      }
    | undefined;
  readonly dependencies: { from: string; to: string; label: string }[];
}
export interface ProjectContext {
  readonly project: Project;
  readonly root: string;
  readonly config: string;
}
/** The diagram's section ids, or undefined when the flow file cannot be read. */
function flowSections(path: string): Set<string> | undefined {
  try {
    const flow = z
      .object({ nodes: z.array(z.object({ id: z.string() })) })
      .parse(JSON.parse(readFileSync(path, 'utf8')));
    return new Set(flow.nodes.map((node) => node.id));
  } catch {
    return undefined;
  }
}
export function readProject(config: string, root?: string): ProjectContext {
  const file = resolve(config);
  const project = ProjectSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  if (project.progress?.basis === 'ticket-count') {
    const progress = project.progress;
    if (progress.recheck && progress.unitAudit)
      throw new Error('A map with a unit audit sets re-checks under unitAudit.recheck');
    for (const repository of [
      ...Object.keys(progress.repositories),
      ...Object.keys(progress.issues ?? {}).map((key) => key.split('#')[0] ?? ''),
      ...Object.keys(progress.placement ?? {}),
    ])
      if (!project.repos.includes(repository))
        throw new Error(`Ticket progress repository is not configured: ${repository}`);
    // #193: a placement must name a diagram section, refused here as foreign repositories are.
    const sections = flowSections(resolve(root ?? dirname(file), project.files.flow));
    if (sections)
      for (const rule of Object.values(progress.placement ?? {}))
        for (const section of [
          ...Object.values(rule.labels ?? {}),
          ...Object.values(rule.titlePrefixes ?? {}),
        ])
          if (section !== 'outside' && !sections.has(section))
            throw new Error(`Ticket placement section is not on the diagram: ${section}`);
  }
  const labelRepositories = new Set<string>();
  for (const repository of Object.keys(project.ticketConventions.ticketLabelsByRepository ?? {})) {
    const identity = repository.toLowerCase();
    if (
      labelRepositories.has(identity) ||
      !project.repos.some((configured) => configured.toLowerCase() === identity)
    )
      throw new Error(`Ticket label repository is unconfigured or duplicated: ${repository}`);
    labelRepositories.add(identity);
  }
  for (const document of Object.values(project.specDocuments ?? {}).flat()) {
    const repository = document.slice(0, document.indexOf(':'));
    if (!project.repos.includes(repository))
      throw new Error(`Spec document repository is not configured: ${repository}`);
  }
  return {
    project,
    root: resolve(root ?? dirname(file)),
    config: file,
  };
}
