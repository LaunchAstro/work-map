# Build spec

The one spec a build fleet works from. It gathers the settled decisions by linking the spec doc and ticket that owns each, and adds only what the build itself needs: the crate map and line budget, what each release holds, the build method, the checks every PR passes, the switch-over steps and the list of amendments later tickets made to earlier specs. The ticket plan is `docs/spec/build-tickets.md`. Part of #16.

Inputs: the map (#2), its Notes and Decisions so far, the settled decisions (#3), every doc under `docs/`, the findings listed on #16, and the maintainer's answers on #2 through batch five (Q1 to Q20, Q31 to Q33), read on 21 October 2026. Revised the same day for the attribution answers, PR placement (#45), this repo's own map (#46), the Seat Gauge file's attribution fields (#7) and the maintainer's sections-first rule (Q20).

## The answer in short

- One Cargo workspace of three shipped crates (`engine`, `server`, `app`) and two dev-only crates (`parity`, `xtask`), with the React screen in `web/` and the example in `examples/`.
- Release one, `v1.0.0`, is about 17,100 lines of Rust and TypeScript, tests aside, plus about 1,300 of CSS. `v1.1.0` adds the start-a-map command and comes to about 18,000 (19,400 with CSS). The owner's estimate holds at about 90% of 20,000. PR placement in layers, `where`, `sections`, `allowed_hosts` and the sections-first warnings added about 1,300 lines, so the margin is thinner than before: a 14% Rust overrun still fits, 20% would not. The line check guards it on every PR, and release two (#40) has just under 2,000 lines of room.
- 124 build tickets under 125 ids (B77 removed, Q16), in 22 batches: 110 for release one (14 batches), 14 for `v1.1.0` (8 batches). About 51,400 lines of change with tests for release one, plus about 3,600 lines of screen files moved across, and about 4,800 for `v1.1.0`.
- Every ticket names one section and touches only that section's paths, plus its own lines in BS13's cross-section lists (BS14, Q20). Tickets that spanned two sections were split.
- Small PRs that the builder merges itself once `cargo xtask check` is green and the reviewer's close gate passes. A bulk review after each batch. Hosted builds on three OSes from batch 1, never blocking, with each red run on `main` becoming a ticket. This repo's merge check moves from OM7's shell lines to `work-map where` once the commands ship (B99).
- The deslop and unslop passes run per section, after the last release-one code lands and before the parity streak starts, because any code change restarts the streak (P23).

## Maintainer answers in force

All settled on #2, and applied in the owning specs (#32, #45, #46, #52) apart from the lines the reconciliations below mark as owed. The tickets here already use every answer.

- (Q1) Release one reads the retired features' last scores once, read-only, and shows their date (CF17, MC-05). AI scoring comes back in release two (below).
- (Q2, revised) PRs place in layers, most reliable first, with configurable ticket ids and workspace pattern; AI placement is release two's (`docs/spec/placement.md`). (Q31) `work-map where` and `work-map sections` ship in release one. (Q32) This repo is strict from its first PR. (Q33) Files no section owns warn as map gaps and never hold a merge.
- (Q7, then Q16) No separate public demo repo: this repo's own map is the example and is live already (`docs/spec/own-map.md`). B77 is removed and its id kept.
- (Q8, changed) The request guard accepts an IP address or a name in `settings.json`'s `allowed_hosts` with the served port, and refuses every other name, so the DNS-rebinding guard otherwise stands (L11, CF25, MC-70). B100, B101.
- (Q9) `work-map start` never writes to GitHub (SM21).
- (Q15, changed, with Q20) Section ids are one word with no hyphen, and seat names are one word, so Seat Gauge splits a workspace label from the right: seat last, section before it, the rest the repo. The repo-name list stays only as a fallback for older labels. B91, B98.
- (Q17) The example shows made-up agents, labelled as examples (OM11). B56.
- (Q18) Any placement layer up to 3 is enough for `where` to pass by default; `strict` is per project, and this repo is strict (PL16). B97, B99.
- (Q19) Tickets a PR mentions in prose beat its changed files, and each card that moves at switch-over is on the known-differences list (KD-40). B44.
- (Q20) Sections first: a repo's sections are set before any ticket, with one-word ids, a plain name and the folders each owns; every folder belongs to one section or is marked shared; every ticket names one section and is split until it does. The config check warns about a section id with a hyphen and about a folder claimed twice (CF26). BS14, B125, and every ticket.
- (Q10) to (Q14) settle release two's scoring and guard (#40).

## Where each decision lives

| Area | Spec | Ticket | Rule ids |
| --- | --- | --- | --- |
| Settled decisions | #3 | #3 | 1 to 17 |
| Engine modules and seams | `docs/review/architecture.md` | #5 | AR-01 to AR-15 |
| Findings on the archive | `docs/review/thermonuclear.md` | #4, #23 | TN-01 to TN-86 |
| Behaviour carried over, deliberate fixes | `docs/spec/must-carry-over.md` | #6 | MC-01 to MC-81, KD-01 to KD-43 |
| Shared Seat Gauge file, its attribution fields | `docs/seat-gauge-file/README.md` | #7 | its tables and examples |
| PR placement layers, `where`, `sections`, the attribution chain | `docs/spec/placement.md` | #45 | PL1 to PL24 |
| Crates, contract, served mode, window, kick, folders, `gh` | `docs/spec/app-layout.md` | #9 | L1 to L23 |
| The screen | `docs/spec/screen.md` | #10 | S1 to S20, F1 to F8 |
| Settings, config v2, example, guide | `docs/spec/config-v2.md` | #11, #52 | CF1 to CF26 |
| This repo's own map, the Section rule, the example's source | `docs/spec/own-map.md`, `.work-map/` | #46 | OM1 to OM12 |
| GitHub budget | `docs/spec/github-budget.md` | #12 | B1 to B14 |
| Parity and switch-over | `docs/spec/parity.md` | #13 | P1 to P26 |
| Release packaging | `docs/spec/release.md` | #14 | R1 to R17 |
| Start-a-map command | `docs/spec/start-a-map.md` | #15 | SM1 to SM23 |
| Roadmap file formats | `docs/spec/roadmap-files.md`, `docs/spec/example/scope/` | #30 | RF1 to RF27 |
| Maintainer answers | #2's comments, the specs above | #32, #45, #46, #52, this file | (Q1) to (Q20), (Q31) to (Q33) |
| Build method, lines, checks, cross-section lists | this file | #16 | BS1 to BS14 |

Every rule above carries its own test. A build ticket names the rules it implements, and those rules' tests are its acceptance list. Nothing here restates them.

## Crate map

```text
work-map/
├── Cargo.toml              workspace; one version (R13)
├── crates/engine/          library, no window or server code (L1)
│   ├── model               ids, repo names, issue and PR keys, instants, clock
│   ├── config              settings, config v2 and v1, roadmap files, frozen inputs, sections-first warnings, finding the project, `sections`
│   ├── github              GitHub port, gh adapter, recorded adapter, budget gate, REST cache
│   ├── census              one store of GitHub data per project, refresh by scope, the one-PR read for `where`
│   ├── store               data folder, atomic saves, instance lock
│   ├── placement           every ticket and PR placed once, in layers; the `where` verdict
│   ├── scores              the seam for unit and section scores (see below)
│   ├── progress            ticket counts, scope shares, review, spec closure, rollups
│   ├── merges, map_gaps, versions, seat_gauge
│   ├── view                MapView, built from everything above
│   ├── engine              the running service: tabs, Sync, timers, kick, release check
│   ├── contract            the five calls and their types, exported to TypeScript (L5)
│   ├── example             the embedded example and its time shift (CF21 to CF24)
│   ├── dump                the parity dump as a library (P9, P25)
│   └── start               v1.1.0: the start-a-map survey, proposal and writer
├── crates/server/          loopback HTTP adapter (L10 to L12)
├── crates/app/             the `work-map` binary and its entries (L2); `window` feature (R3)
├── crates/parity/          dev only: capture, old adapter, compare, report, streak
├── crates/xtask/           dev only: check runner, line count, fixture tools, repo tests
├── web/                    the screen (S1 to S20)
├── examples/demo/          the example project, recorded from this repo (own-map.md)
└── .work-map/              this repo's own map, the example's source (own-map.md)
```

**The scores seam.** `progress` reads every unit and section score through one small trait in `scores`: a score is a value with its date, its source and, optionally, the commit it read. Release one has one adapter, the frozen inputs (CF17, MC-05, MC-34, MC-40). A later store keyed by section and commit can replace it without touching `view`, the contract or the screen, which only ever see the shares and the date for the hover.

**BS1. Dependencies point one way.** L1 holds. `parity` and `xtask` depend on `engine` and are never in a release download (P11).
Test: L1's `cargo tree` checks, plus `cargo tree -p work-map` lists neither `parity` nor `xtask`.

**BS2. Tests sit apart from code.** Unit tests live in a sibling `tests.rs` (`#[cfg(test)] mod tests;`) or a crate's `tests/` folder, and screen tests in `web/test/`, so lines can be counted without parsing.
Test: `cargo xtask lines` fails on a `#[cfg(test)]` block with a body inside any other file.

## Line budget

Lines of code are non-blank lines that are not only a comment, in shipped source: `crates/engine`, `crates/server` and `crates/app` under `src/`, and `web/src`. Tests, `web/src/contract/` (generated from Rust) and the dev-only crates are left out. Estimates come from must-carry-over's line count, the screen spec and the later tickets.

| Crate or part | Estimate | Ceiling | Where the estimate comes from |
| --- | --- | --- | --- |
| `engine`, release one | 11,680 | 12,800 | MC table (11,100 for engine, server and app) plus `model` 200, `dump` 100, `example` 200, the release check 120 and contract additions 50; `scores` comes out of `config`'s frozen-input share. Then placement's layers and evidence 220, the Seat Gauge reader's attribution fields 80, the `attribution` block and pattern helper 80, the one-PR read 150, finding the project and `sections` 100, the `where` verdict and answer 180, the contract's placement fields 30, `allowed_hosts` 30, and the sections-first warnings 90 |
| `engine::start`, v1.1.0 | 600 | inside the engine ceiling | SM2 |
| `server` | 500 | 550 | MC table 450, plus the guard's host list 50 (Q8) |
| `app` | 850 | 1,000 | MC table 600, plus S14's handler, R7, the `rust-embed` adapter (R3) and the two start commands, then the `where` and `sections` entries 150 |
| `web` TypeScript | 4,090, then 4,390 | 4,600 | S-spec: 3,650 drawing, 200 transport, 120 `useMap`; placement hovers and reason words 120; SM2's 300 sheet |
| `web` CSS | 1,300, then 1,360 | 1,500 | S-spec, plus the hovers and the sheet |
| The work map, v1.0.0 | 17,120, with CSS 18,420 | 20,000 | |
| The work map, v1.1.0 | 18,020, with CSS 19,380 | 20,000 | |
| `parity`, dev only | 1,500 | none | P-spec: capture, adapter, compare, report, streak |
| `xtask`, dev only | 1,150 | none | checks, line count, example refresh, fixture export |

The owner's test: each app under 20,000 lines of code, tests aside. The work map passes at about 90% of the target by `v1.1.0`, or 97% counting CSS. If Rust runs 14% over its estimate it reaches about 19,930 lines of code, just under; at 20% (`census` and `placement` hold the most edge cases, per #6) it passes 20,000. So the ceilings are hard, and the totals row fails the check too. Release two is not in these numbers: its specs size AI scoring at about 2,400 lines with the seat-cap guard (`docs/spec/scoring.md`, `docs/spec/scoring-runs.md`, `docs/spec/seat-cap-guard.md`), which would take the app past 20,000 on top of `v1.1.0`. #40 has just under 2,000 lines of room, less any overrun here, and should size its tickets to it or name the cut. Seat Gauge's side in this map is only the shared file's spec and examples, with no code; its own count belongs to its own map ([Seat Gauge in Rust (idea)](https://github.com/LaunchAstro/work-map/issues/20) records 12.4k Swift lines today).

**BS3. Ceilings fail the check.** `cargo xtask lines` prints each crate, module and the totals, and exits 1 when a ceiling in the table is passed, the 20,000 total of shipped code included.
Test: a fixture tree one line over the `server` ceiling exits 1 naming `server`; one whose crates are each under their ceilings but total 20,001 exits 1 naming the total.

**BS4. Over-estimate modules are named.** A PR that takes a module more than a quarter past its estimate says so in its body, and the batch's bulk review decides to cut or to raise the estimate here.
Test: none; a review rule.

## What each release holds

**Release one, `v1.0.0`.** Everything in settled decision 9: sections and the scope, progress and review bars; PRs and blockers; the merge panel and clock-hour chart; ticket counts and Next up; Sync; agents from Seat Gauge; project tabs; served site versions; the loading bay; map gaps. Plus PR placement in layers, with each placement's layer and evidence and each Not placed PR's reasons (PL1 to PL11); the example project, the getting-started guide (decision 11) and the attribution chain page (B98); the six unsigned downloads (R1); the quiet newer-release line (R15, R16); frozen scores (Q1); and `work-map`, `serve`, `kick`, `dump`, `where` and `sections` (L2, PL14 to PL24). It is tagged only after switch-over (R14, P24). Builds before it are `v1.0.0-rc.N`.

**`v1.1.0`.** `work-map start` in the window, on the command line and as a served-page hint (SM1 to SM23), with its amendments below. Nothing else.

**Release two.** AI scoring returns as a planned feature, charted on the map (#2) from [Release two: what the old audit got right](https://github.com/LaunchAstro/work-map/issues/35) to [Release two: AI scoring build spec and tickets](https://github.com/LaunchAstro/work-map/issues/40). In outline: a deep audit at setup or on demand, re-scoring only the sections a merged PR touched, one model run through the user's own coding-agent subscription, off by default, tools off, text in and score out, pausing near the seat cap through Seat Gauge, with scores pinned to the commit they read and ticket counts carrying the bar between audits. None of it is in this plan: its build tickets, PR placement layer 4's AI guess among them, come from #40, wired to the release-one tickets they need. Release one's part is the scores seam above, step 11's reserved `ai_guess` rule (PL7), and the line room left in the budget.

**Never.** The retired list in settled decision 10.

## Build method

From #2's Notes, made checkable.

**BS5. One ticket, one small PR.** A ticket fits one agent session and one PR of about 300 to 800 lines with its tests. Moves of the archive's screen files count their copied lines apart. The PR body has `Section: <id>` (`own-map.md`), its ticket's section, `Why:`, `Left undone:` (ticket numbers or `none`) and `Closes #n`. Work found along the way becomes a new `build` ticket in the section that owns it, not a bigger PR (BS14).

**BS6. Local checks gate the merge.** The builder merges its own PR once `cargo xtask check` passes on the PR head on the always-on build machine and the reviewer's gate passes (BS7). There is no blocking hosted check and no merge queue. The build machine's pre-check posts each named step and its result on the PR. Its first step is the Section check: OM7's shell lines until B99 merges, then `work-map where "$PR" --json`, holding on exit 1 (PL22).

**BS7. The reviewer's close gate.** A reviewer agent on a second model reviews every PR. Each finding has a stable id kept across rounds. The builder may dispute a finding with evidence, and the reviewer rules on it. There are at most two rounds. The PR merges only on a pass; one still held after round two waits for the batch's bulk review.

**BS8. Bulk review after each batch.** When a batch's last PR merges, one review reads the batch's whole diff against this spec and the rules its tickets name. Its findings become tickets in the next batch. The next batch's tickets may start meanwhile, but none merges before the review is posted.

**BS9. Hosted builds from the first build.** B02 switches on R9's `test` job on macOS, Windows and Linux in batch 1. It runs `cargo xtask check --ci`, so hosted and local runs share one list of steps. A red run on `main` opens or comments on the `hosted-build-red` issue (R12). Whoever starts the next batch turns it into a `build` ticket in that batch.

**BS10. Cleanup passes before the streak.** The deslop pass, then the unslop pass, each in a fresh lane per section (Q20), run on the code and docs new since the first build ticket: for release one, deslop B76 and B110 to B114, then unslop B78 and B115 to B120; for `v1.1.0`, B88, then B89 and B121. Deslop removes code that does nothing and keeps every check at untrusted input, every capability and every test. Unslop edits docs, screen words, errors, empty states, comments and test names, keeping technical meaning and identifiers exactly. Deslop covers shipped code only; dev-only `xtask` and `parity` code is left as it is. The release-one passes land before the parity streak (B79), because a new engine commit starts a new streak (P23).

**BS11. The archive is a read-only reference.** Builders read the private archive's code and tests to copy cases, never commit to it, and describe each old case in public by what it checks. Only the screen's own files move across (S1). Anything that needs a private name goes in an issue on the private archive.

**BS12. Batches.** A ticket starts when every ticket it is blocked by has merged. A batch is the tickets whose longest run of blocking edges has the same length, so no ticket waits on another in its own batch. Tickets in one batch share no file, apart from BS13's lists, where each adds only its own lines. The fleet runs a batch's tickets side by side, on the always-on build machine (#3, decision 17).

**BS13. Cross-section lists.** A few files are lists every section adds to, or are generated: the root `Cargo.toml` (members, `[workspace.dependencies]`, the version), `Cargo.lock`, each crate's `Cargo.toml` (dependencies), `crates/engine/src/lib.rs` (`mod` lines only), `web/package.json` (dependencies, the version), `web/pnpm-lock.yaml`, `web/src/contract/**` (generated from Rust, L5), and the KD rows in `must-carry-over.md` with their entries in `parity/known-differences.toml`. Each keeps its one owner in the section map, whose `shared` list stays empty (OM2). A ticket in another section may add its own lines to them, or regenerate them, and that does not make it span two sections. Any other change to them belongs to their owner.
Test: none of its own; a review rule, and BS14's test leaves these files out.

**BS14. One section per ticket (Q20).** Every build ticket names one section and touches only that section's paths, plus its own lines in BS13's lists. A change that would reach into a second section is a second ticket there, blocked by the first where it must be. Tickets with no repo paths (maintainer tasks) take the section of the spec they serve.
Test: a repo test expands every path in the `Touches:` lines of `build-tickets.md` against `.work-map/section-map.json`, BS13's files aside, and finds one owning section per ticket, the one its `Section:` line names.

## Local checks

`cargo xtask check` runs these in order, stops at the first failure, and prints one line per step. The `web` steps are skipped until `web/package.json` exists, and the browser step until `web/test/browser/` does.

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir web typecheck
pnpm --dir web lint
pnpm --dir web test
pnpm --dir web build                         # the app crate embeds web/dist (S18)
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build -p work-map --no-default-features --locked     # the headless build (R3)
pnpm --dir web test:browser                  # Chromium and WebKit (S16)
cargo xtask lines                            # BS3
```

A PR that changes only Markdown under `docs/` may run `cargo xtask check --docs`, which runs only the repo tests that read docs. Some acceptance tests run only on one OS, such as L14's Dock test and R6's PowerShell check. They run on the hosted matrix, and a failure there is a BS9 ticket.

## Switch-over

1. **Before the comparison** (B74, the maintainer on the build machine). Add `sites` and `timeZone: "+10:00"` to each live version 1 config. Make its id fit CF8 and its patterns compile under Rust's rules (CF19). Load both maps in `work-map serve --port <free port>` with a scratch `WORK_MAP_DIR`, and expect no line in `hello.config_problems` or any view's `problems`. If one of the three new readings (RF14's prose time with no zone word, RF17's single dropped plan item, RF24's digest ignoring `maps`) shows up in a live file, add a KD row from KD-44 on (KD-40 to KD-43 are placement's) and its `known-differences.toml` entry (P18), in its own PR with `Section: docs`. Write the dump's settings file with the pinned roadmap and frozen folders (CF20).
2. **The private runbook** (B16, in batch 0) names the old engine's jobs, the live maps' ports, and how to pause, resume and full-read each.
3. **Freeze the code.** The release-one cleanup passes have landed (BS10), and a release candidate `v1.0.0-rc.N` built from that commit is on the build machine as the headless build (release.md, notes).
4. **Run windows** as parity.md's steps 1 to 6 say, until `parity streak` prints `ready`: three clean runs on three days on one commit, every card compared in two of them (P23). A failing run becomes a ticket; its fix is a new commit and a new streak.
5. **The maintainer decides** (P24). Retire the old engine's jobs from the runbook, and give port 4317 to `work-map serve`.
6. **Tag.** A PR sets the version to `1.0.0`; the tag goes on its merge commit and the workflow publishes (R11, R14).
7. **Afterwards.** The maintainer sets each live config's `version` to 2 and removes the retired keys the loader names (CF18).

## Reconciliations

Amendments that later tickets made to earlier specs, dated 21 October 2026. "Patched" marks a line in the owning spec changed in the PR that added the item because it had become plainly wrong. "Owed" marks such a line not yet changed in its owning spec, left to a follow-up on that spec. The rest are additions, applied in the ticket named. Items 18 to 31 were added in the revision for #45, #46, #7 and the batch three to five answers.

1. From release packaging (#14): `Hello` gains `newer_release: { version, url } | null` (R16). B09.
2. From release packaging (#14): the headless build always serves through the `rust-embed` adapter, so L3's fallback is required there (R3). Patched L3. B53.
3. From the screen (#10): S4 defines the one content security policy that L11's served answers and L13's window both carry. B10, B55.
4. From the screen (#10): S14 adds the window's navigation and new-window handlers, which hand `https:` addresses to the OS from Rust. The webview still gets no opener permission, so L13 stands. B55.
5. Follows from 4: the newer-release footer is a link in both modes. Patched R16, the release spec's note to #9 and #10, and S20 with its test. B49.
6. From the parity harness (#13): a dev-only `crates/parity` (capture, old adapter, compare, report, streak) beside the `dump` entry. B14, B15, B40 to B42, B52, B70, B72.
7. Found here: P9 had `dump` map views into the parity record, while P11 keeps the record types in `parity`, out of the release binary. `dump` now writes each view with its read facts and input hashes, and `parity` maps that file to the record. Patched P9. B70.
8. From the parity harness (#13): a private runbook issue on the archive, with the public spec keeping the steps neutral. B16.
9. From config v2 (#11): `Hello` gains `config_problems: { path, message }[]` (CF5), and `dump` gains `--settings` (CF20). Patched P9's command line. B09, B70.
10. From config v2 (#11): the pre-comparison maintainer step on each live version 1 file (CF19). Switch-over step 1, B74.
11. From the roadmap file formats (#30): the board's wire type gains `side`, `offset`, `gap`, `lane` and `label`. Patched the wire line in the screen spec's sketch. B09, B64.
12. From the roadmap file formats (#30): each `MapView` gains `problems: string[]`, the project's roadmap problem lines (RF5), drawn beside the config problems. B09, B67.
13. From the roadmap file formats (#30): the three new readings get KD rows only if the pre-comparison load finds them. Switch-over step 1, B74.
14. From the start-a-map command (#15), all in `v1.1.0`: L2 gains `start` as a fifth entry; L13's capability file gains `propose_map` and `start_map`; R7's refused list gains `start`; the data folder gains `maps/<id>/`. `contract` stays `1`. B85, B86.
15. Found here: R9 said `npm ci`, but the screen pins pnpm with a committed lockfile (S17). Patched R9. B02.
16. From the maintainer (Q1, settled): frozen scores stay, read through the `scores` seam, and release two replaces the adapter. B21, B32.
17. From this repo's own map (#46): the example is a recording of this repo, refreshed by `cargo xtask example-refresh`; fixture.md is gone; P25's capture is generated and planted; every PR and build ticket carries `Section:`. Patched config-v2's example lines and CF21, CF22, CF24, the RF12, RF20 and RF22 tests, P25, BS5 and (Q7). B56, B63, B71, B72, B77.
18. From this repo's own map (#46): every build ticket carries one `Section:` line from its section. B56 is the example refresh command, blocked also by B22 (the live adapter); B71 adds the fixture export and `expected.json` to it, and B109 the parity capture. B56, B71, B108, B109.
19. From PR placement (#45): every PR placement carries `layer`, `rule`, `evidence`, `inferred` and `guessed`, and every Not placed PR its reasons, in the view and on screen (PL1, PL8, PL11). `contract` stays `1`. Patched the screen spec's sketch with a `PrRef` line. B08, B09, B44, B64, B93, B94.
20. From PR placement (#45): L2 gains `where` and `sections`, R7's refused list gains both, and R14's command-line promise covers their arguments and exit codes (PL19, PL24). Patched R7 and R14. Owed: L2's line in the app layout. B102, B106, B107.
21. From PR placement (#45): config v2 gains the `attribution` block, read from version 1 files too, and `seatGauge.workspacePattern`; CF14's list of patterns gains `ticketIds` and `attribution.branchTicket`. Owed: config-v2's short answer, its field table, CF14 and CF18. B58, B92.
22. From the Seat Gauge file format (#7, reopened): the reader takes `workspace_pattern` and each row's `pr`. Seat Gauge splits the label and the work map never splits it again; under (Q15) and (Q20) the split runs from the right. B91, B93.
23. From PR placement (#45): KD-40 to KD-43 are placement's, so the rows for the three new roadmap readings start at KD-44. Patched switch-over step 1. B74.
24. From PR placement (#45): one screen label for unplaced work, "Not placed" (KD-23, PL8), not "Not on the map". Owed: OM4 and its test in own-map. B64, B94.
25. From PR placement (#45) and this repo's own map (#46): `.work-map/work-map.json` gains `"attribution": { "check": "strict", "branchTicket": "^[a-z]+/([1-9][0-9]*)-" }`, `specDocuments.placement` gains `docs/spec/placement.md`, and `AGENTS.md` and OM7 switch to `work-map where` (PL22) once B106 merges. B99.
26. From the maintainer (Q16): no separate demo repo. B77 is removed with its id kept, and B78 and B90 no longer wait on it. Applied in config-v2 and own-map (#52), apart from own-map's ticket table, which is owed. B77.
27. From the maintainer (Q8, changed): `settings.json` gains `allowed_hosts`, host names the served map accepts besides IP addresses; every other name is refused as before. Applied in L11, CF25 and MC-70 (#52). B53, B68, B73, B100, B101.
28. From the maintainer (Q20): every ticket names one section and touches only its paths, plus its own lines in BS13's lists, so tickets that spanned sections were split. B01 kept the workspace root and `xtask`, and B102 (crates and `model`), B103 (licence and README) and B104 (census records) split from it and B03; B08 took the placement types; B03's problem-line type moved to `config/problem.rs`; parts moved from B61 to B105, from B70 to B72, from B71 to B108, from B72 to B109, from B85 to B122, from B86 to B123 and B124, and from B96 and B97 to B106 and B107; the cleanup passes run per section. BS13 names the lists a ticket may add its own lines to without spanning, so own-map's `shared` stays empty. Owed to own-map: its ticket table, from the one in `build-tickets.md`. Every ticket.
29. From the maintainer (Q20), as CF26 (#52): the loader warns, without refusing, about a section id that is not one word and about a glob claimed twice; the warnings show on the project's tab and in `work-map sections` (PL23's `warnings`). B49, B57, B67, B96, B125.
30. Found here: placement's layers, the two commands and the one-PR read come to about 840 engine lines and 150 app lines, against #45's guess of about 350 in all, mostly for the one-PR read and the answer forms. The engine ceiling rises to 12,800 and the app's to 1,000, and BS3 gains a total row. Line budget.
31. From the score contract (#38), for release two: SC22 adds a `score` note (commit, files read and owned, reason, floor) to the progress bar in the contract, beyond the shares and date the `scores` seam promises above. Release two's tickets (#40).

## Public and private

Every build ticket, PR and file follows `AGENTS.md`: no client or business names, machine or account names, internal paths, addresses or private repo contents. The maintainer's live maps, ports and job names appear only in the private runbook (B16). The example's agents are made up (Q17). Captures stay outside the repo (P22).
