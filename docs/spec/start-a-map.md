# The start-a-map command

What `work-map start` does: it reads one GitHub repository, proposes sections, lets the user edit them, then writes a project config and a diagram and adds the config to the settings list. It covers where the command runs, what it spends from the GitHub budget, and when it refuses to write. Resolves #15.

Inputs: the settled decisions in #3 (decision 11 above all), `docs/spec/config-v2.md` (CF ids and its output list for #15), `docs/spec/roadmap-files.md` (RF ids and its output list for #15), `docs/spec/example/`, `docs/spec/app-layout.md` (L ids), `docs/spec/github-budget.md` (B ids), `docs/spec/release.md` (R ids), and the placement order in `docs/spec/must-carry-over.md` (MC-26 to MC-28). The archive has no such command, so nothing here carries old behaviour over.

## The answer in short

- It ships after release one, in `v1.1.0` (a minor bump under R14). Release one ships the example and the guide, and people write their first config by hand (#3, decision 11). None of the command ships in release one.
- Input is one github.com repository, as `owner/name` or a URL. Output is a version 2 config with `progress.basis: "ticket-count"`, a diagram, and a section map only when folders made the sections. The files go in the data folder's `maps/<id>/` and the config joins `settings.json` as the last tab.
- One read of the repository (a "survey") feeds every way of proposing sections. In order of preference: sub-issue trees, an area label family, issue title prefixes, top-level folders, and a plain fallback of one section. Milestones are not used.
- The user sees the proposal and can change it before anything is written: pick another source, rename, drop, reorder or add back sections, and set the title and id.
- It runs in the window and on the command line, both through one engine call. A served page shows the command line to run instead of a button.
- A survey costs at most 9 requests and about 12 GraphQL points, whatever the size of the repository, and keeps to the budget rules.
- It never writes to GitHub (Q9, settled: read-only on GitHub). It never overwrites a file. On a repository that already has a map, it stops and says where that map is.

## Running it

```text
work-map start <owner/name | URL> [--from parents|labels|prefixes|folders|one]
               [--title TEXT] [--id ID] [--rename ID=TITLE]... [--drop ID]... [--add NAME]...
               [--out FOLDER] [--fresh] [--refresh] [--dry-run] [--yes]
```

`start` is the fifth entry of L2. On Windows it runs as `work-map-cli.exe start` (R6), and `work-map.exe start` gets R7's refusal. The headless Linux build has it.

**SM1. Input.** The command accepts `owner/name`, `https://github.com/owner/name`, `github.com/owner/name` and `git@github.com:owner/name.git`, with an optional `.git`, a trailing slash or a deeper path such as `/issues/4`, all dropped. The owner matches `^[A-Za-z0-9][A-Za-z0-9-]{0,38}$` and the name `^[A-Za-z0-9._-]{1,100}$`, never `.` or `..`. Any other host is refused, because the token is github.com's (L22). The canonical `nameWithOwner` that GitHub returns replaces what was typed, so a renamed repository gets its new name.
Test: the four forms above, plus `.../tree/main/src`, all read as `acme/app`; `gitlab.com/acme/app` and `acme/..` exit 2; a fake GitHub that answers with the name `acme/app2` for `acme/app` writes `acme/app2` into the config.

**SM2. One engine call, two front ends.** `engine::start` has two functions: `propose(repo, refresh) -> Proposal` and `write(proposal, choice) -> Written`. The command line and the window call the same two functions, and neither front end works out sections itself. The module is about 600 lines of Rust, tests aside, and the window's sheet about 300 lines in `web/`.
Test: one recorded survey given to the command line with `--from labels --drop docs` and to the window's adapter with the same choice writes byte-identical files.

## The survey

**SM3. One survey, a fixed ceiling.** `propose` makes these requests and no others:
1. `GET /rate_limit`, only when the process has no budget figures yet (free on the primary limit).
2. One GraphQL query: the repository's canonical name, default branch, archived flag, the first 100 labels with each one's issue count, and `issues { totalCount }`.
3. Up to five GraphQL pages of 100 issues, most recently updated first, open and closed: title, labels (first 20), `subIssues { totalCount }` and the `parent` chain three levels up.
4. `GET /repos/{owner}/{name}/git/trees/{default branch}`, not recursive, for the top-level folders and files.
5. When the only code folder is `src`, `packages`, `apps`, `crates`, `services` or `libs`, one more tree read of that folder.

So a survey is at most 9 requests. The five issue pages cost about 2 points each, so a full survey is about 12 GraphQL points and at most three REST requests, under a quarter of one per cent of a 5,000 limit. A repository with 40,000 issues costs the same as one with 500, because the sample stops at the 500 most recently updated. The build measures each call through B3 and pins the ceiling.
Test: against a fake repository with 40,000 issues and 300 labels, a survey makes at most 9 requests and reads no issue page beyond the fifth; a repository with 30 issues reads one issue page.

**SM4. Inside the budget rules.** The survey goes through the engine's GitHub port: one request in flight in that process (B2), every call logged with its cost (B3), and GitHub's stop signals obeyed (B12) with no retry. It is a user's action, like Sync, so it takes B11's reserve: it does not start when either pool is under 20% of its limit, and it stops before a call that would take the remainder under 20%. A stopped survey proposes nothing and says when to try again. The command line runs its own engine, so while the app is open two processes may each have one request in flight. That is still far below the secondary limit of 100 at once, and both draw on one limit that each sees through the headers.
Test: with the fake reporting 900 of 5,000 GraphQL points left, `start` sends only `GET /rate_limit`, prints "GitHub budget low, 900 left, resets 14:05" and exits 1; a secondary-limit answer on the third request stops the survey with no fourth request.

**SM5. Edits spend nothing.** Every source in SM6 comes from the one survey. The answers are kept in the cache folder as `start/<owner>-<name>.json` for 15 minutes, so a second run with other flags makes no request. `--refresh` reads again. In the window, the open sheet holds the proposal, so switching source makes no request either.
Test: `start acme/app --dry-run` then `start acme/app --from folders --yes` within 15 minutes makes requests only in the first run; with `--refresh` the second run reads again.

**SM6. Sign-in.** The token comes from L22. In every GitHub state but `ready` (L23), the command prints that state's header line and exits 1, and the window's sheet shows the same line with Retry. A repository the login cannot see gets "acme/app was not found, or this gh login cannot read it" and exit 1.
Test: a fake signed-out `gh` gives the `signed_out` line and exit 1 with no GitHub request; a GraphQL `repository: null` gives the not-found line.

## Proposing sections

**SM7. Five sources in a fixed order.** The proposal picks the first source that qualifies over the sample, and lists every other qualifying source as a choice. "Covers" means a sampled issue the source would place.

| Order | Source | Qualifies when | A section is | Written as |
| --- | --- | --- | --- | --- |
| 1 | `parents` | at least 2 top-level parents (no parent of their own, 2 or more sub-issues) whose trees cover at least 30% of the sample | one top-level parent and its sub-issues | `progress.issues`: the parent's key to the section (MC-27) |
| 2 | `labels` | a label family with at least 2 labels, each on at least 2 sampled issues, covering at least 30% | one label of the family | `progress.placement[repo].labels` (MC-28) |
| 3 | `prefixes` | at least 2 title prefixes, each on at least 3 sampled issues, covering at least 30% | one prefix, the text before the first colon | `progress.placement[repo].titlePrefixes` (MC-28) |
| 4 | `folders` | at least 2 top-level code folders after SM10's exclusions | one folder | a section map, `boxes` of `<folder>/**` (MC-26 step 6, MC-53) |
| 5 | `one` | always | one section, "Work" | `progress.repositories[repo]`: `work` |

Sub-issue trees and labels come first because people made them on purpose to group work, and they place new issues as they arrive. Title prefixes are a habit, so they come third. Folders describe code, not work: they place merged PRs by their files and issues only through the PRs that closed them (MC-28), so they come last before the fallback. Milestones are left out. They say when, not what, and config v2 has no rule that places a new issue by milestone, so a milestone section would freeze today's issues and miss tomorrow's.
Test: one fixture per source, each shaped so that only that source and every later one qualify, proposes that source first; a fixture where parents cover 25% and labels 60% proposes `labels`.

**SM8. Label families.** A family is the labels that share a prefix ending in `:` or `/`, such as `area:` or `component/`. Families named `type`, `kind`, `priority`, `status`, `size`, `severity`, `effort`, `triage` or `good first issue` are skipped, ignoring case. With no family qualifying, the plain labels count as one family once GitHub's default labels (`bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`) and every prefixed label are taken out. The family that covers the most sampled issues wins, ties going to the one first in GitHub's label order.
Test: labels `area:editor`, `area:storage`, `priority:high` and `bug` give the `area:` family with two sections; a repository with only GitHub's defaults has no label source.

**SM9. Title prefixes.** A prefix is 1 to 30 characters before the first colon, at most four words, compared ignoring case. Conventional-commit kinds (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `build`, `perf`, `style`, `revert`) and `bug`, `rfc` and `question` are skipped, and so is any prefix that holds `(` or `[`.
Test: titles `Search: tokens`, `search: stems`, `Search: tags` and `feat: x` give one `Search` section; `fix(ui): y` gives none.

**SM10. Folders.** Code folders are the tree's top-level folders, leaving out dot folders and `node_modules`, `vendor`, `third_party`, `dist`, `build`, `target`, `out`, `coverage` and `tmp`. Those, and every top-level file (`*`), go in the section map's `shared`, so they are never gaps. SM3's fifth request steps one level into a lone `src`-style folder, and its subfolders become the sections with `src/<name>/**` globs. An empty repository (GitHub's 409) has no folder source.
Test: a tree of `src/`, `docs/`, `.github/`, `vendor/` and `README.md` gives one code folder `src`, steps into it, and proposes its subfolders, with `.github/**`, `vendor/**` and `*` shared.

**SM11. At most 12 sections, largest first.** A source proposes its candidates by sampled issues covered, most first, ties by name. Folders sort by name. Past the 12th, candidates are listed as "left out" with their counts, and the user can add any of them back. Section titles drop the family prefix (`area:editor` becomes "Editor"), a parent's leading `Epic:`, `Map:` or `Feature:`, and change `-` and `_` to spaces, with a capital first letter and at most 120 characters. Each section's `text` names its rule: "Issues labelled area:editor.", "Sub-issues of #12.", "Titles that start Search:." or "Files under src/editor/."
Test: a family of 15 labels proposes 12 and lists 3 as left out; `--add` on a left-out label adds it as the 13th section.

**SM12. Section ids follow the roadmap rule, as one word (Q20).** An id is the title in lower case with every character outside `a-z0-9` dropped, cut to 40 (RF7), so it never holds a hyphen and CF26 never warns about it. An id that is empty, starts with a digit, is `outside`, or repeats another id is flagged, and nothing is written until the user renames that section. The command never invents a suffix.
Test: titles "2FA" and "Editor" plus "editor!" give one flagged id `2fa` and one clash; `--rename 2fa=Two-factor` (id `twofactor`) and a rename of the clash let it write.

**SM13. Bug and question labels.** When the repository has a label named `bug`, `type:bug` or `kind/bug`, ignoring case, it goes in `bugLabels`. A `question` label goes in `skipLabels`. Nothing else is guessed.
Test: a repository with `Bug` and `question` gets `bugLabels: ["Bug"]` and `skipLabels: ["question"]`; one with neither writes neither field.

## Confirming before the map opens

**SM14. The proposal shows what will happen.** Both front ends show: the repository; the source in use, and the others that qualify; each section with its title, id, rule and how many sampled issues it covers; how many sampled issues fit no section ("41 of 500 recent issues fit no section and will show as not on the map"); the left-out candidates; the flagged ids; and the folder and file names it would write.
Test: the labels fixture's proposal names every field above, and the window's sheet and the `--dry-run` text carry the same counts.

**SM15. The command line asks once.** In a terminal, `start` prints the proposal and asks "Write this map? [y/N]". Edits are flags, and the user runs the command again to change the proposal, which SM5 makes free. `--yes` writes without asking. Without a terminal on stdin and without `--yes`, it acts as `--dry-run` and says so. `--dry-run` prints and writes nothing.
Test: with stdin a pipe and no `--yes`, `start` exits 0, prints "dry run: add --yes to write", and creates no file.

**SM16. The window uses a sheet.** A "Start a map" button sits at the end of the project tabs, and the example's header line adds "Start a map from your own repo". The sheet has a repository field and Propose. The proposal comes back as an editable list: choose the source, rename, drop, move up and down, add back left-out candidates, and edit the title and id. "Make the map" calls `write`. The engine then re-reads settings at once rather than at CF4's next 30-second check, and the screen opens the new tab, whose first poll reads its cards (B6's exception). The window has no folder picker (L13), so it always writes to the data folder.
Test: in a window test over a recorded engine, Propose, a rename and "Make the map" end with the new tab selected and its board drawn, with no wait for the 30-second check.

**SM17. Served pages point to the command line.** L11 requires an empty body on every POST, and a page in a browser should not write files into the data folder. When `hello.mode` is `served`, the button opens a short panel with the line to run, `work-map start owner/name`, and nothing else.
Test: a served page shows the panel, and the server has no start route (a POST to `/api/start` gets 404).

## Writing the files

**SM18. What it writes, and where.** It writes to `<data folder>/maps/<id>/`, or to `--out FOLDER` (absolute, or relative to the current folder on the command line):
- `work-map.json`: `version: 2`, `id`, `title` (the repository's name unless `--title` sets it), `productRepo` and `repos` set to the one repository, `files: { "source": "local", "flow": "roadmap/flow.json" }` plus `"sections": "roadmap/section-map.json"` for folders, and `progress` with `basis: "ticket-count"` and only the fields its source and SM13 need. No other field.
- `roadmap/flow.json`: `stages`, `nodes` (`id`, `title`, `text`, `stage`, `row`) and `wires: []`, as roadmap-files' output list says. Sections fill a stage six rows deep, then the next, in proposal order, so up to 12 sections take one or two stages. Stages are named "Stage 1", "Stage 2", for the user to rename.
- `roadmap/section-map.json`, for folders only: `shared` and `boxes`, with no `repo` (it defaults to `productRepo`) and no `maps`.

Each file is written atomically (a temporary file, then a rename), mode 600 on macOS and Linux. The project id defaults to the repository's name under CF8's rule. One that fails CF8 is flagged as in SM12, and the user sets `--id`.
Test: the labels fixture writes exactly the two files with exactly the fields above; the folders fixture also writes the section map; a repository named `My.App` proposes id `my-app`.

**SM19. Everything it writes loads cleanly first.** Before writing, `write` runs the config loader and the roadmap readers over the files in memory (CF6 to CF17, RF1 to RF27). A single problem line means nothing is written, and it reports an internal fault naming the line, because a proposal that fails its own loader is a bug.
Test: for every fixture survey and every source that qualifies on it, the written files load with no problem lines, and a forced bad section name makes `write` write nothing.

**SM20. Settings get one new line at the end.** After the files, `write` takes a short exclusive lock on `settings.lock`, reads `settings.json` again, appends `{ "config": "<absolute path>" }` as the last entry, keeps every other entry, key and order, and replaces the file atomically. It writes nothing to settings when the file is not JSON, has a version other than 1, or already holds 20 entries. Then it prints the entry to add by hand and why, with exit 0 because the map files exist. With no settings file it writes CF1's default with this one entry. The settings write comes last, so no entry ever points at a missing file.
Test: a settings file with two entries and `check_for_updates: false` gains a third entry and keeps the other two and the flag; a file with 20 entries is left byte for byte and the command prints the line to add.

**SM21. It never writes to GitHub (Q9).** The `start` module sends GET requests and GraphQL queries only. It has no mutation, no POST, PATCH, PUT or DELETE, and no option to commit the files or open a PR. A user who wants the map in their repository uses `--out` into a clone and commits it themselves.
Test: a fake GitHub that fails the test on any write method or any GraphQL `mutation` sees none across every fixture; a source check finds no `mutation` keyword in the module.

## A repository that already has a map

**SM22. It stops, says where, and offers `--fresh`.** `propose` checks three things, and any one stops it before a write:
- A loaded config already lists the repository in `repos`, ignoring case: "acme/app is already on the map as tab Shop (<path>)". In the window: "Open that tab" or "Make another map anyway".
- The repository's own top level holds a `work-map.json` (seen in SM3's tree read, so it costs nothing): "acme/app carries its own work map config. Clone the repository and add that file's path to settings."
- The target folder already holds `work-map.json` or `roadmap/flow.json`, or the id is already a tab (CF3): it names the file or the tab and asks for another `--id` or `--out`.

`--fresh` (in the window, "Make another map anyway") skips the first two checks. Nothing skips the third: the command never overwrites a file and never reuses an id.
Test: on a repository already listed, `start` exits 5 naming the tab, and `start --fresh --id app-2` writes a second map; an existing `maps/app/work-map.json` exits 5 with or without `--fresh`, and its bytes are unchanged.

**SM23. Exit codes.** 0: written, or a dry run. 1: GitHub, sign-in or budget stopped it. 2: usage or bad input. 5: an existing map, file or id stopped it. These are part of R14's command-line promise.
Test: each fixture case above ends with its code.

## Fixtures

The tests run on recorded surveys in the `examples/` tree: one per source in SM7, an empty repository, a 40,000-issue repository (only the five sampled pages recorded, with the totals), and a repository already listed in settings. This repo is a live check, not a test (`own-map.md`): its proposal is compared by hand with `.work-map/`.

## Notes for other tickets

- #9: L2 gains `start` as a fifth entry. L13's capability file allows two more window commands, `propose_map` and `start_map`, and the contract types gain `Proposal`, `Choice` and `Written`, generated as L5 says. Served mode gets no route (SM17). `contract` stays `1`, because the calls are added before any client relies on the list.
- #11: the data folder gains `maps/<id>/`, which the user owns. The guide's step 4 becomes `work-map start owner/name` when this ships.
- #14: R7's list of refused commands gains `start`.
- #16: build tickets for the survey and its cache (SM3 to SM6), the five sources (SM7 to SM13), writing and settings (SM18 to SM20), the existing-map checks and exit codes (SM22, SM23), the window sheet and served panel (SM16, SM17), and the recorded fixtures. Mark all of them for `v1.1.0`, after switch-over.
