# The roadmap file formats

The public formats of the files a project config points at: the diagram, the unit audit, the plan's unit table, the section map and the approved mappings, plus a short word on the other files config v2 names. For each: its syntax, required and optional fields, and what the engine does with a missing file, a malformed entry and an unknown field. Resolves #30.

Inputs: the settled decisions in #3, `docs/spec/config-v2.md` (CF ids), the example in `docs/spec/example/`, `docs/spec/must-carry-over.md` (MC and KD ids), `docs/review/thermonuclear.md` (TN ids), and the private archive's roadmap readers, plan-table parser, table checks, section-map compiler, unit-audit reader and their tests, read on 21 October 2026. Nothing here copies the maintainer's own roadmap files.

## The answer in short

- Four JSON files and one Markdown table. Field names stay as the archive reads them (`boxes`, `asAt`, `approvedBy`), so the maintainer's live files load unchanged at switch-over.
- Roadmap files are lenient where the config is strict. They carry no version, other tools read them too, and people edit them by hand, so an unknown key is ignored and noted in the run log, never refused.
- Only the diagram is required. A broken diagram refuses the project (CF10). Every other file failing switches its own part off with a line on the project's header, and a file that breaks on a later re-read keeps its last good version (as CF5 does for configs).
- Each file sorts its faults into two kinds. A whole-file fault turns the file off. An entry fault drops that one entry and names it.
- The example ships a ticket-count diagram and section map (`example/roadmap/`) and a scope-basis variant with an audit, a plan and mappings (`example/scope/`). Every rule below has a case in those files or a one-line inline case.

## Rules for every roadmap file

**RF1. Encoding and size.** UTF-8, a byte order mark allowed and skipped, at most 4 MB (CF12). A JSON file is one object; comments and trailing commas are a whole-file fault.
Test: `flow.json` saved with a byte order mark loads; one with a `//` comment is refused as not JSON, naming the file.

**RF2. Where files come from.** As CF11 says: the config's folder, the roadmap repository's default branch, or a settings entry's `roadmap` folder. A 404 on GitHub is a missing file. A failed fetch keeps the last good copy with its time.
Test: a GitHub-source project whose section map returns 404 at first poll shows `gaps: null` and a "not found" line.

**RF3. Missing files.** A file the config does not name is simply absent, with no line. A named file that is missing gives one line, `<file>: not found`, and its part is off: no audit or plan means the scope bars are pending, no section map means `gaps` is `null` and no file-based placement, no mappings means no approved mappings. A missing diagram refuses the project (CF10).
Test: a scope config naming `plan.md` with no such file loads with every scope bar pending and one "not found" line.

**RF4. Re-reads keep the last good version.** At load, a failing file is off (the diagram refuses the project). On a later re-read (CF4), a file that now fails keeps its previous good version, and the line says the change was not applied.
Test: breaking `audit.json` after a good load keeps the old scope bars and adds a "not applied" line; fixing it clears the line within one re-read.

**RF5. Problem lines.** Each line is `<file>: <field path>: <what is wrong>` for JSON, as CF6 writes them, and `<file>:<line>: <what is wrong>` for the plan. At most 20 per file. They show on that project's header, never on other tabs.
Test: a diagram with three bad wires gives three lines, each naming `wires[n]`.

**RF6. Unknown keys are ignored.** Keys that start with `_` and the retired keys listed below are ignored silently. Any other unknown key is ignored and named once in the run log for each new version of the file, not on screen.
Test: a section map with `_readme` and `colour` keys loads; the run log names `colour` once and nothing names `_readme`.

**RF7. Ids.** A section id matches `^[a-z][a-z0-9-]{0,39}$` and is not `outside`, so a `Section:` line can name it whole (MC-25). A plan unit id matches `^U[0-9]+$`. A plan ticket id matches `^[A-Z][A-Z0-9]*(-[A-Za-z0-9]+)*$`. Audit unit keys and diagram unit names are 1 to 40 letters, digits and `._-`.
Test: section ids `Editor`, `outside` and `2fa` are each an entry fault; `two-factor` loads.

## The diagram (`files.flow`)

The board: stages left to right, sections as cards, and the wires between them. Example: `example/roadmap/flow.json` (ticket map) and `example/scope/flow.json` (scope map, with units and a note).

| Field | Needed | Default | Meaning |
| --- | --- | --- | --- |
| `title` | no | the config's `title` | The board's title |
| `stages` | yes | | 1 to 12 stage names, 1 to 60 characters each, in order |
| `nodes` | yes | | The sections, and any notes |
| `nodes[].id` | yes | | Section id (RF7), unique in the file |
| `nodes[].title` | yes | | Card title, 1 to 120 characters |
| `nodes[].text` | no | `""` | The card's context line, shown in the call-out and the copied brief |
| `nodes[].stage` | yes | | 1-based position in `stages` |
| `nodes[].row` | yes | | Whole number from 1; cards in a stage sort by row, then file order |
| `nodes[].units` | no | `[]` | Plan or audit units this section owns |
| `nodes[].note` | no | `false` | `true` makes the node a note, not a section |
| `wires` | no | `[]` | Arrows between sections |
| `wires[].from`, `.to` | yes | | `[id]`, `[id, side]` or `[id, side, offset]` |
| `wires[].gap`, `.lane` | no | none, `0` | Route through the gap after stage `gap`, shifted `lane` px |
| `wires[].kind` | no | plain | `dash` or `loop` |
| `wires[].label` | no | none | Shown beside the wire while either end is selected |

**RF8. Whole-file faults refuse the project.** Not JSON, `stages` or `nodes` not an array, no section left after RF9, two nodes with one id, or one unit listed in two sections (MC-02). The config is refused at load (CF10) or the change is not applied on a re-read.
Test: a diagram listing `U02` under both `storage` and `editor` refuses the config, naming both sections.

**RF9. A bad node is dropped alone.** A node with no id, a bad id, no title, or a `stage` or `row` out of range is dropped with a line. Config destinations that named it then fail CF10 by name.
Test: a node with `stage: 4` on a three-stage diagram is dropped with one line, and the other cards draw.

**RF10. Notes are not sections.** A node with `note: true` is not drawn, is not a destination, and wires to it are dropped silently. Under a version 1 config, a node with no `units` key is a note too: the archive's rule (MC-03), kept so the old and new engines agree during the comparison. Under version 2 a node with no `units` is a section with none.
Test: `example/scope/flow.json` draws seven cards and no card or wire for `later`; the same unit-less node under a version 1 config is dropped, under version 2 it is a card.

**RF11. Units place plan ids and weigh scope.** On a scope map, a section's `units` are its scope; a section with `units: []` stays on the board as pending (MC-03). On a ticket map, `units` only link plan ids named in PRs to a section (MC-24); ticket weights come from the unit pattern (MC-33).
Test: `search` in the scope example is a pending card; with the same diagram and plan under a ticket-count config, a PR titled `ST-2 retry` lands on `storage` through U02.

**RF12. Wire ends.** `side` is `l`, `r`, `t` or `b`, default `r` at `from` and `l` at `to`. `offset` runs 0 to 1 along that side, default 0.5. `gap` is 1 to one less than the stage count, and `lane` runs from -200 to 200. A wire naming an unknown id, or with a bad side, offset or gap, is dropped with a line. Another `kind` is drawn plain, with a line. The config's `dependencies` add dashed wires, and the engine adds blocker wires (MC-63).
Test: the demo's `search` wire routes through the second gap; a wire with `kind: "zigzag"` draws plain with one line; one to `serach` is dropped with one line.

## The unit audit (`files.audit`, `progress.unitAudit.file`)

How built and live each unit is, as at one date. One format serves both places: the scope basis reads `files.audit`, and a ticket map with `unitAudit` reads `progress.unitAudit.file`. A ticket map does not read `files.audit` and says so once in the run log. Example: `example/scope/audit.json`.

| Field | Needed | Default | Meaning |
| --- | --- | --- | --- |
| `asAt` | yes | | When the audit was taken (RF14) |
| `units` | yes | | Unit id (RF7) to its scores; may be empty |
| `units.<id>.code` | yes | | Built share, 0 to 1 |
| `units.<id>.days` | no | `1` | Size in days, above 0 and at most 10,000 |
| `units.<id>.live` | no | `"no"` | `yes`, `partly` or `no` (MC-33: the full code share, half of it, none) |
| `units.<id>.title` | no | the plan's title, then the id | Shown in the section brief |
| `units.<id>.why` | no | none | The audit's evidence line, shown in the section brief |

**RF13. Any fault refuses the whole audit.** Not JSON, no readable `asAt`, `units` not an object, or one unit with `code` outside 0 to 1, a bad `live` or `days` not above 0. The audit is then off: scope bars pending, ticket weights by count with live unknown (MC-04, MC-33). A partial audit would move every other unit's weight without telling anyone, so there are no entry faults.
Test: `{ "U01": { "code": 1.5 } }` refuses the file with one line naming `units.U01.code`; a ticket map then shows live as unknown, not 0.

**RF14. Four date forms.** An RFC 3339 time with an offset is exact. A date and time with no offset is local time in the config's `timeZone`. `YYYY-MM-DD` is the last millisecond of that day there (CF16, KD-26). The archive's prose form stays readable: day, English month name and four-digit year (`13 October 2026`), then optionally a clock time with `am` or `pm`, read in `timeZone`. Words around them, such as "about" or a zone name, are ignored. An impossible date is refused, where the archive rolled it over (TN-72).
Test: under `+10:00`, `13 October 2026, about 8:45 pm AEST` reads `2026-10-13T10:45:00Z` and `13 October 2026` reads `2026-10-13T13:59:59.999Z`, as the archive's tests expect; `31 September 2026` and `last Tuesday` are refused.

**RF15. Scope maps check the audit against the diagram.** Every unit a section lists must be in the audit, and every audit unit must sit in exactly one section. A miss is an RF13 fault naming the unit. A ticket map makes no such check: a card's unit the audit lacks weighs the average (MC-33).
Test: deleting `U07` from `example/scope/audit.json` turns the audit off with the line `audit.json: units: U07 is on the diagram but not in the audit`.

## The plan's unit table (`files.plan`)

Which tickets make up each unit. Markdown, read line by line. Example: `example/scope/plan.md`.

- The table is read only between a line that starts `## Units by wave` and the next line that starts `## `, or the end of the file. Level-3 headings inside, such as `### Wave 1`, do not end it.
- A unit row is a pipe-table row with at least six cells whose first cell is a unit id (RF7). Other rows and lines are skipped silently.
- Cells read: 1 the unit, 2 its title, 4 the tickets absorbed. Cells 3 (what it covers), 5 (components owned) and 6 (days) are not read; days come from the audit.
- The ticket cell splits on commas and on the word "and". Each item loses everything from its first `(`, then empty items are skipped.
- A unit on several rows keeps its first title and gathers every row's tickets.
- `U<n> (#<n>)` anywhere in the file cites a roadmap issue on `roadmapRepo` for that unit.

**RF16. No `## Units by wave` heading refuses the plan.** Then units have no tickets and plan ids place nothing, with one line.
Test: renaming the heading to `## Units` turns the plan off with one line.

**RF17. A bad row item is dropped alone.** An item in the ticket cell that is not a ticket id is dropped with a line giving its line number. A row that starts with a unit id but has fewer than six cells is skipped with a line, where the archive skipped it silently.
Test: `ST-1 (write-ahead log first)` reads as `ST-1`; `st-9` is dropped with `plan.md:<n>: "st-9" is not a ticket id`; `| U09 | Short |` gives one line.

**RF18. Conflicts refuse the plan.** A ticket in two units, or one issue cited for two units, refuses the file naming both (MC-02).
Test: `SH-1` added to U04's row refuses the plan with `SH-1 is in two units: U04 and U05`.

**RF19. Plan and audit disagreements are lines, not faults.** On a scope map, a plan unit missing from the audit, or an audit unit with no plan row, gives one line each and the rest loads, as the archive's table warnings did. On a ticket map a plan unit that no section lists places nothing, with a line.
Test: `example/scope/plan.md` with U08 moved under the waves loads with one line naming U08.

## The section map (`files.sections`)

Which section owns which product paths, and which map issues place their tickets. Example: `example/roadmap/section-map.json`.

| Field | Needed | Default | Meaning |
| --- | --- | --- | --- |
| `repo` | no | `productRepo` | The repository whose PRs and paths it covers; must be in `repos` |
| `shared` | no | `[]` | Globs owned by no section and never gaps |
| `boxes` | yes | | Section id to its globs |
| `maps` | no | `{}` | Map issue `owner/name#n` to a section or `outside` (MC-27) |

**RF20. Globs.** `**` spans folders, `*` stays within one, `?` is one character, and a leading `**/` may match nothing. Matching is case-sensitive against the repository-relative path with `/`. A path belongs to the glob with the most literal characters, ties going to the first, shared globs before section globs (MC-53). A glob is 1 to 256 characters with no leading `/` and no `..` segment; the file holds at most 2,000.
Test: in the demo, `src/editor/toolbar.ts` is `editor`, `README.md` is shared, and `scripts/release.sh` is a gap (fixture PR 65).

**RF21. Whole-file faults.** Not JSON, `boxes` not an object, or `repo` not in `repos`. The map is then off as in RF3.
Test: `repo: "acme/other"` turns the map off with a line naming `repo`.

**RF22. Entry faults.** A bad glob, a `maps` key that is not `owner/name#n` or names an unlisted repository, or a `maps` value that is not a diagram section or `outside`, is dropped with a line. A map entry naming a section that has left the diagram places nothing (MC-27).
Test: `"LaunchAstro/work-map-demo#2": "share"` places none of issue 2's children and gives one line.

**RF23. A stale section in `boxes` still owns its paths.** Its globs keep those paths out of the gap count, but place nothing, and a line names the section. This keeps the gap count the archive showed when a section is renamed on the diagram before the map catches up.
Test: renaming `search` on the diagram leaves `src/search/x.ts` neither a gap nor placed, with one line.

**RF24. The gap census binds to the rules.** MC-54's digest covers `repo`, `shared` and `boxes` as parsed, so editing `maps`, an `_` key or the file's spacing keeps the last complete census. The archive hashed the whole file.
Test: adding a `maps` entry keeps the current gap count; adding a glob marks it pending until the next complete census.

## Approved mappings (`files.mapping`)

Hand-approved placements for PRs that name nothing the engine can read. Only `prs` is read. Example: `example/scope/mapping.json`.

| Field | Needed | Default | Meaning |
| --- | --- | --- | --- |
| `prs` | no | `{}` | PR number on `productRepo` (decimal, no leading zero) to an entry |
| `prs.<n>.ids` | one of these | | Plan ticket or unit ids the PR covers |
| `prs.<n>.none` | one of these | | `true`: the PR is outside the plan |
| `prs.<n>.approvedBy` | yes, to count | | Who approved it, any non-empty text |
| `prs.<n>.note` | no | none | For people; not read |

**RF25. Only approved entries count.** An entry with no or empty `approvedBy` is pending: unused and named in the run log, never on screen.
Test: entry `66` in the example changes nothing and appears once in the run log.

**RF26. An approved entry beats every other PR rule** (MC-24). `none: true` puts the PR outside the plan; `ids` place it by those tickets and units. An entry with both or neither is dropped with a line, as a body declaring both `none` and a ticket places nothing (MC-24). An id the plan lacks gives a note on that PR and the rest of the entry stands.
Test: example PR 62 lands on `editor` through ED-3 whatever its body says; `{ "ids": ["ED-3"], "none": true, "approvedBy": "x" }` is dropped with one line.

**RF27. Faults.** Not JSON, or `prs` not an object, turns the file off (RF3). A key that is not a PR number is dropped with a line.
Test: key `"#62"` gives one line, and entry `65` still applies.

## Other files config v2 names

- **Frozen inputs** (CF17) are not roadmap files and nobody writes new ones. The engine reads the archive's own shapes: the score store (`schema: "work-map-unit-scores/1"`, `units.<id>` as a list of `{ built, live, confidence, reason, at, drop?, by? }`), estimates (per section `{ at, model, reason, units.<id>: { coded, reason }, prs, evidence? }`), source-finding runs (`code-audits/<run>/summary.json` with `{ productHead, completedAt, findings: [{ unit, status }] }`) and placements (per PR `{ box, unit, via, confidence, reason, at }`). A file that does not match is no input, with a run-log line. The frozen-input build ticket pins each shape with a copied archive case.
- **Spec documents** (`specDocuments`) are only checked for existence on GitHub (MC-17). Their content is never read.
- **The Seat Gauge file** follows `docs/seat-gauge-file/README.md` (MC-56).
- **Served sites** are fetched, not files: CF15 and the versions module.

## Ignored fields: retired, or never drawn

Each is ignored silently under RF6, so the maintainer's live files need no edit at switch-over.

| File | Field | Why it is ignored |
| --- | --- | --- |
| Diagram | `lede`, `overallNote`, `footnote`, `steps` | Prose for a README renderer; the work map never drew it |
| Diagram | `asAt`, `shot`, `howToEdit` | The renderer's own notes |
| Diagram | `nodes[].repo` | Never drawn |
| Audit | `low`, `high` | The coded range the old snapshot carried; the new board has no range (screen spec) |
| Audit | `source`, `method` | Notes for people |
| Mappings | `switchOns` | Switch-on issues are no longer read (must-carry-over, tests not carried) |
| Section map | any `_` key, such as `_readme` | Comments |

## Fields whose meaning leaned on a retired feature

- `units.<id>.code` and `days` fed the estimated-scope and re-check features too. They keep only their audit meaning; nothing re-estimates them, and a frozen score newer than the audit can still stand over them (MC-05).
- `prs.<n>.ids` in the mappings name plan ids, so on a ticket map with no plan only `none` does anything.
- `nodes[].units` on a ticket map once also fed lane and brief placement, now gone (KD-30). It keeps only RF11's job.
- The plan's days column agreed with the audit's days by convention only. The audit's figure wins and the column is not read.

## What the start-a-map command (#15) writes

- A diagram with `title`, `stages`, `nodes` (`id`, `title`, `text`, `stage`, `row`) and `wires: []`, which loads with no problem lines. No units, notes or other roadmap files.
- Section ids that pass RF7, made from the names the user gives (lower case, spaces to `-`), refusing a clash rather than inventing a suffix.

## Notes for other tickets

- #9 and #10: the view carries each project's roadmap problem lines beside its config problems. The board's wires need `side`, `offset`, `gap`, `lane`, `kind` and `label`, because the kept wire drawing uses them; the screen spec's `{ from, to, kind }` sketch grows by those fields.
- #11: `files.audit` on a ticket map is read by nothing and named once in the run log. The same audit format serves `progress.unitAudit.file`.
- #13: before the comparison, the operator loads both live maps and expects no problem lines. Three readings differ from the archive only on input the live files do not contain today: a prose time without a zone word now counts (RF14), bad plan items drop alone (RF17), and the gap digest ignores `maps` (RF24). If the check finds any of them in a live file, it needs a KD row.
- #15: the output list above.
- #16: one build ticket for the roadmap readers, inside the `config` module's 1,000 lines (about 350 of them), taking RF1 to RF27 as its tests and the files in `docs/spec/example/` as fixtures.
