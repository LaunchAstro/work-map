# This repo's own map

This repo's own map: its sections, the paths each owns, where its config and roadmap files live, the `Section:` rule every PR and build ticket here follows, and how the same files become the example project built into the binary. Resolves #46.

Inputs: the maintainer's batch two attribution answers on #2 (Q32: this repo is strict from its first PR, and its own config is the example; Q33: unowned files are map gaps and never hold a merge), the [batches three to five answers](https://github.com/LaunchAstro/work-map/issues/2#issuecomment-6309343311) (Q15, Q16, Q17, Q20), `docs/spec/build-spec.md` (crate map, BS5, BS6), every `Touches:` line in `docs/spec/build-tickets.md`, `docs/spec/config-v2.md` (CF ids), `docs/spec/roadmap-files.md` (RF ids), `docs/spec/parity.md` (P25), and the fictional example this replaces, read on 21 October 2026.

## The answer in short

- Ten sections, by crate and area: `tooling`, `docs`, `config`, `github`, `placement`, `progress`, `service`, `screen`, `parity` and `start`. Every id is one word. Every path in the build plan and every planned top-level folder has exactly one owner. Nothing is shared. So the map meets Q20 and CF26 gives it no warning.
- The config and roadmap files live in `.work-map/`: `work-map.json` (config v2, ticket count), `flow.json` and `section-map.json`.
- Every PR and every build ticket carries one `Section: <id>` line. A one-line shell check holds the merge until `work-map where` (#45) exists.
- The example project is this repo: a copy of `.work-map/` plus a recording of this repo's issues and PRs, taken by `cargo xtask example-refresh`. It opens with no network and shifts its times to now, as CF22 and CF23 already say.
- `docs/spec/example/` keeps only `scope/`, because the RF tests for the scope basis name its files. `fixture.md`, the fictional config and `roadmap/` are gone.
- No separate public demo repo (Q16). This repo is the live example.

## Settled by the maintainer

- (Q16) No separate demo repo; B77 and its seed script drop. Agreed as recommended.
- (Q17) The example's agents are made-up rows on the real open PRs' branches, labelled as examples, because the maintainer's Seat Gauge file names machines and seats. Agreed as recommended.
- (Q20) Sections come first: one-word ids, a plain name and the folders each owns, every folder owned once or marked shared, and every ticket naming exactly one section. This map already meets it (OM1, OM2, OM6).

## Sections

| Id | Title | Owns |
| --- | --- | --- |
| `tooling` | Tooling | `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `.cargo/**`, `.github/**`, `.gitignore`, `.gitattributes`, `crates/xtask/**` |
| `docs` | Docs and planning | `docs/**`, `.work-map/**`, `README.md`, `AGENTS.md`, `CONTEXT.md`, `LICENSE`, `.github/pull_request_template.md` |
| `config` | Config and the example | `crates/engine/src/{config,scores,example}/**`, `examples/**`, `crates/xtask/src/{example_refresh,export}.rs` |
| `github` | GitHub and the census | `crates/engine/src/{github,census,store}/**` |
| `placement` | Placement | `crates/engine/src/{placement,map_gaps,seat_gauge}/**` |
| `progress` | Progress | `crates/engine/src/{progress,merges,versions}/**` |
| `service` | Service and shell | `crates/engine/**` (the rest: `model`, `view`, `engine`, `contract`, `dump`), `crates/server/**`, `crates/app/**`, `web/src/contract/**` |
| `screen` | Screen | `web/**` |
| `parity` | Parity | `crates/parity/**`, `parity/**`, `crates/xtask/src/old_capture.rs` |
| `start` | Start a map | `crates/engine/src/start/**`, `crates/app/src/start.rs`, `web/src/start/**`, `examples/start/**`, `crates/xtask/src/start_fixture.rs` |

The diagram runs six stages: Foundation (`tooling`, `docs`), Reading (`config`, `github`), Working out (`placement`, `progress`), Showing (`service`, `screen`), Proving (`parity`) and After release one (`start`). A dashed dependency draws `parity` to `start`, because start ships after switch-over.

**OM1. The ids are fixed.** Section ids are the ten above and never change once a PR names them. A rename is a new section plus a ticket that moves the old one's paths and lines.
Each id is one word of lower-case letters and digits, with no hyphen (Q20).
Test: `.work-map/flow.json` has exactly these ten sections, each id matching `^[a-z][a-z0-9]*$`, and `boxes` in `.work-map/section-map.json` names the same ten.

**OM2. Every path has one owner.** The section map uses RF20's matching: the glob with the most literal characters wins, so `crates/engine/src/placement/pr.rs` is `placement` and `crates/engine/src/model/ids.rs` falls back to `service`. `shared` stays empty. No glob is listed under two sections, so no folder is claimed twice (Q20, CF26). A broader glob with a longer one inside it, such as `crates/engine/**` (`service`) around `crates/engine/src/config/**` (`config`), still gives each path one owner. A new top-level folder or crate is a map gap until a ticket gives it an owner (Q33).
Test: a repo test matches every path in `build-tickets.md`'s `Touches:` lines, braces expanded and `crates/*` read as each crate in the crate map, and every top-level entry of the repo, and finds an owner for each; `scripts/x.sh` is a gap; loading `.work-map/` gives no CF26 warning.

## Where the files live

**OM3. `.work-map/` holds this repo's map.** The config sets `files.source: "github"`, so the paths in it (`.work-map/flow.json`, `.work-map/section-map.json`) are relative to this repo's root on its default branch and need no clone. To read a local checkout instead, a settings entry sets `roadmap` to the clone's root (CF11).
Test: the config loads with no problem lines from GitHub, and again from a settings entry whose `roadmap` is a clone's root.

**OM4. Planning tickets place by the map, build tickets by their line.** The section map's `maps` entry puts the children of map issue #2 on `docs`. A build ticket places by its own `Section:` line, which beats a parent's entry (MC-27). The config sets no repository default, so a ticket or PR that names nothing shows in Not placed rather than on a guessed card (PL8, KD-23). `idea` and `question` issues are left out of the counts.
Test: in the example, every child of #2 with no `Section:` line is on `docs`, and a `build` issue with no line is in Not placed.

## The Section rule

**OM5. One line on every PR.** A PR body carries exactly one line `Section: <id>`, with an id from `.work-map/flow.json`. Planning and docs PRs say `Section: docs`. A PR whose files span sections names the one with most of its changed lines; one that truly spans two is split (BS5). `.github/pull_request_template.md` starts with the line.
Test: the check below passes `Section: docs`, and refuses no line, `Section: doc`, `Section: docs and more`, and two lines naming different sections.

**OM6. One line on every build ticket.** Each `build` issue's body carries `Section: <id>` from the table in `build-tickets.md`. A ticket that would span two sections is split until each part names one (Q20). Whoever files the ticket runs the same check on its body.
Test: every open `build` issue's body passes the check.

**OM7. The merge check.** Until #45's commands exist, whoever merges runs this from a checkout of the PR head, and does not merge on exit 1:

```sh
s=$(gh pr view "$PR" --json body --jq .body | tr -d '\r' | sed -n 's/^Section: *\([a-z][a-z0-9-]*\) *$/\1/p' | sort -u)
[ "$(printf '%s\n' "$s" | grep -c .)" = 1 ] && jq -e --arg s "$s" 'any(.nodes[]; .id == $s and .note != true)' .work-map/flow.json >/dev/null || { echo "won't land: no single known Section line"; exit 1; }
```

The build machine's pre-check (BS6) posts it as its first step. Once `work-map sections` exists, the id list comes from it; once `work-map where` exists, the merge holds on its exit code instead. Changed files no section owns give a warning and a map gap, never a hold (Q33).
Test: the cases in OM5, on a body with Windows line ends too.

## Build tickets by section

Each build ticket's section is the Section column of "Tickets by section" in `docs/spec/build-tickets.md`. That table is the only copy, so the two docs can't drift (Q20, the build spec's reconciliation 28).

## The example project

`examples/demo/` holds `repo/.work-map/`, a byte copy of `.work-map/` at the recording; `github/`, the recorded answers with times as offsets (CF23); `seat-gauge/log.json`; `recording.toml`, with the commit, the instant and the counts; and `expected.json`. There is no `sites/`, because this repo serves no site, so the example's `versions` is `null`.

**OM8. The example reads its own copy.** The engine embeds `examples/demo/` and loads the copied config as if a settings entry pinned `roadmap` to `examples/demo/repo/` (CF20), whatever `files.source` says (CF22). The tab's id is `work-map` and its title "Work map" (CF21). Its links open this repo's real issues and PRs.
Test: with no `gh` and a fake GitHub that fails every request, the example opens with every part `current` and shows the sections of `examples/demo/repo/.work-map/flow.json`.

**OM9. One dev command refreshes it.** `cargo xtask example-refresh` runs one full read of this repo on the user's `gh` login, a small share of one hour's GitHub budget and no money. It records the answers, copies `.work-map/`, writes the Seat Gauge file, `expected.json`, the screen fixtures (S16) and the parity capture (OM12), all at one instant. A refresh is its own PR with `Section: config`, run before each release candidate or when the example looks stale, never in a hosted run. The PR's diff of `expected.json` is the human review.
Test: a refresh over a fake GitHub gives the same bytes twice, and CF24's checks pass straight after.

**OM10. Public data only, and small.** The recording keeps only the fields the census reads. Each login becomes `person-1`, `person-2` and so on in first-seen order, and bots become `bot-1` and so on. Bodies and comments keep only the lines the reference and declaration grammar reads (B07, B17): `Section:`, `Ticket:`, `Unit:`, closing keywords, issue references and the "Blocked by" list. The refresh refuses to write when the dump of the trimmed recording differs from the dump of the full answers, when any live login or an email address survives, or when the embedded copy passes CF24's 300 KB.
Test: each of the three refusals on a fake GitHub planted for it.

**OM11. Agents are illustrative.** The Seat Gauge file has one working session per open PR, up to three, and one session closed ten minutes before the instant on the newest merged PR's branch. Each sits on `machine-a` with workspace `work-map-<section>-seat1`, a one-word seat that splits from the right (Q15), and its token fields are empty. The screen labels each one as an example agent (Q17). With no open PR there are no working agents.
Test: a recording with two open PRs gives two working agents, each on its PR's section and labelled as an example.

**OM12. The parity capture is generated, then planted.** P25's old capture is written by the refresh from the dump, in the archive's served shape, through `crates/xtask/src/old_capture.rs`. A small plant list in `crates/parity/tests/` then adds the one KD-30 difference, one explained difference and one moved issue, and P26's planted bug. So a refresh never needs a capture written by hand.
Test: P25 and P26 pass straight after a refresh.

Rule cases this repo's history does not hold, such as a site three merges behind or a ticket closed with no reason, are built inline in each rule's own test over the fake GitHub (B04). The example is no longer the catalogue of cases. It shows the build's real state, which before release one means many unstarted cards.

## What happens to `docs/spec/example/`

`fixture.md`, `work-map.json` and `roadmap/` are deleted. `.work-map/` replaces them as the ticket-count example. `scope/` stays: RF10, RF11, RF15, RF17, RF18, RF19, RF25, RF26 and RF27 test against its files, and this repo has no scope-basis map. It remains fictional.

## Spec lines changed here

Patched because the example is now this repo:

- `config-v2.md`: the short answer's example line, the sample config line, the example's opening paragraph, CF21's id and title, CF22's site fetch, CF24's first sentence, the demo repo paragraph [Q7] and the note to #16.
- `roadmap-files.md`: the short answer's example line, the two "Example:" lines for the diagram and section map, the tests for RF12, RF20 and RF22, and the note to #16.
- `parity.md`: P25's capture.
- `build-spec.md`: [Q7], the two spec table rows, the crate map's example line and a new `.work-map/` line, the `xtask` budget row, BS5's PR body, and reconciliation 17.
- `build-tickets.md`: the intro's Section line, B18 and B20's fixtures, B56, B71, B72, B77's first line and B90's live check.
- `start-a-map.md`: the live check line.

## Notes for other tickets

- #16: every build issue gets its `Section:` line from the table in `build-tickets.md`. B56 is now the refresh command, blocked also by B22 (the live adapter); B71 and B72 add `expected.json`, the fixtures and the capture to it.
- #45: `work-map sections` and `work-map where` replace OM7's shell lines; the config's `seatGauge` takes the workspace pattern #45 settles.
- #15: this repo is a live check of `work-map start`; its proposal is compared by hand with `.work-map/`.
