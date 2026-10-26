# The work map's read models

Two JSON files, written by `src/cli/generate.ts` and typed in `src/core/contract.ts`. Other tools can read them as they are. Both are read models: nothing in them is a decision or an instruction.

| File            | Schema              | Refreshed        | Source                                                                                                                  |
| --------------- | ------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `snapshot.json` | `work-map/4`        | every 5 minutes  | the roadmap's tables, plus GitHub (merged PRs, and switch-on issues by `switchOnTitle`, on the configured product repo) |
| `agents.json`   | `work-map-agents/2` | every 45 seconds | round context and Seat Gauge's read-only version 1 publication                                                          |

## snapshot.json, the map read model

- **The map** (`id`, `type: "map"`, `title`, `destination`): the whole planned build. The destination is every planned unit coded and switched on.
- **Sections** (`stages[]`, then each stage's `nodes[]`): the diagram's stages and boxes, in the diagram's order (`row`).
- **Tickets** (each box's `units[]`, then each unit's `tickets[]`): the plan's units and their tickets, from the plan file. Each ticket lists its PR numbers. `prs` holds every merged PR once, keyed by number.
- **Frontier** (`frontier[]`): the units where merged, mapped work moved since the audit, the most first.
- **Fog** (`fog[]`, `{ id, text }`): what the snapshot cannot place, in plain words. This covers PRs that name no ticket, switch-on issues with no approved unit, and table warnings.
- **Display** (`display`, `{ timeZone, locale }`): the IANA zone and the locale every time on the screen is shown in, whoever views it: `project.json`'s `timeZone` and `locale`, else the zone of the machine that made the snapshot and `en-AU`. A snapshot without it, or a zone or locale the browser can't use, falls back field by field to UTC+10 (`Etc/GMT-10`) and `en-AU`. The merge chart's hour bars are that zone's clock hours.

### The numbers, at every level (stage, box, unit; totals)

Each level carries `Measures`, and the numbers are never blended:

- `coded`: `{ pct, low, high }`, the audit's code share weighted by estimate-days. The live view never overwrites the audit.
- `on`: `{ pct, switchOnsClosed, switchOnsOpen }`. `pct` is the audit's live share (a unit's code counts in full when live is yes, half when partly). The counts are switch-on issues mapped to these units in `mapping.json`.
- `reviewed`: always an empty object, still written for older screens; the screen no longer requires it. The UI uses `work.review` for review coverage.
- `sinceAudit`: `{ merged, prs }`. Placed PRs merged after the audit's time (`sources.audit.at`).
- `estimate`: `{ pct, source, at, reason }`, the **live estimate**, which moves between audits. It is always shown beside the audit's `coded` and flagged with an asterisk. Per unit, it takes the first of these that applies:
  1. **`sol`:** a stored re-estimate of the unit's box (`estimates.json`), when it is newer than the audit. The file is read as it is; nothing writes it. A re-estimate never puts a unit below its audit figure.
  2. **`tickets`:** the share of the unit's tickets that a merged PR names as complete (`Ticket: C80 complete`), when that is above the audit.
  3. **`audit`:** the audit itself.

  Boxes, stages and totals weight units by estimate-days, as the audit does. The audit's `coded` moves only when the audit is re-run; `estimate` is what moves the bars between audits (the lighter amber).

- `inferredPrs`: how many of the PRs counted here were placed by inference (`inferred.json`), not stated.

Percentages are exact; round them only to show them. `sinceAudit` counts stated and inferred PRs alike.

### How a PR is placed (`prs[n].class`, `links[].via`)

A PR is `mapped` when it states its unit or ticket, in this order of trust:

1. `backfill`: an approved entry in `mapping.json`.
2. `declared`: a `Ticket:` or `Unit:` line (see `CONVENTION.md`).
3. `title`: an ID in the title or branch.
4. `roadmap`: a link to a unit issue the plan cites.

A PR is `outside` when it says `Ticket: none`. `candidates` lists IDs that appear only in the body's prose. They are shown and never counted as stated.

A PR that states nothing keeps any placement it has in `inferred.json`: class `inferred`, with `inferred: { box, unit, via, confidence, reason, at }`. A box of `outside` classes the PR as outside the plan. `via` records how it was placed (`section`, `issue`, `section-map`, `lane`, `lane-name`, `luna` or `sol`). The file is read as it is; nothing writes it. So a merged PR that states nothing and is not in it stays unmapped.

`sweep` keeps its shape for older screens: the count of inferred PRs, their count by `via`, and the count of kept estimates. `sweep.gaps` is always null. Changed files that no box owns in the section map are counted as **map gaps** by Sync (`map-gaps.json`, published as `snapshot.mapGaps`). Its `filesSeen`, `prsWithGaps` and `topGapFolders` are written with fixed values; only `gapFiles` is a real count.

### Sources

`sources` records where every number came from:

- the audit's `asAt`, read as a time (a prose time is read as AEST, UTC+10);
- the roadmap commit;
- GitHub's watermarks and the last run's log: calls, cost, remaining limit, and skipped or partial;
- the `mapping.json` counts, approved and pending.

### Merge queue (`stats`)

- `at`: the time of the last GitHub read that finished. A read that stops part-way keeps the previous `at`, `queued` and `queueEntries`; only a first read, with nothing earlier to keep, stores what its first page found.
- `queued`: the merge queue's length, or null.
- `queueEntries` (optional): the queue's first entries at the last good read, each with `position`, `number`, `title`, `url` and `enqueuedAt`.

The UI works out twelve rolling hourly buckets from `prs[].mergedAt` at `stats.at`. `PrView` has no per-PR switch-on evidence, so those bars do not claim live status. GitHub's queued figure is a queue count; agents do not have a merging phase.

## Manual local refresh

POST /sync has no arguments or body. It needs the exact loopback Host and Origin, `X-Work-Map-Sync: 1` and `Content-Type: application/json`; there is no CORS grant. The server owns the fixed argv for the GitHub collector (`github --sync`: the merge panel, the cards that changed, map gaps and site versions) and then the agents collector. It joins concurrent requests and bounds each child process group.

It returns complete only for fresh, complete primary and planning publications and a fresh round-context publication. An explicit pending Seat Gauge status is not a GitHub failure, and a zero exit alone is not enough. It does not pull checkout revisions.

The canonical `generate.ts` entry holds a shared `checkout.lockf`, then an exclusive `snapshot.lockf` (GitHub and snapshot) or `agents.lockf`. Scheduled GitHub preparation holds an exclusive `checkout.lockf` for its pulls and build, releases it, then calls `generate.ts`. Atomic rename protects readers. There is no transaction across both JSON models.

GitHub, agents and snapshot publication wait up to 120 seconds for each lock. If a lock wait expires, the process exits with code 75 and does not retry.

## agents.json

`lanes[]` keeps round milestone and placement context in the compatibility shape. The runtime publishes `state: unknown`, no workspace or pane, and the legacy `herdr` field as `{ ok: false, error: <fixed pending reason> }`. `agentSource` carries `state: pending` and the same fixed Seat Gauge reason. These fields cannot establish current activity, start or stop observations, or cost.

The collector never queries a terminal or pane tool, and never reads processes or session logs. Round events and exact task briefs stay available for planning placement. The optional `seatGauge` report gives separately qualified current session evidence; old round lanes do not become current observations.

## Project context and section work

The server serves an optional local `maps.json` from the data folder, read-only, for navigation. It has one to twenty strict `{id, title, url}` entries with unique IDs and URLs. URLs are root-only HTTP addresses on explicit `127.0.0.1` ports. The browser finds the active link by `snapshot.id`, rejects an invalid list whole, and falls back to its ordinary heading when the file is absent or the read fails. Navigation does not change project configuration, collector state or Sync destinations. Sections without approved weighted units have pending scope even with no open PRs.

The tool loads `project.json` from the project's roadmap repo. File paths are relative to that repo. The config carries its id, window title, repos to read, file names, ticket labels, spec naming, lane prefix and lane naming rules, and optionally the time zone (`timeZone`, an IANA name; default the machine's zone) and locale (`locale`; default `en-AU`) the map is shown in. `section-map.json` and approved PR mappings belong to the same project repo.

`snapshot.work` carries the time of the last successful planning read, a completeness flag and an error. Complete means the read finished without error; an item GitHub cut short does not clear it. A failed read keeps the previous data with its time, completeness and error, and records the failure in `lastFailure`. Only a cache that was never read completely takes the failure as its error and stays incomplete. Each section in `work.byNode` carries:

- `state`, the presence of open PR work, otherwise merged work, live work or planned work. This summarises mixed work; it does not claim the whole section is complete.
- `shares`: four exclusive full-scope percentages (`live`, `merged`, `built`, `planned`) that add to 100. Live is the audit's switched-on coded share; merged is the current merged-code estimate less live. Built is unique incremental unmerged feature scope, estimated jointly over all placed open PRs and capped at each unit's remaining scope. Planned is the exact remainder. A large repair can add zero new planned scope.
- `scope`: exact `shares`, jointly rounded integer `display` shares that also add to 100, `estimated`, `pending`, `at` and `reason`. Units use their estimate-day scope weights. With no estimate, open scope stays pending and the remainder includes that unknown work; it is never inferred from PR counts.
- `review`: coverage of tracked merged and open PRs, repairs included, weighted by additions + deletions. This is a changed-line proxy (non-code files included), not coverage of the source that remains. It carries `denominator`, `pct`, `reviewedLines`, `totalLines`, `complete` and linked `prs`. Missing diff sizes or incomplete collection make `pct` null. Zero total changes also has no percentage.
- `openPrs`, repo-qualified PR keys, links and inferred-placement flags. A PR's Section line wins over ticket and parent-map placement. After declared units, a section-map entry for the PR's own repository-qualified key takes precedence over linked issues and inferred fallbacks. This lookup does not override `Ticket: none`; unknown sections are ignored, and an `outside` mapping leaves the PR out of section coverage.
- `planning`, GitHub links for idea, map, tickets, spec and build. A map carries the idea through its destination. Parent maps and related spec issues add context. Specs are left out of the ticket count. Open and merged PRs give build evidence.
- `missing`, planning steps absent from the read, and `context` when the read is incomplete, an issue on the section had its context cut short, or one of the section's open or merged PRs had its closing references cut short.
- `blockers`, open native dependencies and known open issue dependencies named in a Blocked by section. A dependency's latest issue state wins over an older parent record.

Native blocker arrows run from the prerequisite section to the section that waits. They appear while the waiting section is hovered or pinned by a click. Dense native blocker connections stay straight; permanent configured routes use rounded stage channels. Their label badges sit in the foreground while either end is inspected. Hover shows connections; a click or Enter opens pinned details, and a click outside or Escape closes them.

Card tone uses the exact live share strictly above 90%. Scope segments show pointer or focus help at once when their labels cannot fit. The project can also name diagram dependencies, such as Docs waiting for Agent work. Those configured arrows have their own labels, apart from native blockers.

GitHub issue reads span all configured repos and keep a watermark per repository, with a ten-minute overlap. A newly configured repository gets a full first read. Open PRs are read fresh, so a merged or closed PR drops out of built work. Lane evidence can place an open PR, marked inferred; `work.unplacedPrs` reports the rest in the stats strip.

With `progress.notPlaced: "sections"`, `work.offMap` adds two lists. `prs` is every open and merged PR no section places, each with its `state`, leaving out PRs declared outside the plan. `unreadLabels` is the keys of tickets and questions on no section whose labels were cut short where `bugLabels` or `skipLabels` decide a ticket's kind. The header then shows tickets (`ticketProgress.unplaced`), these PRs and map gaps apart, with no plan-unit count. Each count is pending until its own evidence is current: the ticket count while any `unreadLabels` remain, the PR count until `work.at` is read and not in the future. Without the setting the field is absent and the header keeps its one figure.

Both readers keep a reserve of at least 1,000 GitHub calls. An item GitHub cuts short is marked on the item itself: an issue's `contextComplete`, a PR's `labelsComplete`, `reviewsComplete` or `closingComplete`. The work cache's `truncated` flag says some stored item was cut short; it is worked out from the stored items at every write, after a failed read too. A cache written before `truncated` and `closingComplete` existed reads as not cut short.

### Open-scope estimates and review evidence

`open-scope-estimates.json` is separate from merged-work estimates. Each section record has `at`, `model`, `evidence`, `reason` and `units[id]: { built, reason }` (percent of that full unit). A SHA-256 digest binds it to PR keys, current head SHA, title, body, branch, diff sizes and issue references, plus section text, unit titles, weights, baseline and audit rationale. Changed evidence invalidates it at once. The file is read as it is; nothing writes it. A kept record counts only while its digest still matches. Each increment is clamped between zero and the unit's residual scope and never raises merged code.

`work-cache.json` version 2 reads merged history across every configured repository with separate per-repo updated-at watermarks and a ten-minute overlap. A v1 cache is backfilled for merged metadata. New repos get full history, removed repos are filtered out, and open PRs are read fresh. PR metadata includes current head SHA, diff additions and deletions, labels and their completeness, latest writer reviews and their completeness, closing issue references and their completeness, and the last 100 issue comments and their completeness. Missing historical metadata stays unknown.

A PR is reviewed when a complete current-head GitHub writer approval exists without outstanding review-debt labels, negative opinions or hidden comment context, or when an accepted current-head attributed receipt records approval. The review-debt labels are the project's `reviewDebtLabels`, by default `needs-sol`, `unreviewed` and `needs-second-model`. Unknown and unmarked work counts as unreviewed. Removing a review-debt label alone never proves review. `marked` (the PR carries a review-debt label) is independent of reviewed status: a stale label can stay after a recorded PASS, and that PR appears in both lists.

A project may declare `reviewReceiptAuthors` (defaults to no trusted authors). Only comments GitHub attributes to those logins can supply receipts. An accepted receipt ends in five consecutive, unquoted lines: `Reviewer: <nonempty>`, `Model: <nonempty>`, `Head SHA: <40 lowercase hex>`, `Verdict: approve`, `Code review: no findings`.

A negative receipt needs the attributed Reviewer, Model and exact Head SHA lines followed by `Verdict: changes requested`. It may include a Scope line before the verdict and structured Code review, Findings, Coverage or Scope lines after it. This accepts a later area HOLD conservatively without widening the strict positive footer.

The latest created-or-edited matching current-head receipt wins (negative wins ties); a later negative defeats an earlier approval and a formal approval. Stale-head, untrusted-author, mismatched and prose-only claims do not count. Quote and wrapper checks gate positive receipts only: a recognised trusted exact-head structured negative blocks approval even when its surrounding context is ambiguous, fenced, wrapped or lazily quoted.

Positive receipt approval and formal approval both need complete comment history, because an older comment edited after a visible PASS may lie outside the last-100 creation-time window. Truncated history keeps visible receipts and markers but leaves the PR unreviewed with an incomplete-history reason. For positive receipts, unclosed code fences are rejected using the matching marker and opening length; a different marker, a shorter run or an info-string line cannot close a fence. Lazy blockquote continuations and unclosed details, blockquote, pre or code HTML wrappers are also rejected for positive receipts. A receipt establishes attribution; it does not verify the stated model's identity.

## Optional served versions

`versions.json` has schema `work-map-versions/1` and is published atomically under the GitHub collector's snapshot lock. Its repository is the configured product repository. `checkedAt` is when the observation started, and `main` is the full revision pinned before comparison, or null when unavailable. Each configured site carries its name, origin, public artefact URL, reported build, resolved full SHA, `current` or `pending` state, nullable unique merged-PR distance, reason and optional dated `lastKnown` observation. A current row needs a clean build, matching page evidence, a resolved ancestor and complete PR association evidence. An invalid configuration publishes a separate error with no current rows. A site whose own check fails is pending with its reason while the other sites are still compared. When the whole read fails instead (the rate limit or `main`'s revision cannot be read, or the version step throws), the previous publication's sites, if any and for the same repository, are kept as pending, with `main: null`, their dated `lastKnown` and a pending reason on each row and at the top. No configured sites means the feature is off.

The browser treats failed refreshes, and successful observations older than ten minutes, as stale, and hides current-distance claims in both cases. The read model does not change approved progress, review percentages, lane state or merge telemetry. Runtime `versions.config.json` is project-owned and never served to the browser. Public origins and artefact or page identifiers stay out of tool code.

Sync returns `versionsRequired`, worked out from the configured data directory (whether `versions.config.json` exists). When sites are configured, Sync checks for a schema-valid version publication, checked since that Sync began, with no error and every site current. A fault is a warning, not a reason for an incomplete Sync. When the version file is valid, complete responses include its `versionsAt` watermark, and the browser shows a version warning unless its own version read is at least that fresh. When collection is off, no version watermark is needed. A malformed earlier version file cannot block ordinary map publication or a fresh version collection.

## GitHub loading bay

Optional `snapshot.loadingBay` has schema `work-map-loading-bay/1`, nullable `githubAt`, nullable project-owned `readyLabel`, `complete`, `reason` and `prs`. Each PR has `key`, `url`, `title`, `checkedAt`, history completeness, status (`opened`, `ready`, `queued`, `merged`, `dropped` or `pending`), reason, and dated lifecycle events with stable IDs and queue-removal reasons. Publication and browser validation drop old description fields without affecting lifecycle evidence.

The work collector reads bounded timeline items inside its PR pages, across open, merged and closed histories. PR pages hold 25 records, timeline reads hold at most 100 events, and the whole collection stops after 300 pages or at the 1,000-call reserve. Truncated lifecycle history does not make a complete loading bay. Failed reads keep the previous observation dates and mark lifecycle evidence incomplete. The first cache migration backfills lifecycle history; later terminal reads use repository watermarks with the ten-minute overlap. There is no separate GitHub call per PR.

Ready comes only from the optional `ledgerPrReadyLabel`, never the issue-ready label, review approval or a guessed milestone. Without that config, readiness is unavailable. A PR closed without merge is pending with a reason, not an inferred queue removal. The browser treats failed reads and future observations as pending, and keeps dated history; older data stands with its time until the next Sync. Malformed optional loading-bay data is dropped without affecting ordinary map evidence.

The browser states "Change descriptions pending follow-up." Description parsing, field display and gap markers are not built. PR bodies are still collected for ordinary mapping and scope evidence. The loading bay cannot enqueue, merge, close a ticket or change progress. Seat Gauge session evidence is qualified separately from loading-bay health.

## Optional ticket completion progress

`project.progress` is a strict union of the `estimated-scope` variant and `{basis: "ticket-count", repositories: Record<configuredRepository, sectionId>, issues?: Record<qualifiedIssueKey, sectionId | "outside">, bugLabels?: string[], skipLabels?: string[], notPlaced?: "sections", placement?: Record<configuredRepository, {labels?: Record<label, sectionId>, titlePrefixes?: Record<prefix, sectionId>}>, unitAudit?: {file, unitPattern, recheck?: {enabled, dailyCalls = 20, confidence = 0.6, deepCalls = 40}}, recheck?: {enabled, dailyCalls = 20, confidence = 0.6, deepCalls = 40}}`.

The `estimated-scope` variant is retired: it is still accepted, but the collector no longer compiles it, so such a map shows the ordinary scope bar. A map without `unitAudit` is scored by section. Ticket counting and the unit estimate are layers of one config, not modes: `unitAudit` adds weights, built and live to the ticket census.

`recheck` sits at the progress level, or under `unitAudit.recheck` on a map with units; setting both is refused. It is still accepted so existing configs load. Only its `confidence` is read: the floor a stored score needs to stand. `enabled`, `dailyCalls` and `deepCalls` do nothing.

A placement label or title prefix must name a diagram section (or `outside`); `readProject` refuses any other when the flow file can be read. A label ending in `*` matches by prefix (`severity:*`).

A card with any bug label is a **bug card**: it counts in `bugs` (the open-bugs count), never in Progress or Tickets. Otherwise a card with any skip label is a **question** (grilling, research, prototype): it counts nowhere and is listed in `skipped`. Every other card is a **work card** and counts in Progress. Both lists belong to the project's config; with neither, every card is work. Destinations must exist in the diagram, keys must name configured repositories, and repository defaults cannot be `outside`. Defaults need not cover every repository. All project-specific ownership stays in this config and the roadmap evidence.

Ticket snapshots add `progressBasis: "ticket-count"` and `ticketProgress` with schema `work-map-ticket-progress/3` (readers still accept version 2 and read it as version 3 with its counts recomputed). The projection carries `at`, `complete`, `reason`, `byNode` and `totals` (work cards), `bugs: {byNode, totals}` (bug cards, same count shape), `skipped` (questions), `unplaced` and `outside` (work and bug cards), and explicitly configured `missing` keys. `bugs` and `skipped` are optional for readers of older snapshots.

Each count has `completed`, `total`, `absorbed`, `dropped`, `unknown`, `audited`, exact nullable `pct` and linked `tickets`. A ticket closed as not planned or as a duplicate follows the parent it was absorbed into and counts by that parent's state (`absorbed`). With no parent it is `dropped` and left out of `total`. Each ticket keeps its qualified key, title, issue URL, GitHub state and closure reason, section and mapping provenance. Only `CLOSED` plus `COMPLETED` earns completion credit, except as unit scores below. Each ticket keeps GitHub's `closedAt`.

### Unit scores

With `unitAudit` configured, every counted work card carries `share: {unit, weight, built, live, by, at}`. Its unit is the pattern's first group on its own title, or on the title of the parent it was absorbed into.

A unit's score starts from the repository-relative audit file (`asAt`, `units.<id>.code`, `days`, `live`): built is `code`, live is `code` when live is `yes`, half of it when `partly`, 0 when `no`. The local store `unit-scores.json` in the data folder (`work-map-unit-scores/1`, never committed) holds stored score entries per unit (`built`, `live`, `confidence`, `reason`, ISO `at`, optional `drop`, optional `by`). The file is read as it is; nothing writes it. An entry replaces the standing score only when it is newer, at least `recheck.confidence` (default 0.6) confident, live is not above built, and neither share drops unless `drop` says why. The share's `by` then takes the entry's `by` (`luna` when absent, or `deep`).

A unit's audit days are split evenly over its counted cards. A card in no audited unit (loose, or in a unit the audit lacks) weighs the map's average days per audited-unit card and has built and live 0. A done card counts fully built; an open card counts its unit's built share. Live per card is the unit's live, never above the card's built.

Each count adds `weight`, weighted `built` and `live`, `livePct`, and the weighted built that open cards take from the audit (`fromAudit`) and from stored scores (`fromLuna`); `pct` is built / weight. `audited` is the unweighted sum of open cards' built shares, as hovers word it.

### Section scores

A map without `unitAudit` that sets `progress.recheck` keeps one score per section in the same store, keyed `section:<id>`, under the same rules from nothing (built 0, live 0). An entry's optional `by` is `luna` (the default) or `deep`, and the share carries it. Each work card in a section with a standing score carries `share: {unit: "section:<id>", weight: 1, built, live, by, at}`, so stages and the header weigh sections by counted cards.

A closed card counts fully built, so open cards take what the score adds above them: the section's built share is the higher of its score and its ticket count. The score's live is spread over the cards so the section's live is the score's, never above a card's built; closed and open cards of one section may carry different shares. `fromLuna` counts `luna` and `deep` shares. A section with no score carries no shares, so its live is unknown; in a stage or the header its cards add no live.

### Counting rules

A map with neither carries no shares: `live` and `livePct` are null (unknown) and `pct` is (completed + audited) / total. A missing or invalid audit file earns nothing; A ticket closed as not planned or as a duplicate with no parent is dropped, so it is left out of `total`. Closed older records without a reason stay unknown. Every issue, specs and umbrella issues included, counts once. Pull requests never enter this inventory.

Unknown closure reasons, an incomplete census or a configured override missing from the census leave the affected percentages pending. A card no section owns is listed in `unplaced` ("not on the map") and does not hold the placed sections' percentages pending. With label lists configured, a placed card whose labels GitHub cut short (incomplete context) may carry an unread bug or skip label. Its section is then listed in `pendingSections`, and that section's counts and the map totals carry no percentage until a full read; other sections stay current. Empty inventories have no percentage.

### Ticket placement

Placement first honours an explicit progress override, then direct Section, declared, title or section-map evidence, then plan tracker references, parent ancestry and finally the issue's own repository default.

A card still unplaced follows the merged PRs that closed it. These are GitHub's closing links plus every ticket in the body's closing lists, code excluded. A list may use a serial comma (`#1, #2, and #3`) and never runs on into the next list item or block. Each closing PR is placed by the PR rules against the sections the maps decided. A ticket whose only closing PRs are outside is outside. PRs that disagree, outside against a section included, leave it unplaced and say so in its mapping.

Then its repository's `placement` rule applies: a label first, then the title prefix (the text before the first colon, any case). Otherwise it stays in `unplaced`. A bug card placed this way still counts in `bugs`.

Parent traversal detects cycles and does not inherit another repository's default. An outside disposition is final unless the child has stronger direct ownership. Overrides disclose conflicting direct evidence. In ticket mode the same ownership drives issue-based planning, blockers and linked-PR placement; an explicit PR Section, unit or own-key mapping still takes precedence.

### Issue census

`work-cache.json` keeps an optional `issueCensus: {at, complete, error, repositories?}`, separate from PR metadata completeness. Each repository entry has `through` (the incremental watermark) and `fullAt` (the last successful full census). Ticket mode merges issues updated since `through`, with the ten-minute overlap. It stages a full replacement for a repository with missing or invalid timestamps, a new repository, an incomplete earlier census, or a full census at least 24 hours old. That age test applies only to a full read: Sync's changed-only read keeps reading the census incrementally, so the census itself drops no deleted or transferred issue. Configured spec members are the exception: when a read checks them one by one, a member GitHub no longer returns is removed from the cache, whatever the read's scope.

Only a successful full read removes deleted or transferred issues. Incremental reads advance `through` without moving `fullAt`. All repositories must finish before the staged dictionary and watermarks replace the old census. Old caches are not promoted into this marker. A failed issue read keeps the previous dictionary and observation time. A census that was complete stays complete; one that was not stays incomplete. A partial dictionary is never published as current. A later PR failure can keep a fresh census that completed on its own. Other progress modes keep incremental issue reads. The issue reader keeps `stateReason` and `updatedAt`. The usual locks, reserve and page bounds apply.

### Checks and display

The browser and the server's Sync check (one function) recompute every count, weights and live included, from the stored tickets. They reject a share on a bug, a dropped card or a version 2 snapshot, an `audit` field on version 3, live above built, two cards of one unit with different scores (a section's closed and open cards are compared apart), and a section share on a card of another section. They also check count conservation, qualified identities, section ownership and aggregate membership.

The map stays in ticket mode if the optional data is absent or invalid, and shows pending instead of scope shares. Future observations and failed browser reads cannot show a current percentage; an older complete census keeps its percentages between Syncs and the header shows its age. Stage and map ratios use unique issue counts, including when some child sections have no tickets; those empty sections are listed separately. A ticket card turns live (`live90`) past 90% live; with live unknown (no unit audit), past 90% built. Fixed bugs never colour a card. The UI shows linked numerator and denominator details, cancellation, unknown closure, mapping exceptions and source time; copied section context includes ticket provenance and the same scope caveat.

The header's Sync is the only Sync. It reuses the guarded no-body `/sync` and the ordinary collectors and refreshes the whole shared inventory. Completion checks the refreshed issue watermark and the totals. Round-context requirements are separate. A site version fault (a configured version read that is missing, failed, old or not current) is returned in the reply's `warnings` and shown on the Sync line as a warning. It does not make Sync incomplete. There is no additional endpoint, crawler or credential. Scope shares and Review keep their meaning.

What one Sync does in the browser is the plain function `runSync` (`src/web/sync-run.ts`), with its fetcher and data reads passed in.

## Cards, stages and the header

One module, `src/web/meters.ts`, decides what a card, a stage and the project header show; the components only draw it. A map with a ticket census (`ticketCountMap`) shows three bars:

- **Progress:** one bar in three shades: live (solid), built not live (lighter) and to do. These are the count's `livePct` and `pct`, weighted by unit size. The hover reads, for example, "Live 28% · Built 43% · 57% to go · 12% from the audit", followed by the share from stored re-check scores when there is one. With live unknown, the bar is built and to do, and the hover says "Live unknown".
- **Tickets:** build (work) cards done against left ("9 done · 30 left"), with absorbed, dropped and unknown closures on the hover. Bugs and questions are never in it.
- **Review:** the section's review coverage (`work.review`).

A card's footer counts open PRs, blockers and open bugs (the hover gives the fixed count). The header shows open and fixed bugs beside the momentum line. Under the bars, the **momentum** line reads "+N tickets this week" (build cards closed in the last 7 days, by `closedAt`). With none, it reads "nothing moved in N days", counting from the latest close or the latest merge of a PR listed as the scope's build work. There is no Bugs bar.

A scope map (no ticket census) keeps the scope Progress and Review bars with no Tickets bar, counts or momentum. Any census that is not current, or a held section, shows the Progress and Tickets bars pending and drops the open-bugs count.

## Spec built state from ticket closure

Optional `project.json.specMembership` is an explicit project-owned array of sections. Each section has `section` (a diagram node ID), `complete` (the whole section spec set is mapped), and `specs`. Each spec has a repo-qualified issue `key`, `complete` (its whole ticket set is mapped), and `tickets`, an array of repo-qualified issue keys. For example:

```json
{
  "specMembership": [
    {
      "section": "task-work",
      "complete": true,
      "specs": [
        {
          "key": "example-org/roadmap#10",
          "complete": true,
          "tickets": ["example-org/example-app#20", "example-org/example-app#21"]
        }
      ]
    }
  ]
}
```

The repositories must be in `repos`. Section and spec keys must be unique; ticket keys must be unique within a spec, and cannot name another configured spec. GitHub issue identity checks ignore repository-name case, including for duplicates and spec references. At most 200 distinct issue keys (specs plus tickets) are supported. A ticket may support more than one spec: rollups count specs, never duplicated ticket effort. No title, prose, PR count or inferred placement establishes membership. Missing configuration and empty sets stay pending. Each owner section uses its own diagram ID; no project-specific sections live in the tool.

`snapshot.work.specProgress` has source `github-ticket-closure`, the original GitHub collection time `at`, a reason, per-spec evidence, and `bySection` counts (`total`, `built`, `pending`, `pct`). A spec is built only when its section and ticket membership are complete and non-empty, its source spec exists, and every mapped ticket has qualified `CLOSED` evidence. An open ticket makes it open; absent, unknown or incomplete evidence makes it pending. Reopening a ticket removes the built state on the next complete read. Incomplete section membership makes its specs pending. Unknown sections or repositories, or invalid membership, produce no built results. A section's percentage is the share of its configured specs that are built; any pending spec, incomplete section or empty section makes the percentage null.

The read-only GitHub collector rechecks configured issue keys one by one, within its 300-page and 1,000-call reserve limits. This stops a deleted or transferred issue staying closed in the incremental cache forever. A failed collection keeps its original date and marks it incomplete. Nothing auto-closes issues: GitHub's native `Closes #n` handles closure.

Both publication and display need complete, error-free evidence with no future timestamp; between Syncs the last complete read stands. A failed browser reload makes closure progress pending; the section details keep dated observations. The card and copied details show source and age. This deterministic count is separate from approved scope shares: **built from ticket closure does not establish merged, deployed or live**. Scope weights, schedules and endpoints are unchanged. Project owners must fill in membership in their roadmap configuration; configurations without it stay pending rather than gaining guessed mappings.

## Spec documents

Optional `project.json.specDocuments` maps a diagram node ID to spec documents, each `owner/repo:path`, for example `{ "dst": ["example-org/design-system:docs/SPEC.md"] }`. The repository must be in `repos`; the path is relative, without `..`, in letters, digits, spaces and `._/-`. The collector confirms each document on its repository's default branch, with one GraphQL query per repository within the usual reserve and page limits, and keeps `work-cache.json.specDocuments` keyed by `owner/repo:path` as `{found, url, at}`. A failed read keeps the last confirmation.

A found document ticks the section's spec step and links to the file; a missing or unchecked one is no evidence, so without a spec issue the step shows ×. `snapshot.work.byNode.<id>.specDocuments` lists each configured document with `found` (null until checked). The spec step's tooltip and the section details list spec issues apart from spec documents. A spec document does not count toward spec ticket closure.

## Seat Gauge publication

The producer contract is version 1, as Seat Gauge's `docs/session-log.md` describes it at commit `4e796bb2fc5be66a010d3ef65bdf687ecd7e8134`. Only the fixed Application Support `log.json` is read. A nonblocking no-follow descriptor must be a regular file of at most 4,000,000 bytes; bounded reads and before-and-after size and time checks reject in-place changes. Failures never write the producer file or expose its diagnostic messages.

`agents.seatGauge` is `work-map-seat-gauge/1`, with `project`, original publication `at`, consumer `readAt`, `githubAt`, `state`, `reason`, `unmapped` count and `sessions`. Unmapped sessions publish no identity, timestamps or usage. Each mapped row has tuple `id`, allowlisted `source`, mapped `repository`, exact diagram `section`, qualified `prs` and `tickets`, nullable `elapsedSeconds`, `state` and `reason`. Unknown source fields, per-model details and problem messages are not republished. Omitted optional metadata and usage stay null. Token counters stay separate; thinking is a subset of output.

Both the publication and each row observation must be no older than 90 seconds and not future-dated. Row chronology must be coherent, and the machine must have no reported problem. A failed file read keeps the original publication and observation dates with pending state; browser expiry or failed polling also marks the report and its rows pending. A card's open-session pills come from the last publication for up to 15 minutes, so they stay through a late or failed read. A card with no open session shows the last session that closed there, dimmed, with no time limit. A report for another project is dropped. After a failed producer read, kept rows must still match the project's current mapping. The browser schedules an expiry render at the earliest evidence deadline, separately from polling.

### Placing sessions

A row's optional `repository` is the producer's GitHub `owner/name` for the session's remote. When it matches `owner/name` (letters, digits and `-` for the owner; letters, digits and `._-` for the name), it decides the session's repository, compared without case and published in the project's spelling. A named repository outside `repos` makes the row anonymous, whatever its label or workspace says. Any other value, including a non-string, reads as null, so an older or faulty producer never fails the whole file over it.

`seatGauge.repositories` maps exact producer labels to configured GitHub repositories, for rows with no `repository`. Repository comparison ignores case; branches match exactly. Complete, error-free project work evidence (its last read, of any age) must contain an open PR with matching `headRepository` and `headRefName`, or the branch must name a placed ticket. Cached PRs without a head repository stay pending.

Optional `seatGauge.branchTicket` is a branch pattern whose first capture group is a ticket number in the session's mapped repository. For example, `^[a-z]+/([1-9][0-9]*)-` reads `kt/42-basket-badge` as #42. A pattern without a capture group is rejected.

The session's section is its open PR's placement on the map, else its branch ticket's section, else a producer section that exactly names a configured diagram node. Placements come from this project's `snapshot.json` and its last work read. Nothing else infers a repository, ticket or usage allocation. Ticket links are the branch ticket when it is placed, plus closing-issue references limited to configured repositories. A working placed session spins its card's build step.

Optional `seatGauge.workspace` is `{ pattern, repository }`: the pattern's first capture group is a PR or ticket number in `repository`, read from the session's workspace name. A workspace number that is an open PR in the work evidence joins the session's PRs; otherwise it stands in for a branch ticket. A row with no valid `repository` whose repository label is not mapped takes the workspace rule's repository when the pattern matches. With no `seatGauge.workspace` rule, a workspace label that carries a ticket number before its seat (`LBL-Fix-27-Seat`) is read as repository label `LBL`, section `Fix` and ticket #27 in the session's repository, where Seat Gauge's split from the right would give repository label `LBL-Fix` and section `27`. The ticket is the first part after the first, and before the last, that is a number not starting with 0, optionally followed by one lower-case letter, which is ignored. When the label starts with a mapped repository label, the search starts after that label's own parts, so `SITE-2-Fix-27-Seat` under a mapped `SITE-2` reads #27. A label with no such part, or with an empty part before it, keeps Seat Gauge's repository label and section. With a `workspace` rule, that rule alone reads numbers from labels, and the repository label and section are Seat Gauge's. Under a `branchTicket` or `workspace` pattern, a session with no matching PR and no ticket placed on a section counts only toward the anonymous `unmapped` total, whatever the state of the placement evidence. The producer's `stale` flag describes token totals and does not affect a session's state.

Machine/session tuples are deduplicated once per inventory, even with several PR links. A duplicate whose repository mapping conflicts is counted anonymously. The header counts qualified working rows; other pending rows cannot hide that count. Conflicting duplicate observations become one pending row. Session totals can include earlier branches and never claim per-ticket effort or spend. `done` is turn completion; `closed_at` is required for closed or superseded status. Elapsed seconds use `closed_at` or `as_of` minus `started_at`, never the consumer clock; a missing start stays unknown. The optional report shares the usual publication and locking, adds no endpoint, schedule, model call or budget change, and cannot promote old round lanes to current evidence.

## Repository-specific build-ticket labels

Optional `ticketConventions.ticketLabelsByRepository` adds labels to the planning ticket step only for the named configured repository, for example `{ "example-org/seo": ["enhancement"] }`. The shared `readyLabel` and `ticketLabels` still apply everywhere. Repository comparison ignores case; unconfigured or duplicate case-insensitive keys are rejected. Specs stay specs even when they carry a ticket label. This does not change Progress classification, which counts work cards regardless of planning labels.

## Server restarts on a new tool commit

`serve.ts` reads the tool checkout's commit at start and every 30 seconds. When it moves (for example, the five-minute job pulled `main` with `WORK_MAP_SELF_UPDATE` on), the server closes and exits, and its keep-alive job starts it again on the new code, so new snapshot fields are never checked by an old server. An unreadable commit is never a change.
