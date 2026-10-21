# Build spec

The one spec a build fleet works from. It gathers the settled decisions by linking the spec doc and ticket that owns each, and adds only what the build itself needs: the crate map and line budget, what each release holds, the build method, the checks every PR passes, the switch-over steps and the list of amendments later tickets made to earlier specs. The ticket plan is `docs/spec/build-tickets.md`. Part of #16.

Inputs: the map (#2), its Notes and Decisions so far, the settled decisions (#3), every doc under `docs/`, and the maintainer's answers on #2, read on 21 October 2026.

## The answer in short

- One Cargo workspace of three shipped crates (`engine`, `server`, `app`) and two dev-only crates (`parity`, `xtask`), with the React screen in `web/` and the example in `examples/`.
- Release one, `v1.0.0`, is about 15,800 lines of Rust and TypeScript, tests aside, plus about 1,300 of CSS. `v1.1.0` adds the start-a-map command and comes to about 16,700 (18,100 with CSS). The owner's estimate holds: the work map stays under 20,000 lines of code. The margin is real but not wide, so a line check guards it on every PR.
- 90 build tickets in 20 batches: 80 for release one (13 batches), 10 for `v1.1.0` (7 batches). About 46,300 lines of change with tests for release one, plus about 3,600 lines of screen files moved across, and 4,700 for `v1.1.0`.
- Small PRs that the builder merges itself once `cargo xtask check` is green and the reviewer's close gate passes. A bulk review after each batch. Hosted builds on three OSes from batch 1, never blocking, with each red run on `main` becoming a ticket.
- The deslop and unslop passes run after the last release-one code lands and before the parity streak starts, because any code change restarts the streak (P23).

## Defaults and answers in force

- (Q1) Settled by the maintainer: release one reads the retired features' last scores once, read-only, and shows their date (CF17, MC-05). AI scoring comes back in release two (below).
- [Q7] No separate public demo repo: this repo's own map is the example and is live already (`docs/spec/own-map.md`), so B77 drops. Recommended; open on #2.
- [Q8] The request guard accepts a `Host` that is an IP address and refuses every name (L11). Recommended; open on #2.
- [Q9] `work-map start` never writes to GitHub (SM21). Recommended; open on #2.

A tagged ticket changes only if the maintainer answers differently.

## Where each decision lives

| Area | Spec | Ticket | Rule ids |
| --- | --- | --- | --- |
| Settled decisions | #3 | #3 | 1 to 17 |
| Engine modules and seams | `docs/review/architecture.md` | #5 | AR-01 to AR-15 |
| Findings on the archive | `docs/review/thermonuclear.md` | #4, #23 | TN-01 to TN-86 |
| Behaviour carried over, deliberate fixes | `docs/spec/must-carry-over.md` | #6 | MC-01 to MC-81, KD-01 to KD-39 |
| Shared Seat Gauge file | `docs/seat-gauge-file/README.md` | #7 | its tables and examples |
| Crates, contract, served mode, window, kick, folders, `gh` | `docs/spec/app-layout.md` | #9 | L1 to L23 |
| The screen | `docs/spec/screen.md` | #10 | S1 to S20, F1 to F8 |
| Settings, config v2, example, guide | `docs/spec/config-v2.md` | #11 | CF1 to CF24 |
| This repo's own map, the Section rule, the example's source | `docs/spec/own-map.md`, `.work-map/` | #46 | OM1 to OM12 |
| GitHub budget | `docs/spec/github-budget.md` | #12 | B1 to B14 |
| Parity and switch-over | `docs/spec/parity.md` | #13 | P1 to P26 |
| Release packaging | `docs/spec/release.md` | #14 | R1 to R17 |
| Start-a-map command | `docs/spec/start-a-map.md` | #15 | SM1 to SM23 |
| Roadmap file formats | `docs/spec/roadmap-files.md`, `docs/spec/example/scope/` | #30 | RF1 to RF27 |
| Batch-one answers | the specs above | #32 | (Q2) to (Q5) |
| Build method, lines, checks | this file | #16 | BS1 to BS12 |

Every rule above carries its own test. A build ticket names the rules it implements, and those rules' tests are its acceptance list. Nothing here restates them.

## Crate map

```text
work-map/
├── Cargo.toml              workspace; one version (R13)
├── crates/engine/          library, no window or server code (L1)
│   ├── model               ids, repo names, issue and PR keys, instants, clock
│   ├── config              settings, config v2 and v1, roadmap files, frozen inputs
│   ├── github              GitHub port, gh adapter, recorded adapter, budget gate, REST cache
│   ├── census              one store of GitHub data per project, refresh by scope
│   ├── store               data folder, atomic saves, instance lock
│   ├── placement           every ticket and PR placed once
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
├── crates/app/             the `work-map` binary; `window` feature (R3)
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
| `engine`, release one | 10,720 | 12,000 | MC table (11,100 for engine, server and app) plus `model` 200, `dump` 100, `example` 200, the release check 120 and contract additions 50; `scores` comes out of `config`'s frozen-input share |
| `engine::start`, v1.1.0 | 600 | inside the engine ceiling | SM2 |
| `server` | 450 | 550 | MC table |
| `app` | 700 | 850 | MC table 600, plus S14's handler, R7, the `rust-embed` adapter (R3) and the two start commands |
| `web` TypeScript | 3,970, then 4,270 | 4,600 | S-spec: 3,650 drawing, 200 transport, 120 `useMap`; SM2's 300 sheet |
| `web` CSS | 1,270, then 1,330 | 1,500 | S-spec, plus the sheet |
| The work map, v1.0.0 | 15,840, with CSS 17,110 | 20,000 | |
| The work map, v1.1.0 | 16,740, with CSS 18,070 | 20,000 | |
| `parity`, dev only | 1,500 | none | P-spec: capture, adapter, compare, report, streak |
| `xtask`, dev only | 1,150 | none | checks, line count, example refresh, fixture export |

The owner's test: each app under 20,000 lines of code, tests aside. The work map passes at about 84% of the target by `v1.1.0`, or 90% counting CSS. If Rust runs 20% over its estimate, as the riskiest modules may (`census` and `placement` hold the most edge cases, per #6), it reaches about 19,200 lines of code, still under, though CSS would take it past. So the ceilings are hard. Seat Gauge's side in this map is only the shared file's spec and examples, with no code; its own count belongs to its own map ([Seat Gauge in Rust (idea)](https://github.com/LaunchAstro/work-map/issues/20) records 12.4k Swift lines today).

**BS3. Ceilings fail the check.** `cargo xtask lines` prints each crate, module and the totals, and exits 1 when a ceiling in the table is passed.
Test: a fixture tree one line over the `server` ceiling exits 1 naming `server`.

**BS4. Over-estimate modules are named.** A PR that takes a module more than a quarter past its estimate says so in its body, and the batch's bulk review decides to cut or to raise the estimate here.
Test: none; a review rule.

## What each release holds

**Release one, `v1.0.0`.** Everything in settled decision 9: sections and the scope, progress and review bars; PRs and blockers; the merge panel and clock-hour chart; ticket counts and Next up; Sync; agents from Seat Gauge; project tabs; served site versions; the loading bay; map gaps. Plus the example project and the getting-started guide (decision 11), the six unsigned downloads (R1), the quiet newer-release line (R15, R16), frozen scores (Q1), and `work-map`, `serve`, `kick` and `dump` (L2). It is tagged only after switch-over (R14, P24). Builds before it are `v1.0.0-rc.N`.

**`v1.1.0`.** `work-map start` in the window, on the command line and as a served-page hint (SM1 to SM23), with its amendments below. Nothing else.

**Release two.** AI scoring returns as a planned feature, charted on the map (#2) from [Release two: what the old audit got right](https://github.com/LaunchAstro/work-map/issues/35) to [Release two: AI scoring build spec and tickets](https://github.com/LaunchAstro/work-map/issues/40). In outline: a deep audit at setup or on demand, re-scoring only the sections a merged PR touched, one model run through the user's own coding-agent subscription, off by default, tools off, text in and score out, pausing near the seat cap through Seat Gauge, with scores pinned to the commit they read and ticket counts carrying the bar between audits. None of it is in this plan. Release one's part is the scores seam above.

**Never.** The retired list in settled decision 10.

## Build method

From #2's Notes, made checkable.

**BS5. One ticket, one small PR.** A ticket fits one agent session and one PR of about 300 to 800 lines with its tests. Moves of the archive's screen files count their copied lines apart. The PR body has `Section: <id>` (`own-map.md`), `Why:`, `Left undone:` (ticket numbers or `none`) and `Closes #n`. Work found along the way becomes a new `build` ticket, not a bigger PR.

**BS6. Local checks gate the merge.** The builder merges its own PR once `cargo xtask check` passes on the PR head on the always-on build machine and the reviewer's gate passes (BS7). There is no blocking hosted check and no merge queue. The build machine's pre-check posts each named step and its result on the PR.

**BS7. The reviewer's close gate.** A reviewer agent on a second model reviews every PR. Each finding has a stable id kept across rounds. The builder may dispute a finding with evidence, and the reviewer rules on it. There are at most two rounds. The PR merges only on a pass; one still held after round two waits for the batch's bulk review.

**BS8. Bulk review after each batch.** When a batch's last PR merges, one review reads the batch's whole diff against this spec and the rules its tickets name. Its findings become tickets in the next batch. The next batch's tickets may start meanwhile, but none merges before the review is posted.

**BS9. Hosted builds from the first build.** B02 switches on R9's `test` job on macOS, Windows and Linux in batch 1. It runs `cargo xtask check --ci`, so hosted and local runs share one list of steps. A red run on `main` opens or comments on the `hosted-build-red` issue (R12). Whoever starts the next batch turns it into a `build` ticket in that batch.

**BS10. Cleanup passes before the streak.** The deslop pass, then the unslop pass, each in a fresh lane, run on the code and docs new since the first build ticket: once for release one (B76, B78), once for `v1.1.0` (B88, B89). Deslop removes code that does nothing and keeps every check at untrusted input, every capability and every test. Unslop edits docs, screen words, errors, empty states, comments and test names, keeping technical meaning and identifiers exactly. The release-one passes land before the parity streak (B79), because a new engine commit starts a new streak (P23).

**BS11. The archive is a read-only reference.** Builders read the private archive's code and tests to copy cases, never commit to it, and describe each old case in public by what it checks. Only the screen's own files move across (S1). Anything that needs a private name goes in an issue on the private archive.

**BS12. Batches.** A ticket starts when every ticket it is blocked by has merged. Tickets in one batch share no file, apart from append-only lists: `mod` lines, workspace members, `[workspace.dependencies]`, `web/package.json` dependencies, generated contract files and `parity/known-differences.toml` entries. The fleet runs a batch's tickets side by side, on the always-on build machine (#3, decision 17).

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

1. **Before the comparison** (B74, the maintainer on the build machine). Add `sites` and `timeZone: "+10:00"` to each live version 1 config. Make its id fit CF8 and its patterns compile under Rust's rules (CF19). Load both maps in `work-map serve --port <free port>` with a scratch `WORK_MAP_DIR`, and expect no line in `hello.config_problems` or any view's `problems`. If one of the three new readings (RF14's prose time with no zone word, RF17's single dropped plan item, RF24's digest ignoring `maps`) shows up in a live file, add a KD row from KD-40 on and its `known-differences.toml` entry (P18). Write the dump's settings file with the pinned roadmap and frozen folders (CF20).
2. **The private runbook** (B16) names the old engine's jobs, the live maps' ports, and how to pause, resume and full-read each.
3. **Freeze the code.** The release-one cleanup passes have landed (BS10), and a release candidate `v1.0.0-rc.N` built from that commit is on the build machine as the headless build (release.md, notes).
4. **Run windows** as parity.md's steps 1 to 6 say, until `parity streak` prints `ready`: three clean runs on three days on one commit, every card compared in two of them (P23). A failing run becomes a ticket; its fix is a new commit and a new streak.
5. **The maintainer decides** (P24). Retire the old engine's jobs from the runbook, and give port 4317 to `work-map serve`.
6. **Tag.** A PR sets the version to `1.0.0`; the tag goes on its merge commit and the workflow publishes (R11, R14).
7. **Afterwards.** The maintainer sets each live config's `version` to 2 and removes the retired keys the loader names (CF18).

## Reconciliations

Amendments that later tickets made to earlier specs, dated 21 October 2026. "Patched" marks a line in the owning spec changed in this PR because it had become plainly wrong. The rest are additions, applied in the ticket named.

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
17. From this repo's own map (#46): the example is a recording of this repo, refreshed by `cargo xtask example-refresh`; fixture.md is gone; P25's capture is generated and planted; every PR and build ticket carries `Section:`. Patched config-v2's example lines and CF21, CF22, CF24, the RF12, RF20 and RF22 tests, P25, BS5 and [Q7]. B56, B63, B71, B72, B77.

## Public and private

Every build ticket, PR and file follows `AGENTS.md`: no client or business names, machine or account names, internal paths, addresses or private repo contents. The maintainer's live maps, ports and job names appear only in the private runbook (B16). Captures stay outside the repo (P22).
