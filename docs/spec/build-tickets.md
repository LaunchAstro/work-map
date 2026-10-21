# Build tickets

The build plan for the work map in Rust, as batches in order. Each ticket fits one agent session and one small PR (BS5). A ticket starts when every ticket it is blocked by has merged, and the tickets in one batch share no file apart from the append-only lists in BS12. The rules each ticket names come from the specs listed in `docs/spec/build-spec.md`, and their tests are its acceptance list. Each ticket names exactly one section, the one that owns every path it touches apart from BS13's cross-section lists, and its issue body carries that as a `Section: <id>` line (OM6). A ticket whose paths fell in two sections has been split until each names one (Q20). Ids never change: a removed ticket keeps its heading, and new tickets take ids from B91 up, placed in the batch their blocking edges allow. Part of #16.

Each ticket becomes a GitHub issue labelled `build`, with its blocked-by edges as native dependencies. B81 to B90 and B121 to B124 are also labelled `v1.1.0`, after switch-over (start-a-map's notes). Tickets marked "maintainer task" are steps on the build machine or in the private archive, not code. "Lines" is a rough count of code plus tests; moved screen files are counted apart.

## Batches

| Batch | Tickets | Width | Lines with tests | Release |
| --- | --- | --- | --- | --- |
| 0 Foundation | B01, B16, B103 | 3 | 570 | v1.0.0 |
| 1 Crates, workflow, screen package | B02, B11, B102 | 3 | 1,400 | v1.0.0 |
| 2 Types, ports and pure parts | B03 to B10, B12 to B14, B104 | 12 | 6,650 | v1.0.0 |
| 3 Readers, census, maths, server and screen | B15, B17 to B35, B37 to B41, B54, B55, B91, B92, B100, B101 | 31 | 19,250, plus 2,000 moved | v1.0.0 |
| 4 Loader, placement, sync, shell and screen | B36, B42 to B53, B56, B95, B105, B125 | 17 | 9,850, plus 1,600 moved | v1.0.0 |
| 5 Checks, place, measure, sections, release job | B57 to B63, B65, B93, B94, B96 | 11 | 6,250 | v1.0.0 |
| 6 The view and `where` | B64, B97 | 2 | 1,550 | v1.0.0 |
| 7 Engine service and the commands | B66, B67, B106 | 3 | 1,400 | v1.0.0 |
| 8 Timers, dump, fixtures, attribution page, merge check | B68 to B71, B98, B99, B107 | 7 | 2,240 | v1.0.0 |
| 9 Parity test, guide, candidate | B72 to B75, B108 | 5 | 1,500 | v1.0.0 |
| 10 Deslop and the refresh's capture step | B76, B109 to B114 (B77 removed, Q16) | 7 | 390 | v1.0.0 |
| 11 Unslop | B78, B115 to B120 | 7 | 310 | v1.0.0 |
| 12 Parity streak | B79 | 1 | 0 | v1.0.0 |
| 13 Switch-over | B80 | 1 | 20 | v1.0.0 |
| 14 Survey | B81, B82 | 2 | 1,350 | v1.1.0 |
| 15 Sources | B83, B84 | 2 | 1,350 | v1.1.0 |
| 16 Writing | B85 | 1 | 750 | v1.1.0 |
| 17 Sheet and the `start` entry | B86, B122 | 2 | 500 | v1.1.0 |
| 18 Guide, tabs, window commands | B87, B123, B124 | 3 | 400 | v1.1.0 |
| 19 Deslop | B88 | 1 | 200 | v1.1.0 |
| 20 Unslop | B89, B121 | 2 | 200 | v1.1.0 |
| 21 Release | B90 | 1 | 20 | v1.1.0 |

124 live tickets under 125 ids (B77 removed, Q16): 110 for release one in 14 batches, about 51,400 lines with tests plus about 3,600 lines of screen files moved across, and 14 for `v1.1.0` in 8 batches, about 4,800. Each batch's place is the longest run of blocking edges behind it, so no ticket waits on one in its own batch. The longest chain runs through placement: B01, B102, B07, B17, B44, B59, B64, B66, B70, B72, B76, B78, B79, B80. The `where` chain (B04, B22, B95, B97, B106, B98, B73) is shorter and joins it at the deslop passes. Batches 2 to 5 hold most of the work, 71 tickets side by side across four steps.

## Tickets by section

Each ticket's `Section:` line, for filing the issues. This table is the only copy; `docs/spec/own-map.md` points here.

| Section | Tickets |
| --- | --- |
| `tooling` | B01, B02, B61, B75, B80, B90, B107 |
| `docs` | B73, B78, B87, B98, B99, B103, B121 |
| `config` | B03, B12, B18, B19, B20, B21, B43, B56, B57, B58, B63, B71, B92, B96, B100, B109, B115, B125 |
| `github` | B04, B06, B22, B23, B24, B25, B26, B27, B28, B46, B47, B95, B104, B111, B116 |
| `placement` | B05, B07, B08, B17, B36, B44, B48, B59, B91, B93, B97, B112, B117 |
| `progress` | B13, B29, B30, B31, B32, B33, B34, B35, B45, B60, B113, B118 |
| `service` | B09, B10, B37, B53, B54, B55, B64, B65, B66, B67, B68, B69, B70, B76, B101, B102, B105, B106, B119, B122, B124 |
| `screen` | B11, B38, B39, B49, B50, B51, B62, B94, B108, B114, B120, B123 |
| `parity` | B14, B15, B16, B40, B41, B42, B52, B72, B74, B79 |
| `start` | B81, B82, B83, B84, B85, B86, B88, B89 |

All 124 live tickets appear once. Tickets with no repo paths (B16, B74, B79) take the section of the spec they serve, and version bumps (B75, B80, B90), which touch only BS13's lists, take `tooling`.

Release two's AI scoring tickets, PR placement layer 4's AI guess among them, are not in this plan. They come from [Release two: AI scoring build spec and tickets](https://github.com/LaunchAstro/work-map/issues/40), wired to the release-one tickets named there.

## Batch 0: foundation

### B01. Workspace root and the check runner
The Cargo workspace root with `members = ["crates/*"]` and one version `1.0.0-rc.0` (R13, R14), a pinned stable toolchain, `.cargo/config.toml`, and the `xtask` crate with `check` and `lines`. `check` holds the build spec's whole step list, with `--ci` and `--docs`; each step is skipped until the thing it runs exists (`web/package.json`, `web/test/browser/`, the `export` and `example-refresh` commands' `--check` modes), so no later ticket edits the list. R13's test reads `web/package.json` when it exists. The crates themselves are B102's.
- Section: `tooling`.
- Rules: R13, BS2, BS3, the build spec's local checks.
- Acceptance: BS2's and BS3's fixture tests; R13's test with and without `web/package.json`; `cargo xtask check` on the bare workspace runs every step it can and names each skipped one.
- Blocked by: none.
- Lines: about 450.
- Touches: `Cargo.toml`, `.cargo/config.toml`, `rust-toolchain.toml`, `crates/xtask/*`.

### B16. The private runbook (maintainer task)
An issue on the private archive naming the old engine's jobs, the live maps' loopback ports, how to pause, resume and full-read each, and the local file `parity capture` reads. The public issue for this ticket says only "see the private companion issue".
- Section: `parity`.
- Rules: P1, P7, parity's steps on the build machine, reconciliation 8.
- Acceptance: the private issue exists, and one pause and resume has been tried by its steps.
- Blocked by: none.
- Lines: none in this repo.
- Touches: the private archive's issues only.

### B103. Licence and README
The MIT `LICENSE`, and a README that says the app is offered as is (#3, decision 4) and carries R17's install text, with the version left as `<version>`. B61 adds R17's check, and B73 the guide link.
- Section: `docs`.
- Rules: R17 (the text), #3 decision 4.
- Acceptance: R17's four headings and the `xattr` line are in the README, checked by hand here and by B61's test after.
- Blocked by: none.
- Lines: about 120.
- Touches: `LICENSE`, `README.md`.

## Batch 1: crates, the workflow and the screen package

### B02. Hosted test workflow on three OSes
`.github/workflows/build.yml` with R9's `test` job on `ubuntu-22.04`, `windows-latest` and `macos-latest`, which installs WebKitGTK 4.1 on Linux, Node 24 and pnpm, then runs `cargo xtask check --ci`. Also the `report` job, a `workflow_dispatch` with a `fail` input, cancel-in-progress for pull requests, and pinned actions. No bundle job yet (B61). Confirm the repository has no required status checks.
- Section: `tooling`.
- Rules: R9 (test job), R10, R12, BS9, reconciliation 15.
- Acceptance: R9's, R10's and R12's checks; a repo test in `xtask` parses the workflow.
- Blocked by: B01.
- Lines: about 350.
- Touches: `.github/workflows/build.yml`, `crates/xtask/tests/workflow.rs`.

### B11. The screen's package and build shell
`web/` with a private MIT `package.json`, pnpm and Node 24 pinned, the lockfile and the install hardening; Vite, TypeScript, Vitest, oxlint and Prettier; `typecheck`, `lint`, `test`, `test:browser` and `build` scripts; `index.html` with no inline script, `public/first-paint.js`, `tokens.css`, `fonts.css`, the three font packages and their licences; Vite's dev server on 4318 proxying `/api` to 4319; the version baked in; a placeholder `src/main.tsx`; and the MIT header test.
- Section: `screen`.
- Rules: S1 (test), S2, S3 (build check), S4 (no inline script), S17, S18 (Vite side), S19, R13 (web version).
- Acceptance: S1's, S2's, S3's build check and S19's tests; B01's R13 test passes with `web/package.json` present.
- Blocked by: B01.
- Lines: about 450.
- Touches: `web/{package.json, pnpm-lock.yaml, vite.config.ts, tsconfig.json, index.html, public/*, src/main.tsx, src/styles/*, test/repo.test.ts}`.

### B102. Engine, server and app crates, and `model`
`crates/engine`, `crates/server` and `crates/app`, each with its manifest and a `lib.rs` or `main.rs`. The engine's `lib.rs` holds only `mod` lines; each module folder is created by its section's first ticket, which adds its line. A filled `model`: project ids (CF8), repository names compared ignoring case (MC-01), issue and PR keys (`owner/repo#n`), section ids (RF7), UTC instants and a `Clock` trait with a fake clock. The app gets the `work-map` binary reading L2's entries, each in its own stub file (`window.rs`, `serve.rs`, `kick.rs`, `dump.rs`, `where_.rs`, `sections.rs`, `boot.rs`) for later tickets, and a `window` feature that stays empty until B55. The server's `lib.rs` holds only `mod` lines too.
- Section: `service`.
- Rules: L1, L2 (as patched: usage and exit 2), BS1, CF8, RF7, MC-01.
- Acceptance: L1's and BS1's `cargo tree` tests; `work-map frob` exits 2; good and bad cases for each id in `model`.
- Blocked by: B01.
- Lines: about 600.
- Touches: `crates/engine/{Cargo.toml, src/lib.rs, src/model/*}`, `crates/server/{Cargo.toml, src/lib.rs}`, `crates/app/{Cargo.toml, src/*}`.

## Batch 2: types, ports and pure parts

### B03. Engine core types: the project and roadmap files
The shared config types later tickets fill, with no logic beyond constructors: the checked `Project` with every config v2 field, `attribution` and `seatGauge.workspacePattern` included; the roadmap file types; `FrozenInputs` and the `scores` trait (the build spec's seam); the problem line type in CF6's and RF5's forms; and the shared roadmap reading helpers for encoding, size and unknown keys. The census records are B104's and the placement types B08's.
- Section: `config`.
- Rules: CF6 and RF5 (line forms), RF1, RF6, the scores seam.
- Acceptance: RF1's and RF6's tests on the helpers; problem lines print as CF6's and RF5's examples; a `Project` round-trips through serde.
- Blocked by: B102.
- Lines: about 450.
- Touches: `crates/engine/src/{config/project.rs, config/roadmap/types.rs, config/roadmap/common.rs, config/frozen_types.rs, config/problem.rs, scores/mod.rs}`.

### B04. GitHub port, recorded adapter and fake GitHub
The async `GitHub` port for GraphQL and REST, with typed requests, answers and errors (primary and secondary limits, 401, network, 5xx, GraphQL partial errors). The recorded adapter replays answers keyed by request, with times written as offsets from one reference instant. A port-level fake with a fake clock counts requests and points and returns each header and error the budget spec lists, for every engine test.
- Section: `github`.
- Rules: MC-06 (error kinds), CF23 (offset form), the budget spec's facts.
- Acceptance: a two-page answer replays and an unknown request is refused; offsets move with the reference instant; the fake reports cost and remainder per call and raises each error on cue.
- Blocked by: B102.
- Lines: about 750.
- Touches: `crates/engine/src/github/{port.rs, recorded.rs, fake.rs}`.

### B05. Seat Gauge file reader against the examples
`SessionSource` with a file adapter on the per-OS folder and `SEAT_GAUGE_DIR`, and an example-file adapter. Reading, the safety checks and parsing of version 1, and every row of the reader table: missing, damaged, newer, stale, and problems per machine. A torn file keeps the last good read. The rows' `repo`, `section` and `seat` are read as written. `workspace_pattern` and `pr` are B91's; until then they are ignored as unknown fields, as version 1 allows. Placing sessions on cards is B36.
- Section: `placement`.
- Rules: the shared file spec, MC-56, MC-57, MC-61, KD-13, KD-33, TN-66.
- Acceptance: each file in `docs/seat-gauge-file/examples/` at `2026-10-21T03:00:30Z` gives the result its table names; a removed file gives no agents and a quiet note; a symlink, fifo, folder, over-size file and a file that changes during the read are refused.
- Blocked by: B102.
- Lines: about 650.
- Touches: `crates/engine/src/seat_gauge/{source.rs, file.rs, parse.rs}`.

### B06. Data folder, atomic saves and the instance lock
The per-OS data, cache and log folders from `dirs` and the identifier (the `.dev` one in debug builds), `WORK_MAP_DIR`, modes 700 and 600, atomic replace, per-project `state.json` with a schema version, unreadable files set aside, the run log rotated at 5 MB with three kept, and the exclusive lock on `instance.lock`. The instance file and control port are B54; the check against Tauri's own paths is B55.
- Section: `github`.
- Rules: L15 (lock), L20, MC-20, MC-21, KD-03.
- Acceptance: L15's two-copies test at the lock; L20's `WORK_MAP_DIR` test; MC-21's planted corrupt file; the folder table per OS with a faked environment.
- Blocked by: B102.
- Lines: about 550.
- Touches: `crates/engine/src/store/*`.

### B07. One reference grammar
One Markdown-aware extractor for `#n`, `repo#n`, `owner/repo#n` and issue addresses, shared by placement, closing, blockers and absorption, plus closing keywords and lists. Pure functions over text.
- Section: `placement`.
- Rules: MC-22, MC-23, KD-09, TN-38.
- Acceptance: the archive's counted and never-counted lists as cases; serial commas, separate list items, code, raw HTML, link text, images and unused definitions; exact roadmap references and lookalikes.
- Blocked by: B102.
- Lines: about 750.
- Touches: `crates/engine/src/placement/{refs.rs, closing.rs}`.

### B08. Section-map globs and the placement types
Glob compiling and matching, the most-literal-characters rule, ties to the first, shared globs before section globs, and the size limits. Also `Placed` and `Placement`, with PL1's layer, rule, evidence, `inferred` and `guessed`, and PL8's reasons as `{ code, layer, detail }`, with no logic beyond constructors.
- Section: `placement`.
- Rules: RF20, MC-53, PL1 and PL8 (the types).
- Acceptance: RF20's test; the archive's section-map cases; a placement and a reason list round-trip through serde.
- Blocked by: B102.
- Lines: about 500.
- Touches: `crates/engine/src/map_gaps/globs.rs`, `crates/engine/src/placement/placed.rs`.

### B09. The view contract and generated TypeScript
`engine::contract`: `Hello` with `newer_release` and `config_problems`, `GitHubState`, `Budget`, `MapView` with `Part<T>` and `problems`, `Change`, `SyncOutcome` and `ContractError`; the inner shapes from the screen spec's sketch, wires included, with each PR's placement and each Not placed PR's reasons (PL1, PL8, PL11); the `Contract` trait for the five calls and `Control` for kicks; a recorded implementation that serves fixture views, for adapter tests; the `ts-rs` export to `web/src/contract/`.
- Section: `service`.
- Rules: L4 (interface), L5, L6 (types), L7 (outcome), R16 and CF5 (fields), PL11 (fields), reconciliations 1, 9, 11, 12 and 19.
- Acceptance: L5's drift test; the recorded engine answers each call; each type's JSON field names match the sketches.
- Blocked by: B102.
- Lines: about 750.
- Touches: `crates/engine/src/contract/*`, `web/src/contract/*`.

### B10. The request guard
A pure check over a served request's method, path, headers and body length, and the headers every answer carries.
- Section: `service`.
- Rules: L11 (Q8), MC-70 (guard and paths), S4 (the CSP value), TN-22, TN-23, reconciliation 3.
- Acceptance: L11's test; `..` segments, symlinks out and malformed escapes give 404; every answer kind carries the CSP, `nosniff` and `no-referrer`, and `/api` answers `no-store`.
- Blocked by: B102.
- Lines: about 500.
- Touches: `crates/server/src/guard.rs`.

### B12. Settings file
Reading `settings.json`, its one write, its problem lines and its limits. Tabs and re-reads come later (B66, B68).
- Section: `config`.
- Rules: CF1, CF2.
- Acceptance: CF1's and CF2's tests.
- Blocked by: B102.
- Lines: about 450.
- Touches: `crates/engine/src/config/settings.rs`.

### B13. Site fetch port and build stamps
The `Fetch` port, with a live adapter (HTTPS only, no redirects, 5-second limit, size limits) and a recorded one, then the build file and the home page's meta stamp, which must agree on one clean 12-character revision.
- Section: `progress`.
- Rules: MC-55 (fetch side), CF15 (the fields read), TN-24.
- Acceptance: the archive's version-fetch cases; a redirect and an over-size answer refused; a stamp inside a comment ignored.
- Blocked by: B102.
- Lines: about 500.
- Touches: `crates/engine/src/versions/{fetch.rs, stamp.rs}`.

### B14. Parity record and known-differences list
The `parity` crate, depending on `engine` only (BS1), with its record types, its difference type and schema test, and `parity/known-differences.toml` with one entry per KD row, checked against the must-carry-over table.
- Section: `parity`.
- Rules: P11, P18.
- Acceptance: P11's schema test on a sample record; P18's check.
- Blocked by: B102.
- Lines: about 500.
- Touches: `crates/parity/{Cargo.toml, src/lib.rs, src/record.rs, src/kd.rs}`, `parity/known-differences.toml`.

### B104. Census record types
The census records, with no logic beyond constructors: issues, PRs, reviews, comments, closing references, timeline events, merge queue, file lists, spec documents and members, read marks per repository and kind, and one PR record per AR-01.
- Section: `github`.
- Rules: AR-01.
- Acceptance: every record round-trips through serde; one PR record serves the merge panel, the cards and the file list (AR-01's case).
- Blocked by: B102.
- Lines: about 300.
- Touches: `crates/engine/src/census/{mod.rs, records.rs}`.

## Batch 3: readers, census, maths, server and screen

### B15. Parity capture of the old answers
`parity capture`: a GET-only loopback client that copies each map's answers and a manifest into `capture/<run id>/old/<map id>/`, Seat Gauge copies every 5 seconds with the pick rule, and the window checks it can make from read-only files. Ports and job names come from a local file outside the repo that the runbook (B16) describes.
- Section: `parity`.
- Rules: P1, P2, P3, P4, P6, P7, P22.
- Acceptance: each rule's check against a fake old server serving fixture files on loopback.
- Blocked by: B14.
- Lines: about 650.
- Touches: `crates/parity/src/capture/*`.

### B17. Declarations in PR and issue text
`Ticket:`, `Unit:` and `Section:` lines with PL2's reasons; known ids in titles and branches by PL3's matching, over a known-id set the caller gives; "complete", "done" or "finished" after an id; the closing comment's opener for absorption; and the "Blocked by" section. Pure, over B07's extractor.
- Section: `placement`.
- Rules: MC-24 (text), MC-25, MC-31 (opener), MC-63 (the section's text), PL2, PL3, KD-41.
- Acceptance: the archive's PR-mapping, Section-line and blocker-list cases; PL2's and PL3's tests.
- Blocked by: B07.
- Lines: about 650.
- Touches: `crates/engine/src/placement/{declare.rs, blocked_by.rs}`.

### B18. Diagram reader
`files.flow` into the diagram type: nodes, notes, units, wires and their ends, with the whole-file and entry faults.
- Section: `config`.
- Rules: RF5, RF7 to RF12, MC-03.
- Acceptance: the RF tests, over `.work-map/` and `docs/spec/example/scope/`.
- Blocked by: B03.
- Lines: about 650.
- Touches: `crates/engine/src/config/roadmap/diagram.rs`.

### B19. Audit and plan readers
The unit audit, its four date forms in the config's zone, and the plan's unit table.
- Section: `config`.
- Rules: RF13, RF14, RF16, RF17, RF18, MC-02 (plan), MC-04, KD-26, CF16, TN-72 (impossible dates).
- Acceptance: those tests, over `docs/spec/example/scope/`.
- Blocked by: B03.
- Lines: about 750.
- Touches: `crates/engine/src/config/roadmap/{audit.rs, plan.rs, dates.rs}`.

### B20. Section map and mappings readers
The section map with its `maps` entries, and approved PR mappings.
- Section: `config`.
- Rules: RF21, RF22, RF23, RF25, RF26 (entry shape), RF27.
- Acceptance: those tests, over `.work-map/` and `docs/spec/example/scope/`.
- Blocked by: B03, B08.
- Lines: about 550.
- Touches: `crates/engine/src/config/roadmap/{section_map.rs, mapping.rs}`.

### B21. Frozen inputs reader and the frozen scores adapter
The four frozen files in the archive's shapes, read once and never written, with the standing-score rule, and the `scores` adapter over them.
- Section: `config`.
- Rules: CF17, MC-05, roadmap-files' frozen shapes, (Q1), reconciliation 16.
- Acceptance: CF17's test; MC-05's store cases; each shape pinned by a copied archive case described by what it checks.
- Blocked by: B03.
- Lines: about 650.
- Touches: `crates/engine/src/config/frozen.rs`, `crates/engine/src/scores/frozen.rs`.

### B22. `gh` token and the live GitHub adapter
Finding and running `gh`, the token held in memory, the GitHub states and their lines, and the live HTTPS adapter to `api.github.com` that reads every rate-limit header. Includes an HTTP-level fake GitHub for these tests.
- Section: `github`.
- Rules: L21, L22, L23, R5, R8, B1.
- Acceptance: those tests.
- Blocked by: B04.
- Lines: about 750.
- Touches: `crates/engine/src/github/{live.rs, gh.rs, state.rs}`.

### B23. Budget gate and the run log
The gate around any `GitHub`: one request in flight, costs logged, the light floor, the reserve and GitHub's stop signals, all scaled to the reported limit.
- Section: `github`.
- Rules: B2, B3, B10, B11, B12, MC-07, MC-08, TN-14.
- Acceptance: those tests, on B04's fake.
- Blocked by: B04.
- Lines: about 700.
- Touches: `crates/engine/src/github/{gate.rs, runlog.rs}`.

### B24. Conditional REST cache
The cache under `http/` with ETag and last-modified per exact request, and the fixed-once file list of a merged PR.
- Section: `github`.
- Rules: B9.
- Acceptance: B9's test at the port.
- Blocked by: B04.
- Lines: about 400.
- Touches: `crates/engine/src/github/cache.rs`.

### B25. Merge panel read and refresh scopes
`ReadScope` and `Census::refresh` with the Timer scope filled in: the one GraphQL merge panel query with its watermark and overlap, and the queue on the default branch. Stub files for the Sync and Full scopes, owned by B46 and B47.
- Section: `github`.
- Rules: B5, B6 (the first-poll card read hook), MC-09, KD-22, TN-15.
- Acceptance: B5's test; MC-09's cases.
- Blocked by: B03, B04, B104.
- Lines: about 600.
- Touches: `crates/engine/src/census/{refresh.rs, merge_panel.rs, sync.rs, full.rs}`.

### B26. Issue census
Issues per repository with closure reasons, close times, parents, blockers, labels and the comments absorption needs, from the same pages.
- Section: `github`.
- Rules: MC-13, MC-15 (issues), KD-08, TN-37.
- Acceptance: MC-13's and MC-15's cases.
- Blocked by: B03, B04, B104.
- Lines: about 750.
- Touches: `crates/engine/src/census/issues.rs`.

### B27. PR census and loading-bay events
Open, merged and closed PRs with heads, sizes, reviews, comments, closing references and timeline events, with the head repository GitHub reports.
- Section: `github`.
- Rules: MC-15 (PRs), MC-19, TN-25.
- Acceptance: MC-15's and MC-19's cases.
- Blocked by: B03, B04, B104.
- Lines: about 800.
- Touches: `crates/engine/src/census/{prs.rs, events.rs}`.

### B28. PR files, spec documents and spec members
The PR file inventory and the spec document and member reads.
- Section: `github`.
- Rules: MC-17, MC-18, TN-26.
- Acceptance: MC-17's and MC-18's cases.
- Blocked by: B03, B04, B104.
- Lines: about 650.
- Touches: `crates/engine/src/census/{files.rs, specs.rs}`.

### B29. Site versions: ancestry and merge distance
`versions::observe`: the revision as an ancestor of main, distinct merged PRs between them, and last known values with their reasons.
- Section: `progress`.
- Rules: MC-55, KD-14, KD-20, TN-43, TN-50.
- Acceptance: the archive's version and publication cases.
- Blocked by: B04, B13.
- Lines: about 600.
- Touches: `crates/engine/src/versions/{distance.rs, observe.rs}`.

### B30. Merges: the clock-hour chart, rolling figures and the loading bay
The twelve local-hour bars, the average and last hour, the queue figures kept on a partial read, and loading-bay status.
- Section: `progress`.
- Rules: MC-49, MC-50, MC-51, MC-52, KD-01, KD-02, KD-17, KD-39, TN-46, TN-47, TN-65.
- Acceptance: those cases, including TN-65's example and a read on the hour.
- Blocked by: B03.
- Lines: about 750.
- Touches: `crates/engine/src/merges/*`.

### B31. Ticket status, work, bugs and questions
Status from state and closure reason, work, bug and question cards, and when a count is current. Takes absorption parents as an input (B45 works them out).
- Section: `progress`.
- Rules: MC-30, MC-32, MC-38, TN-03, TN-13.
- Acceptance: those cases.
- Blocked by: B03.
- Lines: about 650.
- Touches: `crates/engine/src/progress/tickets.rs`.

### B32. Unit weights, section shares, days left and momentum
Unit days over counted cards, section shares on maps without units, days left and momentum, reading scores through the `scores` trait.
- Section: `progress`.
- Rules: MC-33, MC-34, MC-35, MC-36, KD-12, KD-16, TN-05, TN-06, TN-41, TN-45, (Q1), reconciliation 16.
- Acceptance: those cases, with a test double for `scores`.
- Blocked by: B03.
- Lines: about 700.
- Touches: `crates/engine/src/progress/{weights.rs, days.rs, momentum.rs}`.

### B33. Scope shares, build state and card tone
Three shares that add to 100, their inputs, the section build state and the card tone.
- Section: `progress`.
- Rules: MC-39, MC-40, MC-42, MC-43, KD-28, KD-31, TN-01, TN-02, TN-55, TN-69.
- Acceptance: those cases, and TN-01's 200,000 random sections as a property test.
- Blocked by: B03.
- Lines: about 700.
- Touches: `crates/engine/src/progress/{scope.rs, tone.rs}`.

### B34. Review bar and receipts
The Review bar by changed lines, de-duplicated by key, and the receipt and approval rules.
- Section: `progress`.
- Rules: MC-44, MC-45, KD-18, KD-27, TN-08, TN-48, TN-70.
- Acceptance: those cases.
- Blocked by: B03, B07.
- Lines: about 750.
- Touches: `crates/engine/src/progress/{review.rs, receipts.rs}`.

### B35. Spec closure and the planning checklist
- Section: `progress`.
- Rules: MC-46, MC-47, KD-11, TN-09, TN-11, TN-40.
- Acceptance: those cases.
- Blocked by: B03.
- Lines: about 650.
- Touches: `crates/engine/src/progress/{specs.rs, checklist.rs}`.

### B37. Server routes, static files and the change stream
The route table over `dyn Contract`, ETags and 304s, Sync held open, the event stream with a comment every 25 seconds, static files through the `Assets` trait, and the loopback bind. Tests use B09's recorded engine and a fake `Assets`.
- Section: `service`.
- Rules: L3 (server side), L10 (bind), L12, MC-70 (routes), the served-mode table.
- Acceptance: L3's same-bytes test, L10's other-addresses refusal and L12's test; each route over the recorded engine; an unknown path gives 404.
- Blocked by: B09, B10.
- Lines: about 700.
- Touches: `crates/server/src/{routes.rs, sse.rs, assets.rs}`.

### B38. Screen transport client
The one client module, with the Tauri and HTTP adapters.
- Section: `screen`.
- Rules: S5, L4, L9, L11 (headers sent), L12 (resubscribe).
- Acceptance: L4's shared suite against both adapters; L9's and L12's tests; S5's lint rule.
- Blocked by: B09, B11.
- Lines: about 550.
- Touches: `web/src/transport/*`, `web/test/transport/*`.

### B39. Screen move: the shell, board, cards and camera
Move the archive's app shell, board, cards, bars, wires, camera, call-outs, interactions, saved view, theme and section brief with their CSS. Add MIT headers, cut the retired code these files hold and TN-83's dead CSS, delete the validators, and read generated types. Tests build views with typed builders until B108 moves them onto the exported fixtures. Leave stub components for the header, overview strip, merge panel, loading bay, agents and versions, which B49 and B50 replace.
- Section: `screen`.
- Rules: S1, S7 (these parts), S8, S9, S10, S12, S13, S15, F2, F3, F6, MC-72, MC-74, MC-75, MC-77, MC-78, MC-79, MC-80, MC-81, KD-21, TN-28 to TN-34, TN-52, TN-53, TN-56, TN-81.
- Acceptance: those tests; S4's storage-key test; S7's import and shown-shares tests; S8's all-`null` render.
- Blocked by: B09, B11.
- Lines: about 800 changed, about 2,000 moved.
- Touches: the moved files under `web/src/`, `web/test/unit/*`.

### B40. Parity compare rules
Pairing cards, the compared and ignored fields, the tolerances, order, and drift as "moved".
- Section: `parity`.
- Rules: P12 to P17.
- Acceptance: those checks.
- Blocked by: B14.
- Lines: about 650.
- Touches: `crates/parity/src/compare.rs`.

### B41. Parity explanations and report
The mechanical KD tests, `explanations.toml`, stale explanations, and the text and JSON report with its exit codes.
- Section: `parity`.
- Rules: P19, P20, P21, KD-02, KD-30, KD-39.
- Acceptance: those checks.
- Blocked by: B14.
- Lines: about 550.
- Touches: `crates/parity/src/{explain.rs, report.rs}`.

### B54. Control port, instance file and `kick`
- Section: `service`.
- Rules: L15 (instance file), L16, L17, L18 (the command side), B14 (nothing queues).
- Acceptance: those tests.
- Blocked by: B06, B09.
- Lines: about 650.
- Touches: `crates/app/src/{control.rs, kick.rs}`.

### B55. Window shell
Tauri 2 behind the `window` feature: `tauri.conf.json`, the capability file, the five commands and the channel over `dyn Contract`, Dock and close behaviour, the navigation and new-window handlers, the Windows refusal of terminal commands, `Context::assets()` for the window build, and the build's stop line when `web/dist` is missing.
- Section: `service`.
- Rules: L3, L13, L14, L20 (Tauri's paths), R7, S14, S18, reconciliations 3 and 4.
- Acceptance: those tests, S14's with a fake opener.
- Blocked by: B09, B11.
- Lines: about 750.
- Touches: `crates/app/{tauri.conf.json, capabilities/, build.rs, icons/, src/window.rs}`.

### B91. Seat Gauge reader: workspace pattern and PR evidence
`workspace_pattern` at the top of the file and `pr` in each row, as the shared file spec's workspace labels and PR evidence sections say. The split is the writer's job: Seat Gauge cuts each label from the right (seat last, section before it, the rest the repo), with its repo list kept only as a fallback for older labels, then writes `repo`, `section` and `seat` (Q15). This reader takes them as written and never cuts `workspace` again. A bad `pr` drops alone, and an unknown source shows as text and ranks below `agent`. One tie rule, `seat_gauge::tie`, links a row to a PR in the project's PR list: its `pr` when that PR is in the list, else MC-58's branch match on the base repository, which wins when the two disagree. B36 and B93 both use it.
- Section: `placement`.
- Rules: the Seat Gauge file spec (workspace labels, PR evidence), MC-58 (the branch tie), TN-66, (Q15).
- Acceptance: `attribution.json` and `normal.json` at the test clock give the rows, pattern and PR evidence their table names; a fork's branch never ties; a row whose `pr` names a PR missing from the list ties by branch or not at all; a row's written `section` is used whatever its `workspace` says (Q15).
- Blocked by: B05.
- Lines: about 400.
- Touches: `crates/engine/src/seat_gauge/{attribution.rs, tie.rs}`, the row fields in `crates/engine/src/seat_gauge/parse.rs`.

### B92. Config: the attribution block and the workspace pattern
`attribution` (`ticketIds`, `branchTicket`, `check`) with its defaults, and `seatGauge.workspacePattern` checked by the file spec's template rules. `seatGauge.branchTicket`, when unset, uses `attribution.branchTicket`. CF14's pattern helper (Rust `regex`, at most 256 characters, the capture-group counts) lands here as `config/patterns.rs`, and B57 uses it for the older pattern fields.
- Section: `config`.
- Rules: PL12, PL13 (config side), CF14 (as patched), CF6 (line form).
- Acceptance: PL12's and PL13's tests; `P11: Zoom` reads as `P11` under the default `ticketIds`.
- Blocked by: B03.
- Lines: about 350.
- Touches: `crates/engine/src/config/{attribution.rs, patterns.rs}`.

### B100. Settings: `allowed_hosts`
`settings.json`'s `allowed_hosts`: 0 to 20 plain host names besides IP addresses, each entry checked and dropped alone with a line naming it, as CF2 does (CF25, Q8).
- Section: `config`.
- Rules: CF25 (the settings side), CF2, (Q8).
- Acceptance: CF25's test on the list `["build-box", "Build-Box", "build-box:4317", "*.example", "192.0.2.7"]`; no key means an empty list.
- Blocked by: B12.
- Lines: about 250.
- Touches: `crates/engine/src/config/settings.rs`.

### B101. Request guard: listed host names
The guard accepts a `Host` that is a name on the list it is given followed by the served port, compared exactly, with an `Origin` to match, and refuses every other name, so the DNS-rebinding guard otherwise stands as written (L11, MC-70, Q8). B53 hands it `allowed_hosts`, and B68 hands it a changed list at CF4's next re-read.
- Section: `service`.
- Rules: L11 (as amended), MC-70, (Q8).
- Acceptance: L11's tests with `allowed_hosts: ["build-box"]`.
- Blocked by: B10.
- Lines: about 250.
- Touches: `crates/server/src/guard.rs`.

## Batch 4: loader, placement, sync, shell and screen

### B36. Seat Gauge placement and agents on cards
`seat_gauge::read`: where each session goes, with sessions tied to PRs by B91's rule, pills on cards, the kept report on a failed read, the anonymous count, and the next deadline. Tests build `Placement` by hand. Moved to batch 3 to follow B91.
- Section: `placement`.
- Rules: MC-58, MC-59, MC-60, MC-61, TN-19, TN-20, TN-21, AR-05, AR-12.
- Acceptance: those cases, over B05's example adapter.
- Blocked by: B03, B05, B08, B91.
- Lines: about 650.
- Touches: `crates/engine/src/seat_gauge/{place.rs, agents.rs}`.

### B42. Parity old-capture adapter
The capture turned into a record, repeating the old screen's own rules where it worked figures out.
- Section: `parity`.
- Rules: P8, TN-29, AR-07.
- Acceptance: P8's check, each repeated rule tested on the old screen's cases described by what they check.
- Blocked by: B14, B15.
- Lines: about 750.
- Touches: `crates/parity/src/old/*`.

### B43. Config v2 loader
`config::load`: the strict v2 schema, ids, repositories, roadmap file sources (local, GitHub through the cache, or a settings entry's folder), paths, basis, sites and zone, assembled into `Project` from the readers. It calls stub `checks.rs` and `v1.rs` files that B57 and B58 fill, so neither edits `load.rs`.
- Section: `config`.
- Rules: CF6, CF7, CF8, CF9, CF11, CF12, CF13, CF15, CF16, RF2, RF3, RF4.
- Acceptance: those tests.
- Blocked by: B12, B18, B19, B20, B21, B24, B92.
- Lines: about 800.
- Touches: `crates/engine/src/config/{load.rs, sources.rs, checks.rs, v1.rs}`.

### B44. PR placement in layers: what it says and what it changes
`placement.md`'s twelve steps against a ticket-section lookup, first match wins, with steps 1 to 8 filled: the Section line, ticket ids, `Ticket: none`, the PR's own entry, closed tickets and the branch's ticket, prose tickets, changed files and the repository default. Each placement carries its layer, rule, a one-line evidence of at most 200 characters, `inferred` and `guessed`; each step that does not place leaves its reasons in step order; warnings (`files_tie`, `closing_tickets_disagree`, `docs_only`, `map_gap`) never change a placement. Steps 9 and 10 call stub `session.rs` and `guess.rs` files that leave `no_session` and `no_guess`, for B93; step 11 is reserved for release two.
- Section: `placement`.
- Rules: PL1, PL2 (wiring), PL4, PL5, PL10, MC-26 (steps 1 to 8), MC-24 (wiring), MC-29, KD-23, KD-30, KD-36, KD-40, TN-12, (Q2), (Q19).
- Acceptance: PL1's, PL4's, PL5's and PL10's tests; MC-26's cases for steps 1 to 8; a PR named only in prose by tickets in one section places by step 6 ahead of its files (Q19).
- Blocked by: B08, B17.
- Lines: about 800.
- Touches: `crates/engine/src/placement/{pr.rs, session.rs, guess.rs}`.

### B45. Absorption
Parents from duplicate links and closing comments, loops, parents outside the census and chains not read in full, as the parent map B31 takes.
- Section: `progress`.
- Rules: MC-31, TN-04.
- Acceptance: the archive's absorbed-progress cases.
- Blocked by: B17.
- Lines: about 500.
- Touches: `crates/engine/src/progress/absorb.rs`.

### B46. Change probe and backstops
The Sync scope: the probe per 15 repositories, re-reads of what it names, the merge-lag read, and the daily and weekly backstops.
- Section: `github`.
- Rules: B7, B8, MC-10, MC-11, MC-12, KD-07, KD-32, TN-16, TN-36.
- Acceptance: those tests, and MC-11's property that an incremental read equals a full one.
- Blocked by: B25, B26, B27.
- Lines: about 700.
- Touches: `crates/engine/src/census/sync.rs`.

### B47. Resumable full read and kept values
The Full scope with progress saved per repository and kind, and the last good values kept with their times on any failure.
- Section: `github`.
- Rules: MC-14, MC-16, MC-06 (whole reads), KD-06, KD-35, TN-13, TN-35, TN-62.
- Acceptance: those cases, including 7,600 merged PRs read over several Syncs.
- Blocked by: B25, B26, B27, B28.
- Lines: about 700.
- Touches: `crates/engine/src/census/{full.rs, keep.rs}`.

### B48. Gap census
- Section: `placement`.
- Rules: MC-54, RF24, KD-29, TN-26, TN-60.
- Acceptance: those cases, and RF20's fixture PR 65 as one gap.
- Blocked by: B08, B20, B28.
- Lines: about 550.
- Touches: `crates/engine/src/map_gaps/census.rs`.

### B49. Screen: header, tabs, Sync and footer
Move the header, overview strip, ticket inventory, tabs and Sync button, draw the GitHub and budget lines, the config and roadmap problem lines, and the newer-release link.
- Section: `screen`.
- Rules: S11, S20, B13 (lines), L23 (lines), MC-76, KD-21, reconciliations 5 and 12.
- Acceptance: S11's and S20's tests; B13's render test; each problem line, CF26's warnings included, on its own tab only.
- Blocked by: B39.
- Lines: about 700 changed, about 900 moved.
- Touches: the header, overview, inventory, tabs and Sync files under `web/src/`, their tests.

### B50. Screen: merge panel, loading bay, agents, versions and gaps
- Section: `screen`.
- Rules: S7 (these parts), MC-49 (drawing only), MC-52 (drawing), MC-59 (pills), MC-76 (the Seat Gauge button).
- Acceptance: the archive's loading-bay, Seat Gauge pill and site-version drawing cases, rewritten on typed builders.
- Blocked by: B39.
- Lines: about 600 changed, about 700 moved.
- Touches: those component files under `web/src/`, their tests.

### B51. Screen: `useMap` and map switching
- Section: `screen`.
- Rules: S6, MC-71, TN-28, TN-57, TN-82.
- Acceptance: S6's test.
- Blocked by: B38, B39.
- Lines: about 400.
- Touches: `web/src/useMap.ts`, the shell's data source, `web/test/unit/useMap.test.ts`.

### B52. Parity streak
`parity streak` over the kept reports.
- Section: `parity`.
- Rules: P23, P24.
- Acceptance: P23's check.
- Blocked by: B41.
- Lines: about 400.
- Touches: `crates/parity/src/streak.rs`.

### B53. Headless serve and the embedded files
`work-map serve` over `dyn Contract`, the `rust-embed` assets for the build with no window, the serving line, `--port`, `--open` and exit 4, the no-window message, and `allowed_hosts` handed to the guard (CF25, B100, B101). B66 swaps in the real engine.
- Section: `service`.
- Rules: L2 (serve with no display), L3, L10, R3, reconciliation 2.
- Acceptance: L2's, L3's, L10's and R3's tests.
- Blocked by: B37, B100, B101.
- Lines: about 500.
- Touches: `crates/app/src/{serve.rs, assets.rs}`.

### B56. The example refresh command
`cargo xtask example-refresh` as own-map.md lays out (OM8 to OM11): one full read of this repo through the live adapter, recorded as answers to the census's own queries with logins replaced and bodies trimmed, a copy of `.work-map/` and the made-up Seat Gauge file, labelled as examples (Q17), with times as offsets. B71 adds the fixture export and `expected.json` to it, and B109 the parity capture.
- Section: `config`.
- Rules: CF23 (offsets), CF24 (size), OM8 to OM11, (Q17).
- Acceptance: two refreshes over a fake GitHub give the same bytes; the recorded adapter answers every request a full read of the example makes; OM10's three refusals; OM11's test; the embedded copy is under 300 KB.
- Blocked by: B04, B22, B25, B26, B27, B28.
- Lines: about 800.
- Touches: `examples/demo/*`, `crates/xtask/src/example_refresh.rs`.

### B95. The one-PR read for `where`
A scoped read of one PR and the tickets it names, through the budget gate: PL20's calls in order, file pages up to 3,000, the alias query for named tickets, the title search for unknown ids that hold a letter and a digit, parent levels up to four, and the 40-request cap. It returns census-shaped records, so the ladders run on them unchanged. GraphQL queries and REST `GET`s only.
- Section: `github`.
- Rules: PL20, PL21 (GitHub side), B2, B11, B12, L22.
- Acceptance: PL20's three cost tests; PL21's fake that fails any mutation or non-`GET` request sees none; a 41st request ends the read with `call_cap`.
- Blocked by: B22, B23, B27, B28.
- Lines: about 550.
- Touches: `crates/engine/src/census/one_pr.rs`.

### B105. Platform Tauri files
`tauri.macos.conf.json`, `tauri.windows.conf.json` (the companion in `bundle.externalBin`, `bundle.targets` set to `["nsis"]`) and `tauri.linux.conf.json`.
- Section: `service`.
- Rules: R1 (the bundle list), R4, R6 (the bundle side).
- Acceptance: R6's bundle check that the companion is listed; each file parses and names only R1's bundles.
- Blocked by: B55.
- Lines: about 150.
- Touches: `crates/app/tauri.{macos,windows,linux}.conf.json`.

### B125. Config: the sections-first warnings
CF26's two checks over the diagram and the section map, as warning lines in CF6's form with `warning:` before the message: a section id that is not one word, and a glob claimed twice, under two sections in `boxes` or both in `shared` and under a section. A glob inside a broader one is not a double claim (RF20). Warnings never stop a load. B57 runs them, B67 shows them on the project's tab, and B96 lists them in `sections`.
- Section: `config`.
- Rules: CF26, RF20, (Q20).
- Acceptance: CF26's test: `sign-in` and `src/shared/**` under both `editor` and `search` give two lines; `crates/engine/src/config/**` under `config` with `crates/engine/**` under `service` gives none; this repo's `.work-map/` gives none (OM2).
- Blocked by: B18, B20.
- Lines: about 300.
- Touches: `crates/engine/src/config/sections_check.rs`.

## Batch 5: checks, place, measure, sections and the release job

### B57. Config cross-checks
Destinations against the diagram, the older pattern fields under Rust's `regex` through B92's helper, scope maps' audit against the diagram, and plan and audit disagreements. It runs B125's sections-first warnings with the rest.
- Section: `config`.
- Rules: CF10, CF14, RF15, RF19, MC-01.
- Acceptance: those tests; a config with a CF26 warning still loads, with the warning among its lines.
- Blocked by: B43, B125.
- Lines: about 600.
- Touches: `crates/engine/src/config/checks.rs`.

### B58. Version 1 config reader
Includes reading `attribution` from a version 1 file, as `sites` and `timeZone` are read (PL12, CF18 as patched).
- Section: `config`.
- Rules: CF18, CF19, PL12 (version 1).
- Acceptance: CF18's paired cases and CF19's test; a version 1 file with an `attribution` block loads it.
- Blocked by: B43.
- Lines: about 550.
- Touches: `crates/engine/src/config/v1.rs`.

### B59. Issue placement, the closing-PR pass and `place`
The issue order of trust, the closing-PR second pass with label and prefix rules, and `place()` running both ladders once. A bare id in a ticket title uses PL3's ids and matching, each ticket placement carries its rule and evidence, and a ticket placed through a PR's guess inherits `guessed` (PL9; tests build the guessed PR placement by hand).
- Section: `placement`.
- Rules: MC-27, MC-28, AR-04, PL9 (tickets), KD-41.
- Acceptance: those cases; PL9's ticket test.
- Blocked by: B44.
- Lines: about 800.
- Touches: `crates/engine/src/placement/{issue.rs, second_pass.rs, place.rs}`.

### B60. Rollups, header census and `measure`
Stage and header rollups, the header ticket census, and `measure()` composing B31 to B35 and B45.
- Section: `progress`.
- Rules: MC-37, MC-48, KD-15, TN-10, TN-44, AR-06.
- Acceptance: those cases.
- Blocked by: B31, B32, B33, B34, B35, B45.
- Lines: about 700.
- Touches: `crates/engine/src/progress/{rollups.rs, header.rs, measure.rs}`.

### B61. Release jobs and the README check
The `bundle`, `draft` and `publish` jobs in `build.yml`, renaming, `SHA256SUMS` and the Windows companion staging, with R17's README check as a repo test. The platform Tauri files are B105's and the README text B103's.
- Section: `tooling`.
- Rules: R1, R2, R4, R11, R14 (the draft job's check), R17 (the check).
- Acceptance: those checks, with a test tag `v0.0.1-rc.1`; R17's check passes on B103's README.
- Blocked by: B02, B53, B105.
- Lines: about 500.
- Touches: `.github/workflows/build.yml`, `crates/xtask/tests/readme.rs`.

### B62. Browser suite
Playwright's Chromium and WebKit against the built screen, served by a small Node server from fixture files.
- Section: `screen`.
- Rules: S16 (the server), S3 (no off-origin request), S4 (no CSP violation), F1, F4, F5, F7, F8, MC-73, MC-74.
- Acceptance: those cases in both engines.
- Blocked by: B49, B50, B51.
- Lines: about 700.
- Touches: `web/test/browser/*`, `web/test/server.ts`.

### B63. The example in the binary
`engine::example`: the embedded files, recorded adapter and Seat Gauge file, shifted to now on load and on each Sync.
- Section: `config`.
- Rules: CF21, CF22, CF23, CF24 (embedding).
- Acceptance: CF22's and CF23's tests at the module.
- Blocked by: B43, B56.
- Lines: about 500.
- Touches: `crates/engine/src/example/*`.

### B65. View: parts and freshness
The merges, agents, versions and gaps parts and their states, and the pending reason codes.
- Section: `service`.
- Rules: MC-64, AR-12, AR-13, B13 (states).
- Acceptance: MC-64's cases for each part.
- Blocked by: B29, B30, B36, B48.
- Lines: about 600.
- Touches: `crates/engine/src/view/{parts.rs, freshness.rs}`.

### B93. PR placement layers 3 and 4: who made it, and the guess
Fills B44's `session.rs` and `guess.rs`. Step 9 ties the PR to Seat Gauge rows through B91's tie rule and takes the row's `section` (exactly, else ignoring case when one section matches), leaving `no_session`, `seat_gauge_unavailable`, `session_no_section`, `session_unknown_section` or `sessions_disagree`. Layer-3 placements are kept with the rows' keys in a value the engine saves in project state (B66), so a merged PR stays placed after Seat Gauge drops its rows. A file pattern unlike `seatGauge.workspacePattern` adds `workspace_pattern_differs`. Step 10 takes a merged PR's frozen model placement as `guessed`, with its date for the hover and `only_guessed` for `where`. Release one never calls a model.
- Section: `placement`.
- Rules: PL6, PL7, PL8, PL9 (sessions), PL13 (the comparison), KD-40, KD-42, MC-58.
- Acceptance: PL6's, PL7's, PL8's and PL9's session tests; PL13's `workspace_pattern_differs` case.
- Blocked by: B21, B36, B44, B91, B92.
- Lines: about 600.
- Touches: `crates/engine/src/placement/{session.rs, guess.rs, kept.rs}`.

### B94. Screen: placement hovers and Not placed reasons
A PR's hover reads its layer, rule and evidence ("Layer 2, changed files: 7 of 9 owned files in editor"), a guessed placement carries the "guessed" tag with its date, and the Not placed list shows each PR's first reason as a sentence with the rest on hover. The engine sends reason codes and the screen holds their words.
- Section: `screen`.
- Rules: PL8 (on screen), PL11, KD-43, S7.
- Acceptance: PL11's test; every reason code in PL15's table has a sentence.
- Blocked by: B39, B49.
- Lines: about 350.
- Touches: the PR hover and Not placed list components under `web/src/`, `web/src/words/reasons.ts`, their tests.

### B96. `sections`, and finding the project
In the engine: PL14's project rule without a PR (`--config`, `--project`, else `.work-map/work-map.json` at the root of the checkout holding the current folder), kept for `where` to add the PR's repository to; then PL23's list as tab-separated text or JSON, with B125's warnings in `warnings` and on `warning` lines, and its exit code. B106 gives it its command.
- Section: `config`.
- Rules: PL14 (the project), PL23, CF26 (the `warnings` field).
- Acceptance: PL23's tests on this repo's `.work-map/` and on a diagram holding `sign-in`; outside a checkout with no flag it answers exit 2 naming what it tried.
- Blocked by: B20, B43, B125.
- Lines: about 350.
- Touches: `crates/engine/src/config/{resolve.rs, sections.rs}`.

## Batch 6: the view and `where`

### B64. View: the board
Cards, stages, header, wires with configured dependencies and blocker arrows, Next up, PR lists with each PR's placement and warnings, planning steps and the Not placed PRs with their reasons. `view/build.rs` starts here, with the other parts as never read until B67.
- Section: `service`.
- Rules: RF12 (in the view), MC-62, MC-63, MC-65, PL11 (fields), KD-10, KD-34, KD-43, TN-07, TN-39, TN-68, reconciliations 11, 19 and 24.
- Acceptance: those cases; an inferred open PR carries its layer, rule and evidence, and a Not placed PR its reasons in step order.
- Blocked by: B59, B60, B93.
- Lines: about 850.
- Touches: `crates/engine/src/view/{board.rs, next_up.rs, wires.rs, build.rs}`.

### B97. `where`: the verdict and the answer
In the engine: PL14's PR forms and its settings rule on top of B96's, B95's read, the ladders exactly as the map runs them (B59's `place()`), the verdict under `placed` or `strict` with a guess never landing (Q18), JSON (`WhereAnswer` and `WhereError`) with a schema generated from the Rust types, the text form, and the exit code. B106 gives it its command.
- Section: `placement`.
- Rules: PL14 to PL21, (Q31), (Q18).
- Acceptance: every PL15 code has a case over the fake GitHub, each checking its full reason list; PL14's and PL16's to PL19's tests; PL21's no-write test with the data folder's list and times unchanged.
- Blocked by: B57, B59, B93, B95, B96.
- Lines: about 700.
- Touches: `crates/engine/src/placement/{verdict.rs, answer.rs}`.

## Batch 7: the engine service and the two commands

### B66. Engine service
`Engine::open`, tabs, `hello`, view stamps, `subscribe`, Sync joining and its outcome, Retry, the last good config on a failed re-read, the example when nothing loads, saves through `store`, B93's kept layer-3 placements in project state, and viewer handles. It implements `Contract` and `Control`, and `boot.rs` builds it for every entry. It leaves stub `timers.rs` and `release_check.rs` files, with the viewer count and a `newer_release` slot in `hello` exposed to them, for B68 and B69.
- Section: `service`.
- Rules: L6, L7, L23, CF3, CF5, CF21, CF22, MC-66, MC-67, KD-25.
- Acceptance: those tests.
- Blocked by: B06, B22, B23, B46, B47, B57, B58, B63, B64.
- Lines: about 800.
- Touches: `crates/engine/src/engine/{service.rs, sync.rs, tabs.rs, timers.rs, release_check.rs}`, `crates/app/src/boot.rs`.

### B67. View build: every part and the problem lines
Wire B65's parts into `view::build`, add each project's roadmap problem lines and CF26 warnings, and carry the Seat Gauge deadline.
- Section: `service`.
- Rules: RF5 (on screen), CF26 (on the project's tab), L8 (the deadline in the view), reconciliation 12.
- Acceptance: a view of the example has every part `current`; a broken section map gives a `problems` line on its own project only, and so does a CF26 warning.
- Blocked by: B64, B65.
- Lines: about 350.
- Touches: `crates/engine/src/view/build.rs`.

### B106. The `where` and `sections` commands
The app's two entries over B96 and B97: arguments, stdout, exit codes 0, 1, 2 and 5, the headless build running both (R3), and `work-map.exe` refusing both on Windows as it refuses `serve` (R7).
- Section: `service`.
- Rules: PL24, L2, R7 and R14 (as patched), R3.
- Acceptance: `work-map where` and `work-map sections` give B96's and B97's answers and codes from the binary; `work-map.exe where 1` exits 2.
- Blocked by: B55, B96, B97.
- Lines: about 250.
- Touches: `crates/app/src/{where_.rs, sections.rs}`, R7's list in `crates/app/src/window.rs`.

## Batch 8: timers, release check, dump, fixtures, the attribution page and the merge check

### B68. Timers: viewers, the poll, kicks and the Seat Gauge deadline
- Section: `service`.
- Rules: L8, L18 (engine side), L19, B4, B6, B14, CF4, MC-68, MC-69, L11 (a changed `allowed_hosts` reaches the guard at the next re-read).
- Acceptance: those tests on a fake clock.
- Blocked by: B66, B67.
- Lines: about 700.
- Touches: `crates/engine/src/engine/{timers.rs, kick.rs, reread.rs}`.

### B69. Newer-release check
- Section: `service`.
- Rules: R15, R16, `check_for_updates` (CF settings), reconciliation 1.
- Acceptance: R15's and R16's checks.
- Blocked by: B23, B24, B66.
- Lines: about 450.
- Touches: `crates/engine/src/engine/release_check.rs`.

### B70. `work-map dump`
`engine::dump` and the app's `dump` entry: one Sync per project, views at `--as-at` with agents at `--agents-at`, `--settings`, and a file of views with their read facts and input hashes, which `parity` maps to its record in B72.
- Section: `service`.
- Rules: P9 (as patched), P10, CF20, L2, reconciliations 7 and 9.
- Acceptance: P9's and CF20's tests.
- Blocked by: B66, B67.
- Lines: about 400.
- Touches: `crates/engine/src/dump/*`, `crates/app/src/dump.rs`.

### B71. Fixture export and the expected numbers
`cargo xtask export`, with a `--check` mode that B01's step list already names, writing the example's views as the screen's fixture files; the export step in the refresh; and `examples/demo/expected.json`, written by the refresh and reviewed by hand in its PR (OM9). B108 commits the fixtures and moves the screen tests onto them.
- Section: `config`.
- Rules: S16 (fixtures), CF24.
- Acceptance: CF24's regeneration check; an export into a temporary folder twice gives the same bytes; a test holds the example to `expected.json`.
- Blocked by: B63, B66, B67.
- Lines: about 250.
- Touches: `crates/xtask/src/export.rs`, the export step in `crates/xtask/src/example_refresh.rs`, `examples/demo/expected.json`.

### B98. The attribution chain page
`docs/attribution.md`, about one page, as `placement.md`'s guide section lays it out: ticket, section, agent workspace, PR, merge check and map, each with what checks it and what the map shows when it fails, then one worked example from this repo's own map and the fix for each reason code. It says section ids are one word with no hyphen and seat names one word, so Seat Gauge splits a workspace label from the right: seat last, section before it, the rest the repo (Q15, Q20).
- Section: `docs`.
- Rules: `placement.md`'s attribution chain page, PL22, (Q15), (Q18), (Q20).
- Acceptance: every command on the page runs as written in a checkout of this repo; every PL15 reason code has its fix on the page, checked in review.
- Blocked by: B106.
- Lines: about 300.
- Touches: `docs/attribution.md`.

### B99. This repo's merge check moves to `work-map where`
PL22 for this repo. `.work-map/work-map.json` gains `"attribution": { "check": "strict", "branchTicket": "^[a-z]+/([1-9][0-9]*)-" }` and `specDocuments.placement` gains `docs/spec/placement.md`. `AGENTS.md` and OM7 replace the two shell lines with `work-map where "$PR" --json`, holding the merge on exit 1, and take the id list from `work-map sections`. The build machine's pre-check (BS6) runs `work-map` built from `main` as its first step. The example's copy picks the block up at the next refresh (OM9).
- Section: `docs`.
- Rules: PL22, OM5, OM7, (Q32), (Q18).
- Acceptance: OM5's cases, Windows line ends included, give the same verdicts from `where` as from the old lines, recorded on the ticket; the config loads with no problem line (OM3).
- Blocked by: B106.
- Lines: about 80.
- Touches: `.work-map/work-map.json`, `AGENTS.md`, `docs/spec/own-map.md`.

### B107. Hosted Windows check for `where` and `sections`
R6's PowerShell check in `build.yml` also runs `work-map-cli.exe sections --config .work-map/work-map.json` in a checkout and `work-map.exe where 1` (PL24).
- Section: `tooling`.
- Rules: PL24, R6.
- Acceptance: PL24's test on the hosted Windows runner.
- Blocked by: B61, B106.
- Lines: about 60.
- Touches: R6's check in `.github/workflows/build.yml`.

## Batch 9: parity test, guide and the first candidate

### B72. Parity: the dump as a record, and the example project test
`parity` reads `dump`'s file of views and maps it to its record, with the read facts and input hashes P5 checks. Then the example's old capture in the archive's served shape, written from the dump through `crates/xtask/src/old_capture.rs` (the refresh calls it from B109 on) and planted with one KD-30 difference, one explained difference and one moved issue, plus the planted-bug fixture (OM12).
- Section: `parity`.
- Rules: P9 (as patched), P11, P25, P26, reconciliation 7.
- Acceptance: the mapped record of the example's dump passes P11's schema test; P25's and P26's checks, with no network, old engine or login.
- Blocked by: B14, B40, B41, B42, B52, B70, B71.
- Lines: about 850.
- Touches: `crates/parity/src/new.rs`, `crates/parity/tests/*`, `crates/xtask/src/old_capture.rs`.

### B73. The getting-started guide
`docs/getting-started.md` from config-v2's outline, linked from the README. Step 5 links the attribution chain page (B98).
- Section: `docs`.
- Rules: the guide outline, (Q5), (Q8) and CF25 for step 7's third route, (Q20) for steps 4 and 5.
- Acceptance: every command in it runs as written against the example.
- Blocked by: B61, B66, B68, B98, B100.
- Lines: about 300.
- Touches: `docs/getting-started.md`, `README.md`.

### B74. Prepare the live maps for comparison (maintainer task)
Switch-over step 1 in the build spec, on the build machine.
- Section: `parity`.
- Rules: CF19, RF14, RF17, RF24, P18, reconciliations 10 and 13.
- Acceptance: both live maps load with no problem line; any new KD row is in `must-carry-over.md` and `known-differences.toml`.
- Blocked by: B16, B57, B58, B66, B70.
- Lines: none here. Any new KD row goes in its own small PR with `Section: docs`, adding the row to `must-carry-over.md` and its entry to `parity/known-differences.toml`, one of BS13's lists.
- Touches: the maintainer's live configs, outside the repo.

### B75. Release candidate one
A version PR to `1.0.0-rc.1`, its tag and prerelease, and the manual checks no runner can make: F3's pinch in the macOS window, S14's Copy in each OS window, R17's first-launch steps on each OS, and L14's Dock behaviour. Red hosted runs open at this point are fixed or ticketed first.
- Section: `tooling`.
- Rules: R11, R14, F3, S14, R17, L14.
- Acceptance: R11's prerelease has R1's assets; the manual results are recorded on the ticket.
- Blocked by: B61, B62, B68, B69, B70, B71, B94, B106, B107.
- Lines: about 50.
- Touches: `Cargo.toml`, `web/package.json`.

### B108. Screen tests on the exported fixtures
Run B71's export into `web/test/fixtures/` and move the screen tests from typed builders onto the fixture files where a fixture covers the case.
- Section: `screen`.
- Rules: S16.
- Acceptance: S16's tests on the fixtures; `cargo xtask export --check` passes.
- Blocked by: B71.
- Lines: about 300.
- Touches: `web/test/fixtures/*`, the screen's test helpers.

## Batch 10: deslop, and the refresh's capture step

### B76. Deslop pass on release one: `service`
BS10's deslop pass over the `service` section's code new since B01. Five more tickets take the other sections with shipped code, one each (Q20), side by side.
- Section: `service`.
- Rules: BS10.
- Acceptance: `cargo xtask check` green before and after; no capability or test removed; net lines reported.
- Blocked by: B72, B73, B75, B99, B108.
- Lines: a net cut, about 80 changed.
- Touches: the `service` section's shipped paths in own-map.md (dev-only `xtask` and `parity` code aside).

### B77. Removed (Q16)
The separate public demo repo and its seed script are dropped (Q16): this repo is the live example (own-map.md). The id stays so no other ticket's number moves, and no issue is filed for it.
### B109. The refresh writes the parity capture
The refresh calls B72's `old_capture` so every refresh writes P25's capture at the same instant as the rest (OM9, OM12).
- Section: `config`.
- Rules: OM9, OM12.
- Acceptance: P25 and P26 pass straight after a refresh over a fake GitHub.
- Blocked by: B72.
- Lines: about 60.
- Touches: the capture step in `crates/xtask/src/example_refresh.rs`.

### B110. Deslop pass on release one: `config`
As B76, over the `config` section's code.
- Section: `config`.
- Rules: BS10.
- Acceptance: as B76.
- Blocked by: B72, B73, B75, B99, B108.
- Lines: a net cut, about 50 changed.
- Touches: the `config` section's shipped paths in own-map.md (dev-only `xtask` and `parity` code aside).

### B111. Deslop pass on release one: `github`
As B76, over the `github` section's code.
- Section: `github`.
- Rules: BS10.
- Acceptance: as B76.
- Blocked by: B72, B73, B75, B99, B108.
- Lines: a net cut, about 50 changed.
- Touches: the `github` section's shipped paths in own-map.md (dev-only `xtask` and `parity` code aside).

### B112. Deslop pass on release one: `placement`
As B76, over the `placement` section's code.
- Section: `placement`.
- Rules: BS10.
- Acceptance: as B76.
- Blocked by: B72, B73, B75, B99, B108.
- Lines: a net cut, about 50 changed.
- Touches: the `placement` section's shipped paths in own-map.md (dev-only `xtask` and `parity` code aside).

### B113. Deslop pass on release one: `progress`
As B76, over the `progress` section's code.
- Section: `progress`.
- Rules: BS10.
- Acceptance: as B76.
- Blocked by: B72, B73, B75, B99, B108.
- Lines: a net cut, about 50 changed.
- Touches: the `progress` section's shipped paths in own-map.md (dev-only `xtask` and `parity` code aside).

### B114. Deslop pass on release one: `screen`
As B76, over the `screen` section's code.
- Section: `screen`.
- Rules: BS10.
- Acceptance: as B76.
- Blocked by: B72, B73, B75, B99, B108.
- Lines: a net cut, about 50 changed.
- Touches: the `screen` section's shipped paths in own-map.md (dev-only `xtask` and `parity` code aside).

## Batch 11: unslop

### B78. Unslop pass on release one: `docs`
BS10's unslop pass over the docs new since B01. Six more tickets take the screen words, errors, comments and test names of each section with shipped code, one each (Q20), side by side.
- Section: `docs`.
- Rules: BS10.
- Acceptance: as B76.
- Blocked by: B76, B110, B111, B112, B113, B114.
- Lines: about 100 changed.
- Touches: the `docs` section's paths in own-map.md.

### B115. Unslop pass on release one: `config`
As B78, over the `config` section's words: messages, empty states, comments and test names.
- Section: `config`.
- Rules: BS10.
- Acceptance: as B76.
- Blocked by: B110.
- Lines: about 35 changed.
- Touches: the `config` section's paths in own-map.md.

### B116. Unslop pass on release one: `github`
As B78, over the `github` section's words: messages, empty states, comments and test names.
- Section: `github`.
- Rules: BS10.
- Acceptance: as B76.
- Blocked by: B111.
- Lines: about 35 changed.
- Touches: the `github` section's paths in own-map.md.

### B117. Unslop pass on release one: `placement`
As B78, over the `placement` section's words: messages, empty states, comments and test names.
- Section: `placement`.
- Rules: BS10.
- Acceptance: as B76.
- Blocked by: B112.
- Lines: about 35 changed.
- Touches: the `placement` section's paths in own-map.md.

### B118. Unslop pass on release one: `progress`
As B78, over the `progress` section's words: messages, empty states, comments and test names.
- Section: `progress`.
- Rules: BS10.
- Acceptance: as B76.
- Blocked by: B113.
- Lines: about 35 changed.
- Touches: the `progress` section's paths in own-map.md.

### B119. Unslop pass on release one: `service`
As B78, over the `service` section's words: messages, empty states, comments and test names.
- Section: `service`.
- Rules: BS10.
- Acceptance: as B76.
- Blocked by: B76.
- Lines: about 35 changed.
- Touches: the `service` section's paths in own-map.md.

### B120. Unslop pass on release one: `screen`
As B78, over the `screen` section's words: messages, empty states, comments and test names.
- Section: `screen`.
- Rules: BS10.
- Acceptance: as B76.
- Blocked by: B114.
- Lines: about 35 changed.
- Touches: the `screen` section's paths in own-map.md.

## Batch 12: the parity streak

### B79. Parity runs to a streak (maintainer task)
Switch-over steps 2 to 4: a release candidate from the cleaned commit on the build machine, then windows by parity's steps until `parity streak` prints `ready`. Each failing run becomes a ticket.
- Section: `parity`.
- Rules: P1 to P23.
- Acceptance: `ready`, with the three runs' summary lines on the ticket (no private data).
- Blocked by: B16, B74, B78, B109, B115, B116, B117, B118, B119, B120.
- Lines: none.
- Touches: the build machine only.

## Batch 13: switch-over

### B80. Switch-over and `v1.0.0`
Switch-over steps 5 to 7: the maintainer's call, the old jobs retired, port 4317 to `work-map serve`, the `1.0.0` version PR and tag, then the live configs moved to version 2.
- Section: `tooling`.
- Rules: P24, R11, R14, CF18.
- Acceptance: release `v1.0.0` has R1's assets; both live maps are served by the Rust app.
- Blocked by: B79.
- Lines: about 20.
- Touches: `Cargo.toml`, `web/package.json`.

## Batch 14: the survey (`v1.1.0`)

### B81. Start: the survey, its cache and sign-in
Input forms, the nine-request survey through the gate, the 15-minute cache, sign-in states, the `Proposal`, `Choice` and `Written` types exported to TypeScript, and stub files for the five sources.
- Section: `start`.
- Rules: SM1, SM3, SM4, SM5, SM6, L5, reconciliation 14.
- Acceptance: those tests, on B04's fake.
- Blocked by: B80.
- Lines: about 750.
- Touches: `crates/engine/src/start/{input.rs, survey.rs, cache.rs, types.rs, sources/*}`, `web/src/contract/*`.

### B82. Start: recorded surveys
Recorded surveys in `examples/start/`: one per source, an empty repository, a 40,000-issue repository and one already listed.
- Section: `start`.
- Rules: start-a-map's fixtures section.
- Acceptance: each loads in the recorded adapter and makes at most nine requests.
- Blocked by: B56, B80.
- Lines: about 600.
- Touches: `examples/start/*`, `crates/xtask/src/start_fixture.rs`.

## Batch 15: the sources (`v1.1.0`)

### B83. Start: parents and labels, and the proposal
`propose`: the fixed order, qualifying, sorting, the 12-section limit and titles, with the parents and labels sources.
- Section: `start`.
- Rules: SM7, SM8, SM11, SM2 (`propose`).
- Acceptance: those tests on B82's fixtures.
- Blocked by: B81, B82.
- Lines: about 600.
- Touches: `crates/engine/src/start/{propose.rs, sources/parents.rs, sources/labels.rs}`.

### B84. Start: prefixes, folders, the fallback, ids and bug labels
- Section: `start`.
- Rules: SM9, SM10, SM12, SM13.
- Acceptance: those tests on B82's fixtures.
- Blocked by: B81, B82.
- Lines: about 750.
- Touches: `crates/engine/src/start/{sources/prefixes.rs, sources/folders.rs, sources/one.rs, ids.rs, bug_labels.rs}`.

## Batch 16: writing (`v1.1.0`)

### B85. Start: writing, settings and the command line
`write`, the existing-map checks, the settings append, exit codes, and `work-map start` with its flags in `start.rs`. B122 joins it to L2's entries and R7's refusals.
- Section: `start`.
- Rules: SM2 (`write`), SM14, SM15, SM18 to SM23, (Q9), reconciliation 14.
- Acceptance: those tests; SM21's fake fails on any write method across every fixture.
- Blocked by: B83, B84.
- Lines: about 750.
- Touches: `crates/engine/src/start/{write.rs, settings_append.rs, existing.rs}`, `crates/app/src/start.rs`.

## Batch 17: the sheet and the `start` entry (`v1.1.0`)

### B86. Start: the window sheet and the served panel
- Section: `start`.
- Rules: SM16, SM17, reconciliation 14.
- Acceptance: SM16's and SM17's tests over a fake transport.
- Blocked by: B85.
- Lines: about 450.
- Touches: `web/src/start/*`.

### B122. `start` joins the entries
`start` becomes one of L2's entries, and `work-map.exe` refuses it on Windows (R7, reconciliation 14).
- Section: `service`.
- Rules: L2, R7, reconciliation 14.
- Acceptance: `work-map start --help` exits 0; `work-map.exe start x/y` exits 2.
- Blocked by: B85.
- Lines: about 50.
- Touches: the entry list in `crates/app/src/main.rs`, R7's list in `crates/app/src/window.rs`.

## Batch 18: the guide, the tabs and the window commands (`v1.1.0`)

### B87. The guide and README for start
The guide's step 4 becomes `work-map start owner/name`.
- Section: `docs`.
- Rules: config-v2's guide note, start-a-map's note to #11.
- Acceptance: the command in step 4 runs as written against a recorded survey.
- Blocked by: B122.
- Lines: about 150.
- Touches: `docs/getting-started.md`, `README.md`.

### B123. Screen: the start entry in the tabs
The tabs open B86's sheet in the window and show the served-page hint (SM16, SM17).
- Section: `screen`.
- Rules: SM16, SM17 (the entry points).
- Acceptance: the tab strip's new control opens the sheet in the window build and shows the hint in the served build.
- Blocked by: B86.
- Lines: about 100.
- Touches: the tabs file under `web/src/`, its test.

### B124. Window: the start commands
The capability file and the window's commands gain `propose_map` and `start_map` (L13, reconciliation 14).
- Section: `service`.
- Rules: L13 (`propose_map`, `start_map`), reconciliation 14.
- Acceptance: L13's capability test with the two commands.
- Blocked by: B122.
- Lines: about 150.
- Touches: `crates/app/capabilities/`, the window's commands in `crates/app/src/window.rs`.

## Batch 19: deslop (`v1.1.0`)

### B88. Deslop pass on `v1.1.0`
- Section: `start`.
- Rules: BS10, over the code new since B81.
- Acceptance: as B76.
- Blocked by: B86, B87, B123, B124.
- Lines: about 200 changed.
- Touches: `crates/engine/src/start/`, `web/src/start/`.

## Batch 20: unslop (`v1.1.0`)

### B89. Unslop pass on `v1.1.0`
- Section: `start`.
- Rules: BS10, over the `start` section's words new since B81.
- Acceptance: as B76.
- Blocked by: B88.
- Lines: about 150 changed.
- Touches: the `start` section's paths in own-map.md.

### B121. Unslop pass on `v1.1.0`: `docs`
- Section: `docs`.
- Rules: BS10, over the docs new since B81.
- Acceptance: as B76.
- Blocked by: B88.
- Lines: about 50 changed.
- Touches: the `docs` section's paths in own-map.md.

## Batch 21: release (`v1.1.0`)

### B90. Release `v1.1.0`
The version PR and tag, and a live check against this repo, whose proposal is compared by hand with `.work-map/`.
- Section: `tooling`.
- Rules: R11, R14, start-a-map's fixtures note.
- Acceptance: release `v1.1.0` has R1's assets; the live check's result is on the ticket.
- Blocked by: B89, B121.
- Lines: about 20.
- Touches: `Cargo.toml`, `web/package.json`.
