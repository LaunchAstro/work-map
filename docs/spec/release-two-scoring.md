# Release two: AI scoring

> Release two. Part of #40.

This doc gathers release two's decisions in one place and adds what the build needs on top of the four release-two specs: AI placement of PRs (layer 4), how a deep audit reads code, the checks run by hand before each release, the release number, the reconciliations and the line budget. The build tickets are R01 to R41 in the "Release two" section of `docs/spec/build-tickets.md`.

Inputs: the maintainer's Q1 answer on #2 (release two's scope), the [batch two attribution answers](https://github.com/LaunchAstro/work-map/issues/2#issuecomment-6308898124) (layer 4), the [batches three to five answers](https://github.com/LaunchAstro/work-map/issues/2#issuecomment-6309343311) (Q10 to Q14, Q20), the [batch six answers](https://github.com/LaunchAstro/work-map/issues/2#issuecomment-6314707858) (Q21 to Q23), `docs/spec/scoring.md` (SC ids), `docs/spec/scoring-runs.md` (SR ids), `docs/spec/seat-cap-guard.md` (G ids), `docs/research/model-invocation.md` (M ids), `docs/review/old-audit.md` (OL ids), `docs/spec/placement.md` (PL ids), `docs/spec/build-spec.md`, `docs/spec/build-tickets.md`, `docs/spec/own-map.md` and GitHub's REST docs on repository archives, read on 21 October 2026.

## The answer in short

- Release two ships as `v2.0.0`, the maintainer's call (Q22). R14's semver default would make it `v1.2.0`, since nothing here breaks (RT12).
- AI placement takes step 11 of the PR ladder. A PR that steps 1 to 10 leave Not placed gets at most one guess per head commit. The model reads its title, body and changed file paths and names one section from the project's list, or "cannot tell". The placement is marked guessed and never lands in `where` (RT1 to RT6).
- A deep audit reads code one blob at a time, as SC7 says. It never downloads a repository archive (RT7).
- Files that look like they hold a secret are never sent (RT8). The old audit had this check, and the score spec had dropped it.
- Before each release the maintainer runs the tools-off proof for each CLI on each OS (RT9). Before release two is tagged, the maintainer scores this repo twice at one commit and records the spread. The gate is settled: no section moves more than 20 points and at most one flips between a score and "cannot tell", or the prompt is fixed first (RT10, OL-13, Q23).
- 41 tickets in 13 batches, about 11,550 lines of change with tests. Shipped code comes to about 2,790 lines, inside the maintainer's 2,000 to 3,000 target. That is a sizing estimate: there is no line ceiling, and release two keeps everything planned (RT11, Q21).
- There is no new section. The two new engine modules, `model_cli` and `scoring`, fall to `service` under `crates/engine/**` (OM2), so Q20 holds as it stands.

## Where each decision lives

| Area | Spec | Rule ids | Tickets |
| --- | --- | --- | --- |
| Running one model read-only on the user's plan | `docs/research/model-invocation.md` | M1 to M10 | R05, R09, R23, R39 |
| What a score is, the prompt, the answer, the bar | `docs/spec/scoring.md` | SC1 to SC25 | R06, R08, R11 to R14, R16, R21 |
| When scoring runs, the queue, the score files | `docs/spec/scoring-runs.md` | SR1 to SR22 | R07, R15, R16, R19 to R22 |
| The seat-cap guard and seat room | `docs/spec/seat-cap-guard.md`, `docs/seat-gauge-file/README.md` | G1 to G12 | R02, R03, R10, R15, R21 |
| Lessons from the old audit | `docs/review/old-audit.md` | OL-01 to OL-17 | named per ticket |
| AI placement, reading code, release checks, budget | this doc | RT1 to RT13 | R01, R04, R11, R17, R18, R20, R23, R24, R39 to R41 |

## AI placement, layer 4

Settled by the maintainer (Q2, revised): the AI reads a PR's title, description and changed files and proposes a section, marked as guessed. It runs with AI scoring and follows the same rules. PL7 reserved step 11 for it.

**RT1. When a guess is asked for.** A guess runs only while scoring is `ready` (M9). It is for an open or merged PR in one of the project's `repos` that steps 1 to 10 leave Not placed. A PR gets at most one guess per head commit. A stored guess for the PR's current head is reused, and a push that moves the head makes the PR eligible again. Closed unmerged PRs are never guessed. PRs already Not placed when scoring turns ready, or when the app starts, are never sent on their own. SR2's setup offer and "Score the map" add them, and SR4's estimate counts them. After that, a PR that turns up Not placed at a head the engine has not seen since start queues one guess without asking, as a merge re-score does. This is the one start SR1 did not list.
Test: with scoring ready, a Sync that finds a new open PR naming nothing and changing one unowned file queues one guess; the next Sync queues none; a push queues one more; twelve Not placed PRs present at start appear only in the offer's count.

**RT2. What the model is given.** The PR's title (at most 256 characters), the first 8 KB of its body cut at a line end, and the paths of up to 300 changed files with "and N more". All of it comes from the census, so a guess makes no GitHub read. The section list follows, in diagram order: each section's id, title and text, plus its owned globs when the project has a section map, cut at 32 KB. Notes (RF10) are left out. The fixed instructions live in the binary under their own `PLACE_PROMPT_VERSION`. They say the PR text is untrusted (OL-16) and ask for the one section the work belongs to, or "cannot tell". The PR text and paths sit inside SC13's nonce markers. A PR whose text holds the call's nonce is not sent.
Test: a PR with a 20 KB body sends 8 KB of it; the system text for two projects is byte for byte the same; a planted nonce sends nothing and leaves `no_guess`.

**RT3. The answer.** `{ "section": "editor", "reason": "Changes the undo stack." }`. `section` is an enum of the ids sent plus `"cannot_tell"`, and `reason` is 1 to 200 characters after trimming, in SC14's strict-mode shape. SC15's refusal rules and M9's one retry apply. After a second refusal the engine stores no guess. It keeps the raw answer and the cause on the PR's entry, and the PR stays Not placed.
Test: an id not sent, an empty reason and prose around the JSON are each refused and retried once; two misses keep the cause and leave `no_guess` naming it.

**RT4. What a guess places.** Step 11 places the PR in the guessed section with `layer: 4`, `rule: "ai_guess"`, `guessed: true` and `inferred: true`. The evidence reads `AI guess at a1b2c3d: <reason>`, at most 200 characters (PL1). Step 11 runs after steps 1 to 10, so it never overrides layers 1 to 3 or a frozen guess. A PR that later gains a Section line, a ticket or an owned file places by that step, and its stored guess stays unused. A `cannot_tell`, a failure, or a guess naming a section no longer on the diagram places nothing. Each leaves `no_guess` with a detail such as "AI could not tell: <reason>". Tickets placed through a guessed PR inherit `guessed` (PL9). The hover reads "Layer 4, AI guess, 3 days ago: <reason>" with the guessed tag (PL11). A guess never lands under `where` (PL16). `where` never calls a model and never reads stored guesses (PL21), so it answers `no_guess` there.
Test: a PR guessed into `search` that then gains `Section: editor` places in `editor` by step 1; a merged PR with a frozen placement places by step 10 and is never sent; `where` on a guessed PR gives `wont_land` with `no_guess`.

**RT5. The same rules as scoring.** A guess is one entry on the scoring queue (SR10), in order with section entries. It uses the one CLI that `ai_scoring` names (M1), the same arguments and tools-off guards (M5 to M8), and the seat guard before the call (G1, SR18). Cancel, off and not ready treat it as they treat a section (SR13, SR20, SR21). A layer-4 placement, frozen or AI, touches no section for SR5's re-scoring. Only steps 1 to 9 and owned files do.
Test: a guess waits behind a running section and behind a seat pause; Cancel drops it; a merged PR placed by a guess, with no owned files, queues no section.

**RT6. Where guesses are kept.** `projects/<id>/guesses.json` in the data folder: `{ "version": 1, "guesses": { "acme/app#57": { "head", "section", "reason", "read_at", "cli", "model", "prompt_version", "failure" } } }`. It is written atomically and set aside when bad, as SR15 says. Each write drops entries for PRs the census no longer holds. It keeps no history. Deleting the file forgets every guess.
Test: a guess round-trips through the file; a corrupt file is renamed `.bad` and the PRs read as never guessed.

## Reading the code

**RT7. Blob reads, no archive.** A deep audit reads file contents one blob at a time (SC7) and never asks for a repository archive. The reasons, by budget and size:
- SC8 picks files from the tree's sizes before any read. Reads per section are bounded by the 360 KB cap, not by the size of the repository: about 90 at a typical 4 KB a file. A 30-section map's first audit is at most about 2,700 reads, under one hour of scoring's share of a 5,000 limit. SR19 makes a larger audit wait for the reset rather than take what polls need.
- Blobs are kept by SHA and never read twice, so a merge re-score reads only the files that changed.
- An archive holds the whole repository, not the few MB the caps send. GitHub answers the request with a redirect to a download link, which lasts five minutes for a private repository and must be fetched without the token. With the repository's LFS archive setting on, the archive holds large files where the tree holds pointers, so each file would need checking against its blob SHA. Reading it needs gzip and tar, about 150 more lines that buy nothing the blob reads lack (Q21).

When SR4's estimate needs more reads than scoring has above its 40% floor, its line adds "This waits for GitHub's hourly reset about N times."
Test: the estimate for a fake tree needing 3,500 reads at 5,000 left says it waits once; no code path requests `tarball` or `zipball`.

**RT8. Secret-shaped files are not sent.** After reading, the engine leaves out a file whose text holds a private key block (`-----BEGIN` followed by `PRIVATE KEY-----` on the same line) or a token with a fixed prefix: `ghp_`, `gho_`, `ghu_`, `ghs_`, `github_pat_`, `sk-ant-`, `xoxb-`, `xoxp-`, or `AKIA` followed by 16 capitals or digits. The file counts in Y as `left_out.secret_shaped`, and the hover's left-out line adds "1 may hold a secret". The list is fixed in the code, like SC6's. The old audit refused the whole prompt (OL-16); dropping only the file keeps the rest of the section scoreable.
Test: a source file holding a planted `ghp_` token is not in the prompt, is counted, and is named in the hover; a file mentioning `ghp_` with no token after it is sent.

## Crates and modules

| Path | Section | What release two adds | Tickets |
| --- | --- | --- | --- |
| `engine/src/model_cli/` (new) | `service` | Finding the CLI, the sign-in check, the child environment, one call with tools off, stream guards, the optional shim reader | R05, R09, R23 |
| `engine/src/scoring/` (new) | `service` | Prompt, schema and answer check, file picking and the input key, one section's read, the guess call, the queue, starts, staleness, the estimate | R06, R11, R16, R17, R19, R20 |
| `engine/src/{contract,view,engine}/` | `service` | Score note, scoring and guard state, the two calls; the queue hosted in the service | R08, R19, R21, R22 |
| `server/`, `app/` | `service` | Two routes, the capability, the control op, the `score` entry | R22 |
| `engine/src/seat_gauge/` | `placement` | Seat rows and the guard | R03, R10 |
| `engine/src/placement/` | `placement` | Step 11 | R18 |
| `engine/src/github/`, `store/` | `github` | Head, tree and blob reads; keyed JSON files | R04, R07 |
| `engine/src/config/`, `scores/` | `config` | The two settings keys; the pinned adapter | R02, R12 |
| `engine/src/progress/` | `progress` | The floor note | R13 |
| `web/src/` | `screen` | Tag, hover, scoring line, offers, Cancel | R14, R15 |
| `crates/xtask/` | `tooling` | Release two's line estimate rows (Q21), the tools-off proof, the spread report | R01, R24 |

Config v2 gains nothing: scoring needs `files.sections`, which it already has (SC3).

## Settings

`settings.json` gains two optional keys, both read only from `v2.0.0` (Q22). An older app names them as unknown and ignores them (CF2). There is no settings screen. The user edits the file (CF1), and the scoring line shows M3's result with M1's line.

| Key | Default | Rules |
| --- | --- | --- |
| `ai_scoring` | `{ "cli": "off", "model": null }` | M1: `off`, `claude` or `codex`; a model name passed unchanged |
| `seat_guard` | `{ "on": true, "seat": null, "five_hour": 90, "weekly": 85 }` | G2: whole numbers from 1 to 100; `seat` a seat label or null |

## Screen and contract

- The progress bar gains `score: ScoreNote | null` (SC22), with `stale` and `checked_commit` (SR17) and `left_out.secret_shaped` (RT8).
- `MapView` gains `scoring` (SR22), holding the guard's state (G11).
- Two calls, `score` and `cancel_scoring`, as Tauri commands and as `POST /api/projects/{id}/score` and `/score/cancel` (SR3). `score` answers with an estimate, or queues when `confirmed` is set.
- PR placements use PL1's fields as they are. Layer 4 adds no field.
- `contract` stays `1`: every change is additive.
- The screen draws the tag and hover (SC23, SR17, RT4) and the scoring line with its offers, waiting count, guard line, Retry and Cancel (SR2, SR7, SR22, G10, M9). It holds no cap, age or threshold (S7).

## Checks before a release

**RT9. The tools-off proof, every release.** Before each release from `v2.0.0` on (Q22), and whenever the version floor moves, the maintainer runs `cargo xtask tools-off-proof --cli claude` and `--cli codex` on macOS, Windows and Linux, each signed in to a plan. The command runs M10's canary through the engine's own invocation (M5, M6) and passes only on M10's four checks. The release ticket records each CLI, version, OS and result. A Claude Code failure holds the release. A Codex run in which a command ran drops Codex in the next release (Q12); any other Codex failure holds the release. M2's floor moves to the newest version that passed, in its own PR. CI never runs the proof, because it has no plan login.
Test: the command over a fake CLI that writes `made.txt` fails, and over one that answers in text passes.

**RT10. The score spread on the example.** Before release two is tagged, the maintainer scores this repo's own map, the example project (Q16), twice at one commit with each CLI on offer. Each run goes into a new scratch data folder, so SR12 skips nothing. `cargo xtask score-spread A B` refuses two folders read at different commits. It prints each section's and unit's two shares, the spread in points, every outcome that flipped between a share and `cannot_tell`, and the largest and median spread. The report goes on the ticket and in the release notes. The release goes ahead when no spread passes 20 points and at most one outcome flips. Otherwise the prompt is fixed, `PROMPT_VERSION` goes up and the check runs again. The maintainer agreed this gate (Q23). Scoring stays off by default either way.
Test: the command over two planted folders prints the table, and exits 1 at 21 points or at two flips.

**RT12. Release two is `v2.0.0`.** It adds two settings keys, one command, two calls and two kinds of file in the data folder. It changes no existing setting, command line, exit code or folder name, so R14's semver default would make it a minor bump, `v1.2.0`. The maintainer chose `v2.0.0` over that default (Q22). R14 still governs every later release. The tag follows `v1.1.0` (R41 waits for B90).

**RT13. The `.exe` behind an npm shim, optional.** When M2 finds only an npm `.cmd` shim on Windows, the engine reads the shim's text for its package folder and looks in that package for one native `<cli>.exe`. It runs that file only when it exists, passes the version floor and passes M3. It never runs `cmd.exe` or Node. Without it, M2's `cli_missing` line stands.
Test: a fake shim whose package holds `codex.exe` finds it; one that points at a `.js` file gives `cli_missing` with the shim line.

## Line budget

Shipped code, counted as the build spec counts it, tests and CSS aside:

| Part | Lines | Tickets |
| --- | --- | --- |
| `service`: `model_cli` | 360 | R05, R09 |
| `service`: `scoring` | 1,090 | R06, R11, R16, R17, R19, R20 |
| `service`: contract, view, engine service | 260 | R08, R21, R22 |
| `service`: server and app | 130 | R22 |
| `placement`: seat rows, guard, step 11 | 260 | R03, R10, R18 |
| `github`: git reads, keyed files | 210 | R04, R07 |
| `config`: settings, pinned adapter | 150 | R02, R12 |
| `progress`: floor | 40 | R13 |
| `screen` TypeScript | 290 | R14, R15 |
| Release two | 2,790 | all of the above |
| Optional `.exe` finder | 80 | R23 |
| CSS | 60 | R14, R15 |

**RT11. No ceiling, estimates only.** The maintainer dropped the line ceiling (Q21): the 20,000 figure was a rough guess, not a limit. At `v2.0.0` the work map comes to about 20,810 lines of code, or 22,230 counting CSS, and those figures size the work. Nothing waits on them and nothing fails on them. Release two keeps everything planned: Codex scoring, the `score` command line and control op, AI placement, per-unit shares and stale marks. R01 adds release two's rows to `cargo xtask lines`, which prints estimates against actuals and never exits 1 on size (BS3).
Test: R01's fixture trees, as BS3's.

## Reconciliations

Dated 21 October 2026. Items 13 and 14 were revised, and 18 added, the same day for the batch six answers. "Patched" marks a line changed in the PR that added or revised the item because it had become plainly wrong. "Owed" marks a line left for the named ticket. The rest are additions, applied in the tickets named.

1. From the score contract (#38): SC22 adds a `score` note (commit, files read and owned, reasons, floor) to the progress bar, beyond the shares and date the `scores` seam promised (build spec reconciliation 31). `contract` stays `1`. R08, R21.
2. From when scoring runs (#39): `score` joins L2's entries. SR3 called it the fifth entry, which was written before `where`, `sections` and `start`. Patched SR3 and its note. L2 already names it. R22.
3. From when scoring runs (#39): the control port gains op `score`, with `cancel` for `work-map score --cancel` (L17). Patched L17. R22.
4. From when scoring runs (#39): the contract gains `score` and `cancel_scoring`, and the capability file allows them (L13), beside `v1.1.0`'s two (build spec reconciliation 14). Patched L13. R22.
5. From when scoring runs (#39): L19 narrows. The scoring queue drains with no viewer (SR8) and the guard reads the Seat Gauge file with no viewer (G8). Polls stay stopped. Patched L19. R19.
6. Settled here: SC7's blob reads stay, and there is no archive read (RT7). Patched SR's tarball note. R04, R20.
7. Found here: placement guesses are a start SR1 did not list (RT1). Patched SR1. R20.
8. Found here: the seat guard gates every model call, guesses included (RT5, G1). R19.
9. Found here: a layer-4 placement touches no section for SR5 (RT5). R20.
10. From the old audit (OL-16): the secret check that SC6 left out returns as RT8. `left_out` gains `secret_shaped` (SC22, SR14) and the hover a line (SC23). Patched SC6's last sentence. R08, R11, R14.
11. From the maintainer (Q16): scoring.md's note on the demo repository's files is spent, since this repo is the example. SC10's no-code case is built inline in its own test. Patched the note. R11.
12. From the seat guard (#37) and the model research (#36): `settings.json` gains `ai_scoring` and `seat_guard`. Owed: config-v2's settings sample, in R25.
13. From the maintainer (Q22): release two is `v2.0.0`, over R14's semver default of `v1.2.0` (RT12). Patched RT12, the settings line, RT9 and the release-two tickets. R41.
14. From the maintainer (Q21): there is no line ceiling, and release two's about 2,790 lines are a sizing estimate (RT11). The cut list is gone. Patched the build spec's line budget and BS3, which now only reports. R01.
15. Found here: `where` never reads guesses, so PL21 holds, and a PR the map guessed answers `no_guess` there (RT4). R18.
16. Found here: `model_cli` and `scoring` fall to `service` under OM2's broad glob, so the section map gains no section (Q20). Every ticket.
17. Patched: the build ticket plan's line saying release two's tickets are not in it.
18. From the maintainer (Q23): RT10's gate is settled as recommended. R40.

## Questions for the maintainer, settled

All three were answered on #2 in batch six, 21 October 2026. Nothing here waits on the maintainer.

1. **The 20,000 line ceiling (Q21).** Settled: no ceiling. The 20,000 figure was a rough guess, not a limit. Release two keeps everything planned, and the line estimates stay for sizing only (RT11, BS3). This differs from the recommended answer, a 23,000 ceiling.
2. **The version number (Q22).** Settled: `v2.0.0`, the maintainer's call over the semver default of `v1.2.0` (RT12). This differs from the recommended answer.
3. **How much wobble is acceptable (Q23).** Settled as recommended: two runs at one commit, no section moves more than 20 points, at most one flips between a score and "cannot tell", or the prompt is fixed before the tag (RT10).
