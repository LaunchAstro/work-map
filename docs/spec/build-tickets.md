# Build tickets

The build plan for the work map in Rust, as batches in order. Each ticket fits one agent session and one small PR (BS5). A ticket starts when every ticket it is blocked by has merged, and the tickets in one batch share no file apart from the append-only lists in BS12. The rules each ticket names come from the specs listed in `docs/spec/build-spec.md`, and their tests are its acceptance list. Part of #16.

Each ticket becomes a GitHub issue labelled `build`, with its blocked-by edges as native dependencies. B81 to B90 are also labelled `v1.1.0`, after switch-over (start-a-map's notes). Tickets marked "maintainer task" are steps on the build machine or in the private archive, not code. "Lines" is a rough count of code plus tests; moved screen files are counted apart.

## Batches

| Batch | Tickets | Width | Lines with tests | Release |
| --- | --- | --- | --- | --- |
| 0 Foundation | B01 | 1 | 800 | v1.0.0 |
| 1 Types, ports and pure parts | B02 to B16 | 15 | 7,900 | v1.0.0 |
| 2 Readers, census, maths, server and screen | B17 to B42 | 26 | 17,300, plus 2,000 moved | v1.0.0 |
| 3 Loader, placement, sync, shell and screen | B43 to B56 | 14 | 8,850, plus 1,600 moved | v1.0.0 |
| 4 Checks, place, measure, release job | B57 to B63 | 7 | 4,500 | v1.0.0 |
| 5 The view | B64, B65 | 2 | 1,400 | v1.0.0 |
| 6 The engine service | B66, B67 | 2 | 1,150 | v1.0.0 |
| 7 Timers, release check, dump, fixtures | B68 to B71 | 4 | 2,200 | v1.0.0 |
| 8 Parity test, guide, candidate | B72 to B75 | 4 | 1,050 | v1.0.0 |
| 9 Deslop, demo repo | B76, B77 | 2 | 800 | v1.0.0 |
| 10 Unslop | B78 | 1 | 300 | v1.0.0 |
| 11 Parity streak | B79 | 1 | 0 | v1.0.0 |
| 12 Switch-over | B80 | 1 | 20 | v1.0.0 |
| 13 Survey | B81, B82 | 2 | 1,350 | v1.1.0 |
| 14 Sources | B83, B84 | 2 | 1,350 | v1.1.0 |
| 15 Writing | B85 | 1 | 800 | v1.1.0 |
| 16 Sheet and guide | B86, B87 | 2 | 800 | v1.1.0 |
| 17 Deslop | B88 | 1 | 200 | v1.1.0 |
| 18 Unslop | B89 | 1 | 200 | v1.1.0 |
| 19 Release | B90 | 1 | 20 | v1.1.0 |

90 tickets: 80 for release one, about 46,300 lines with tests, and 10 for `v1.1.0`, about 4,700. The longest chain runs through placement: B01, B07, B17, B44, B59, B64, B66, B68, B75, B76, B78, B79, B80. The wide batches 1 to 3 hold most of the work.

## Batch 0: foundation

### B01. Workspace scaffold and the check runner
The Cargo workspace with `crates/engine`, `server`, `app`, `parity` and `xtask`, one version `1.0.0-rc.0` (R13, R14), a pinned stable toolchain, the MIT `LICENSE` and a README stub that says the app is offered as is (#3, decision 4). The engine gets every module of the crate map as a folder with a `mod.rs` that names its spec, and a filled `model`: project ids (CF8), repository names compared ignoring case (MC-01), issue and PR keys (`owner/repo#n`), section ids (RF7), UTC instants and a `Clock` trait with a fake clock. The app gets the `work-map` binary reading L2's entries, each in its own stub file (`window.rs`, `serve.rs`, `kick.rs`, `dump.rs`, `boot.rs`) for later tickets, and a `window` feature that stays empty until B55. `xtask` gets `check` (the build spec's step list, with `--ci` and `--docs`) and `lines`.
- Rules: L1, L2 (usage and exit 2), R13, BS1, BS2, BS3, CF8, RF7, MC-01.
- Acceptance: L1's and BS1's `cargo tree` tests; `work-map frob` exits 2; BS2's and BS3's fixture tests; R13's test before `web/` exists; good and bad cases for each id in `model`.
- Blocked by: none.
- Lines: about 800.
- Touches: `Cargo.toml`, `.cargo/config.toml`, `rust-toolchain.toml`, `crates/*`, `LICENSE`, `README.md`.

## Batch 1: types, ports and pure parts

### B02. Hosted test workflow on three OSes
`.github/workflows/build.yml` with R9's `test` job on `ubuntu-22.04`, `windows-latest` and `macos-latest`, which installs WebKitGTK 4.1 on Linux, Node 24 and pnpm, then runs `cargo xtask check --ci`. Also the `report` job, a `workflow_dispatch` with a `fail` input, cancel-in-progress for pull requests, and pinned actions. No bundle job yet (B61). Confirm the repository has no required status checks.
- Rules: R9 (test job), R10, R12, BS9, reconciliation 15.
- Acceptance: R9's, R10's and R12's checks; a repo test in `xtask` parses the workflow.
- Blocked by: B01.
- Lines: about 350.
- Touches: `.github/workflows/build.yml`, `crates/xtask/tests/workflow.rs`.

### B03. Engine core types
The shared types later tickets fill, with no logic beyond constructors: the census records (issues, PRs, reviews, comments, closing references, timeline events, merge queue, file lists, spec documents and members, read marks per repository and kind, one PR record per AR-01); `Placed` and `Placement`; the checked `Project` with every config v2 field; the roadmap file types; `FrozenInputs` and the `scores` trait (the build spec's seam); the problem line type in CF6's and RF5's forms; and the shared roadmap reading helpers for encoding, size and unknown keys.
- Rules: AR-01, CF6 and RF5 (line forms), RF1, RF6, the scores seam.
- Acceptance: RF1's and RF6's tests on the helpers; problem lines print as CF6's and RF5's examples; stored records round-trip through serde.
- Blocked by: B01.
- Lines: about 750.
- Touches: `crates/engine/src/{census/records.rs, placement/placed.rs, config/project.rs, config/roadmap/types.rs, config/roadmap/common.rs, config/frozen_types.rs, scores/mod.rs, model/problem.rs}`.

### B04. GitHub port, recorded adapter and fake GitHub
The async `GitHub` port for GraphQL and REST, with typed requests, answers and errors (primary and secondary limits, 401, network, 5xx, GraphQL partial errors). The recorded adapter replays answers keyed by request, with times written as offsets from one reference instant. A port-level fake with a fake clock counts requests and points and returns each header and error the budget spec lists, for every engine test.
- Rules: MC-06 (error kinds), CF23 (offset form), the budget spec's facts.
- Acceptance: a two-page answer replays and an unknown request is refused; offsets move with the reference instant; the fake reports cost and remainder per call and raises each error on cue.
- Blocked by: B01.
- Lines: about 750.
- Touches: `crates/engine/src/github/{port.rs, recorded.rs, fake.rs}`.

### B05. Seat Gauge file reader against the examples
`SessionSource` with a file adapter on the per-OS folder and `SEAT_GAUGE_DIR`, and an example-file adapter. Reading, the safety checks and parsing of version 1, and every row of the reader table: missing, damaged, newer, stale, and problems per machine. A torn file keeps the last good read. Placing sessions on cards is B36.
- Rules: the shared file spec, MC-56, MC-57, MC-61, KD-13, KD-33, TN-66.
- Acceptance: each file in `docs/seat-gauge-file/examples/` at `2026-10-21T03:00:30Z` gives the result its table names; a removed file gives no agents and a quiet note; a symlink, fifo, folder, over-size file and a file that changes during the read are refused.
- Blocked by: B01.
- Lines: about 650.
- Touches: `crates/engine/src/seat_gauge/{source.rs, file.rs, parse.rs}`.

### B06. Data folder, atomic saves and the instance lock
The per-OS data, cache and log folders from `dirs` and the identifier (the `.dev` one in debug builds), `WORK_MAP_DIR`, modes 700 and 600, atomic replace, per-project `state.json` with a schema version, unreadable files set aside, the run log rotated at 5 MB with three kept, and the exclusive lock on `instance.lock`. The instance file and control port are B54; the check against Tauri's own paths is B55.
- Rules: L15 (lock), L20, MC-20, MC-21, KD-03.
- Acceptance: L15's two-copies test at the lock; L20's `WORK_MAP_DIR` test; MC-21's planted corrupt file; the folder table per OS with a faked environment.
- Blocked by: B01.
- Lines: about 550.
- Touches: `crates/engine/src/store/*`.

### B07. One reference grammar
One Markdown-aware extractor for `#n`, `repo#n`, `owner/repo#n` and issue addresses, shared by placement, closing, blockers and absorption, plus closing keywords and lists. Pure functions over text.
- Rules: MC-22, MC-23, KD-09, TN-38.
- Acceptance: the archive's counted and never-counted lists as cases; serial commas, separate list items, code, raw HTML, link text, images and unused definitions; exact roadmap references and lookalikes.
- Blocked by: B01.
- Lines: about 750.
- Touches: `crates/engine/src/placement/{refs.rs, closing.rs}`.

### B08. Section-map globs
Glob compiling and matching, the most-literal-characters rule, ties to the first, shared globs before section globs, and the size limits.
- Rules: RF20, MC-53.
- Acceptance: RF20's test; the archive's section-map cases.
- Blocked by: B01.
- Lines: about 350.
- Touches: `crates/engine/src/map_gaps/globs.rs`.

### B09. The view contract and generated TypeScript
`engine::contract`: `Hello` with `newer_release` and `config_problems`, `GitHubState`, `Budget`, `MapView` with `Part<T>` and `problems`, `Change`, `SyncOutcome` and `ContractError`; the inner shapes from the screen spec's sketch, wires included; the `Contract` trait for the five calls and `Control` for kicks; a recorded implementation that serves fixture views, for adapter tests; the `ts-rs` export to `web/src/contract/`.
- Rules: L4 (interface), L5, L6 (types), L7 (outcome), R16 and CF5 (fields), reconciliations 1, 9, 11 and 12.
- Acceptance: L5's drift test; the recorded engine answers each call; each type's JSON field names match the sketches.
- Blocked by: B01.
- Lines: about 700.
- Touches: `crates/engine/src/contract/*`, `web/src/contract/*`.

### B10. The request guard
A pure check over a served request's method, path, headers and body length, and the headers every answer carries.
- Rules: L11 [Q8], MC-70 (guard and paths), S4 (the CSP value), TN-22, TN-23, reconciliation 3.
- Acceptance: L11's test; `..` segments, symlinks out and malformed escapes give 404; every answer kind carries the CSP, `nosniff` and `no-referrer`, and `/api` answers `no-store`.
- Blocked by: B01.
- Lines: about 500.
- Touches: `crates/server/src/guard.rs`.

### B11. The screen's package and build shell
`web/` with a private MIT `package.json`, pnpm and Node 24 pinned, the lockfile and the install hardening; Vite, TypeScript, Vitest, oxlint and Prettier; `typecheck`, `lint`, `test`, `test:browser` and `build` scripts; `index.html` with no inline script, `public/first-paint.js`, `tokens.css`, `fonts.css`, the three font packages and their licences; Vite's dev server on 4318 proxying `/api` to 4319; the version baked in; a placeholder `src/main.tsx`; and the MIT header test.
- Rules: S1 (test), S2, S3 (build check), S4 (no inline script), S17, S18 (Vite side), S19, R13 (web version).
- Acceptance: S1's, S2's, S3's build check and S19's tests; R13's test now reads `web/package.json`.
- Blocked by: B01.
- Lines: about 450.
- Touches: `web/{package.json, pnpm-lock.yaml, vite.config.ts, tsconfig.json, index.html, public/*, src/main.tsx, src/styles/*, test/repo.test.ts}`.

### B12. Settings file
Reading `settings.json`, its one write, its problem lines and its limits. Tabs and re-reads come later (B66, B68).
- Rules: CF1, CF2.
- Acceptance: CF1's and CF2's tests.
- Blocked by: B01.
- Lines: about 450.
- Touches: `crates/engine/src/config/settings.rs`.

### B13. Site fetch port and build stamps
The `Fetch` port, with a live adapter (HTTPS only, no redirects, 5-second limit, size limits) and a recorded one, then the build file and the home page's meta stamp, which must agree on one clean 12-character revision.
- Rules: MC-55 (fetch side), CF15 (the fields read), TN-24.
- Acceptance: the archive's version-fetch cases; a redirect and an over-size answer refused; a stamp inside a comment ignored.
- Blocked by: B01.
- Lines: about 500.
- Touches: `crates/engine/src/versions/{fetch.rs, stamp.rs}`.

### B14. Parity record and known-differences list
The `parity` library's record types, its difference type and schema test, and `parity/known-differences.toml` with one entry per KD row, checked against the must-carry-over table.
- Rules: P11, P18.
- Acceptance: P11's schema test on a sample record; P18's check.
- Blocked by: B01.
- Lines: about 500.
- Touches: `crates/parity/src/{record.rs, kd.rs}`, `parity/known-differences.toml`.

### B15. Parity capture of the old answers
`parity capture`: a GET-only loopback client that copies each map's answers and a manifest into `capture/<run id>/old/<map id>/`, Seat Gauge copies every 5 seconds with the pick rule, and the window checks it can make from read-only files. Ports and job names come from a local file outside the repo that the runbook (B16) describes.
- Rules: P1, P2, P3, P4, P6, P7, P22.
- Acceptance: each rule's check against a fake old server serving fixture files on loopback.
- Blocked by: B01.
- Lines: about 650.
- Touches: `crates/parity/src/capture/*`.

### B16. The private runbook (maintainer task)
An issue on the private archive naming the old engine's jobs, the live maps' loopback ports, how to pause, resume and full-read each, and the local file `parity capture` reads. The public issue for this ticket says only "see the private companion issue".
- Rules: P1, P7, parity's steps on the build machine, reconciliation 8.
- Acceptance: the private issue exists, and one pause and resume has been tried by its steps.
- Blocked by: none.
- Lines: none in this repo.
- Touches: the private archive's issues only.

## Batch 2: readers, census, maths, server and screen

### B17. Declarations in PR and issue text
`Ticket:`, `Unit:` and `Section:` lines; plan ids in titles and branches; "complete", "done" or "finished" after an id; the closing comment's opener for absorption; and the "Blocked by" section. Pure, over B07's extractor.
- Rules: MC-24 (text), MC-25, MC-31 (opener), MC-63 (the section's text).
- Acceptance: the archive's PR-mapping, Section-line and blocker-list cases.
- Blocked by: B07.
- Lines: about 600.
- Touches: `crates/engine/src/placement/{declare.rs, blocked_by.rs}`.

### B18. Diagram reader
`files.flow` into the diagram type: nodes, notes, units, wires and their ends, with the whole-file and entry faults.
- Rules: RF5, RF7 to RF12, MC-03.
- Acceptance: the RF tests, over `docs/spec/example/roadmap/` and `docs/spec/example/scope/`.
- Blocked by: B03.
- Lines: about 650.
- Touches: `crates/engine/src/config/roadmap/diagram.rs`.

### B19. Audit and plan readers
The unit audit, its four date forms in the config's zone, and the plan's unit table.
- Rules: RF13, RF14, RF16, RF17, RF18, MC-02 (plan), MC-04, KD-26, CF16, TN-72 (impossible dates).
- Acceptance: those tests, over `docs/spec/example/scope/`.
- Blocked by: B03.
- Lines: about 750.
- Touches: `crates/engine/src/config/roadmap/{audit.rs, plan.rs, dates.rs}`.

### B20. Section map and mappings readers
The section map with its `maps` entries, and approved PR mappings.
- Rules: RF21, RF22, RF23, RF25, RF26 (entry shape), RF27.
- Acceptance: those tests, over `docs/spec/example/`.
- Blocked by: B03, B08.
- Lines: about 550.
- Touches: `crates/engine/src/config/roadmap/{section_map.rs, mapping.rs}`.

### B21. Frozen inputs reader and the frozen scores adapter
The four frozen files in the archive's shapes, read once and never written, with the standing-score rule, and the `scores` adapter over them.
- Rules: CF17, MC-05, roadmap-files' frozen shapes, (Q1), reconciliation 16.
- Acceptance: CF17's test; MC-05's store cases; each shape pinned by a copied archive case described by what it checks.
- Blocked by: B03.
- Lines: about 650.
- Touches: `crates/engine/src/config/frozen.rs`, `crates/engine/src/scores/frozen.rs`.

### B22. `gh` token and the live GitHub adapter
Finding and running `gh`, the token held in memory, the GitHub states and their lines, and the live HTTPS adapter to `api.github.com` that reads every rate-limit header. Includes an HTTP-level fake GitHub for these tests.
- Rules: L21, L22, L23, R5, R8, B1.
- Acceptance: those tests.
- Blocked by: B04.
- Lines: about 750.
- Touches: `crates/engine/src/github/{live.rs, gh.rs, state.rs}`.

### B23. Budget gate and the run log
The gate around any `GitHub`: one request in flight, costs logged, the light floor, the reserve and GitHub's stop signals, all scaled to the reported limit.
- Rules: B2, B3, B10, B11, B12, MC-07, MC-08, TN-14.
- Acceptance: those tests, on B04's fake.
- Blocked by: B04.
- Lines: about 700.
- Touches: `crates/engine/src/github/{gate.rs, runlog.rs}`.

### B24. Conditional REST cache
The cache under `http/` with ETag and last-modified per exact request, and the fixed-once file list of a merged PR.
- Rules: B9.
- Acceptance: B9's test at the port.
- Blocked by: B04.
- Lines: about 400.
- Touches: `crates/engine/src/github/cache.rs`.

### B25. Merge panel read and refresh scopes
`ReadScope` and `Census::refresh` with the Timer scope filled in: the one GraphQL merge panel query with its watermark and overlap, and the queue on the default branch. Stub files for the Sync and Full scopes, owned by B46 and B47.
- Rules: B5, B6 (the first-poll card read hook), MC-09, KD-22, TN-15.
- Acceptance: B5's test; MC-09's cases.
- Blocked by: B03, B04.
- Lines: about 600.
- Touches: `crates/engine/src/census/{refresh.rs, merge_panel.rs, sync.rs, full.rs}`.

### B26. Issue census
Issues per repository with closure reasons, close times, parents, blockers, labels and the comments absorption needs, from the same pages.
- Rules: MC-13, MC-15 (issues), KD-08, TN-37.
- Acceptance: MC-13's and MC-15's cases.
- Blocked by: B03, B04.
- Lines: about 750.
- Touches: `crates/engine/src/census/issues.rs`.

### B27. PR census and loading-bay events
Open, merged and closed PRs with heads, sizes, reviews, comments, closing references and timeline events, with the head repository GitHub reports.
- Rules: MC-15 (PRs), MC-19, TN-25.
- Acceptance: MC-15's and MC-19's cases.
- Blocked by: B03, B04.
- Lines: about 800.
- Touches: `crates/engine/src/census/{prs.rs, events.rs}`.

### B28. PR files, spec documents and spec members
The PR file inventory and the spec document and member reads.
- Rules: MC-17, MC-18, TN-26.
- Acceptance: MC-17's and MC-18's cases.
- Blocked by: B03, B04.
- Lines: about 650.
- Touches: `crates/engine/src/census/{files.rs, specs.rs}`.

### B29. Site versions: ancestry and merge distance
`versions::observe`: the revision as an ancestor of main, distinct merged PRs between them, and last known values with their reasons.
- Rules: MC-55, KD-14, KD-20, TN-43, TN-50.
- Acceptance: the archive's version and publication cases.
- Blocked by: B04, B13.
- Lines: about 600.
- Touches: `crates/engine/src/versions/{distance.rs, observe.rs}`.

### B30. Merges: the clock-hour chart, rolling figures and the loading bay
The twelve local-hour bars, the average and last hour, the queue figures kept on a partial read, and loading-bay status.
- Rules: MC-49, MC-50, MC-51, MC-52, KD-01, KD-02, KD-17, KD-39, TN-46, TN-47, TN-65.
- Acceptance: those cases, including TN-65's example and a read on the hour.
- Blocked by: B03.
- Lines: about 750.
- Touches: `crates/engine/src/merges/*`.

### B31. Ticket status, work, bugs and questions
Status from state and closure reason, work, bug and question cards, and when a count is current. Takes absorption parents as an input (B45 works them out).
- Rules: MC-30, MC-32, MC-38, TN-03, TN-13.
- Acceptance: those cases.
- Blocked by: B03.
- Lines: about 650.
- Touches: `crates/engine/src/progress/tickets.rs`.

### B32. Unit weights, section shares, days left and momentum
Unit days over counted cards, section shares on maps without units, days left and momentum, reading scores through the `scores` trait.
- Rules: MC-33, MC-34, MC-35, MC-36, KD-12, KD-16, TN-05, TN-06, TN-41, TN-45, (Q1), reconciliation 16.
- Acceptance: those cases, with a test double for `scores`.
- Blocked by: B03.
- Lines: about 700.
- Touches: `crates/engine/src/progress/{weights.rs, days.rs, momentum.rs}`.

### B33. Scope shares, build state and card tone
Three shares that add to 100, their inputs, the section build state and the card tone.
- Rules: MC-39, MC-40, MC-42, MC-43, KD-28, KD-31, TN-01, TN-02, TN-55, TN-69.
- Acceptance: those cases, and TN-01's 200,000 random sections as a property test.
- Blocked by: B03.
- Lines: about 700.
- Touches: `crates/engine/src/progress/{scope.rs, tone.rs}`.

### B34. Review bar and receipts
The Review bar by changed lines, de-duplicated by key, and the receipt and approval rules.
- Rules: MC-44, MC-45, KD-18, KD-27, TN-08, TN-48, TN-70.
- Acceptance: those cases.
- Blocked by: B03, B07.
- Lines: about 750.
- Touches: `crates/engine/src/progress/{review.rs, receipts.rs}`.

### B35. Spec closure and the planning checklist
- Rules: MC-46, MC-47, KD-11, TN-09, TN-11, TN-40.
- Acceptance: those cases.
- Blocked by: B03.
- Lines: about 650.
- Touches: `crates/engine/src/progress/{specs.rs, checklist.rs}`.

### B36. Seat Gauge placement and agents on cards
`seat_gauge::read`: where each session goes, pills on cards, the kept report on a failed read, the anonymous count, and the next deadline. Tests build `Placement` by hand.
- Rules: MC-58, MC-59, MC-60, MC-61, TN-19, TN-20, TN-21, AR-05, AR-12.
- Acceptance: those cases, over B05's example adapter.
- Blocked by: B03, B05.
- Lines: about 650.
- Touches: `crates/engine/src/seat_gauge/{place.rs, agents.rs}`.

### B37. Server routes, static files and the change stream
The route table over `dyn Contract`, ETags and 304s, Sync held open, the event stream with a comment every 25 seconds, static files through the `Assets` trait, and the loopback bind. Tests use B09's recorded engine and a fake `Assets`.
- Rules: L3 (server side), L10 (bind), L12, MC-70 (routes), the served-mode table.
- Acceptance: L3's same-bytes test, L10's other-addresses refusal and L12's test; each route over the recorded engine; an unknown path gives 404.
- Blocked by: B09, B10.
- Lines: about 700.
- Touches: `crates/server/src/{lib.rs, routes.rs, sse.rs, assets.rs}`.

### B38. Screen transport client
The one client module, with the Tauri and HTTP adapters.
- Rules: S5, L4, L9, L11 (headers sent), L12 (resubscribe).
- Acceptance: L4's shared suite against both adapters; L9's and L12's tests; S5's lint rule.
- Blocked by: B09, B11.
- Lines: about 550.
- Touches: `web/src/transport/*`, `web/test/transport/*`.

### B39. Screen move: the shell, board, cards and camera
Move the archive's app shell, board, cards, bars, wires, camera, call-outs, interactions, saved view, theme and section brief with their CSS. Add MIT headers, cut the retired code these files hold and TN-83's dead CSS, delete the validators, and read generated types. Tests build views with typed builders until B71's fixtures arrive. Leave stub components for the header, overview strip, merge panel, loading bay, agents and versions, which B49 and B50 replace.
- Rules: S1, S7 (these parts), S8, S9, S10, S12, S13, S15, F2, F3, F6, MC-72, MC-74, MC-75, MC-77, MC-78, MC-79, MC-80, MC-81, KD-21, TN-28 to TN-34, TN-52, TN-53, TN-56, TN-81.
- Acceptance: those tests; S4's storage-key test; S7's import and shown-shares tests; S8's all-`null` render.
- Blocked by: B09, B11.
- Lines: about 800 changed, about 2,000 moved.
- Touches: the moved files under `web/src/`, `web/test/unit/*`.

### B40. Parity compare rules
Pairing cards, the compared and ignored fields, the tolerances, order, and drift as "moved".
- Rules: P12 to P17.
- Acceptance: those checks.
- Blocked by: B14.
- Lines: about 650.
- Touches: `crates/parity/src/compare.rs`.

### B41. Parity explanations and report
The mechanical KD tests, `explanations.toml`, stale explanations, and the text and JSON report with its exit codes.
- Rules: P19, P20, P21, KD-02, KD-30, KD-39.
- Acceptance: those checks.
- Blocked by: B14.
- Lines: about 550.
- Touches: `crates/parity/src/{explain.rs, report.rs}`.

### B42. Parity old-capture adapter
The capture turned into a record, repeating the old screen's own rules where it worked figures out.
- Rules: P8, TN-29, AR-07.
- Acceptance: P8's check, each repeated rule tested on the old screen's cases described by what they check.
- Blocked by: B14, B15.
- Lines: about 750.
- Touches: `crates/parity/src/old/*`.

## Batch 3: loader, placement, sync, shell and screen

### B43. Config v2 loader
`config::load`: the strict v2 schema, ids, repositories, roadmap file sources (local, GitHub through the cache, or a settings entry's folder), paths, basis, sites and zone, assembled into `Project` from the readers. It calls stub `checks.rs` and `v1.rs` files that B57 and B58 fill, so neither edits `load.rs`.
- Rules: CF6, CF7, CF8, CF9, CF11, CF12, CF13, CF15, CF16, RF2, RF3, RF4.
- Acceptance: those tests.
- Blocked by: B12, B18, B19, B20, B21, B24.
- Lines: about 800.
- Touches: `crates/engine/src/config/{load.rs, sources.rs, checks.rs, v1.rs}`.

### B44. PR placement ladder
The eight-step order for PRs against a ticket-section lookup, inferred marks, docs-only warnings and notes on disagreeing references.
- Rules: MC-26, MC-24 (wiring), MC-29, KD-23, KD-30, KD-36, TN-12, (Q2).
- Acceptance: those cases.
- Blocked by: B17.
- Lines: about 800.
- Touches: `crates/engine/src/placement/pr.rs`.

### B45. Absorption
Parents from duplicate links and closing comments, loops, parents outside the census and chains not read in full, as the parent map B31 takes.
- Rules: MC-31, TN-04.
- Acceptance: the archive's absorbed-progress cases.
- Blocked by: B17.
- Lines: about 500.
- Touches: `crates/engine/src/progress/absorb.rs`.

### B46. Change probe and backstops
The Sync scope: the probe per 15 repositories, re-reads of what it names, the merge-lag read, and the daily and weekly backstops.
- Rules: B7, B8, MC-10, MC-11, MC-12, KD-07, KD-32, TN-16, TN-36.
- Acceptance: those tests, and MC-11's property that an incremental read equals a full one.
- Blocked by: B25, B26, B27.
- Lines: about 700.
- Touches: `crates/engine/src/census/sync.rs`.

### B47. Resumable full read and kept values
The Full scope with progress saved per repository and kind, and the last good values kept with their times on any failure.
- Rules: MC-14, MC-16, MC-06 (whole reads), KD-06, KD-35, TN-13, TN-35, TN-62.
- Acceptance: those cases, including 7,600 merged PRs read over several Syncs.
- Blocked by: B25, B26, B27, B28.
- Lines: about 700.
- Touches: `crates/engine/src/census/{full.rs, keep.rs}`.

### B48. Gap census
- Rules: MC-54, RF24, KD-29, TN-26, TN-60.
- Acceptance: those cases, and RF20's fixture PR 65 as one gap.
- Blocked by: B08, B20, B28.
- Lines: about 550.
- Touches: `crates/engine/src/map_gaps/census.rs`.

### B49. Screen: header, tabs, Sync and footer
Move the header, overview strip, ticket inventory, tabs and Sync button, draw the GitHub and budget lines, the config and roadmap problem lines, and the newer-release link.
- Rules: S11, S20, B13 (lines), L23 (lines), MC-76, KD-21, reconciliations 5 and 12.
- Acceptance: S11's and S20's tests; B13's render test; each problem line on its own tab only.
- Blocked by: B39.
- Lines: about 700 changed, about 900 moved.
- Touches: the header, overview, inventory, tabs and Sync files under `web/src/`, their tests.

### B50. Screen: merge panel, loading bay, agents, versions and gaps
- Rules: S7 (these parts), MC-49 (drawing only), MC-52 (drawing), MC-59 (pills), MC-76 (the Seat Gauge button).
- Acceptance: the archive's loading-bay, Seat Gauge pill and site-version drawing cases, rewritten on typed builders.
- Blocked by: B39.
- Lines: about 600 changed, about 700 moved.
- Touches: those component files under `web/src/`, their tests.

### B51. Screen: `useMap` and map switching
- Rules: S6, MC-71, TN-28, TN-57, TN-82.
- Acceptance: S6's test.
- Blocked by: B38, B39.
- Lines: about 400.
- Touches: `web/src/useMap.ts`, the shell's data source, `web/test/unit/useMap.test.ts`.

### B52. Parity streak
`parity streak` over the kept reports.
- Rules: P23, P24.
- Acceptance: P23's check.
- Blocked by: B41.
- Lines: about 400.
- Touches: `crates/parity/src/streak.rs`.

### B53. Headless serve and the embedded files
`work-map serve` over `dyn Contract`, the `rust-embed` assets for the build with no window, the serving line, `--port`, `--open` and exit 4, and the no-window message. B66 swaps in the real engine.
- Rules: L2 (serve with no display), L3, L10, R3, reconciliation 2.
- Acceptance: L2's, L3's, L10's and R3's tests.
- Blocked by: B37.
- Lines: about 500.
- Touches: `crates/app/src/{serve.rs, assets.rs}`.

### B54. Control port, instance file and `kick`
- Rules: L15 (instance file), L16, L17, L18 (the command side), B14 (nothing queues).
- Acceptance: those tests.
- Blocked by: B06, B09.
- Lines: about 650.
- Touches: `crates/app/src/{control.rs, kick.rs}`.

### B55. Window shell
Tauri 2 behind the `window` feature: `tauri.conf.json`, the capability file, the five commands and the channel over `dyn Contract`, Dock and close behaviour, the navigation and new-window handlers, the Windows refusal of terminal commands, `Context::assets()` for the window build, and the build's stop line when `web/dist` is missing.
- Rules: L3, L13, L14, L20 (Tauri's paths), R7, S14, S18, reconciliations 3 and 4.
- Acceptance: those tests, S14's with a fake opener.
- Blocked by: B09, B11.
- Lines: about 750.
- Touches: `crates/app/{tauri.conf.json, capabilities/, build.rs, icons/, src/window.rs}`.

### B56. Example fixture description and generator
`examples/demo/` as fixture.md lays out: the config and roadmap files, a compact description of every issue, PR, agent and site row in `fixture.toml`, and `cargo xtask demo-fixture`, which writes recorded answers to the census's own queries, the site recording and the Seat Gauge file, with times as offsets.
- Rules: CF23 (offsets), CF24 (size), fixture.md's tables.
- Acceptance: two runs give the same bytes; the recorded adapter answers every request a full read of the demo makes; the embedded copy is under 300 KB.
- Blocked by: B04, B25, B26, B27, B28.
- Lines: about 800.
- Touches: `examples/demo/*`, `crates/xtask/src/demo_fixture.rs`.

## Batch 4: checks, place, measure and the release job

### B57. Config cross-checks
Destinations against the diagram, patterns under Rust's `regex`, scope maps' audit against the diagram, and plan and audit disagreements.
- Rules: CF10, CF14, RF15, RF19, MC-01.
- Acceptance: those tests.
- Blocked by: B43.
- Lines: about 600.
- Touches: `crates/engine/src/config/checks.rs`.

### B58. Version 1 config reader
- Rules: CF18, CF19.
- Acceptance: CF18's paired cases and CF19's test.
- Blocked by: B43.
- Lines: about 500.
- Touches: `crates/engine/src/config/v1.rs`.

### B59. Issue placement, the closing-PR pass and `place`
The issue order of trust, the closing-PR second pass with label and prefix rules, and `place()` running both ladders once, frozen model placements included.
- Rules: MC-27, MC-28, MC-26 (step 6), AR-04.
- Acceptance: those cases.
- Blocked by: B44.
- Lines: about 800.
- Touches: `crates/engine/src/placement/{issue.rs, second_pass.rs, place.rs}`.

### B60. Rollups, header census and `measure`
Stage and header rollups, the header ticket census, and `measure()` composing B31 to B35 and B45.
- Rules: MC-37, MC-48, KD-15, TN-10, TN-44, AR-06.
- Acceptance: those cases.
- Blocked by: B31, B32, B33, B34, B35, B45.
- Lines: about 700.
- Touches: `crates/engine/src/progress/{rollups.rs, header.rs, measure.rs}`.

### B61. Release bundles, publishing and the README
The `bundle`, `draft` and `publish` jobs in `build.yml`, the three platform Tauri files, renaming, `SHA256SUMS`, the Windows companion staging, and the README's install text and as-is line.
- Rules: R1, R2, R4, R6, R11, R14 (the draft job's check), R17, #3 decision 4.
- Acceptance: those checks, with a test tag `v0.0.1-rc.1`.
- Blocked by: B02, B53, B55.
- Lines: about 700.
- Touches: `.github/workflows/build.yml`, `crates/app/tauri.{macos,windows,linux}.conf.json`, `README.md`.

### B62. Browser suite
Playwright's Chromium and WebKit against the built screen, served by a small Node server from fixture files.
- Rules: S16 (the server), S3 (no off-origin request), S4 (no CSP violation), F1, F4, F5, F7, F8, MC-73, MC-74.
- Acceptance: those cases in both engines.
- Blocked by: B49, B50, B51.
- Lines: about 700.
- Touches: `web/test/browser/*`, `web/test/server.ts`.

### B63. The example in the binary
`engine::example`: the embedded files, recorded adapter and Seat Gauge file, shifted to now on load and on each Sync.
- Rules: CF21, CF22, CF23, CF24 (embedding).
- Acceptance: CF22's and CF23's tests at the module.
- Blocked by: B43, B56.
- Lines: about 500.
- Touches: `crates/engine/src/example/*`.

## Batch 5: the view

### B64. View: the board
Cards, stages, header, wires with configured dependencies and blocker arrows, Next up, PR lists and warnings, planning steps and unplaced PRs. `view/build.rs` starts here, with the other parts as never read until B67.
- Rules: RF12 (in the view), MC-62, MC-63, MC-65, KD-10, KD-34, TN-07, TN-39, TN-68, reconciliation 11.
- Acceptance: those cases.
- Blocked by: B59, B60.
- Lines: about 800.
- Touches: `crates/engine/src/view/{board.rs, next_up.rs, wires.rs, build.rs}`.

### B65. View: parts and freshness
The merges, agents, versions and gaps parts and their states, and the pending reason codes.
- Rules: MC-64, AR-12, AR-13, B13 (states).
- Acceptance: MC-64's cases for each part.
- Blocked by: B29, B30, B36, B48.
- Lines: about 600.
- Touches: `crates/engine/src/view/{parts.rs, freshness.rs}`.

## Batch 6: the engine service

### B66. Engine service
`Engine::open`, tabs, `hello`, view stamps, `subscribe`, Sync joining and its outcome, Retry, the last good config on a failed re-read, the example when nothing loads, saves through `store`, and viewer handles. It implements `Contract` and `Control`, and `boot.rs` builds it for every entry. It leaves stub `timers.rs` and `release_check.rs` files, with the viewer count and a `newer_release` slot in `hello` exposed to them, for B68 and B69.
- Rules: L6, L7, L23, CF3, CF5, CF21, CF22, MC-66, MC-67, KD-25.
- Acceptance: those tests.
- Blocked by: B06, B22, B23, B46, B47, B57, B58, B63, B64.
- Lines: about 800.
- Touches: `crates/engine/src/engine/{service.rs, sync.rs, tabs.rs, timers.rs, release_check.rs}`, `crates/app/src/boot.rs`.

### B67. View build: every part and the problem lines
Wire B65's parts into `view::build`, add each project's roadmap problem lines, and carry the Seat Gauge deadline.
- Rules: RF5 (on screen), L8 (the deadline in the view), reconciliation 12.
- Acceptance: a view of the example has every part `current`; a broken section map gives a `problems` line on its own project only.
- Blocked by: B64, B65.
- Lines: about 350.
- Touches: `crates/engine/src/view/build.rs`.

## Batch 7: timers, release check, dump and fixtures

### B68. Timers: viewers, the poll, kicks and the Seat Gauge deadline
- Rules: L8, L18 (engine side), L19, B4, B6, B14, CF4, MC-68, MC-69.
- Acceptance: those tests on a fake clock.
- Blocked by: B66, B67.
- Lines: about 700.
- Touches: `crates/engine/src/engine/{timers.rs, kick.rs, reread.rs}`.

### B69. Newer-release check
- Rules: R15, R16, `check_for_updates` (CF settings), reconciliation 1.
- Acceptance: R15's and R16's checks.
- Blocked by: B23, B24, B66.
- Lines: about 450.
- Touches: `crates/engine/src/engine/release_check.rs`.

### B70. `work-map dump`
`engine::dump` and the app's `dump` entry: one Sync per project, views at `--as-at` with agents at `--agents-at`, `--settings`, and a file of views with their read facts and input hashes, which `parity` maps to its record.
- Rules: P9 (as patched), P10, CF20, L2, reconciliations 7 and 9.
- Acceptance: P9's and CF20's tests; the mapped record passes P11's schema test.
- Blocked by: B14, B66, B67.
- Lines: about 550.
- Touches: `crates/engine/src/dump/*`, `crates/app/src/dump.rs`, `crates/parity/src/new.rs`.

### B71. Fixture export and the expected numbers
Export the example's views into `web/test/fixtures/`, move the screen tests onto them, and write `examples/demo/expected.json`, reviewed by hand against fixture.md's expected numbers.
- Rules: S16 (fixtures), CF24.
- Acceptance: S16's and CF24's regeneration checks; a test holds the example to `expected.json`.
- Blocked by: B63, B66, B67.
- Lines: about 500.
- Touches: `crates/xtask/src/export.rs`, `web/test/fixtures/*`, `examples/demo/expected.json`, the screen's test helpers.

## Batch 8: parity test, guide and the first candidate

### B72. Parity example project test
A fresh, MIT old capture of the demo in the archive's served shape, with one KD-30 difference, one explained difference and one moved issue, plus the planted-bug fixture.
- Rules: P25, P26.
- Acceptance: both checks, with no network, old engine or login.
- Blocked by: B40, B41, B42, B52, B70, B71.
- Lines: about 700.
- Touches: `crates/parity/tests/*`.

### B73. The getting-started guide
`docs/getting-started.md` from config-v2's outline, linked from the README.
- Rules: the guide outline, (Q5), [Q8] for step 7.
- Acceptance: every command in it runs as written against the example.
- Blocked by: B61, B66, B68.
- Lines: about 300.
- Touches: `docs/getting-started.md`, `README.md`.

### B74. Prepare the live maps for comparison (maintainer task)
Switch-over step 1 in the build spec, on the build machine.
- Rules: CF19, RF14, RF17, RF24, P18, reconciliations 10 and 13.
- Acceptance: both live maps load with no problem line; any new KD row is in `must-carry-over.md` and `known-differences.toml`.
- Blocked by: B16, B57, B58, B66, B70.
- Lines: none, or a few appended KD rows.
- Touches: the maintainer's live configs (outside the repo), and only appended rows here.

### B75. Release candidate one
A version PR to `1.0.0-rc.1`, its tag and prerelease, and the manual checks no runner can make: F3's pinch in the macOS window, S14's Copy in each OS window, R17's first-launch steps on each OS, and L14's Dock behaviour. Red hosted runs open at this point are fixed or ticketed first.
- Rules: R11, R14, F3, S14, R17, L14.
- Acceptance: R11's prerelease has R1's assets; the manual results are recorded on the ticket.
- Blocked by: B61, B62, B68, B69, B70, B71.
- Lines: about 50.
- Touches: `Cargo.toml`, `web/package.json`.

## Batch 9: deslop and the demo repo

### B76. Deslop pass on release one
BS10's deslop pass over everything new since B01.
- Rules: BS10.
- Acceptance: `cargo xtask check` green before and after; no capability or test removed; net lines reported.
- Blocked by: B72, B73, B75.
- Lines: a net cut, about 300 changed.
- Touches: any shipped source.

### B77. The public demo repo [Q7]
`cargo xtask demo-seed` creates the demo's issues, PRs and files from `examples/demo/fixture.toml`, so numbers match, with `files.source: "github"` and no sites. The maintainer creates the public repo and runs it, at no cost.
- Rules: config-v2's demo repo section, [Q7].
- Acceptance: the seeded repo's live map shows the example's ticket counts.
- Blocked by: B56, B75.
- Lines: about 500.
- Touches: `crates/xtask/src/demo_seed.rs`, `README.md` (one link).

## Batch 10: unslop

### B78. Unslop pass on release one
BS10's unslop pass over the docs, screen words, errors, comments and test names new since B01.
- Rules: BS10.
- Acceptance: as B76.
- Blocked by: B76, B77.
- Lines: about 300 changed.
- Touches: docs, screen words, messages.

## Batch 11: the parity streak

### B79. Parity runs to a streak (maintainer task)
Switch-over steps 2 to 4: a release candidate from the cleaned commit on the build machine, then windows by parity's steps until `parity streak` prints `ready`. Each failing run becomes a ticket.
- Rules: P1 to P23.
- Acceptance: `ready`, with the three runs' summary lines on the ticket (no private data).
- Blocked by: B16, B74, B78.
- Lines: none.
- Touches: the build machine only.

## Batch 12: switch-over

### B80. Switch-over and `v1.0.0`
Switch-over steps 5 to 7: the maintainer's call, the old jobs retired, port 4317 to `work-map serve`, the `1.0.0` version PR and tag, then the live configs moved to version 2.
- Rules: P24, R11, R14, CF18.
- Acceptance: release `v1.0.0` has R1's assets; both live maps are served by the Rust app.
- Blocked by: B79.
- Lines: about 20.
- Touches: `Cargo.toml`, `web/package.json`.

## Batch 13: the survey (`v1.1.0`)

### B81. Start: the survey, its cache and sign-in
Input forms, the nine-request survey through the gate, the 15-minute cache, sign-in states, the `Proposal`, `Choice` and `Written` types exported to TypeScript, and stub files for the five sources.
- Rules: SM1, SM3, SM4, SM5, SM6, L5, reconciliation 14.
- Acceptance: those tests, on B04's fake.
- Blocked by: B80.
- Lines: about 750.
- Touches: `crates/engine/src/start/{input.rs, survey.rs, cache.rs, types.rs, sources/*}`, `web/src/contract/*`.

### B82. Start: recorded surveys
Recorded surveys in `examples/start/`: one per source, an empty repository, a 40,000-issue repository and one already listed.
- Rules: start-a-map's fixtures section.
- Acceptance: each loads in the recorded adapter and makes at most nine requests.
- Blocked by: B56, B80.
- Lines: about 600.
- Touches: `examples/start/*`, `crates/xtask/src/start_fixture.rs`.

## Batch 14: the sources (`v1.1.0`)

### B83. Start: parents and labels, and the proposal
`propose`: the fixed order, qualifying, sorting, the 12-section limit and titles, with the parents and labels sources.
- Rules: SM7, SM8, SM11, SM2 (`propose`).
- Acceptance: those tests on B82's fixtures.
- Blocked by: B81, B82.
- Lines: about 600.
- Touches: `crates/engine/src/start/{propose.rs, sources/parents.rs, sources/labels.rs}`.

### B84. Start: prefixes, folders, the fallback, ids and bug labels
- Rules: SM9, SM10, SM12, SM13.
- Acceptance: those tests on B82's fixtures.
- Blocked by: B81, B82.
- Lines: about 750.
- Touches: `crates/engine/src/start/{sources/prefixes.rs, sources/folders.rs, sources/one.rs, ids.rs, bug_labels.rs}`.

## Batch 15: writing (`v1.1.0`)

### B85. Start: writing, settings and the command line
`write`, the existing-map checks, the settings append, exit codes, and `work-map start` with its flags, as L2's fifth entry. The Windows window binary refuses `start`.
- Rules: SM2 (`write`), SM14, SM15, SM18 to SM23, L2, R7, [Q9], reconciliation 14.
- Acceptance: those tests; SM21's fake fails on any write method across every fixture.
- Blocked by: B83, B84.
- Lines: about 800.
- Touches: `crates/engine/src/start/{write.rs, settings_append.rs, existing.rs}`, `crates/app/src/start.rs`, R7's list in `crates/app/src/window.rs`.

## Batch 16: the sheet and the guide (`v1.1.0`)

### B86. Start: the window sheet and the served panel
- Rules: SM16, SM17, L13 (`propose_map`, `start_map`), reconciliation 14.
- Acceptance: SM16's and SM17's tests; L13's capability test with the two commands.
- Blocked by: B85.
- Lines: about 650.
- Touches: `web/src/start/*`, the tabs file, `crates/app/capabilities/`, the window's commands.

### B87. The guide and README for start
The guide's step 4 becomes `work-map start owner/name`.
- Rules: config-v2's guide note, start-a-map's note to #11.
- Acceptance: the command in step 4 runs as written against a recorded survey.
- Blocked by: B85.
- Lines: about 150.
- Touches: `docs/getting-started.md`, `README.md`.

## Batch 17: deslop (`v1.1.0`)

### B88. Deslop pass on `v1.1.0`
- Rules: BS10, over the code new since B81.
- Acceptance: as B76.
- Blocked by: B86, B87.
- Lines: about 200 changed.
- Touches: `crates/engine/src/start/`, `web/src/start/`.

## Batch 18: unslop (`v1.1.0`)

### B89. Unslop pass on `v1.1.0`
- Rules: BS10, over the words new since B81.
- Acceptance: as B76.
- Blocked by: B88.
- Lines: about 200 changed.
- Touches: start's words and docs.

## Batch 19: release (`v1.1.0`)

### B90. Release `v1.1.0`
The version PR and tag, and a live check against the demo repo, where the labels source should come first and propose its `accounts`, `storage` and `editor` sections.
- Rules: R11, R14, start-a-map's fixtures note.
- Acceptance: release `v1.1.0` has R1's assets; the live check's result is on the ticket.
- Blocked by: B77, B89.
- Lines: about 20.
- Touches: `Cargo.toml`, `web/package.json`.
