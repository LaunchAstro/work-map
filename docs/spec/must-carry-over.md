# Must carry over

What the Rust engine keeps from the old TypeScript engine, the rule or edge case that matters in each, and which old test proves it, so a Rust test can prove the same case again. Resolves #6.

Inputs: the settled decisions in #3 (9 and 10 above all), the thermonuclear review (`docs/review/thermonuclear.md`, TN ids), the architecture review (`docs/review/architecture.md`, AR ids and the module map), the GitHub budget (`docs/spec/github-budget.md`, B ids), the app layout (`docs/spec/app-layout.md`, L ids), the shared Seat Gauge file (`docs/seat-gauge-file/README.md`), and the 64 ordinary test files in the private archive that touch kept code. The tests were read, not run: the archive has no installed dependencies. Retired features and the `sol*` proof files are left out, with two exceptions where a proof file is the only proof of a kept rule (MC-73, MC-74).

## How to read it

- Each kept behaviour has a stable id, `MC-01` to `MC-81`. Later tickets cite the id. If one turns out wrong, mark it withdrawn rather than renumber.
- Behaviours are grouped by the engine modules the architecture review names, then the server, then the kept React screen. Screen items stay TypeScript tests in `web/` (#10); everything else is a Rust test.
- "Old proof" names an archive test by what it checks, so a builder can find it in the archive and copy its cases. Where no old test exists, the item says so and names the case the new test must cover.
- Rust tests run on the recorded GitHub adapter, a fake clock and the Seat Gauge example files, as the review and the budget spec set out.
- A tag such as [Q1] marks an item built on a recommended default for a question still open on #2. If the maintainer answers differently, only the tagged items change.
- A mark such as (Q2), in round brackets, cites a question the maintainer settled on #2. A removed item keeps its id and says "Removed".
- The deliberate fixes at the end have `KD` ids. They seed the known-differences list the switch-over check uses.

## Defaults in force

- [Q1] The last scores and placements the retired re-checks and sweeps wrote are read once, read-only, as frozen inputs, each shown with its date.

## Settled in batch one

- (Q2) No PR placement from the build fleet's round logs. Agreed as recommended.
- (Q3) No "built but unmerged" share. The scope bar is live, merged and planned only, because an open PR already says what that share would have said. The maintainer chose this over the recommended default.
- (Q4) Switch-over passes a card that matches the old engine or differs only by a listed KD id. Agreed as recommended.
- (Q5) The served map listens on loopback only, with no network option in release one. The guide names two routes from another device: an SSH tunnel, and a mesh VPN whose client hands inbound connections to loopback.

## The answer in short

- 80 behaviours: 69 in the engine and server, 11 in the screen. MC-41 is removed (Q3).
- 43 deliberate fixes. 27 of them can move a number on a card or the header, and two more only the merge chart, so the parity check in #13 must name the KD id behind every difference (Q4).
- The engine comes to about 11,100 lines of Rust, tests aside: 56% of the 20,000-line target. The kept screen adds about 4,000 lines of TypeScript, so the whole app stays under the target too.

## `config`

**MC-01 The project config is checked whole at load.** Every destination a config names (repository defaults, issue overrides, label and title-prefix rules, spec documents, Seat Gauge labels) must be a diagram section or `outside`. Every repository it names must be configured, compared ignoring case. A repository default may not be `outside`. The progress settings must be one known variant with no mixing, and issue keys must read `owner/repo#n`. A spec document must name a configured repository and a plain relative path, so no `..`, no leading `/` and no quotes. A branch-ticket pattern must have a capture group. A failure refuses that project with a message naming the entry. The old engine checked some of this only at run time (KD-25). Behind it: TN-72, AR-10. Old proof: the ticket config tests, the spec-document config test, the Seat Gauge test that rejects a pattern with no capture group, and the ticket placement test that refuses a rule naming an unknown section or repository.

**MC-02 The plan table.** Unit rows are read only under the "Units by wave" heading, with notes stripped from ticket ids, and roadmap unit issue numbers map to their unit. A ticket listed in two units is refused, and every unit must sit in exactly one diagram section. Old proof: the plan-table tests in the core tests.

**MC-03 The diagram.** A section with no scope yet stays on the board as pending. A diagram entry that is not a section, such as an annotation, is dropped. Old proof: the core test that keeps explicit sections awaiting scope.

**MC-04 The unit audit.** Each unit has days, a code share from 0 to 1, a live answer of yes, partly or no, and the audit's date. A missing, broken or out-of-range file, or a path outside the project root, gives no audit rather than an error. The date is read one way (KD-26): an ISO time with an offset is exact, and a date alone means the end of that day in the project's configured zone. Behind it: TN-05, TN-72. Old proof: the unit audit reader tests, and the core test that reads the audit time and takes the end of the day when no time is given.

**MC-05 Frozen inputs [Q1].** Read once at load and never written: the score store's unit scores, section scores on maps without units, model unit estimates and source-finding holds on scope maps, and model placements of merged PRs. Each value keeps its date for the hover. A missing file means no frozen input, not an error. A unit's standing score is the store's newest accepted check over the audit: a newer check at or above the confidence floor replaces the audit; an older one, one under the floor, or a drop with no reason is refused; a drop that gives a reason stands, and later checks build on it. Behind it: AR question 1, TN-45, TN-55. Old proof: the unit score store tests in the weighted-progress tests, and the reader test that moves a section through store checks over the audit file.

## `github`

**MC-06 Answers that cannot be trusted are refused.** A GraphQL answer with partial errors, a cursor that does not move, a page that repeats an item, or an answer that arrives past its time limit fails that read, and nothing from it counts as complete. Behind it: AR-02, TN-62. Old proof: the map-gap tests that refuse cursor loops, duplicate paths and GraphQL partial errors and reject an over-deadline response, and the changed-card fallback when a cursor does not advance.

**MC-07 The budget floor stops a read before the call.** Every read checks the budget before each call and stops when the remainder is under the floor or unknown. It keeps what came and leaves its watermark where it was. The floors are B10 and B11 (30% and 20% of the reported limit, which is the old 1,500 and 1,000 at a 5,000 limit), and no setting can lower them. Behind it: TN-14, B10, B11. Old proof: the GitHub reader tests that never let the floor fall under 1,000 when asked for 1 or NaN, and that stop part-way and leave the watermark; the map-gap reserve tests at 1,000, 1,001, 1,099 and 1,100 (KD-35 covers the one case not carried).

**MC-08 Every call is logged with its cost.** A run that fails still logs every call it made, with the reader, cost and points left. Behind it: B3. Old proof: the reader test that logs every call of a failed run.

## `census`

**MC-09 The merge panel reads incrementally.** Merged PRs on the product repository, newest-updated first, 50 a page, stopping at the first PR updated before the watermark less ten minutes. The watermark is the newest `updatedAt` seen, GitHub's clock, and moves only when the list finished. The same query reads the merge queue's length and first 20 entries on the repository's default branch, not a hard-coded `main` (KD-22). Behind it: TN-15, TN-80, B5. Old proof: the GitHub reader tests (the first run reads everything page by page; the next reads only what changed since the watermark less ten minutes, in one call) and the timer refresh tests.

**MC-10 What each scope reads.** The timer reads the merge panel only, and the cards only when they were never read. Sync reads the panel, what changed, map gaps and site versions. A full read reads everything. When a merge is newer than the cards' last read, Sync reads the product repository in every kind, because GitHub's search index can lag a merge. Behind it: TN-16, B4 to B7. Old proof: the collector scope tests in the changed-card tests and the timer refresh tests.

**MC-11 Sync reads only what changed, and the result equals a full read.** One search per group of up to 15 repositories for issues and PRs updated since the oldest mark less ten minutes, at most three pages. More pages, a stuck cursor or an unknown PR state fall back to reading every repository incrementally. Only the repositories and kinds the search names are read again. A cached open PR leaves the list when the same run sees it merged or closed. The property that matters: an incremental read and a full read of the same history give the same census. Behind it: TN-16, B7. Old proof: the changed-card tests on both fixture projects, and the open-PR incremental test that spends fewer calls and still matches a full read.

**MC-12 Backstops.** The first Sync more than a day after the last all-repository read skips the search and reads every repository incrementally from that read less the overlap, not from "now" (KD-07). The first Sync more than seven days after the last full read reads everything, so deleted and transferred issues drop out (KD-32). Behind it: TN-36, B8. Old proof: the changed-card daily read test and the ticket collector test that reconciles deleted issues.

**MC-13 The issue census per repository.** Closure reasons, close times, parents, blockers, labels and the comments needed for absorption come from the same pages, with no extra calls. A newly configured repository is read in full while the others keep their own watermarks. Overlap updates and reopenings apply without losing older issues. A repository removed from the config drops out. Old proof: the ticket collector tests, the test that reads the absorption parent from the same census pages, and the all-repository merged history tests.

**MC-14 A failed read keeps the last good values.** A failed page keeps the census and its watermark. A finished issue census is kept when the PR part of the same run fails. Kept values keep their original read time, and the failure is recorded beside them. Behind it: TN-13, B13. Old proof: the ticket collector failure tests, the planning read failure tests in the version 3 tests, the changed-card light-floor test and the cards-keep-last tests.

**MC-15 A list cut short marks one item, not the read.** A PR with more than 100 labels, reviews, comments or closing links, or an issue with more than 100 labels or blockers, is marked on that item. The read stays complete, so later Syncs stay incremental (KD-08). The mark has effects: a PR whose labels or comments were not all read is not reviewed, and a section holding a placed card whose labels were cut short waits for a full read when bug or skip labels are configured. Behind it: TN-37. Old proof: the GitHub reader test that marks a PR whose labels were not all read, the core test that counts it as not reviewed, the scope test that marks truncated review data incomplete, and the ticket screen test that shows a held section as pending.

**MC-16 The first read finishes on any history.** A full read saves its progress per repository and kind and resumes on the next Sync. No shared page cap fails the whole read (KD-06). A slow full read that keeps making progress completes; only a call past its own time limit fails. Behind it: TN-35, TN-62. Old proof: the refresh-budget test that completes 116 reads in over ninety seconds. No old test covers a large history; the new one reads 7,600 merged PRs over several Syncs and ends complete.

**MC-17 Spec documents and spec members.** Each configured spec document is checked on its repository's default branch: found ticks the spec step, deleted shows a cross. Spec members are read again each Sync, so a deleted ticket cannot linger in the cache as closed. Old proof: the spec-document test and the spec-progress test that revalidates explicit members.

**MC-18 The PR file inventory.** Every file page is followed. A cached list is reused only while head and base are unchanged. Open PRs are always checked again. A merged PR's list is fixed once read in full (B9). A base change before the final check throws the list away, a head that moves during the read is refused, and the docs-only flag comes from the files. Behind it: TN-26, B9. Old proof: the map-gap inventory tests and the version 3 test that reads each PR's files into a docs-only flag.

**MC-19 Loading-bay events.** Lifecycle events carry ids and times. Repeated queue cycles and removal reasons are kept. An approval never makes a PR ready. A PR whose history was cut short is pending on its own. A drop is never inferred from a close. The head repository is the one GitHub reports, never the target. The read stops before history when the reserve is reached, and the last good history keeps its source dates. Behind it: TN-25. Old proof: the loading-bay ledger tests.

## `store`

**MC-20 One writer per data folder.** The old lock semantics stay: one writer per output, shared readers, a clear "busy" answer. They come from one process holding an OS lock on `instance.lock` (L15), not from Perl helpers (KD-03). Behind it: TN-58, AR-03. Old proof: the Sync test where kernel locks serialise publication and allow shared readers. Re-prove with L15's test.

**MC-21 Saves are atomic and a bad file never wedges the app.** Write to a temporary file, flush, rename. A file with an unknown schema version, or one that fails to parse, is logged and set aside, and the project reads in full. The old engine threw on every run after one corrupt cache file. Behind it: TN-72, AR-03. No old test; the new test plants a corrupt state file and expects a full read.

## `placement`

**MC-22 One reference grammar.** References are `#n`, `repo#n`, `owner/repo#n` and issue addresses, with a left word boundary, read through one Markdown-aware extractor shared by placement, closing, blockers and absorption. Code spans, code blocks, raw HTML, link text, link titles, reference labels, images and unused definitions never count; link destinations and reference definitions in use do. Pull request and comment addresses are not issue references. A roadmap reference must be exact: closing punctuation and emphasis around it are fine, while lookalike owners and suffixes such as `.5`, `/x`, `-x`, `_extra` or a query refuse it. Behind it: TN-38, AR-04. Old proof: the prose-link tests (their counted and never-counted lists, and prose after an HTML anchor closes) and the core tests on exact roadmap references (KD-09).

**MC-23 Closing keywords.** Case, tabs, quotes and lists count; comments and lookalike words do not. Every ticket in a closing list counts, across repositories, outside code. A serial comma keeps the last ticket, and separate list items never run together. Behind it: TN-38. Old proof: the ticket placement tests on closing lists.

**MC-24 Plan ids in a PR.** An id in the title or branch counts as `docs/spec/placement.md` reads it (PL3, KD-41): next to a hyphen and ignoring case, but never inside a longer known id or across an underscore. A declared `Ticket:` or `Unit:` line beats the title, and only its leading id list counts, in brackets or before a colon. A body that declares both `none` and a ticket places nothing, with a note. A `Unit:` line naming no id is ignored. An unknown declared id gets a note. A body-only mention is a candidate, never counted. "complete", "done" or "finished" after an id marks the ticket finished by that PR. An approved backfill entry replaces everything else. Old proof: the core tests on mapping a pull request.

**MC-25 The Section line.** `Section:` takes a whole diagram id and nothing longer, and a line naming no section is ignored. Old proof: the version 2 tests that read a whole id after `Section:` and ignore a Section line naming no section.

**MC-26 PR placement order.** The first match wins: (1) the PR's own Section line; (2) a plan unit or ticket it names; (3) `Ticket: none`, which puts it outside the plan whether open or merged (KD-23); (4) a configured placement for the PR; (5) the first placed issue among its closing links and keyword references, then its branch's ticket; (6) issues named in prose, only when all sit in one section; (7) the section most of its owned files point to; (8) the repository default on ticket-count maps; (9) the agent session that made it (KD-42); (10) for a merged PR, its frozen model placement [Q1], marked as guessed (KD-40). These are the layers of `docs/spec/placement.md` (PL1). The old lane step is gone (Q2, KD-30). Anything after step 2 is shown as inferred. Closing references that disagree resolve first-wins, now with a note (KD-36). A repository default never applies to a PR's own key in step 4. Behind it: TN-12, AR-04, AR question 2. Old proof: the version 3 tests (Section before ticket, Section before a parent-map guess, linked PRs without repository defaults on their own keys, a prose link to a placed ticket) and the section-map test that places a PR by most of its owned files.

**MC-27 Issue placement order.** A project override wins and records what it overrode. Then the issue's own Section line, a declared id in its body, its own section-map entry, its parent's entry (where the parent's override beats the parent's entry), a bare id in its title, the parent's own line or ids, a roadmap unit issue, and the parent's placement, followed up the chain with a loop check. Last comes the ticket's own repository default, never a parent's. A map entry naming a section no longer on the diagram places nothing. Everything after the issue's own lines is inferred. Behind it: AR-04. Old proof: the version 2 ticket-issue tests (own Section or id, else parent map; skip a parent map whose section is gone; a Ticket line before the parent map; a mapped parent beats a bare title id) and the ticket-progress tests on the order and on nested cross-repository evidence.

**MC-28 The closing-PR second pass.** A ticket nothing else places takes the section of the merged PRs that closed it, through GitHub's closing links and the PR body's closing lists, or `outside` when that PR is outside. PRs that disagree leave it unplaced, naming each PR and its section. Then the repository's label rule, then its title-prefix rule (the text before the first colon, ignoring case), for that repository only. A section map beats the closing PR, and the closing PR beats a label. PRs are placed once, against the ticket sections the maps decided. A bug-labelled ticket placed this way counts in Bugs. Behind it: AR-04. Old proof: the ticket placement tests.

**MC-29 The docs-only warning.** A PR that changes only documentation and declares a section that owns no product paths gets a warning on that section. Docs-only PRs tick the build step only in configured planning sections. Old proof: the section test that flags a docs-only PR declaring an empty product section, and the version 3 docs-only build test.

## `progress`

**MC-30 Ticket status.** Only closed-as-completed counts as done. A ticket closed as not planned or duplicate follows the last parent in its absorption chain; with no parent it is dropped, leaving the total but staying listed. A closed ticket with no reason is "unknown" and holds the percentage pending. Reopening drops credit at once. Behind it: TN-03. Old proof: the ticket-progress and absorbed-progress tests.

**MC-31 Absorption.** A parent comes only from GitHub's duplicate link, which outranks the comment, or from the closing comment: the last one written no later than a minute after the close, opening (after at most one `Label:`) with "Absorbed into", "Merged into" or "Duplicate of" and a reference. Replaced, superseded or split work, and a mere mention, name no parent. A parent outside the census counts as open with a note; a loop counts as open with a note. A placed card whose chain was not read in full holds its section pending. Each ticket counts once, in its own section, even when its parent sits in another repository. Behind it: TN-04. Old proof: the absorbed-progress tests on following the parent and on the parent named at closing.

**MC-32 Work, bugs and questions.** Label patterns, with a trailing `*` as a prefix match, sort cards into work, bugs and questions. Progress counts work. Bugs show as fixed out of found. Questions are left out and listed. Fixed bugs never turn a card purple. With no label lists, every card is work. Old proof: the ticket-progress tests on work cards, bugs and questions, the ticket screen test on the details list, and the scope-header test.

**MC-33 Unit weights.** A unit's audit days split evenly over its counted cards, meaning placed work cards that are not dropped, not every card in the unit (KD-12). A card in no scored unit weighs the map's average days per unit card, or 1 when there is none, with built 0. A card's unit is the unit pattern's first capture from its title, or from the title of the parent it was absorbed into. Done counts 1 whatever the unit says. An open card weighs its unit's built share, and its live share is the smaller of its unit's live and its own built. Audit live is the code share for yes, half of it for partly and 0 for no. A map with no unit audit shows live as unknown, not 0. Behind it: TN-05, TN-41. Old proof: the weighted-progress tests on unit size.

**MC-34 Section shares on maps without units [Q1].** Each work card weighs 1. Closed cards count fully built, so open cards take what the frozen section score adds above them, and the section's live never passes any card's built. Behind it: TN-45, AR question 1. Old proof: the section-score cases in the ticket-progress module, pinned today only by the retired section-score tests. Copy their arithmetic cases, not their re-check cases.

**MC-35 Days left.** The counted weight less the weighted built. It shows only when the count is current and the cards carry unit days, so a map scored per section never shows "days" counted in cards (KD-16). Under half a day reads "<1 day left"; otherwise it rounds to whole days. The header shows the total. Behind it: TN-06, TN-45. Old proof: the days-left tests.

**MC-36 Momentum.** "nothing moved in N days" from the latest ticket close or merge of a section's build PRs, "moved today" under a day, and nothing when there is nothing to go on. Old proof: the momentum tests in the meters tests.

**MC-37 The header ticket census.** Every ticket on the project's repositories counts once in the header: build work, fixes, decisions and questions, not on the map, outside the plan, absorbed into open work, absorbed into done work, and dropped. Cards and stages count build work only, with an absorbed ticket under its parent. The header's "done" is therefore not the sum of the cards' "done", on purpose. The header shows nothing while the census is pending. Behind it: TN-10. Old proof: the all-tickets header tests.

**MC-38 When a ticket count is current.** A count is current only when the read is complete, no ticket is unknown and the total is above 0. An empty section is never finished. A missing configured issue holds every count. A placed card's cut-short labels or unsettled chain holds only its section. An old complete read stays current at any age; a future read time does not. Behind it: TN-03, TN-13. Old proof: the ticket-progress tests (reopening, unknown reasons and failures cannot claim complete; complete evidence stays current past ten minutes; future dates refused) and the ticket screen tests on failed and future reads.

**MC-39 Three scope shares that add to 100 (Q3).** Live, merged but not live, and planned. The old engine's fourth share, built but unmerged, is dropped: an open PR says it instead, on the card's PR list and in the section's build state (MC-42). The bar is pending only when the section has no approved units or its read is incomplete, never for having open PRs (KD-31). Rounding is largest remainder: floor each share, then hand leftover points to the largest fractions, earlier category first on ties. Shares adding to more than 100 are clamped first (KD-28). Raw fractional audit weights are kept, not rounded. Behind it: TN-01, TN-69. Old proof: the scope tests on exclusive shares and joint rounding, with the built share left out. New case: a section with approved units, a complete read and an open PR shows its three shares and is not pending. TN-01's probe of 200,000 random sections becomes a property test.

**MC-40 Scope inputs.** Coded is the audit's code share weighted by unit days. Live is the smaller of coded and code times the live factor. The merged baseline is the larger of coded and the unit estimate. The estimate is a frozen model estimate newer than the audit [Q1], held at the audit when a newer frozen source finding says the unit falls short, never shown below the audit; else the share of the unit's plan tickets a merged PR named complete; else the audit. PRs merged since the audit show beside it without moving its percentage, and a PR merged at the audit minute is not after it. Behind it: TN-55, AR question 1. Old proof: the core snapshot tests (weights by estimate days, compares times as times, merged since the audit), the version 2 test that never shows an estimate below the audit, and the scope tests that keep live and merged true.

**MC-41 Removed (Q3).** This was the built-but-unmerged share, filled from plan tickets named by open PRs. The maintainer dropped the share in batch one. Its pending rule moved to MC-39. Behind it: TN-55.

**MC-42 Section build state.** Built while it has an open PR; merged when the merged share is above 0, or live is 0 and PRs merged since the audit; live when live is above 0; planned otherwise. Old proof: the version 3 test that shows merged and live shares apart without turning an open PR into a percentage.

**MC-43 Card tone.** A scope card turns purple when live is strictly above 90, with a 1e-7 tolerance, whatever the cumulative progress, so rounding noise at 90 stays plain. A ticket card turns purple when live is above 90, or built is above 90 when live is unknown. A card is unstarted (warm grey, dotted border) when nothing is done, nothing is built and no PR is open; a scope card also needs its scope settled. Built with nothing closed is started. Behind it: TN-02. Old proof: the interaction tests on progress presentation, the meters card-colour test and the bar tests.

**MC-44 The Review bar.** Each tracked PR weighs its additions plus deletions, counted once per PR across sections and stages by its repository-qualified key. The bar is unknown when a size is missing, the read is incomplete or a duplicate disagrees. A section with no PRs gets an empty bar, not pending. A complete read whose PRs all change zero lines shows "no changed lines", not pending (KD-27). A PR with an accepted receipt and a leftover debt label is listed under both Reviewed and Marked for review (KD-18). Any new push sends the whole PR back to unreviewed. Behind it: TN-08, TN-48, TN-70. Old proof: the scope tests on weighting, de-duplication and relocated PRs, the stage review tests, the bar test for an empty review bar and the unreviewed-card test.

**MC-45 Review receipts.** A receipt is a comment from a configured trusted author ending in `Reviewer:`, `Model:`, `Head SHA:` (40 hex characters equal to the current head) and `Verdict: approve` with `Code review: no findings`, or `Verdict: changes requested` with optional `Scope:`, `Findings:` and `Coverage:` lines. An approval inside an open fence, a block quote (lazy continuation included) or an unclosed `details`, `blockquote`, `pre` or `code` wrapper does not count. The newest receipt by the later of created and edited time wins, and a negative wins a tie. An approval counts only with full comment history and no changes requested on GitHub. Without a receipt, a formal approval on the current head counts only with complete labels, reviews and comments and no debt label. A changes-requested decision on an older head still blocks a fresh approval, on purpose. Removing a debt label never proves review. Behind it: TN-08, TN-70. Old proof: the scope tests on head-bound review evidence.

**MC-46 Spec closure.** A spec is decided only when the evidence is current and error-free, the section and spec are marked complete, the spec has at least one ticket, and the spec and every ticket were read in full. It is built when every ticket closed as completed (KD-11), open otherwise, pending when undecided. A section's percentage is built over total, only with no pending specs. Moving a section's membership drops the old rollup. With no membership configured, the section stays pending and nothing is guessed from prose or closed specs. Behind it: TN-09, TN-40. Old proof: the spec-progress tests.

**MC-47 The planning checklist.** Map, tickets, spec and build each tick with evidence, show "?" when context is incomplete, and show a cross otherwise. A tick does not prove the step is finished. A section's map is found through ancestors; an umbrella map over several sections ticks none of them and lends no spec. A spec under a shared map ticks only its own section. A spec is never a build ticket. Configured spec labels count. The old idea step is drawn nowhere and goes. Closed dependencies, even ones closed after the parent last changed, are not blockers. Behind it: TN-11. Old proof: the version 3 tests on project evidence.

**MC-48 Stage and header rollups.** A stage averages its sections equally and rounds once. A section with no scope makes the stage pending rather than counting as 100% planned (KD-15). Missing, incomplete or empty membership publishes no percentage. Rollups count unique tickets and unique PRs across unequal and empty sections. Behind it: TN-44, AR-06. Old proof: the stage display tests and the ticket screen test that aggregates unique counts.

## `merges`

**MC-49 The clock-hour chart (Q5).** The engine sends twelve bars, newest last, each with its start, end and merge count. They are bucketed on the machine's local hour boundaries, so a zone at a half or quarter hour also works (KD-01). That is right because the served map is loopback only (Q5), so the viewer normally sits at that machine. A viewer who opens it from another device through the guide's tunnel or mesh VPN sees bars on the host's hours, which release one accepts. The newest bar is the hour so far, and each earlier bar starts on a local hour. A bar holds merges from its start up to, but not including, its end (KD-02). Future and older merges are left out, and empty bars stay. Behind it: TN-47, TN-56, AR-06, and the screen spec (#10), which moved the bucketing out of the screen. Old proof: the clock-hour test, whose boundary case flips, and the camera-file tests on exact hourly boundaries.

**MC-50 Two hour rules on one strip (Q5).** The engine also sends the average per hour and "last hour", both over rolling 60-minute windows ending at the read. They differ from the newest bar on purpose: merges at 02:15, 02:30, 02:45, 02:50 and 03:05, read at 03:10, give a last hour of 5 and a newest bar of 1. A read exactly on a local hour would make the newest bar a zero-length window, so the newest bar is then the hour just ended (KD-39). The screen labels "last hour" as the last 60 minutes. Behind it: TN-65, AR-06. Old proof: none beyond TN-65's example, which becomes the test, plus one read on the hour.

**MC-51 Merge figures keep their last good read.** A skipped or failed poll keeps the last figures with their time. A partial read whose later page stops keeps the old queue figures and the old time, rather than stamping a new time on them (KD-17). Behind it: TN-13, TN-46. Old proof: the GitHub freshness tests and the cards-keep-last test for a skipped merge read.

**MC-52 Loading-bay status.** From dated, de-duplicated, time-sorted events: merged; pending if closed or its history is incomplete; queued if the last queue event is queued; dropped if the last event is a drop; ready only from the configured label; otherwise opened. A bay with duplicate PR keys is refused whole. The bay renders without Seat Gauge, and keeps its dated history on failure. Behind it: TN-25. Old proof: the loading-bay tests.

## `map_gaps`

**MC-53 Who owns a path.** In section-map globs, `**` spans folders, `*` stays within one, `?` is one character, and a leading `**/` may match nothing. A path belongs to the glob with the most literal characters, ties going to the first rule, shared globs before section globs. Shared paths belong to no section and are not gaps. Behind it: TN-11. Old proof: the section-map tests in the version 2 tests.

**MC-54 The gap census.** A gap is a changed path in a tracked open or merged PR that no section owns. One path shared by two PRs counts once, with both PRs listed. The count shows only after a complete census at exact heads and bases, and the last complete count keeps its date after a failure. A report counted against another repository or another section-map digest is thrown away. An empty repository needs no GitHub call. The caps bound the work each Sync does, not the census, so a project past 2,000 PRs finishes over several Syncs, and a PR over the file limit is named as too large instead of holding the count pending for good (KD-29). Behind it: TN-26, TN-60. Old proof: the map-gap tests and the map-gap failure and freshness tests.

## `versions`

**MC-55 Served site versions.** For up to ten configured HTTPS sites: fetch the small build file and the home page's meta stamp, with no redirects, a five-second limit and size limits. A commented-out stamp does not count. The two must agree on one clean 12-character revision. The engine then checks that revision is an ancestor of main and counts distinct merged PRs whose merge commit lies between them, up to 1,000 commits. It counts PR identities, not commits or associated open PRs, and one PR spanning rebase commits counts once. An identical clean build is a verified zero. A hidden page, a GraphQL error or a missing commit shows pending. Each site keeps its last known value with its age, never marked stale after ten minutes (KD-14), and keeps its own reason when GitHub cannot be read (KD-20). Behind it: TN-24, TN-43, TN-50. Old proof: the version tests and the version publication test.

## `seat_gauge`

**MC-56 Reading the shared file.** Read as `docs/seat-gauge-file/README.md` says, which supersedes TN-17 where they differ (KD-33): refuse a symlink, a non-regular file, a file over 4,000,000 bytes, or one whose size or time changed during the read; a missing file means no agents and a quiet note; a higher version means no agents and a "newer" note. Unknown fields are dropped, and a time with no offset fails the file. Row ids are the machine and session pair; a pair seen twice with any difference becomes one pending row. A session linked to several PRs shows once. Behind it: TN-17, TN-66, AR-11. Old proof: the Seat Gauge tests on publication failures (missing, malformed, version, symlink, oversize, directory, fifo), duplicates and identities. Re-prove against the five example files.

**MC-57 When a session's figures count.** Only when the file's `updated`, the read and the row's `as_of` are each at most 90 seconds old and not in the future beyond the file spec's tolerance. `closed_at` must be present exactly when the status is closed or superseded, `started_at` no later than the end, and the elapsed time must match. The row must name a repository, a section and a PR or ticket. A machine named in `problems` makes only its own rows pending (KD-13). Failing rows stay visible as pending with a reason. Unknown token totals stay unknown, never 0. Behind it: TN-18, TN-42. Old proof: the Seat Gauge tests that keep repo, branch, fork, unknown-head, stale, future, machine-failed and conflicting evidence pending.

**MC-58 Where a session goes.** Its repository comes from the configured label map, else a workspace pattern, and must be one of the project's repositories, ignoring case. Its PRs are open PRs whose head repository and branch match exactly, so a fork never matches. Its ticket comes from the branch pattern, else a number in the workspace name. Its section is the first that exists among its PRs' sections, its ticket's section and the section the writer named. A session first places by its branch ticket, then by its open PR once one exists, keeping the ticket. With a pattern configured and no PR and no placed ticket, it adds only to an anonymous count. Without a branch pattern, a mapped session is a pending row. Behind it: TN-20, AR-05. Old proof: the Seat Gauge placement tests on branch tickets, open PRs and workspace names.

**MC-59 Agents on a card.** For 15 minutes after the last file update, a card shows its open sessions as pills, working first, then newest start. With none open it shows the latest closed one, dimmed. A working session spins the build step even when its figures are pending; an idle one keeps its pill and a still build step. The header counts only current, working sessions. Behind it: TN-19. Old proof: the card-agent tests and the Seat Gauge card tests.

**MC-60 A failed read keeps the last report.** The previous report stays with its dates, marked pending. Each kept row is placed again under the current config, and a row whose mapping was removed joins the anonymous count, even when the next read also fails. Behind it: TN-21. Old proof: the Seat Gauge test that removes a mapped identity after config removal, and the display test that re-evaluates mappings on each file.

**MC-61 Nothing private leaks.** An unmatched session adds only to a count, with no id, branch or usage. `problems` messages are never republished. Figures are labelled session totals; thinking is a part of output, not added to it; "done" is never shown as closed. Malformed optional fields drop alone, without dropping the row. Behind it: TN-17, the file spec. Old proof: the Seat Gauge tests on anonymous counts and private diagnostics, and the display tests on labels and malformed optional data.

## `view`

**MC-62 Next up.** A section's open tickets: those named by an open PR first, then unblocked, then blocked, each group by issue number, each row with its labels and open blockers. With none, a "no open tickets" row. On a ticket-count map the list is the open work cards behind the Tickets bar's "N left", so the two always agree apart from absorbed cards, which the hover counts (KD-34). On a scope map it keeps the label rule: open tickets with the ready or ticket labels, specs excluded. A ticket is blocked once for each blocker, so one blocker over two tickets blocks both (KD-10). Behind it: TN-07, TN-39, TN-68. Old proof: the next-up tests.

**MC-63 Blockers and arrows.** Blockers come from GitHub's native dependencies plus a "Blocked by" section in the body: multi-line lists and Markdown links, stopping at the next heading, de-duplicated by the pair of blocker and ticket. Only open blockers count. A blocker in another section draws a "waits on" arrow; configured dependencies draw dashed arrows; duplicate arrows merge. Behind it: TN-39. Old proof: the version 3 tests on blocker lists and closed dependencies.

**MC-64 Every part says how fresh it is.** Each part of the view (board, merges, agents, versions, gaps) is current, last good with its time, never read, or failed since a time. Old values show at any age; pending means only never read. The screen never judges ages. Behind it: TN-13, AR-12, AR-13, B13, L8. Old proof: the cards-keep-last tests and the map-gap freshness test that keeps a complete census past ten minutes.

**MC-65 PR lists and warnings.** The view lists unplaced PRs, flags inferred placements on open PRs, and carries the docs-only warnings. Old proof: the version 3 test that reports remaining unplaced work, less its lane cases.

## `engine`

**MC-66 Sync joins and reports.** A Sync pressed while one runs joins it. The outcome comes from the read just made: a site-version fault is a warning on a complete Sync, an incomplete Sync gives its reasons, and the GitHub part never waits on Seat Gauge being pending. Behind it: TN-22, TN-63, AR-13, L7. Old proof: the Sync tests that join concurrent requests and keep GitHub Sync apart from pending Seat Gauge data, and the Sync run tests on warnings and incomplete replies.

**MC-67 Projects are tabs.** One process holds 1 to 20 projects with unique ids, and the active tab is the project in view. Ids are limited to lower-case letters, digits and hyphens, so an id like `..` cannot alias another project (KD-25 covers the load check). Behind it: TN-27, TN-67, AR-14. Old proof: the map-link tests; the address check becomes an id check.

**MC-68 Agents drop on time.** The engine wakes at the earliest Seat Gauge deadline and emits a new view, instead of the screen re-arming its own timer. Behind it: TN-18, TN-72, AR-12, L8. Old proof: the Seat Gauge display test that keeps exact source dates at display expiry.

**MC-69 A kick reads the merge panel only.** A kick after a merge polls the merge panel at once and never reads cards; kicks within 30 seconds count as one. Behind it: B14, L18. Old proof: the timer test where a new merge reads only the merge panel and the cards wait for Sync.

## `server`

**MC-70 Every request is guarded.** A `Host` that is an IP address and port, or a name listed in `allowed_hosts` with the served port (Q8, CF25), never any other name (L11); an `Origin`, when sent, equal to `http://` and that `Host`; each POST with no body, a custom header, an exact JSON content type, and `Sec-Fetch-Site` absent or same-origin; no CORS grant. GET serves only the built screen and the API routes. Real paths must stay inside their folder: symlinks out, `..` segments and malformed escapes are refused, and a malformed path is a 404, not a crash. Every answer is `no-store`. Loopback only (Q5). Behind it: TN-22, TN-23, L10, L11. Old proof: the Sync tests that refuse foreign, parameterised, body-carrying and unmarked requests, and the local server tests.

## The kept screen (TypeScript, #10)

**MC-71 A map visit never crosses another.** A slow read from an earlier visit cannot overwrite a later one, the board keeps its previous data until the new view arrives, and retained data names the project it came from. Behind it: TN-28. Old proof: the map-visit tests, less the audit-registry case.

**MC-72 The camera.** At 100% the first four stage columns fill the window less a 12 px margin each side, padded with phantom columns on smaller maps; a 228 px column makes a 1,080 px window open at scale 1. Zoom runs from the smaller of "fits" and 25% up to 200%, + and − step to the next whole ten of the readout, and zoom keeps the point under the cursor still. Cards never leave the window, a map smaller than the window pins top-left, and a change under half a pixel is the same view. Behind it: TN-30, TN-32. Old proof: the camera tests.

**MC-73 Real 1 px borders under CSS zoom.** The board scales with CSS `zoom` and pans with a translate divided by the scale. Frames, bars and dividers are real borders, never inset shadows. Behind it: TN-31. Old proof: only the browser proof file that measures computed borders at zooms 1, 0.868 and 1.02 on both engines. Copy that case into the new suite.

**MC-74 A drag never selects, follows a link or opens a card.** A press anywhere on the board pans, cards and links included; call-outs and form fields keep their press. A drag starts after 4 px, hides hover and tooltips, cancels the native drag, and swallows the next pointer click, never a keyboard one. A card opens only on a press that did not move. Behind it: TN-33, TN-71. Old proof: one camera test on pressing anywhere, and pointer proof scripts that need two live servers. The new test is a self-contained browser test.

**MC-75 Saved view, theme and call-outs.** Each project keeps zoom, position, theme, toggles and overview tab, each field checked alone; blocked storage gives defaults and never throws. An inline script paints the saved dark theme before the app loads. A card call-out sits beside its card, flipping left near the right edge; a header call-out sits 8 px below its button, right-aligned. Behind it: TN-34. Old proof: the saved-view, home-theme and call-out placement tests.

**MC-76 Card face and header.** No per-card freshness or closure line on the face; one Sync in the header for the whole map; call-outs offer Copy and Close, and Close alone when there is nothing to copy; agent pills with no label or per-card toggle; a footer of open PRs and blockers, each a number over its label; header controls on one row; the ticket inventory opens from the header and hides without a census; the Seat Gauge button hides when no report exists. Old proof: the one-Sync, card-face, component-controls, Seat Gauge card and display, scope-header and header call-out tests.

**MC-77 Bars.** One frame and label markup for every bar. The empty end of a bar is unlabelled, zero segments are dropped, an old census keeps its bars, and a failed read holds the bars and drops the counts. Label text is white on dark purple and near-black on light purple, and footer counts wrap. Old proof: the bar tests and the meters tests.

**MC-78 Hover, pin and wires.** A hover never opens details, a pin outranks a hover, a stale leave cannot clear a newer hover, and a deliberate activation replaces the pin and remembers a keyboard origin. Wires run in axis-aligned channels with rounded turns, honour an explicit gutter, and route backward or same-column links through an outside corridor. Old proof: the interaction tests.

**MC-79 Times.** Only an ISO time with `Z` or an offset is converted; any other text, a bare date or a note, shows exactly as written. Times show in the viewer's zone (KD-01) and carry the date when it is not today (KD-19). Behind it: TN-49, TN-56, AR-09. Old proof: the time tests, with their expected strings moved to the viewer's zone.

**MC-80 Copy for a section.** Copy writes the section's words, its scope ("pending" when unknown, never "live 0%") and its review state as Markdown. Old proof: the section-context test.

**MC-81 Draw, never count.** The screen formats the engine's numbers and never recounts, re-validates or changes a part's state. The old screen's recount and refusal tests are not carried. Behind it: TN-64, AR-07, L8. Old proof: none to copy; L8's test proves it.

## Deliberate fixes: the known-differences seed

"Moves numbers" says whether the fix can change a figure on a card or header of the maintainer's live maps at switch-over. Those rows are the ids the parity check in #13 may cite (Q4).

| Id | Fix | From | Moves numbers |
| --- | --- | --- | --- |
| KD-01 | Times in the viewer's zone; chart hours on the machine's local hours (Q5) | TN-56, AR-09 | Chart only, on machines away from UTC+10 |
| KD-02 | Clock-hour bars start-inclusive | TN-47 | Yes, merges on the hour |
| KD-03 | Perl lock helpers replaced by one process and a native lock | TN-58, AR-03 | No |
| KD-04 | launchd jobs, fixed macOS paths, Homebrew path, Chrome launcher gone | TN-59, TN-86 | No |
| KD-05 | A sample config and example project ship, written fresh | TN-61, #11 | No |
| KD-06 | The first read resumes and finishes on any history | TN-35 | Yes, on projects the old engine never finished |
| KD-07 | The daily backstop reads from the last all-repository read | TN-36 | Yes, where the old search missed a change |
| KD-08 | A cut-short list marks one item, not the read | TN-37 | Yes: agents, loading bay |
| KD-09 | One Markdown-aware reference grammar | TN-38 | Yes: placement, closing, blockers |
| KD-10 | One blocker over two tickets blocks both | TN-39 | Yes: Next up, blocker counts |
| KD-11 | A spec is built only by completed closes | TN-40 | Yes: spec closure |
| KD-12 | Unit days split over counted cards only | TN-41 | Yes: weighted progress, days left |
| KD-13 | A machine's problem holds only its own rows | TN-42, #7 | Yes: agents |
| KD-14 | Site versions show their last read with its age | TN-43 | Yes: merge distance shown instead of pending |
| KD-15 | A stage with an unscoped section is pending | TN-44 | Yes: stage bars |
| KD-16 | Days left hidden unless cards carry unit days | TN-45 | Yes: days left |
| KD-17 | A partial merge read keeps the old queue figures and time | TN-46 | Yes: merge panel shown instead of pending |
| KD-18 | A receipt-reviewed PR with a debt label is listed under Reviewed too | TN-48 | No, lists only |
| KD-19 | The header's updated time carries the date | TN-49 | No |
| KD-20 | Site-version reasons and last values survive a version-step error | TN-50 | Yes: sites keep values |
| KD-21 | Screen fixes: the open-PR hover, Command-key zoom on macOS, Space opens a card | TN-51 to TN-53 | No |
| KD-22 | The queue reads the default branch, not `main` | TN-80 | Yes, where the default is not `main` |
| KD-23 | An open PR with `Ticket: none` is outside the plan, as a merged one is | TN-72 | Yes: Not placed count |
| KD-24 | Card read marks use GitHub's clock | TN-72 | No, unless a local clock ran fast |
| KD-25 | All config checks at load, and safe project ids | TN-67, TN-72 | No |
| KD-26 | Audit dates read one way, date-only in the configured zone | TN-72 | Yes, if the zone differs from UTC+10 |
| KD-27 | All-zero-line review shows "no changed lines", not pending | TN-70 | No |
| KD-28 | Scope shares clamped before rounding | TN-69 | No, nothing produces such input today |
| KD-29 | Map-gap caps bound a Sync, not the census | TN-60 | Yes: map gaps shown instead of pending |
| KD-30 | No placement by the lane that opened a PR (Q2) | TN-12, AR question 2 | Yes: open PR counts |
| KD-31 | No built-but-unmerged share, and open PRs no longer make a section pending (Q3) | TN-55 | Yes: scope bars, pending sections |
| KD-32 | Deleted issues leave within seven days, not one | B8 | Yes, until the next full read |
| KD-33 | Seat Gauge reader per the file spec: quiet when missing, refuses newer versions | #7 | Yes: agents |
| KD-34 | Next up lists the cards behind "N left" | TN-68 | No, lists only |
| KD-35 | A read that crosses the reserve keeps what it read | B11 | Yes: map gaps |
| KD-36 | Disagreeing closing references get a note | TN-12 | No |
| KD-37 | Frozen inputs stop moving [Q1] | AR question 1 | Yes, if the old engine keeps re-checking |
| KD-38 | The design package and fonts inlined; MIT headers | TN-54 | No |
| KD-39 | A read on the hour shows the hour just ended, not an empty bar | TN-65 | Chart only |
| KD-40 | PRs place in layers: prose tickets before changed files (Q19), the repository default before the frozen model placement, which drops to layer 4 as guessed (Q2 revised, PL1) | #45 | Yes: PR counts where the old order chose differently; each card moved at switch-over is listed (Q19) |
| KD-41 | Ticket ids per project, read from ticket titles by patterns, matched next to hyphens and ignoring case, plus the branch's ticket number (PL3, PL4) | #45 | Yes: Not placed count, card PR counts |
| KD-42 | A PR is placed by the agent session that made it (PL6) | #45, #7 | Yes: Not placed count |
| KD-43 | Every placement names its layer, rule and evidence, and every Not placed PR its reasons (PL1, PL8) | #45 | No, hovers and lists only |

## Old tests that are not carried

- Every whole file of a retired feature: the Codex audit and its budget, scan status and scan line, estimated scope, Luna re-checks and their Sync and card lines, section-score re-checks, deep sync, sweeps, lane documents, the map forwarder, the tool-commit restart, the lock generator and the launch scripts.
- The `sol*` proof files, apart from the one case in MC-73. Their other kept cases already have ordinary tests (TN-84).
- Tests that pin a rule the rewrite fixes: the clock-hour boundary case and every fixed-zone expectation, the loading-bay test that keeps the cards' zone, the map-gap case that refuses a read crossing the reserve, and the Sync tests built on child processes, process-group deadlines, lock files and herdr evidence.
- Tests of shapes that no longer exist: snapshot and cache version upgrades (a first run reads in full), the screen's recounts and refusals, the four-hour merge buckets, switch-on issue reads, the fog list, lane readers and lane placement, and the agent phase check.

## Line count

Estimated from the architecture review's module sizes, plus what the budget spec and the app layout added since, checked against the old TypeScript covering the same ground: about 9,100 lines in the kept core, readers and command files, of which about 1,000 are woven-in retired logic. Rust with typed errors and no runtime schema library usually runs a little longer than the TypeScript it replaces, so 1.2 to 1.4 times the remaining 8,100 gives 9,700 to 11,300.

| Module | Review | Now | Why it moved |
| --- | --- | --- | --- |
| `config` | 900 | 1,000 | Frozen-input acceptance rule (MC-05) |
| `github` | 500 | 850 | Conditional REST cache, back-off, `gh` token and states (B9, B12, L21 to L23) |
| `census` | 1,700 | 1,800 | Resumable first read (MC-16) |
| `store` | 250 | 250 | |
| `placement` | 1,100 | 1,200 | One Markdown-aware reference extractor (MC-22) |
| `progress` | 1,500 | 1,500 | The built-but-unmerged share dropped (Q3) |
| `merges` | 350 | 350 | |
| `map_gaps` | 250 | 250 | |
| `versions` | 450 | 450 | |
| `seat_gauge` | 550 | 550 | |
| `view` | 900 | 900 | |
| `engine` | 600 | 700 | Viewer count and kick coalescing (L18, L19) |
| `contract` | | 250 | Added by the app layout |
| `server` | 350 | 450 | Event stream, view ETags, CSP (L10 to L12) |
| `app` with the folded `cli` | 370 | 600 | Window, control port, instance file, kick and dump (L13 to L18) |
| Total | 9,770 | about 11,100 | 56% of the 20,000 target |

The biggest risks are `census` and `placement`, where the old tests hold the most edge cases. Even at 1.5 times this estimate the engine stays under the target. The screen spec (#10) keeps about 3,650 lines of drawing TypeScript plus a client module of about 320, with about 1,270 lines of CSS beside them. Engine and screen TypeScript together come to about 15,100.

## Notes for other tickets

- #11: project config v2 needs an optional time zone for date-only stamps in roadmap files (MC-04), the frozen input file names (MC-05), project ids limited as in MC-67, and the served sites. The maintainer's live maps should set the zone the old engine assumed, so audit dates match at switch-over.
- #13: compare only after both engines have made a full read (KD-32), with the old engine's re-checks and sweeps stopped (KD-37), and compare times as UTC instants (KD-01). Every difference must cite a KD row marked "Yes" (Q4).
- #16: each MC item is a test in the build tickets, apart from MC-41, which is removed (Q3). Most module tickets can take their MC items as their acceptance list.
- #10: MC-71 to MC-81 are the screen's list, and KD-21 its fixes.
