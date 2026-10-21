# PR placement in layers, `where` and `sections`

How the engine places each PR in layers, what each placement shows, the config fields the layers need, and the two commands a merge tool or CI can call: `work-map where <pr>` and `work-map sections`. Resolves #45.

Inputs: the maintainer's [batch two attribution answers](https://github.com/LaunchAstro/work-map/issues/2#issuecomment-6308898124) (Q2 revised, Q31, Q32, Q33), `docs/spec/must-carry-over.md` (MC-22 to MC-28, MC-53, MC-54, MC-58, MC-65, KD-23, KD-30, KD-36), `docs/seat-gauge-file/README.md` (`workspace_pattern` and `pr`), `docs/spec/config-v2.md` (CF6, CF9, CF14), `docs/spec/app-layout.md` (L2, L21 to L23), `docs/spec/release.md` (R6, R7, R14), `docs/spec/github-budget.md` (B2, B11, B12), `docs/spec/own-map.md` (OM3, OM5, OM7), and the private archive's placement code and tests, read on 21 October 2026.

## The answer in short

- One placement per PR, first match wins, in five layers: what the PR says, what it changes, who made it, a guess, else Not placed. Every placement names its layer, its rule and the evidence. Every Not placed PR names its reasons.
- The kept order of MC-26 fits inside the layers. Prose tickets now come before changed files (Q19), and the frozen model placement drops to layer 4, marked as guessed (KD-40). Ticket ids follow per-project patterns (KD-41). The agent's workspace is new (KD-42).
- Config v2 gains one optional block, `attribution`: the ticket id patterns, a branch ticket pattern and the check mode. `seatGauge` gains `workspacePattern`.
- Map gaps warn and are recorded. They never hold a merge (Q33).
- `work-map where <pr>` answers "lands in this section, by this layer, because of this", or "won't land" with reason codes, as text or JSON, with exit codes 0, 1, 2 and 5. It reads GitHub with a handful of calls and never writes to it.
- `work-map sections` prints the section ids, names and owned paths. Both commands run from the one binary and from `work-map-cli.exe` on Windows. Together they replace the shell check in `AGENTS.md` (OM7).

## Settled by the maintainer

- (Q2, revised) Placement in layers, most reliable first, with configurable id formats and workspace pattern, and AI placement in release two only.
- (Q31) A "where would this PR land?" command with machine-readable output and stable exit codes, plus a section list. The map never writes to GitHub; the merge tool acts on the answer.
- (Q32) This repo is strict: every PR names a real section with a `Section:` line.
- (Q33) Files no section owns warn as map gaps and never hold a merge.
- (Q15, settled through Q20) Section ids and seat names are one word, so Seat Gauge splits a workspace label from the right: seat last, section before it, the rest is the repo. Its repo-label list is a fallback for older labels only (PL13).
- (Q18) Any placing rule is enough for a PR to land by default; strict is per project, and this repo is strict (PL16).
- (Q19) Tickets a PR mentions in prose beat its changed files, as the layer order says (step 6 before step 7). Each card this moves at switch-over is recorded on the known-differences list under KD-40.

## Why the old engine missed ids like `P11` and `S0-1f`

The archive's id matcher has three limits:

- It knows only ids that are rows of the plan's unit table. A ticket-count map with no plan file has no known ids, so no id in a PR title or branch counted there at all.
- An id followed by a hyphen and a letter or digit never counts, and nor does one preceded by a hyphen. That guards `C71` inside `C71-CHAIN-3`, but it also refuses `plan/P11-zoom`, `wm/S0-1f-fix` and `fix-P11`, which is how branches are usually named.
- It compares case exactly, so a lower-case branch such as `p11-zoom` misses.

## The layers

| Step | Layer | Rule code | What places the PR | Kept from |
| --- | --- | --- | --- | --- |
| 1 | 1 | `section_line` | Its own `Section:` line | MC-25, MC-26 (1) |
| 2 | 1 | `ticket_id` | An approved mapping entry, else a declared `Ticket:` or `Unit:` line, else a known id in its title or branch | MC-24, MC-26 (2) |
| 3 | 1 | `ticket_none` | `Ticket: none`, which puts it `outside` | MC-26 (3), KD-23 |
| 4 | 1 | `override` | The project's entry for the PR's own key | MC-26 (4) |
| 5 | 1 | `closed_ticket` | The first placed ticket among its closing links and keyword references, then the ticket its branch names | MC-26 (5), new |
| 6 | 1 | `prose_tickets` | Tickets named in prose, when all sit in one section (Q19) | MC-26 (7), moved |
| 7 | 2 | `changed_files` | The section most of its owned changed files point to | MC-26 (6), moved |
| 8 | 2 | `repository_default` | The repository default on a ticket-count map | MC-26 (8) |
| 9 | 3 | `session` | The section of the agent session that made it | new |
| 10 | 4 | `frozen_guess` | A merged PR's frozen model placement (Q1) | MC-26 (6), moved |
| 11 | 4 | `ai_guess` | Release two only; reserved | new |
| 12 | 5 | `not_placed` | Nothing above | MC-65 |

**PL1. One placement, first match wins, and it says why.** The engine runs the steps in order and stops at the first that places the PR. The placement carries `layer`, `rule`, a one-line `evidence` (at most 200 characters, such as `Section: editor` or `7 of 9 owned files in editor`), `inferred` (every rule but `section_line` and `ticket_id`, as MC-26 had it) and `guessed` (layer 4). A PR is placed once, against the ticket sections the maps decided (MC-28).
Test: a PR with a Section line, a closing ticket in another section and owned files in a third places by step 1 with `inferred: false`; without the line it places by step 5 with `inferred: true`, and the closing ticket's section is the evidence.

**PL2. The Section line.** As MC-25: a whole diagram id after `Section:`, compared exactly, and the first such line wins. A line naming no section on the diagram is skipped and leaves the reason `unknown_section` with the name it gave, so the later steps still run. Two lines naming different sections leave `several_section_lines`, and a line with more after the id leaves `section_line_extra_text`; the first only matters to the strict check (PL16).
Test: `Section: editr` on a PR with owned files in `progress` places by step 7 and lists `unknown_section` naming `editr`; `Section: docs and more` places on `docs` with `section_line_extra_text`.

**PL3. Known ids and how a title or branch names one.** The known ids are the plan's unit and ticket ids (scope maps) and the ids that `attribution.ticketIds` reads from each tracked ticket's title. A known id must contain a digit. In a PR's title or branch, an id counts where it starts the text or follows a character that is not a letter, digit or underscore, and ends the text or is followed by one; hyphens, slashes, colons, brackets and spaces all end it. At one position the longest known id wins, so `MP-1-20` is never read as `MP-1-2`. Case is ignored, ASCII only. An id held by tickets in more than one section places nothing, with `ambiguous_id`. MC-24's other rules stand: a declared line beats the title, `none` with an id places nothing, and a body-only mention is a candidate.
Test: with tickets titled `P11: Zoom` and `[S0-1f] Fix` and the patterns `^(P[0-9]+):` and `^\[([A-Za-z0-9-]+)\]`, the branches `plan/P11-zoom`, `p11-zoom` and `wm/S0-1f-fix` and the title `Fix S0-1f.` each place on that ticket's section; `C71` stays unread inside `C71_X` and `C710`, and `MP-1-2` inside `MP-1-20` when both are known.

**PL4. Closed tickets and the branch's ticket.** Step 5 takes the closing links GitHub reports, then the closing lists in the body (MC-23), then the ticket number `attribution.branchTicket` reads from the head branch, in the PR's own repository. The first ticket that a ticket rule (MC-27, MC-28) places wins. Disagreeing tickets leave a `closing_tickets_disagree` note (KD-36). A closed ticket that no rule places, or that sits in a repository the project does not list, leaves `closed_ticket_not_on_map` naming it.
Test: `Closes #12, #13`, with #12 unplaced and #13 in `search`, places in `search` with `closed_ticket_not_on_map` for #12; the branch `wm/14-tidy` with no closing link places on #14's section.

**PL5. Changed files.** Each changed file goes to its owner by MC-53. Shared files do not vote. The section with the most owned files wins, and a tie goes to the lower section id, as the archive does, with a `files_tie` note naming the tied sections. Files no section owns are map gaps (PL10). A PR with no section map gets `no_section_map`, with no owned file `no_owned_files`, and with more than 3,000 changed files (GitHub's own list limit) `too_many_files` (KD-29).
Test: 3 files in `editor`, 3 in `search` and 2 gaps place in `editor` with `files_tie` and two map-gap paths.

**PL6. Who made it.** Step 9 ties the PR to Seat Gauge rows. A row ties when its `pr` names this PR (repository ignoring case, and number), or when its `branch` equals the PR's head branch, the head repository is the base repository (so a fork never ties) and the row's `repo` label maps to the PR's repository through `seatGauge.repositories` (MC-58). The section is the row's `section`, matched exactly, else ignoring case when one section matches. Rows that name different sections place nothing, with `sessions_disagree`. Rows of any status count, closed ones included. Each placement made here is kept in the project's state with the rows' keys, so a merged PR stays placed after Seat Gauge drops the rows; a later row that names another section turns it into `sessions_disagree`. The engine never derives `section` from `workspace` itself (Seat Gauge file spec). When the file's `workspace_pattern` differs from `seatGauge.workspacePattern`, the placement stands with a `workspace_pattern_differs` note.
Test: `attribution.json` at the test clock, over a diagram that holds `S0-1f` and a PR list that holds PR 57, places PR 57 in `S0-1f` by layer 3; the row with a null section leaves `session_no_section`; after the rows are removed from the file, the placement stays.

**PL7. A guess is marked as one.** Step 10 takes a merged PR's frozen model placement (CF17, Q1) and marks it `guessed`. The screen tags it "guessed" with the date the old model wrote it. Release two's `ai_guess` takes step 11, runs only with AI scoring on, and is settled with the release-two scoring tickets (#40). Release one never calls a model to place a PR.
Test: a merged PR whose frozen placement says `search` and whose owned files point to `editor` places in `editor` by layer 2 (KD-40); with no owned files it places in `search`, `guessed: true`.

**PL8. Not placed, with every reason.** A PR no step places is Not placed. It carries the reasons every step left, in step order, each as `{ code, layer, detail }`. The codes are listed under PL15. The screen shows the first reason as a sentence and the rest on hover.
Test: an open draft PR that names nothing, changes one unowned file and has no Seat Gauge row is Not placed with `no_section_line`, `no_ticket`, `no_owned_files`, `no_session` and `no_guess`, in that order.

**PL9. Tickets and sessions keep their own order.** Tickets keep MC-27 and MC-28 exactly, with two changes: MC-27's bare id in a title uses PL3's ids and matching, and each ticket placement carries its rule and evidence the same way. A ticket placed by MC-28's closing-PR pass inherits that PR's `guessed`. Sessions keep MC-58: a session takes its section from its PRs' placements. A PR placed by step 9 gives its session nothing new, because that section came from the session's own row, so no loop forms.
Test: a ticket placed only through a PR that a frozen guess placed is marked guessed; a session whose only PR was placed by its own row has the row's section.

**PL10. Map gaps warn and never hold (Q33).** Changed files no section owns are recorded as map gaps (MC-54) whatever step placed the PR, and `where` lists them as `map_gap` warnings. A map gap never changes a placement, a verdict or an exit code.
Test: a PR with `Section: editor` and one unowned file exits 0 from `where` with one `map_gap` warning, and the gap shows in the map's gap census after Sync.

**PL11. What the map shows.** Each PR on a card carries its placement (PL1); the hover reads "Layer 2, changed files: 7 of 9 owned files in editor". An open PR placed by an inferred rule keeps MC-65's flag. The Not placed list gives each PR's reasons (PL8). The view adds these fields; no number changes because of them (KD-43).
Test: the screen's fixture for an inferred open PR shows the layer line and the flag; a Not placed PR's hover lists its reasons in step order.

## Config

**PL12. The `attribution` block.** Optional in config v2, and read from a version 1 file as CF18 reads `sites`, so the maintainer can add it to a live file.

| Field | Default | Meaning |
| --- | --- | --- |
| `ticketIds` | `["^\\[?([A-Z][A-Za-z0-9-]*[0-9][A-Za-z0-9-]*)\\]?:"]` | 0 to 10 patterns that read an id from a ticket's title. The default reads a leading id before a colon, in brackets or not, such as `P11:` or `[S0-1f]:`. `[]` reads none. |
| `branchTicket` | none | One pattern that reads the PR's ticket number from its head branch, such as `^[a-z]+/([1-9][0-9]*)-`. `seatGauge.branchTicket`, when unset, uses it. |
| `check` | `"placed"` | How `where` decides: `placed` or `strict` (PL16). |

Each pattern follows CF14: Rust `regex`, at most 256 characters, exactly one capture group. A bad entry is a CF6 problem line naming it.
Test: a pattern with two groups, a 257-character one and `"check": "loose"` are each refused with a line naming the field; no block gives the defaults, and `P11: Zoom` reads as `P11`.

**PL13. `seatGauge.workspacePattern`.** A template, default `<repo>-<section>-<seat>`, checked by the Seat Gauge file spec's rules (`<section>` once, `<repo>` and `<seat>` at most once, literal text between parts). The engine reads `repo`, `section` and `seat` as the file wrote them. Seat Gauge splits the label from the right, so with one-word section ids (CF26) and seat names the default pattern needs no list; its repo-label list only rescues older labels whose section holds a hyphen (Q15, the file spec's workspace labels). It uses its own pattern only to compare with the file's `workspace_pattern` (PL6) and to explain a reason. The existing `seatGauge.workspace` regex, which finds a ticket or PR number in the label, stays (MC-58).
Test: `<section><seat>` and `<repo>-<repo>-<section>` are refused; a file with pattern `<seat>-<section>` gives `workspace_pattern_differs` on its placements.

## `work-map where <pr>`

```text
work-map where <pr> [--repo owner/name] [--config FILE | --project ID] [--check placed|strict] [--json]
```

**PL14. Which PR and which project.** `<pr>` is a number, `owner/name#n` or a PR's github.com address. A bare number takes `--repo`, else the project's `productRepo`; a repository given twice that disagrees is a usage error. The project is `--config FILE`, else `--project ID` from `settings.json`, else the one settings project whose `repos` list the PR's repository (ignoring case), else `.work-map/work-map.json` at the root of the git checkout that holds the current folder (OM3). Several matches, or none, are usage errors naming what was tried.
Test: `where 57` beside a settings file with two projects listing that repository exits 2 naming both ids; `where acme/app#57 --repo acme/web` exits 2.

**PL15. The answer.** The PR is placed exactly as the map would place it (PL1 to PL9), with its reasons and warnings. The reason codes:

| Code | Layer | Meaning |
| --- | --- | --- |
| `no_section_line` | 1 | The body has no `Section:` line |
| `unknown_section` | 1 | The Section line names a section not on the diagram |
| `several_section_lines`, `section_line_extra_text` | 1 | PL2 |
| `no_ticket` | 1 | No known id, declared line, closing ticket, branch ticket or prose ticket |
| `unknown_id` | 1 | A declared id is not a plan or ticket id |
| `none_and_ticket` | 1 | The body declares both `none` and a ticket |
| `ambiguous_id` | 1 | A known id belongs to tickets in more than one section |
| `closed_ticket_not_on_map` | 1 | A ticket it closes is not placed, or is in a repository the project does not list |
| `prose_tickets_disagree` | 1 | Tickets named in prose sit in more than one section |
| `no_section_map`, `no_owned_files`, `too_many_files` | 2 | PL5 |
| `no_session`, `seat_gauge_unavailable`, `session_no_section`, `session_unknown_section`, `sessions_disagree` | 3 | PL6; `seat_gauge_unavailable` covers a missing, newer or failed file |
| `no_guess` | 4 | No frozen placement, or AI placement off |
| `only_guessed` | 4 | Only a guess placed it, which never lands (PL16) |
| `repo_not_on_map` | 5 | The PR's repository is not in the project's `repos` |
| `closed_unmerged` | 5 | The PR was closed without merging, so the map ignores it |

Warnings never change the verdict: `map_gap`, `files_tie`, `closing_tickets_disagree`, `workspace_pattern_differs`, `disagrees_with_ticket` (the placed section differs from a closed ticket's), `inferred`, and MC-65's docs-only warning as `docs_only`.
Test: each code above has a case in the placement tests over the fake GitHub (B04), and each case checks its full reason list.

**PL16. The verdict (Q18).** `placed` (the default): the PR lands when steps 1 to 9 place it, `outside` included. A layer-4 guess does not land: the guess is shown, with the reason `only_guessed`. `strict`, for projects like this one (Q32): the PR lands only when step 1 places it and none of `several_section_lines`, `section_line_extra_text` or `closed_ticket_not_on_map` is present. A closed unmerged PR, or one in an unlisted repository, never lands. `--check` overrides the config for one run.
Test: a PR placed by its files lands under `placed` and, under `strict`, does not land with `no_section_line`; a PR with `Section: editor` closing an unplaced ticket lands under `placed` with that reason listed, and does not land under `strict`.

**PL17. JSON.** With `--json`, stdout holds one JSON object and nothing else. `schema` changes only when a field is removed or changes meaning; new fields and codes may be added within schema 1.

```ts
interface WhereAnswer {
  schema: 1;
  project: string;
  check: "placed" | "strict";
  verdict: "lands" | "wont_land";
  pr: { repo: string; number: number; url: string; state: "open" | "merged" | "closed"; head: string };
  placement: null | {
    section: string;            // a diagram id, or "outside"
    name: string | null;        // the section's diagram title
    layer: 1 | 2 | 3 | 4;
    rule: string;               // PL1's rule codes
    evidence: string;
    inferred: boolean;
    guessed: boolean;
  };
  reasons: { code: string; layer: 1 | 2 | 3 | 4 | 5; detail: string }[];
  warnings: { code: string; detail: string; paths?: string[] }[];
  spent: { graphql: number; rest: number };
}
interface WhereError { schema: 1; error: { code: string; message: string } }
```

An exit 2 or 5 with `--json` prints a `WhereError`. Its codes are `usage`, `bad_pr`, `no_project`, `several_projects`, `config_refused` and `pr_not_found` (exit 2), and `github_not_ready`, `budget_low`, `github_stopped`, `read_failed` and `call_cap` (exit 5).
Test: the JSON for each PL15 case validates against a schema generated from the Rust type, and a signed-out `gh` prints a `WhereError` with `github_not_ready`.

**PL18. Text.** Without `--json`: one first line, then one line per reason and per warning.

```text
lands in placement (Placement): layer 1, Section line "Section: placement"
warning map_gap: scripts/x.sh is owned by no section
```
```text
won't land: no Section line (strict check)
  layer 2 changed_files would place it in placement: 7 of 9 owned files
```
Test: the first line of each PL15 case matches a stored line; no colour codes are written when stdout is not a terminal.

**PL19. Exit codes.** 0: lands. 1: won't land. 2: usage or bad input, a config that fails to load, or a PR not found. 5: could not answer, because `gh` is not ready (L23), the budget is under B11's reserve, GitHub sent a stop signal (B12), a read failed, or the call cap was reached. They are part of R14's command-line promise. A merge tool holds on 1, fixes its call on 2 and tries again later on 5.
Test: one recorded case per code, plus a fake GitHub that fails a read, exiting 5 with `read_failed`.

**PL20. What it reads, within the budget.** `where` gets its token as L22 does and sends one request at a time (B2). It refuses to start under B11's 20% reserve and stops on any B12 signal with no retry. Its calls, in order:
1. The roadmap files, when `files.source` is `github`: the diagram, the section map and the plan, one REST read each.
2. One GraphQL query for the PR: title, body, state, head branch and repository, base repository, the first 100 changed files, and the first 20 closing tickets with their titles, bodies, labels, repositories and parents.
3. Further file pages of 100, only for a PR with more files, up to 3,000.
4. One GraphQL query, by alias, for up to 20 tickets the PR names otherwise (declared lines, the branch ticket, prose), with their parents.
5. Only when the title or branch holds a word with a letter and a digit that the plan does not hold: one GraphQL search per group of 15 repositories for up to 5 such words in ticket titles. The engine keeps only results whose title one of `ticketIds` reads as that word.
6. One GraphQL query per further parent level, up to 4 (MC-27's chain).

A typical PR costs 2 to 4 GraphQL points and at most 3 REST requests. A hard cap of 40 requests ends the run with exit 5 and `call_cap`.
Test: a merged PR with `Section: docs` and `Closes #32` on a local-source project costs one GraphQL query and no REST; a 2,500-file PR reads 25 file pages; under 20% left, `where` sends only `GET /rate_limit` and exits 5.

**PL21. It never writes.** `where` sends only GraphQL queries and REST `GET`s. It writes nothing to GitHub, to the data folder or to the cache, takes no instance lock (L15), and so runs beside a running app or in CI. It reads the Seat Gauge file directly (`SEAT_GAUGE_DIR` honoured) but not the app's saved layer-3 placements, so a merged PR whose rows Seat Gauge has dropped can answer differently from the map; `where` is meant for PRs before they merge.
Test: a fake GitHub that fails any mutation or non-`GET` REST request sees none across every PL15 case, and the data folder's file list and times are unchanged.

**PL22. This repo's merge check.** Once both commands ship, OM7's two shell lines give way to `work-map where "$PR" --json`, holding the merge on exit 1, and the id list comes from `work-map sections`. This repo's config sets `"attribution": { "check": "strict" }` (Q32).
Test: OM5's cases (no line, `Section: doc`, `Section: docs and more`, two lines naming different sections, and Windows line ends) get the same verdicts from `where` as from OM7's lines.

## `work-map sections`

```text
work-map sections [--config FILE | --project ID] [--json]
```

**PL23. The section list.** It loads the project as PL14 does (without a PR), reads the diagram and the section map, and prints every section in diagram order: id, name and owned globs. Text is tab-separated, one section a line, then one `shared` line with the shared globs, then one `warning` line for each CF26 warning (Q20). JSON:

```ts
interface SectionList {
  schema: 1;
  project: string;
  sections: { id: string; name: string; stage: string | null; paths: string[] }[];
  shared: string[];
  section_map: boolean;         // false when the project has no section map; every paths list is then empty
  destinations: ["outside"];    // valid in config rules, never in a Section line
  warnings: string[];           // CF26's lines: ids that are not one word, folders claimed twice (Q20)
}
```

It spends nothing on a local-source project and at most two REST reads on a GitHub one. Exit codes: 0 printed, 2 usage or a config that fails to load, 5 roadmap files unreadable or GitHub not ready.
Test: on this repo's `.work-map/` it prints the ten sections in diagram order with their globs, an empty `shared` line and no warning line; with no section map, `section_map` is false; a diagram holding `sign-in` gives one warning line naming it.

**PL24. Both commands everywhere.** `where` and `sections` join L2's entries and run in the headless build (R3). On Windows they run from `work-map-cli.exe`, and `work-map.exe` refuses them as R7 refuses `serve` (R6, R7). On macOS and Linux the one binary runs them.
Test: R6's PowerShell check runs `work-map-cli.exe sections --config .work-map/work-map.json` in a checkout and gets exit 0; `work-map.exe where 1` exits 2.

## The guide's attribution chain page

`docs/attribution.md`, about one page, written with the build. Each step says what it is, what checks it, and what the map shows when it fails.

1. **Ticket.** Carries an id the project's patterns read, or a `Section:` line, or a label or title prefix a rule maps. Checked by MC-27 and MC-28 on Sync. Fails as a Not placed ticket with its rule list.
2. **Section.** A one-word diagram id, set before any ticket, that owns paths in the section map (Q20). `work-map sections` lists them. Checked by CF10 at load, with CF26's warnings.
3. **Agent workspace.** Named by the pattern (`<repo>-<section>-<seat>` by default). Seat Gauge splits it from the right, seat last, and writes the row (Q15). Checked by PL6 and PL13: the section must be real and the patterns must agree.
4. **PR.** `Section:`, `Closes #n` and a branch that names its ticket. Checked by the layers (PL1).
5. **Merge check.** `work-map where <pr>` in CI or a merge tool, holding on exit 1. `strict` for repos that require the Section line. Map gaps warn and never hold.
6. **Map.** After the merge and a Sync the card counts it, with its layer on the hover. A Not placed PR or a map gap is the next fix.

The page ends with one worked example from this repo's own map and how to fix each reason code.

## Known differences

Four rows join the table in `docs/spec/must-carry-over.md`: KD-40 (the layer order), KD-41 (ticket ids), KD-42 (layer 3) and KD-43 (each placement shows its layer and reasons). The first three can move a number on a card; KD-43 changes hovers and lists only.

## Notes for other tickets

- #9: L2 gains `where` and `sections` (and R7's refused list with them); each view's PRs gain PL1's placement and Not placed PRs their reasons (PL8). `contract` stays `1`.
- #10: the hover line, the guessed tag and the reasons on hover (PL11).
- #11: config v2's table gains `attribution` (PL12) and `seatGauge.workspacePattern` (PL13); CF14's list of patterns gains `ticketIds` and `attribution.branchTicket`.
- #13: KD-40 to KD-43 join the known differences. The switch-over step that adds rows for the three new roadmap readings now starts after KD-43.
- #16: build tickets for PL1 to PL11 in `placement` and `seat_gauge` (about 200 more lines than MC's 1,200), the config fields in `config`, and the two commands in `app` (about 150 lines), each ticket with its `Section:` line. Every PL rule's test is acceptance.
- #46 (merged): `.work-map/work-map.json` gains `"attribution": { "check": "strict", "branchTicket": "^[a-z]+/([1-9][0-9]*)-" }`; its `seatGauge` keeps the default `workspacePattern`, so it needs no new key. `AGENTS.md` and OM7 switch to PL22 when the commands merge.
