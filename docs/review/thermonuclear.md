# Thermonuclear review of the archive

This is the thermonuclear pass from the maintainer's cleanup method, run read-only on the old TypeScript engine in the private archive. It answers ticket #4: which parts of the old engine are correct and worth keeping, and which are wrong, fragile or dead weight. The must-carry-over list (#6) is written from it.

Nothing was committed to the archive. Its dependencies are not installed, so its test suite was not run. Every "wrong" finding below was either reproduced by a small probe script that imported the archive's own module and fed it an input, or traced line by line through the code. Each one says which. A finding that could not be proved is filed as fragile, with the test that would prove it.

File paths, private project names and code excerpts are in a private companion issue on the archive. This document names behaviour only.

## How to cite a finding

Every finding has a stable id, `TN-01` to `TN-86`. Later tickets cite the id. The ids never change meaning; if a finding turns out wrong, mark it withdrawn here rather than renumber.

Findings are ranked in four groups, in this order: correct and worth keeping, wrong, fragile, dead weight. Within a group the most important come first. "Feeds" names the open ticket that should use the finding.

## The measured facts in the ticket, checked

| Ticket said | Measured | Verdict |
| --- | --- | --- |
| About 24k lines of source | 24,318 lines of TypeScript and TSX, plus 1,448 lines of CSS | Correct |
| About 35k lines of tests | 34,779 lines, of which 3,998 are fixture data | Correct |
| The Codex audit block is about 10.5k source and 12.4k test lines | The Codex audit on its own is 6,650 source lines. All the retired features together come to 10,079 source lines in whole files, plus retired logic woven into kept modules (TN-74). Their whole-file tests come to about 11,500 lines | Right total, wrong label: 10.5k is every retired feature, not the Codex audit alone |
| 73 `sol*` proof files, about 9.5k lines, leftover review scaffolding | 75 files, 9,554 lines: 64 test files (8,439 lines) and 11 scripts (1,115 lines). 12 of the test files import only retired modules. The other 52 exercise kept code, and a few hold the only proof of a kept rule (TN-31) | Count off by two. "Leftover" is true of the files but not of every case in them: carry the cases, drop the files |
| Perl lock scripts wrap every collector, which blocks Windows | Every collector run (cards, merge panel, agents, snapshot) goes through two nested Perl kernel-lock helpers, and Sync goes through the same helper. The retired audit has a second, larger Perl guard. Some calls use a fixed `/usr/bin/perl` path | Correct (TN-58) |
| Time is fixed to one time zone where the viewer's local time is wanted | Every time on the map is formatted at a fixed UTC+10 offset with no daylight saving and no zone marker | Correct, and the merge chart's hour buckets quietly depend on it (TN-56) |
| There is no sample project config | No example config exists. The test fixtures are copies of a live private map, including a 370 KB unit table, so they cannot become the example either | Correct (TN-61) |

## Correct and worth keeping

These are the rules the Rust engine and the kept screen must reproduce. Each states the rule closely enough to re-implement and names the test in the archive that pins it, so the port can copy the cases.

### Numbers on a card

#### TN-01 The four scope shares always add to 100

A section's scope splits into live, merged but not live, built but unmerged, and planned. Live is the smaller of the coded and switched-on shares. Merged is the coded baseline less live. Planned is what is left. Rounding is largest remainder: floor each share, then hand the leftover points to the largest fractions, earlier category first on ties. A probe of 200,000 random sections and 28,000 stage averages found no total other than 100 and no negative share. Pinned by the scope tests. Feeds #6. See TN-69 for the edge it does not cover and TN-55 for the share that needs a new source.

#### TN-02 Card tone

A scope card turns purple when live is strictly above 90% (with a tiny tolerance). A ticket-count card turns purple when live is above 90%, or built is above 90% when live is unknown. A card is "unstarted" (warm grey, dotted border) when nothing is done, nothing is built and no PR is open; on a scope map its scope must also not be pending. Pinned twice, by the meter tests and the bar tests. Feeds #6 and #10.

#### TN-03 Ticket status and counting

Only closed-as-completed counts as done. A ticket closed as not planned or duplicate follows the last parent in its absorption chain; with no parent it leaves the total but stays listed. An unreadable parent counts as open, and a loop counts as open with a note. A closed ticket with no reason is "unknown" and holds the percentage pending. Without unit shares, percent is done over total. With shares, done weighs 1 and an open ticket weighs its unit's built share; a card's live share is the smaller of its unit's live share and its own built share. An empty inventory has no percentage. Pinned by the ticket-progress, absorbed-progress and weighted-progress tests. Feeds #6.

#### TN-04 Absorption rule

A ticket closed as not planned or duplicate is absorbed into a parent only through GitHub's own duplicate link, or a closing comment written no more than a minute after the close that opens with "Absorbed into", "Merged into" or "Duplicate of" and an issue reference. Replaced, superseded or split work names no parent. This is the one strict reference rule in the engine (compare TN-38). Feeds #6.

#### TN-05 Unit weights and the audit baseline

A unit's days from the approved unit audit are split evenly over its counted cards. A card in no scored unit weighs the map's average days per unit card, or 1 if there are none, with built 0. Audit live is the code share for "yes", half of it for "partly" and 0 for "no". A card's unit is the unit pattern's first capture from its own title, or from the title of the parent it was absorbed into. Pinned by the weighted-progress tests. Feeds #6. TN-41 is a bug in the "counted cards" part.

#### TN-06 Days left

Days left is the counted weight less the weighted built share. It shows only when the count is current and the cards carry unit shares. Under half a day it reads "<1 day left"; otherwise it rounds to whole days. Pinned by the days-left tests. Feeds #6. See TN-45.

#### TN-07 Next up ordering

Next up lists a section's open tickets: those named by an open PR first, then unblocked, then blocked, each with its labels and open blockers. Within a group they sort by issue number. With none, it shows a "no open tickets" row. Pinned by the next-up tests. Feeds #6. TN-39 and TN-68 are bugs in what it lists.

#### TN-08 The Review bar and review receipts

The Review bar weighs each tracked PR by additions plus deletions, counted once per PR. It is unknown when any size is missing, the read is incomplete, or the total is zero. A PR counts as reviewed when a receipt from a trusted author approves the exact current head with full comment history and no changes requested, or when a formal approval sits on the current head with no review-debt label and complete labels, reviews and comments. The newest receipt by created-or-edited time wins, and a negative wins a tie. Any new push sends the whole PR back to unreviewed: credit is all or nothing per head. Removing a debt label never proves review. Pinned by the scope tests and the receipt proofs. Feeds #6. Note one deliberate conservatism the port should keep on purpose: a "changes requested" decision on an older head still blocks a fresh receipt approval.

#### TN-09 Spec built state

A spec is decided only when the evidence is current and error-free, the section and the spec are marked complete, the spec has at least one ticket, and the spec issue and every ticket were read in full. It is built when all its tickets are closed, open otherwise, and pending when it cannot be decided. A section's percentage is built over total, and only with no pending specs. At display time the screen checks freshness again, so stale or failed evidence turns every spec pending. Pinned by the spec-progress tests. Feeds #6. TN-40 is a bug in "closed".

#### TN-10 The header ticket census

The header counts every ticket on the project's repositories once, split into build work, fixes from checks, decisions and questions, not on the map, outside the plan, absorbed (into open work and into done work) and dropped. Cards and stages count build work only, and count an absorbed ticket under its parent. So the header's "done" is not the sum of the cards' "done", and both rules are deliberate. Pinned by the all-tickets header tests. Feeds #6.

#### TN-11 Section-map ownership and the planning checklist

A changed file belongs to the section-map glob with the most literal characters; ties go to the first rule, shared globs before section globs. Shared files belong to no section. Files no glob matches are map gaps. A PR belongs to the section most of its owned files point to, ties broken alphabetically. Each planning step (map, tickets, spec, build) shows a tick when it has evidence, "?" when the context is incomplete, and a cross otherwise. A tick does not prove the phase is finished. Pinned by the section tests. Feeds #6 and #11.

### PRs, blockers and placement

#### TN-12 PR placement order

A PR's section is the first match in this order: its own "Section:" line naming an exact diagram box; a plan unit or ticket it names; unplaced if it says "Ticket: none"; a configured placement for the PR; the first placed issue among its closing links and keyword references; the lane that opened it; its merged-history record; issues named in prose, only when all of them sit in one section; and finally the repository's default section on ticket-count projects. Anything after the second step is shown as inferred, never as stated. Closing references that disagree resolve first-wins without a warning; prose references must all agree. Pinned by the placement and version 3 tests. Feeds #6. The lane step depends on a private log format; see question 2 at the end.

#### TN-13 Keep the last good values on failure

A failed or stopped card read returns the previous values with their original time and records the failure beside them. It reports failure as its state only when nothing was ever read completely. On ticket-count projects a finished issue census is kept even when the PR part of the same run fails. The merge panel keeps its last figures and the screen labels them with their time. Only a card that was never read is pending. Pinned by the changed-card, ledger, freshness and cards-keep-last tests. Feeds #6 and #12.

### Merge panel and GitHub reads

#### TN-14 The GitHub budget stop rule

Every collector run first asks the free rate-limit endpoint and stops when the REST or GraphQL remaining budget is below the floor, or unknown. The floor is at least 1,000 points, and the automatic timer uses at least 1,500. Before each further GraphQL page it stops when the last reported remaining figure is below the floor. A stop in the merge panel keeps what arrived and does not move its watermark; a stop in a card read fails the read and keeps the last good values. Pinned by the reader, changed-card, ledger and timer tests. Feeds #12.

#### TN-15 The merge-panel incremental read

The panel reads the product repository's merged PRs newest-updated first, 50 a page, and stops at the first PR updated before the watermark less ten minutes. The watermark is the newest `updatedAt` seen, which is GitHub's clock, not the local one, and it moves only when the list finished. The first call also fetches the merge queue's length, its first 20 entries and the count of open approved PRs. Pinned by the reader and timer tests. Feeds #12. See TN-80 for the hard-coded branch name.

#### TN-16 The changed-only card read

A card read first sends one search per group of up to 15 configured repositories, with `repo:` qualifiers, for issues and PRs updated since the oldest mark less ten minutes, at most three pages. No repository is left out by the cap of 15; the search batches. More pages, a cursor that does not advance, or an unknown PR state falls back to re-reading every repository incrementally. Only the repositories and the kinds (issues, open, merged or closed PRs) the search names are read again. After a merge newer than the cards' last read, the product repository is read in every kind regardless, because the search index can lag a merge. A cached open PR leaves the list when the same run sees it merged or closed. Pinned by the changed-card, open-PR and timer tests. Feeds #12. TN-36 is a bug in its daily backstop.

### Agents from Seat Gauge

#### TN-17 The session publication the map accepts

The map reads one Seat Gauge publication in version 1. The top level has `version`, `updated` (an ISO time with an offset), `sessions` (at most 5,000) and `problems` (machine to message). Each session needs `machine` and `session_id` (1 to 512 characters), `workspace`, `pane`, `tool` and `status` (up to 512, may be empty), `as_of` (time with an offset) and `stale` (boolean). Optional, and read as null when absent: `model`, `effort`, `repo`, `section`, `seat`, `branch`, `started_at`, `closed_at`, `usd` (a finite number of at least 0) and `tokens` (all seven counters as non-negative safe integers). Unknown fields are dropped; a time with no offset fails the file. The file is read only if it is a regular file of at most 4 MB, opened without following links, and its size and change times must match before and after the read. A machine and session pair seen twice with any difference becomes one pending row. Pinned by the Seat Gauge tests. Feeds #7. TN-66 says the `stale` field should change.

#### TN-18 When a session's figures count

A session's figures count as current only when the publication, the map's read of it and the session's own `as_of` are each at most 90 seconds old and not in the future. Its timeline must also hold together: `closed_at` present exactly when the status is closed or superseded, `started_at` no later than the end, and the elapsed seconds matching. It must name a repository and a section and at least one PR or ticket. Rows that fail stay visible as pending with a reason. Row ids are the JSON of the machine and session pair and must be unique, or the whole report is dropped. The screen re-renders at the earliest expiry. Pinned by the Seat Gauge and display tests. Feeds #7. The port needs a publication cadence well under 90 seconds or nothing will ever count.

#### TN-19 Agents shown on a card

This presence rule is separate from TN-18. For 15 minutes after the last publication, a card shows the open sessions placed on it, working first, then newest start. With no open session it shows the most recently closed one, dimmed. A working session spins the card's build step even when its figures are pending. The header counts only current, working sessions. Pinned by the card-agent tests. Feeds #7 and #10.

#### TN-20 Where a session is placed

A session's repository comes from a configured label map, else from a workspace-name pattern, and must be one of the project's repositories (compared ignoring case). Its PRs are the open PRs whose head repository and branch match exactly. Its ticket comes from a branch pattern, else from a number in the workspace name. Its section is the first that exists among each PR's section, the ticket's section and the section the publisher named. When a pattern is configured and the session has no PR and no placed ticket, it adds only to an anonymous count. Pinned by the Seat Gauge tests. Feeds #7.

#### TN-21 A failed publication read keeps the last report

When the publication cannot be read or fails its checks, the previous report is kept with its original dates and marked pending. Each kept row is placed again under the current config, and rows that no longer map join the anonymous count. Pinned by the Seat Gauge tests. Feeds #7.

### Sync and the local server

#### TN-22 How Sync is guarded and joined

Sync is a POST with no body, to exactly `/sync`, from a page on the same loopback origin: the Host and Origin headers must match the server's own address and port, a custom header and an exact JSON content type are required, `Sec-Fetch-Site` must be absent or same-origin, and there is no CORS grant, so a cross-site page cannot send it. Presses while a Sync runs join the same job. The server runs the card collector and then the agents collector, each in its own process group with a five-minute deadline, and calls the Sync complete only when the files written since it began are fresh, complete and error-free. A site-version fault is a warning, not a failure. The screen then re-reads the files and checks they are no older than the server says. Pinned by the Sync tests. Feeds #9. TN-63 is the part that must not carry over.

#### TN-23 Every request is guarded

Every request must name the exact loopback host and port and carry no Origin or the same origin. Only GET serves files: the built page, its assets and a fixed list of data files, resolved through real paths that must stay inside their folder. Symlinks pointing out, `..` segments and malformed escapes are refused, and every response is `no-store`. Pinned by the server tests. Feeds #9.

### Served site versions, loading bay, map gaps, project tabs

#### TN-24 Served site versions

For each of up to ten configured HTTPS sites, the engine fetches a small build file and the home page's meta stamp, with no redirects, a five-second timeout and size limits. The two must agree on one clean 12-character revision. The engine then checks that revision is an ancestor of main and counts the distinct merged PRs whose merge commit lies between them, up to 1,000 commits, with consistent paging and no duplicates. Anything uncertain shows pending. The last known value is carried forward per site. Pinned by the version tests. Feeds #6. TN-43 and TN-50 are bugs in how it ages and reports.

#### TN-25 Loading-bay status

Each PR's loading-bay status comes from its dated lifecycle events, in this order: merged; pending if closed or its history is incomplete; queued if the last queue event is queued; dropped if the last event is a drop; ready only from the configured label; otherwise opened. Events are de-duplicated by id and sorted by time. A bay with duplicate PR keys is rejected whole. Pinned by the loading-bay tests. Feeds #6.

#### TN-26 The map-gap census

A map gap is a changed file path, in any tracked open or merged PR, that no section of the section map owns. The count shows only after a complete census of every PR's file list at its exact head and base revisions; the last complete count is kept with its date after a failure. Cached file lists are reused only when head and base are unchanged. The report is published only when the section map's digest matches the one it was counted against. Pinned by the map-gap tests. Feeds #6. TN-60 is the cap that turns permanent.

#### TN-27 Project tabs

The optional tab list holds 1 to 20 entries of id, title and address, with unique ids and unique addresses, each address exactly `http://127.0.0.1:<port>/` with an explicit port. An invalid list is rejected whole and the plain title is shown instead. The active tab is the entry whose id matches the snapshot. Pinned by the map-link tests. Feeds #9 and #11. TN-67 is the one gap. In a single-process app the address check becomes a project-id check.

### The kept screen

#### TN-28 What the screen polls

The screen polls `snapshot.json` every 60 seconds (keeping the previous board until the new one arrives), `versions.json` and `maps.json` every 60 seconds, and `agents.json` every 30 seconds, all with `no-store`, and posts the one Sync request. A failed read keeps the last data and marks it failed. For a map other than the home one, every request goes through a per-map path prefix. A slow visit to an earlier map can never overwrite a later one. Pinned by the map-visit tests. Feeds #9. TN-57 covers what is wrong with the polling itself.

#### TN-29 What the screen reads from the snapshot

The screen uses a small part of the snapshot: the map id, title, generation time, progress basis, ticket progress, loading bay and map gaps; the audit date, product repository, last GitHub run and plan commit from its sources; total days; stages and their nodes (id, title, text, row, units); each PR's number, title, address and merge time; the unplaced PRs; the diagram's wires; the queue figures; and the per-section work (scope, review, open PRs, blockers, missing steps, planning, spec documents, state). The four-hour and thirty-minute stats, the stalled flag, fog, frontier, destination, switch-ons and inferred PRs are never read. Feeds #9: this list, not the old snapshot, is the starting point for the engine-to-screen contract.

#### TN-30 Camera geometry

At 100%, the first four stage columns and their gaps fill the window width less a 12 px margin each side; maps with fewer stages are padded with phantom columns, so 100% is the same scale everywhere. A column is 228 px, so a 1,080 px window opens at exactly scale 1. Zoom runs from the smaller of "whole map fits" and 25% up to 200%, and the readout is the scale relative to 100%. Geometry changes under half a pixel, measured against the last applied geometry, are ignored, which stops one browser's sub-pixel snapping from re-homing the camera every frame. Pinned by the camera tests and two proof files. Feeds #10.

#### TN-31 CSS zoom and real 1 px borders

The board scales with CSS `zoom`, not a transform, and pans with a translate divided by the scale. Card frames, bars and dividers are real 1 px borders, never inset shadows, so both browser engines snap them to whole device pixels at fractional zoom. The only automated proof is one Playwright test inside a `sol*` proof file, which checks the computed border at three zoom levels on both engines. Feeds #10: copy that case into the new suite before the proof files go.

#### TN-32 Cards never leave the window; zoom steps in whole tens

On each axis, if the cards are smaller than the window less its margins they are pinned top-left; otherwise the offset is clamped so cards always cover the window, 12 px in from each edge. The + and − keys and buttons go to the next whole ten of the readout (93 to 100 to 110, and 100 to 90), within the limits. Zooming keeps the point under the cursor or pinch still. The wheel pans; shift turns vertical into horizontal; Ctrl or Command with the wheel zooms; Safari's pinch uses its own gesture events. Pinned by the camera tests. Feeds #10.

#### TN-33 A drag never selects text, follows a link or opens a card

A press anywhere on the board starts a pan, including on cards, links and buttons; only call-outs and form fields keep their press. A drag starts after 4 px. While dragging, hover and tooltips are off. The native drag start is cancelled, and after a drag the next click on a link or button is swallowed; a keyboard click never is. A card opens only on a press that did not move. Only keyboard focus pans an off-screen card into view. Feeds #10. Only scripts that need two live servers prove most of this (TN-71); the port needs a self-contained browser test.

#### TN-34 Saved view, theme before first paint, call-out placement

Each map keeps its zoom, position, theme, toggles and overview tab in browser storage, keyed by map id, with each field checked on its own; blocked storage gives defaults and never throws. A small inline script paints the saved dark theme before the app loads. A card call-out sits beside its card, right if there is room and left otherwise, 440 px wide or the container less margins, height capped at 600. A header call-out sits 8 px below its button, right-aligned. A tooltip centres on its anchor, flips below when there is no room above and hides when the anchor is off-screen. Pinned by the saved-view, theme and call-out placement tests. Feeds #10.

## Wrong

Each finding gives the behaviour, the input that shows it, and the test that pins or misses it. Fix them in the port; do not copy them. Several change numbers on the live maps, which matters for the side-by-side check (see question 3 at the end).

#### TN-35 A large history can never finish its first card read (high for big projects, probe)

All repositories and kinds share one budget of 300 pages per card read. A project with more than about 7,500 merged and closed PRs plus issue pages cannot finish its first read. The read fails, keeps nothing it fetched, stays "never read", and the five-minute timer starts it over on every tick, spending shared budget each time. Input: one repository with 7,600 merged PRs. Result: 300 calls, an empty read time, nothing kept, and the timer decides to read again. No test covers it. Feeds #12.

#### TN-36 The daily backstop cannot recover a change the search missed (medium, probe)

Once a day the changed-only read skips its search and re-reads every repository "incrementally" as a backstop. But every earlier run moved every repository's read mark to "now", including repositories the search said were unchanged. So the backstop only reads the last few minutes. Input: a full read at t0; an issue updated at t0+30m that the search misses at t0+1h; the backstop at t0+25h. The backstop's issue list still lacks the change; a full read has it. The existing test only checks that no search was sent and how many reads ran. Fix: the backstop reads from the last full read less the overlap. Feeds #12.

#### TN-37 One truncated item turns every Sync into a full read, and blanks agents and the loading bay (medium, probe and trace)

One flag means two things: "the read finished" and "nothing was cut short". A single PR with more than 100 labels, reviews or closing links, or an issue with more than 100 labels or blockers, sets the whole read incomplete. That switches off every incremental path on later runs: with 60 merged PRs and one carrying 101 labels, the next Sync with nothing changed makes 6 GraphQL calls and reports a full scope, where one search was expected. The same flag gates session matching (TN-20) and the loading bay, so every session joins the anonymous count and the bay shows pending. No test covers a read that finished with truncation. Fix: two flags, and per-item truncation. Feeds #12.

#### TN-38 Ticket references are parsed by seven patterns with different rules (medium, probe)

References such as `#n`, `repo#n`, `owner/repo#n` and issue addresses are matched by at least seven separate patterns. Placement reads keyword references with no Markdown awareness, so references inside code count; ticket closing reads parsed Markdown, so they do not. After a closing keyword, only the first of several issue addresses is kept: "Closes url1, url2" yields one issue. Prose matching has no left word boundary: "Fixes C#12 and refs foo.bar#3" yields two bogus references. Fix: one reference grammar and one Markdown-aware extractor, shared by placement, closing, blockers and absorption. Feeds #6.

#### TN-39 Next up labels a blocked ticket "Ready" (medium, probe)

When one open issue blocks two open tickets in the same section, only the first is recorded as blocked, because blockers are de-duplicated by the blocker alone rather than by the pair. Input: #2 blocks #7 and #9. Next up shows #9 as Ready, and the blocker count and list show one entry. The next-up tests only ever use one blocker per ticket. Feeds #6.

#### TN-40 A spec counts as built when its tickets were closed as not planned (medium, trace)

A spec is built when all its mapped tickets are closed, whatever the close reason. Ticket counting treats not-planned and duplicate closes as dropped or absorbed, never done, and the contract says only completed closes earn credit. Input: a spec with two tickets, both closed as not planned. It shows built. The spec tests have no not-planned case. Feeds #6.

#### TN-41 Unit days are shared out to cards outside the map (medium, probe)

A unit's days are split over every card in the unit, including cards outside the plan or not on the map, so a section's counted days and days left come out too small. Input: a 6-day unit with three cards, one done, one open in the section, one outside, unit built 0.5. Each card weighs 2 and days left is 1; split over the counted cards, each weighs 3 and days left is 1.5. No test covers it. Feeds #6.

#### TN-42 One machine's reported problem makes every machine's sessions pending (medium, trace)

If any one machine reports a problem in the publication, the whole report is marked pending, so every session from every machine goes pending and the header shows the publisher as pending, though the file is fresh. The contract describes the problem check per machine. Input: two machines, one healthy, one with a problem entry. Expected: only the second machine's rows go pending. The existing test uses one machine, so it cannot tell the two apart. Feeds #7.

#### TN-43 Site versions show "stale" ten minutes after every Sync (medium, trace)

Since GitHub reads were cut back, site versions are refreshed only by Sync, never by the timer. The screen still marks any version reading older than ten minutes as stale and hides the merge distance. Map gaps and the loading bay, under the same change, keep their last read with its time. Input: a Sync, then the timer, then the screen at +11 minutes: "Merge distance pending". The README still says the timer refreshes versions. No test renders site versions after ten minutes. Feeds #6.

#### TN-44 A stage bar averages a section with no scope yet as 0% (medium, probe)

A stage bar averages its sections equally and counts a section with no approved scope weights as 100% planned. The project header goes pending in the same case. Input: a stage with section a at 80 live and 10 merged, and section b with no units. The stage shows 40 live and 5 merged, not pending; section b alone says "Progress pending". The stage test checks the pending flag but not the bar. Feeds #6.

#### TN-45 Days left counts cards as days on section-scored maps (medium, probe)

On a map scored per section rather than per unit, every card weighs 1, so "days left" reports cards left worded as days. Input: ten cards, four done, section score 0.6: "4 days left". The days-left test covers unit shares only. Section scores come from the retired model re-checks, so the bug goes with them, but the guard must become "the shares carry unit days". Feeds #6.

#### TN-46 A partial merge read hides the merge panel (low, probe)

If the first merge-panel query succeeds but a later page stops on budget or fails, the queue figures are still stamped with the new read's time, so the screen's "show last good figures" rule treats them as a failed current read and shows pending. Input: a good run, then a run whose budget drops to 900 after the first call. The panel goes from shown to pending. The freshness tests cover only runs that never touch the queue figures. Feeds #12.

#### TN-47 Clock-hour bars count a merge on the hour in the previous bar (low, probe)

Each clock-hour bar counts merges after its start and up to and including its end. A merge stamped exactly 1:00:00 pm lands in the 12 pm bar, and a merge exactly at the oldest bar's start drops off the chart. Clock hours should be start-inclusive. The clock-hour test pins the wrong edge. Feeds #6 and #10.

#### TN-48 A reviewed PR with a leftover debt label is missing from "Reviewed" (low, probe)

A merged PR that still has a review-debt label but has an accepted approval receipt counts its lines as reviewed, yet appears only under "Marked for review", not under "Reviewed". The contract says both. No test covers it. Feeds #6.

#### TN-49 The header's "updated" time drops the date (low, probe)

The header shows only the clock time of the last snapshot, so a snapshot several days old reads as if it were made today. Input: a snapshot from the previous day shows "12:40 am". Expected: the date whenever it is not today. No test covers it. Feeds #10.

#### TN-50 Site-version reasons get lost (low, trace)

When the main revision or the rate limit cannot be read, every site shows a generic "unavailable" reason, because the catch keeps only messages with certain prefixes and this one does not match. Separately, any error from the version step is published as "configuration is invalid" with no sites, which throws away every site's last known value. Feeds #6.

#### TN-51 The open-PR count's hover always says "pending" (low, trace)

Each card's open-PR figure shows "open PRs pending" on hover even when the number is known: it is the only count with no title of its own, and the fallback does not check for a value. No test covers it. Feeds #10.

#### TN-52 Map shortcuts swallow the browser's own zoom on macOS (low, trace)

The 0, + and − shortcuts let Ctrl and Alt through to the browser but not Command, so on macOS Command-plus, Command-minus and Command-0 zoom the map and block page zoom. No test presses a modifier. Feeds #10.

#### TN-53 Cards do not open with Space (low, trace)

Cards present themselves as buttons but open only on Enter. They also hold focusable bar segments and a link inside the button. Feeds #10.

## Fragile

Correct today, or not proved wrong, but easy to break or blocking the new platforms. Each says what would prove or fix it.

#### TN-54 The design package comes from a private repository (high)

The screen takes eight design tokens and three web fonts from a package fetched by git from a private repository at a pinned commit. Without that checkout the whole install fails, not just the styling. No script from the package is used, yet it pulls in an icon library. The fonts are open packages. Fix: inline the tokens and depend on the font packages directly. Separately, the archive's files carry an AGPL licence header. Every commit is the maintainer's, so code carried into this MIT repo is relicensed on copy and its headers change. Feeds #10.

#### TN-55 The built-but-unmerged share only ever came from retired estimates (high)

The scope bar's "built but unmerged" share is non-zero only when a model estimate of the open work exists with matching evidence. Without one it is always 0, and the section is marked pending whenever it has open PRs. The merged share also takes the higher of the audit's code share and a per-unit estimate that can itself come from a model. With estimated scope retired, release one needs either a deterministic source for this share or a bar without it. See question 1 at the end. Feeds #6.

#### TN-56 Fixed UTC+10 display, and chart buckets that depend on it (medium)

Every time is formatted at a fixed UTC+10 offset with no daylight saving and no zone marker on chart labels or short times. A viewer elsewhere sees times that are not theirs; in a daylight-saving zone at UTC+10 the map is an hour behind for half the year. The clock-hour chart buckets on UTC hours, which is right only because the offset is a whole number of hours. Day keys roll over at 14:00 UTC. One review series left nine proof files, from rounds numbered up to thirteen, most of them re-proving this one formatter. Fix for the port: format in the viewer's zone, and bucket the chart on the viewer's local hour boundaries so zones at half or quarter hours also work. Feeds #10 and #6.

#### TN-57 Polling never backs off, never times out, and one failed read blanks the panels (medium)

Every poll runs on a fixed interval through failures, a hidden tab or a request still in flight, and nothing aborts a hung request. One failed snapshot read marks the merge panel, ticket figures and placement counts pending until the next success, up to a minute, though the last good data is still in memory. The retired re-check poll asks for a missing file every five seconds on every map. A browser test with a stalled server would prove the pile-up. Feeds #9 and #10.

#### TN-58 Perl lock helpers around every collector (medium)

Each collector run is wrapped in two Perl kernel-lock helpers: a shared checkout lock, then an exclusive publication lock, each waiting up to 120 seconds. The helper takes the lock and then becomes the command, so the lock lasts exactly as long as the command, and a busy lock exits with code 75. If Perl is missing, the launcher swallows the spawn error and exits 1 with no message. On Windows, Perl emulates exec by starting a child and exiting, so the lock may not cover the command. Keep the semantics (one writer per output, shared readers, exit 75 for busy); hold a native file lock inside the process instead. Feeds #9.

#### TN-59 Other macOS-only assumptions (medium)

Beyond Perl, the engine assumes macOS: a fixed Application Support path for the Seat Gauge publication, launchd jobs for scheduling and keep-alive, a Homebrew search path, POSIX process-group kills on the Sync deadline, a refusal of external-volume paths, and a launcher that opens the page in Chrome's app mode. None of it carries over; each needs a per-platform answer in the Tauri layout. Feeds #9 and #14.

#### TN-60 PR history grows without limit, and the map-gap caps then stick (medium)

The loading-bay ledger and the merged-PR list keep every PR ever seen and are republished in full in every snapshot. The map-gap census gives up past 2,000 tracked PRs, or when one PR changes more than 1,000 files. Merged PRs never leave the list, so once either cap is passed, map gaps stay pending for good. The tests pin the caps but not that they become permanent. Feeds #6 and #12.

#### TN-61 No example config, and fixtures that cannot ship (medium)

There is no example project config. The richest test fixtures are copies of a live private map, so they cannot be published or turned into the example project. The example project and its fixtures must be written fresh. Feeds #11.

#### TN-62 Synchronous GitHub calls with no timeout, inside the publication lock (medium)

Every GitHub call blocks the process, and the merge-panel and card reads pass no time limit, while the run holds the publication lock. A hung call holds the lock indefinitely; a Sync then waits 120 seconds and exits busy, and timer runs stack up behind it. Feeds #12.

#### TN-63 Sync's success check depends on retired lane fields (medium)

Sync counts the agents collector as healthy only when the direct-lane source flag is false and one exact pending sentence appears in its output. Rewording that sentence makes every Sync report "lane read is incomplete". The Sync tests pin the coupling. About a third of the Sync code starts or reports retired re-checks, deep syncs and audits. Feeds #9.

#### TN-64 The screen's input checks demand retired fields and recount the census (medium)

The screen rejects the whole snapshot unless a retired sweep object and several legacy measure objects are present on every total, stage and card. It rejects the agents file unless retired direct-lane fields are present, though it only uses the Seat Gauge publication and the generation time from it. The ticket check recomputes every count from the ticket lists and rejects the census on any mismatch, retired fields included, so the counting rule lives in both the engine and the screen. Fix in one change: trim the checks with the contract (TN-29), or have the engine serve stubs for one release. Feeds #9 and #10.

#### TN-65 "Last hour" and the newest chart bar count different hours (medium)

The chart's bars are clock hours, the newest being the hour so far, while "Average" and "Last hour" use rolling 60-minute windows. Input: merges at 02:15, 02:30, 02:45, 02:50 and 03:05, read at 03:10: "Last hour" says 5, the newest bar says 1. A read exactly on the hour makes the newest bar a zero-length window that always shows 0. It is documented as intended, but two hour rules on one strip will confuse. Feeds #10.

#### TN-66 Seat Gauge's `stale` field is required but never used (low)

Every session must carry a boolean staleness flag, and a publisher that leaves it out has its whole file rejected, but the engine never reads it. The shared format should make it optional or drop it. Feeds #7.

#### TN-67 Project tab ids are not restricted (low, probe)

Tab ids are trimmed to 1 to 80 characters but not limited to safe characters. An id of `..` makes the per-map path resolve back to the current map's data, so the other tab shows this map's numbers under its own name. Feeds #9.

#### TN-68 Next up and the Tickets bar count different tickets (medium)

Next up lists open tickets with planning labels, which can include fix tickets. The Tickets bar counts every work card the census placed, labelled or not. A card can say "N left" while Next up lists fewer, or different, tickets. Decide one rule in the port. Feeds #6.

#### TN-69 Rounding misbehaves if the shares ever add to more than 101 (low, probe)

When the input shares add to more than 101, the leftover goes negative and the code adds points instead of removing them: inputs adding to 103 round to shares adding to 104. No kept path produces such input today. The port should clamp or assert. Feeds #6.

#### TN-70 Review edge cases (low, probe)

Editing an old "changes requested" receipt, say to fix a typo, puts it ahead of a newer approval, because receipts are ordered by the later of created and edited time. And a complete read whose PRs all change zero lines shows "Review pending" forever, because the bar has an empty state only for "no PRs". Feeds #6.

#### TN-71 Browser proofs are stale or outside the test run (medium)

One browser proof inside the normal test run still asserts a ten-minute ticket expiry that a later change removed, so it should fail against the current code (not run here; running it would settle it). Most of the drag, no-selection and click-swallowing behaviour in TN-33 is proved only by scripts that need two live servers and sit outside the test run. Every test run boots a dev server. Feeds #10.

#### TN-72 Smaller fragile spots (low)

Grouped here because each is small:

- An open PR declared "Ticket: none" counts as "Not placed", while a merged PR declared the same way counts as outside the plan.
- Card read marks use the local start time, while the merge panel uses GitHub's time. A local clock more than ten minutes fast silently skips card changes.
- Output files are written to a temporary file and renamed. That is atomic per file, but there is no flush and no atomicity across the three files a run writes. A corrupt cache file makes every later run throw until someone deletes it.
- Some config is checked only at run time. A wrong spec-membership repository fails every card read. A product repository missing from the repository list silently skips its open PRs.
- The audit's free-text date is parsed two ways: one at fixed UTC+10 and end of day, the other in the machine's zone at start of day. Impossible dates roll over silently.
- The dev server and the built server serve different files, so the browser proofs intercept requests to cope.
- The agent-expiry timer re-arms on every render. With a deadline more than about 24.8 days away it fires at once, in a loop.
- Unselected wires draw as rounded right angles and the selected wire as a curve. Any timestamp even a second ahead of the viewer's clock reads as not yet read.
- Wire strokes scale with zoom, so the 1 px promise holds for borders only.
- A call-out container under 24 px wide gives a negative width.

Feeds #6, #9, #10 and #12 as marked in the companion.

#### TN-73 The docs are stale in places (low)

The contract and README are about 109 KB together and drift from the code. They still describe not-planned tickets earning credit, the timer refreshing site versions, tabs opening separate windows and a lane-document view that no longer exists. Port the code's rule, checked against these findings, never the doc text.

## Dead weight

Code or tests that do nothing for release one. Drop them; do not port them.

#### TN-74 Retired logic woven through kept modules

Retired features are not only whole files; they run through the kept modules too. Roughly: about 90 of the ticket-counting module's 865 lines (an old format version, model re-check credits, per-section model scores); a third of Sync; most of the score-store module except the audit baseline; the estimate, sweep and source-finding fields in snapshot assembly; and the audit, scan, re-check, deep-sync and estimate lines in the app shell, board, card, header and section call-out. The companion lists the line ranges. The port starts from the kept rules above, so none of this needs unpicking in TypeScript.

#### TN-75 Direct-lane data in the agents file

The agents file still carries a lane list built from round event logs, with every lane forced to unknown, and every branch that reads the terminal multiplexer gets empty input. The screen validates the lane fields but never draws them. The only live parts are event-log folding and lane-to-section inference, which feed PR placement step six (TN-12) and the retired sweep.

#### TN-76 Lane documents

The engine still reads lane task and result documents under careful file-safety checks and publishes them. The screen never shows them, and the lane list they key off is always empty now. About 280 source lines and 290 test lines.

#### TN-77 The forwarding proxy between map servers

Each map ran its own loopback server, and a request for another map was forwarded to that server, with headers rewritten and audit tokens swapped. About 120 of its 200 lines serve only the retired audit routes. In one process holding every project none of it is needed; what carries over is per-request project selection and the guards in TN-22 and TN-23. Its proof files include two pairs that differ only in a token string or share their first 90 lines.

#### TN-78 Restart on a new tool commit

The server checks its own git commit every 30 seconds and exits when it changes, relying on a keep-alive job to start the new code. A desktop app with its own updater does not need it.

#### TN-79 Numbers computed and never shown

- The "above 90%" scope flag is computed in four places with three formulas and read by nothing. Card tone has its own rule (TN-02).
- A second, label-only review rule in the snapshot counts a merged PR as reviewed when it has no debt label. Nothing shows it, and it contradicts TN-08.
- The four-hour buckets, per-hour average, thirty-minute count, stalled flag and approved-PR count are computed for "older readers". The screen recomputes its own buckets. The approved-PR search runs on every merge-panel read for nothing.
- Map-gap files seen, PRs with gaps and top gap folders are validated and never shown.

#### TN-80 Merged PRs stored twice and placed by two systems

The product repository's merged PRs are read twice. The merge panel keeps a slim record; the card read keeps a full one. Two different placers handle them, and a "legacy" filter reconciles the two. The port should keep one merged-PR store and one placer. The merge panel's queue query also hard-codes the branch name `main`, so a repository with another default branch shows the queue as unknown.

#### TN-81 The same rule written twice

- The pending bar, zero-segment filter and "<1%" wording are defined in two screen modules with slightly different rounding.
- The Seat Gauge qualification check runs twice per render; the second pass alone is enough.
- The saved-view key names are copied into the inline theme script.
- Stages run their own review consistency check beside the project total.
- The ten-minute overlap, one day and the 1,000-point floor appear as bare numbers beside their named constants.

#### TN-82 Hooks with no callers

These have no callers:

- a camera "fit" event that nothing fires;
- a call-out status line that no caller sets;
- a no-project fallback for project scope that the collector never takes, which also uses a 90% test without the tolerance the stages use;
- the polling hook's custom-reader option, which exists only for the retired audit.

#### TN-83 Dead CSS

The project's unused-selector script reports nothing unused because it counts any matching word in any string, including retired files, and ignores element selectors. With retired files left out it finds 8 unused class names and 24 dead rules: the merge chart's old SVG rules, an overridden grid rule, list rules used only by retired audit lists, a rule defined twice, the call-out status line, and the scan-line, estimate and re-check styles. The audit stylesheet goes whole.

#### TN-84 `sol*` proof files

75 files, 9,554 lines. They are review-round scaffolding: one file per review round, often several per round. The time formatter alone collected most of one nine-file series, from rounds numbered up to thirteen. Twelve test files import only retired modules. The other 52 re-prove kept rules that ordinary tests already pin, with a few exceptions (TN-31) whose cases should be copied into the new suite.

#### TN-85 Duplicate and retired-only ordinary tests

- Two test pairs pin the same rule: the "last closed agent" rule, and purple at 90% with the unstarted dash and keep-last bars.
- One proof is an exhaustive copy of the half-pixel camera test.
- Three browser proofs copy the same 90-line fixture.
- Four camera scripts re-check the same claims against live servers.
- Several ordinary test files cover only retired code: the old version-2 scores, section scores, the scan line, the estimated-scope reader budget, lane joins in the reader tests, and the deep-sync and re-check Sync tests.

#### TN-86 The macOS launch scripts

The installer, run script and window launcher (about 200 lines with the Perl helpers) exist to drive launchd jobs. All of it is retired.

## Retired code: where it lives and its size

Whole files only; the woven-in lines are TN-74. The companion lists every file.

| Retired feature | Where it lives in the archive | Source lines | Test lines |
| --- | --- | --- | --- |
| Codex code-evidence audit, with scan status and its screen panels | 40 files across the command-line, core, reader and screen folders, plus a Perl process guard and one stylesheet | 6,650 | about 6,800 |
| of which: the local-model audit runtime | two reader modules | 335 | included above |
| Estimated scope (model effort estimates) | five modules in core, readers and the screen | 1,553 | about 3,100 together with the next three rows |
| Luna re-checks and model unit scores | three core modules | 641 | (above) |
| Sweeps | the sweep command and the inference module (one function of it, section-of-path, is kept as TN-11) | 952 | (above) |
| Deep sync | one core module, plus a dialog and button in the screen | 283 | (above) |
| Direct herdr reads | inside the agents module and the agents collector (TN-75) | woven in | in the reader and stage tests |
| macOS launchd jobs | the ops folder (TN-86) | about 200 with the Perl helpers | none |
| `sol*` proof files | the scripts and test folders (TN-84) | 1,115 in scripts | 8,439, of which about 1,600 exercise only the features above |

## Questions for the maintainer

These are product calls. The doc is written around the recommended answer in each case, so nothing waits on them.

1. **The "built but unmerged" part of the scope bar.** In the old engine this part only ever came from a model estimate of open work, which is retired (TN-55). Without it, the part is always empty and sections with open PRs sit "pending". Option A: drop the part, so the bar has live, merged and planned only. Option B: fill it from plain evidence, counting tickets named by an open PR as built but unmerged, weighted by unit days. B keeps the four-colour bar and is deterministic, but it credits work that may be half done. Recommended: B, labelled "has an open PR" in the hover so nobody reads it as finished.

2. **Placing PRs by the lane that opened them.** One step in PR placement (TN-12) reads the build fleet's own round logs to find which lane opened a PR. That log format is private to the maintainer's setup and means nothing to anyone else, and agents now come only through Seat Gauge. Option A: drop the step; PRs place by their Section and Ticket lines, links and changed paths. Option B: keep it as an optional, documented input. Recommended: A. A PR that relied on it shows as "not placed" until its body names a section, which the PR rules already ask for.

3. **Fixed bugs against the "same numbers on every card" switch-over.** Several wrong findings (TN-39, TN-40, TN-41, TN-44 and the dropped lane step) change numbers on the live maps when fixed. Option A: the side-by-side check passes when every card matches, or differs only by a listed finding id. Option B: build the Rust engine bug-compatible first, switch over, then fix. Recommended: A. The switch-over still needs every card explained, and the bugs are not rebuilt on purpose.

## Private companion

A private companion issue on the archive repository holds the file and line references, the probe inputs and the private names for every finding here, keyed by the same ids.
