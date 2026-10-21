# Project config v2 and the example project

What a project config holds in release one, how the app lists the configs it shows as tabs, how a version 1 config is still read, what the example project is, and what the getting-started guide covers. Resolves #11.

Inputs: the settled decisions in #3 (9 to 11), the config items in `docs/spec/must-carry-over.md` (MC-01, MC-04, MC-05, MC-26, MC-34, MC-55, MC-67, KD-05, KD-25, KD-26), the `config` module and AR-10 in `docs/review/architecture.md`, the folders and `WORK_MAP_DIR` in `docs/spec/app-layout.md` (L15, L19, L20), B6 and B9 in `docs/spec/github-budget.md`, S15 and S16 in `docs/spec/screen.md`, R14 and R16 in `docs/spec/release.md`, P5 and P9 in `docs/spec/parity.md`, and the private archive's config reader, its tests and its two contract documents, read on 21 October 2026. Nothing here copies the maintainer's own configs.

## The answer in short

- A project config stays one JSON file. Version 2 is version 1 with its field names kept, the retired fields gone, and three additions: served `sites` (moved out of the old data folder), the `frozen` inputs [Q1] and an optional `timeZone`.
- `files.source` says where the roadmap files come from: the config's own folder on disk, or the roadmap repository's default branch on GitHub. The GitHub source needs no clone and nothing to keep pulled.
- `settings.json` in the app's data folder lists project configs by absolute path, in tab order, replacing the old tab file of loopback addresses. An entry can pin a roadmap folder and a frozen-input folder, which is how `work-map dump` reads the same inputs as the old engine.
- A version 1 config is read as it is, in memory, and never rewritten, so the old and new engines can share one file during the comparison.
- The example project ships inside the binary: a small fictional map with recorded GitHub answers. A first open, with no `gh` and no network, shows a working map. An optional public demo repo gives the same map live.

## Defaults in force

- [Q1] The scores, estimates, source findings and model placements the retired features wrote are read once, read-only, as frozen inputs, each with its date.
- [Q2] No PR placement from fleet round logs, so the lane fields are gone.

## Settings: the list of projects

`settings.json` sits in the data folder from L20: `$HOME/Library/Application Support/com.launchastro.workmap/` on macOS, `%LOCALAPPDATA%\com.launchastro.workmap\` on Windows, and `$XDG_DATA_HOME/com.launchastro.workmap/` (else `$HOME/.local/share/...`) on Linux. `WORK_MAP_DIR` moves it with the rest of the folder. The file uses snake case, as R16 set for `check_for_updates`.

```json
{
  "version": 1,
  "projects": [
    { "config": "/home/user/code/demo-roadmap/work-map.json" },
    { "config": "D:/maps/shop.json", "roadmap": "D:/pinned/shop-roadmap", "frozen": "D:/pinned/shop-data" }
  ],
  "check_for_updates": true
}
```

| Field | Needed | Default | Meaning |
| --- | --- | --- | --- |
| `version` | yes | | `1` |
| `projects` | no | `[]` | 0 to 20 entries, in tab order |
| `projects[].config` | yes | | Absolute path to a project config |
| `projects[].roadmap` | no | none | Absolute folder that holds the roadmap files, read from disk whatever `files.source` says |
| `projects[].frozen` | no | none | Absolute folder that holds the frozen inputs, instead of `frozen.folder` |
| `check_for_updates` | no | `true` | R16's daily release check; `WORK_MAP_NO_UPDATE_CHECK=1` also turns it off |

**CF1. The app writes settings once.** When `settings.json` is missing at start, the app writes the default above with an empty list, atomically and owner-only (600), and shows the example. It never writes the file again. The user, or the start-a-map command (#15), owns it after that.
Test: a first start with `WORK_MAP_DIR` set to an empty folder writes exactly that file and shows the example tab; a later start leaves an existing file byte for byte as it was.

**CF2. Settings problems are named, and stay small.** A file that is not JSON, or whose `version` is not 1, loads no projects: the example shows, with a line saying why ("from a newer work map" for a higher version). Inside a good file, an unknown key is named and ignored, and an entry with a relative path, a path listed twice or a place past the 20th is refused alone, with a line naming it.
Test: a file with an unknown key `check_for_update`, a relative path and a duplicate path loads its one good entry and shows three problem lines, each naming its entry.

**CF3. Tabs follow the list.** `hello.projects` lists the loaded projects in settings order, with each config's `id` and `title`. A config whose `id` repeats an earlier one is refused, naming both paths. The data folder keeps state by id (`projects/<id>/state.json`), so changing an id starts that project with a full read.
Test: two configs with the same id give one tab and a problem line naming both files; reordering the entries reorders the tabs.

**CF4. Changes are picked up while someone looks.** The engine re-reads `settings.json`, each config and each local roadmap file when its modified time or size changes, checked at start, at every Sync and every 30 seconds while there is a viewer (L19). A change that moves the tabs sends a new `hello`; a change to a project sends a new view stamp. With no viewer it checks nothing.
Test: adding an entry with a fake clock gives a `hello` with the new tab within 30 seconds; over a fake hour with no viewer the engine opens no settings or config file.

**CF5. A bad config never empties the window.** A config that fails at start is not a tab. It is listed in `hello` as a config problem (path and message), shown as a header line on every tab. A config that fails on a later re-read keeps its last good version, and the line says the change was not applied. When no project loads, the example shows, with the problem lines.
Test: one good and one broken config give one tab plus the broken file's line; breaking the good one afterwards keeps its board and adds a "not applied" line; with both broken, the example shows with two lines.

## Project config v2

One JSON object, UTF-8, at most 1 MB, with a byte order mark allowed and skipped (some Windows editors add one). The usual name is `work-map.json`; any name works, because settings name the path. JSON stays because version 1 is JSON, the old engine must read the same file during the comparison, and the Rust side needs no second parser. Field names stay as in version 1, so the version 1 reader is a short mapping rather than a second schema.

The sample in `docs/spec/example/work-map.json` is the example project's own config and uses most fields.

| Field | Needed | Default | Meaning | From version 1 |
| --- | --- | --- | --- | --- |
| `version` | yes | | `2` | was `1` |
| `id` | yes | | Tab id, `?map=` value and saved-view key (S15) | kept, now limited (CF8) |
| `title` | yes | | Tab and window title, 1 to 120 characters | kept |
| `productRepo` | yes | | Merge panel, queue and sites | kept, must now be in `repos` |
| `roadmapRepo` | no | `productRepo` | Roadmap unit issues, and the GitHub source of roadmap files | kept, now optional |
| `repos` | yes | | 1 to 100 repositories read for cards | kept |
| `files.source` | no | `"local"` | `local` or `github` (CF11) | new |
| `files.flow` | yes | | The diagram | kept |
| `files.audit`, `files.plan` | scope basis | none | The unit audit and the plan's unit table | kept, optional on ticket maps |
| `files.mapping` | no | none | Approved PR mappings; only `prs` is read | kept, optional; switch-on entries ignored |
| `files.sections` | no | none | The section map; without it `gaps` is `null` | kept, optional |
| `progress` | yes | | `{ "basis": "scope" }` or `{ "basis": "ticket-count", ... }` | kept; no longer optional |
| `progress.repositories`, `issues`, `bugLabels`, `skipLabels`, `placement`, `unitAudit` | no | none | Ticket-map placement, labels and unit weights (MC-27, MC-28, MC-32, MC-33) | kept, `unitAudit` minus `recheck` |
| `ticketConventions` | no | each part unused | `readyLabel`, `ticketLabels`, `ticketLabelsByRepository`, `mapLabel`, `specLabels`, `specPattern` | kept minus `ideaLabels`, `ideaPattern` |
| `specMembership`, `specDocuments`, `planningSections` | no | none | MC-46, MC-17, MC-29 | kept |
| `reviewReceiptAuthors` | no | `[]` | Trusted receipt authors (MC-45) | kept |
| `ledgerPrReadyLabel` | no | none | The loading bay's ready label (MC-52) | kept |
| `seatGauge` | no | none | `repositories`, `branchTicket`, `workspace` (MC-58) | kept |
| `dependencies` | no | `[]` | Dashed arrows, `{ from, to, label }` | kept, now optional |
| `sites` | no | none | Up to 10 served sites (CF15) | moved from the data folder's site file |
| `timeZone` | no | `"UTC"` | Zone for date-only stamps (CF16) | new; the old engine assumed UTC+10 |
| `frozen` | no | none | Frozen inputs [Q1] (CF17) | new; replaces fixed names in the data folder |

Gone with the retired features: `lanePrefix` and `laneRules` [Q2], the idea step's two fields (MC-47), the `estimated-scope` basis, and every `recheck` block apart from its `confidence`, which becomes `frozen.confidence`.

**CF6. Strict, and every problem named.** Unknown keys are refused. The loader collects up to 20 problems before it stops, one per line, each as `<file>: <field path>: <what is wrong>`, such as `work-map.json: progress.placement["acme/app"].labels["ui"]: "ui-shell" is not a section on the diagram`.
Test: a config with a misspelt key and two bad section names gives three lines in that form, and no tab.

**CF7. Versions.** `2` is read as specified here, `1` through the version 1 reader (CF18). Any other value is refused: "This config is version N; this work map reads versions 1 and 2."
Test: `version: 3` and a missing `version` are each refused with that line.

**CF8. Safe ids.** `id` matches `^[a-z0-9][a-z0-9-]{0,39}$` (MC-67, KD-25).
Test: `..`, `Main` and a 41-character id are each refused; `shop-2` loads.

**CF9. Repositories are checked against `repos`.** Names match `owner/name`. `repos` holds 1 to 100, with no duplicates, compared ignoring case. `productRepo` must be in it, which fixes the archive's silent skip of open PRs (TN-72). Every repository named elsewhere (placement keys, issue keys, ticket label keys, spec keys and documents, Seat Gauge targets) must be in it too, ignoring case (MC-01).
Test: `productRepo` missing from `repos`, and a spec document on an unlisted repository, are each refused naming the field.

**CF10. Destinations are sections.** Every destination (repository defaults, issue overrides, label and title-prefix rules, `planningSections`, `specDocuments` and `specMembership` sections, both ends of each dependency) is a diagram section or, where MC-01 allows, `outside`. A repository default is never `outside`. The diagram must read, or the config is refused. The archive skipped these checks when it could not read the diagram.
Test: a label rule naming a section the diagram lacks is refused (the archive's case); so is a config whose diagram file is missing.

**CF11. Where roadmap files come from.** `files.*` and `progress.unitAudit.file` follow `files.source`. With `local` they are read from disk relative to the config's folder. With `github` they are read from `roadmapRepo`'s default branch with B9's conditional reads, at the first poll when never read (B6's exception) and at each Sync, never on the timer otherwise. A failed read keeps the last good files with their time. A settings entry's `roadmap` folder replaces either source with that folder on disk.
Test: a GitHub-source project re-read on Sync with nothing changed gets a 304 for every file and spends no REST primary limit; a 404 on Sync keeps the board and notes the file.

**CF12. Safe paths.** Every path in a config is relative, uses `/`, has only letters, digits, spaces and `._/-`, no `..` segment and no leading `/`. On disk its real path, symlinks resolved, must stay inside its root folder. Each roadmap file is at most 4 MB and each frozen file at most 8 MB.
Test: `../x.json`, `/etc/x`, `C:\x`, a quoted path and a symlink out of the folder are each refused; a 5 MB diagram is refused naming its size.

**CF13. One basis, its own fields.** `scope` needs `files.audit` and `files.plan`, and takes no ticket fields. `ticket-count` takes the ticket fields. `estimated-scope` is refused: "Estimated scope is retired. Set progress.basis to scope or ticket-count."
Test: a scope map without `files.plan`, a scope map with `bugLabels` and an `estimated-scope` map are each refused with their lines.

**CF14. Patterns are Rust patterns.** `branchTicket`, `workspace.pattern`, `unitPattern` and `specPattern` compile with the Rust `regex` crate, at most 256 characters. The first three need a capture group. Look-around and back-references, which the archive's JavaScript allowed, are refused naming the pattern. Label lists keep the trailing `*` prefix rule (MC-32).
Test: a pattern with no group, one with a look-ahead, and one of 257 characters are each refused; `^[a-z]+/([1-9][0-9]*)-` reads `wm/149-zoom` as 149.

**CF15. Sites.** `sites` holds 1 to 10 entries of `name` (1 to 100 characters), `origin` (a bare `https://` origin with a dotted host and no credentials), `buildPath` (matching `^/[A-Za-z0-9/_-]+\.json$`) and `metaName` (matching `^[A-Za-z0-9_-]{1,100}$`), with unique origins (MC-55). Absent or empty means no sites, and `versions` is `null`.
Test: an `http://` origin, an origin with a path, a duplicate origin and an 11th site are each refused; no `sites` gives a view with `versions: null`.

**CF16. Time zone.** `timeZone` is an IANA name such as `Australia/Brisbane` or a fixed offset such as `+10:00`. It applies only to stamps in roadmap and frozen files that carry no offset. A date and time with no offset is that local time in this zone. A date alone is the last millisecond of that day there (MC-04, KD-26). Times on screen are always in the viewer's zone (S9).
Test: an audit `asAt` of `2026-10-01` reads as `2026-10-01T13:59:59.999Z` under `+10:00` and as `2026-10-01T23:59:59.999Z` with no `timeZone`; `Mars/Olympus` is refused.

**CF17. Frozen inputs [Q1].** `frozen` is `{ folder, scores, estimates, sourceFindings, placements, confidence }`. `folder` is relative to the config's folder and needed when the block is present; a settings entry's `frozen` folder replaces it. Frozen files are always read from disk, whatever `files.source` says, because they are copies of the old engine's local files. The four names default to the old engine's own file names: `unit-scores.json`, `estimates.json`, `code-audits` (a folder of runs, each with `summary.json`) and `inferred.json`. `confidence` runs from 0 to 1, default 0.6 (MC-05). The engine reads them when the config loads, never writes them, and keeps each value's date for the hover. A missing file is no input, not an error. From `placements` it takes only the entries a model wrote; it works out the rule-based ones again (MC-26). `scores` gives unit scores on a map with `unitAudit` and section scores on a ticket map without one (MC-34).
Test: a frozen folder with only `unit-scores.json` loads with scores and no estimates; the engine leaves every frozen file's bytes and times unchanged; a placement entry made by a rule is ignored.

## Reading a version 1 config

**CF18. Read in memory, never rewritten.** A `version: 1` file loads through a mapping onto version 2. Missing `progress` becomes `scope`. Retired fields (the list under the table) are ignored and named in the run log, not on screen. `recheck.confidence` becomes `frozen.confidence`. Unknown keys are ignored, as the archive's reader did, except that `sites` and `timeZone` are read in their version 2 form, so the maintainer can add them to a live file the old engine still reads. Frozen inputs for a version 1 file come only from a settings entry's `frozen` folder, under the old names. The roadmap root is the entry's `roadmap` folder, else the config's folder, as the old `--repo-root` flag worked.
Test: each archive config test case, written once as version 1 and once as version 2, loads to equal projects; a version 1 file with `laneRules` loads and logs one line; the file's bytes never change.

**CF19. Some version 1 files are refused.** The version 2 checks still run (CF8 to CF17), so an `estimated-scope` basis, an id outside CF8 or a pattern Rust cannot compile is refused with its line and the fix. The maintainer's two live configs must pass before the comparison starts.
Test: a version 1 file with id `Ops Map` is refused naming CF8's rule.

After switch-over, the maintainer sets `version` to 2. A version 2 file refuses leftover retired keys by name, which lists the cleanup.

## Pinned inputs for the comparison

**CF20. `work-map dump` reads a settings file it is given.** `dump` takes `--settings <file>`; without it, it reads the data folder's `settings.json`. For a parity run (P5), that file lists both live configs, each with `roadmap` set to the checkout pinned at the old snapshot's roadmap commit and `frozen` set to the copy of the old data folder taken when the window opened. The parity record lists, per project, the roadmap folder and the SHA-256 of every roadmap and frozen file read, so the harness checks P5 by hash without running git.
Test: a dump given a settings file whose entry pins a fixture checkout reads from that folder although `files.source` is `github`, makes no contents request, and records the hashes of the files it read.

## The example project

The example lives in `examples/demo/` (the folder L1's layout reserves) and is built into the binary. Its outline, with every case it covers, is `docs/spec/example/fixture.md`. It is fictional, MIT and written fresh (KD-05, TN-61): the repository is `LaunchAstro/work-map-demo` and the served site is on `example.com`.

**CF21. The example fills an empty app.** It shows as the only tab, with its config's id `demo` and title "Work map demo", whenever no project loads. It never shows beside the user's projects.
Test: with no projects it is the one tab; adding one good config replaces it within CF4's 30 seconds.

**CF22. No network, no login.** The example runs on the recorded GitHub adapter, a recorded site fetch, the embedded roadmap files and an embedded Seat Gauge file, whatever its config's `files.source` says. While only the example is open, the engine does not run `gh` and `hello.github` carries the fixture's recorded budget, so no sign-in line shows. Sync replays the recording and returns `complete` with nothing spent.
Test: with no `gh` on the path and a fake GitHub that fails any request, a first open shows every part of the example `current`, and Sync returns `complete` with `spent` zero.

**CF23. The example always looks recent.** Recorded times are offsets from one reference instant. At load and at each Sync the example sets that instant to now, so the newest merge is minutes old and the merge chart has bars. Seat Gauge rows shift on every read, so the agents stay current while the example is open.
Test: with fake clocks a week apart, the example's newest merge is the same minutes old and its agents are current at both.

**CF24. One fixture, three users.** The engine's tests, the screen's fixtures (S16) and the parity harness's example test (P25) all come from `examples/demo/`. The embedded copy is under 300 KB.
Test: a build check fails when the embedded example passes 300 KB or `web/test/fixtures/` differs from a fresh export.

### The public demo repo (optional)

The maintainer may create a public repo, `LaunchAstro/work-map-demo`, at no cost. Nothing in release one needs it. It would hold the same `work-map.json` with `files.source: "github"` and no `sites`, the roadmap files, a few source files that match the section map, and issues and PRs created from the fixture by a seed script in this repo, so issue numbers match. A user saves the config file, adds its path to settings and sees the map live on their own `gh` login, for a few points a Sync. #15 can test against it. Until it exists, the example's GitHub links lead to a 404 page.

## What the start-a-map command (#15) must output

- A version 2 config with `progress.basis: "ticket-count"` and a diagram file that load with no problem lines (CF6 to CF17), using only the fields above.
- The config's path, and either the line to add to `settings.json` or a note that it added it, keeping the file's other entries and order.
- Nothing written to GitHub unless the user asked, and no existing file overwritten.

## Getting-started guide outline

`docs/getting-started.md`, about two pages, written with the build:

1. Install, linking to the README's steps for each OS (release spec).
2. The example map: what a card, its bars, the merge panel, Next up and agents mean.
3. Sign in once with `gh auth login`.
4. Point it at your repo: copy the sample config, name your sections in a diagram, list the config in `settings.json` (path per OS), and the tab appears.
5. Name your work: `Section:` lines, `Closes #n`, labels and title prefixes, and where an unplaced ticket shows.
6. Optional parts: Seat Gauge for agents, served sites, a section map for map gaps, spec documents.
7. Without a window: `work-map serve`, and `work-map kick` after a merge.
8. When something is wrong: the header's `gh`, budget and config lines, and what each fix is.

When #15 ships, its command replaces step 4's copying.

## Notes for other tickets

- #9: `Hello` gains `config_problems: { path: string; message: string }[]` (CF5). `dump` gains `--settings` (CF20).
- #12 and `census`: CF11's roadmap file reads are Sync reads under B9 and B11.
- #13: the operator adds `sites` and `timeZone: "+10:00"` (the old engine's zone) to each live version 1 file, and writes the dump's settings file with the pinned folders (CF20).
- #15: the output list above.
- #16: build tickets for settings (CF1 to CF5), the config loader (CF6 to CF17), the version 1 reader (CF18, CF19), the example and its recorder (CF21 to CF24), the demo seed script and the guide. The loader stays within the `config` module's 1,000 lines; the example's embedding and time shift add about 200 to `engine`.
