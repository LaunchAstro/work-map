# When scoring runs and how scores are kept

> Release two. Resolves #39.

AI scoring (release two, from the maintainer's Q1 answer on #2) reads a section's code at one commit and returns a built share (`docs/spec/scoring.md`, SC ids). This doc fixes when that happens, how the queue behaves, where scores live, what makes one stale, and how scoring waits for the seat-cap guard and the GitHub budget.

Inputs: the Q1 answer, the old audit's lessons (`docs/review/old-audit.md`, OL ids, above all OL-06 and OL-14), the model research (`docs/research/model-invocation.md`, M ids), the seat-cap guard (`docs/spec/seat-cap-guard.md`, G ids), the GitHub budget (`docs/spec/github-budget.md`, B ids), the app layout (`docs/spec/app-layout.md`, L ids) and the build spec's `scores` seam. Marks such as (Q10) cite questions the maintainer settled on #2; Q10 to Q13 were agreed as recommended.

## The answer in short

- Scoring starts in three ways only: a deep audit the user confirms, a merge seen while the app is open, or "Score again" on one section. No timer, no nightly run, no Sync and no start-up ever queues it.
- A deep audit is offered when a map has no AI scores yet, and is on demand from the scoring line or `work-map score`. It always shows an estimate of calls, tokens and GitHub requests and waits for a yes.
- A merged PR touches its placed section plus every section that owns one of its changed files. Only those queue, once per merge commit, and a section already waiting is not added again.
- One queue in memory for every project, one call at a time, cancellable. It does not survive a restart. Sections a merge changed while nobody was scoring show as stale and are offered in one click.
- Each section's score is one JSON file in the data folder, written atomically, pinned to the commit read. A later merge touching the section makes it stale. Stale changes the tag and hover, never the bar.
- Before each section, scoring waits while the seat guard or the GitHub budget says wait. Scoring keeps 40% of the REST limit untouched, so polls and Syncs never go short.
- Turning scoring off cancels the queue and keeps every stored score, pinned and dated.

## When scoring runs

**SR1. Three starts, nothing else.** Scoring queues work only from a confirmed deep audit (SR2 to SR4), a merge seen while the app runs (SR5, SR6), or "Score again" and the stale offer (SR3, SR7). A poll that finds no merge, a Sync, a kick, a start-up, a settings change and a new `PROMPT_VERSION` queue nothing. The only timers are G9's 60-second re-check and the budget's reset wait (SR19), and they only resume entries already waiting (OL-14).
Test: a fake hour of polls with no merges, three Syncs, a kick and a restart start no CLI and send no tree or blob read.

**SR2. The deep audit is offered at setup, never started.** When scoring is ready (M3) for a project that has a section map (SC3) and no section with a pinned score, the scoring line offers "Score this map?" with SR4's estimate and two buttons, Start and Not now. Not now hides the offer until the app restarts. "Score the map" stays in the scoring line's menu.
Test: turning scoring on for the example project shows the offer and sends no model call until Start; after Not now the offer is gone and the menu item is there.

**SR3. On demand, in the window and on the command line.** In the window, the scoring line's menu has "Score the map" (every scoreable section, SC1), and each card's score hover has "Score again" (that section). On the command line:

```text
work-map score [--project ID] [--section ID]... [--yes]
work-map score --cancel [--project ID]
```

The command reads `instance.json` and sends op `score` over the control port (L17), with the project, up to 64 section ids (none means the whole map) and whether the user confirmed. With no copy running it prints "work map is not running" and exits 3, and nothing queues (as L18). With scoring off or not ready it prints the M9 line and exits 5. This makes `score` the binary's fifth entry (L2). The contract gains two calls, `score` and `cancel_scoring`, as Tauri commands and `POST /api/projects/{id}/score` and `/score/cancel` under L11's guard, and the capability file allows them (L13).
Test: `work-map score` with no app running exits 3; with scoring off it exits 5 and prints the off line; `--section editor --yes` queues one entry.

**SR4. Ask first, with an estimate.** A deep audit and any request for more than one section is two steps: the engine returns an estimate, then queues only on a yes. "Score again" on one section and merge re-scores do not ask. To estimate, the engine reads the head and tree (SC4, SC5), picks each section's files by SC6 and SC8 from the tree's sizes, and computes each input key (SC17) from paths, blob SHAs and ticket titles, with no blob read. The window and the CLI show the same line:

"Score 6 sections? 4 changed since their last score and need a call each (4 calls, at most 8 with retries, about 150,000 tokens of code). 2 are unchanged and will not be sent. Reading the files takes about 210 GitHub requests. Scoring sends each section's code to Anthropic under your plan's terms."

Tokens are bytes to send divided by 4, rounded to the nearest 10,000. Requests are the blobs not yet in B9's cache plus PR file pages. The line says "about" because a file dropped after reading (SC6, SC13) can change it. On a terminal the CLI then asks "Start? [y/N]". Off a terminal it queues only with `--yes`, and without it prints the estimate and exits 0 with nothing queued.
Test: the estimate for the example map names the right counts and makes exactly two GitHub requests; a piped `work-map score` without `--yes` queues nothing.

**SR5. Which sections a merged PR touched.** When a poll (B5) or a kick finds a PR newly merged into the default branch of the section map's `repo`, the touched sections are the section the board places it in (MC-26), when that section is scoreable (SC1), plus every section that owns one of its changed files (MC-53). Changed files come from `GET /repos/{repo}/pulls/{n}/files` pages through B9, read once per merged PR and never again. Shared and unowned paths touch nothing. A PR merged into another repository or branch touches nothing. A PR whose list GitHub cuts short (over 3,000 files) touches the owners of the files listed, and the scoring line adds "PR #n changed too many files to list in full. Score the map to be sure."
Test: a merge placed in `editor` that changes `src/storage/a.ts` and `README.md` touches `editor` and `storage` only; a merge into another branch touches nothing.

**SR6. Only those, once per merge commit, merged into one entry.** Each touched section joins the queue as one entry for its project. A section already waiting is not added again: its run reads the head when it starts, which holds every merge before it. A section whose run has already read its head when a new merge arrives queues once more. The engine keeps the merge commits it has queued since start, so B5's overlap re-reading a merge queues nothing. A touched section whose inputs have not changed at the new head gets no call (SR12).
Test: one poll finding three merges that touch `editor`, `editor` and `storage`, then `storage`, queues two entries; the next poll re-reading the same merges queues nothing.

**SR7. Merges while scoring could not run, and the stale offer.** A merge with a merge time before the app started, or found while scoring was off or not ready (SR20, SR21), queues nothing. Its sections only turn stale (SR16). When any section is stale, scoring is ready and nothing waits, the scoring line offers "3 sections changed since their scores. Score them?" with SR4's estimate.
Test: a first poll after start that finds two merges from the night before queues nothing, marks their sections stale and shows the offer.

## How runs happen

**SR8. Only while the app runs.** The queue lives in memory in the engine process. It drains with or without a viewer, which narrows L19 for scoring's own reads as G8 does for the Seat Gauge file. With no viewer polls stop (L19), so no merge adds work. Quitting kills a running call's process tree (M7) and writes nothing for it. There is no status file, lease, heartbeat or extra lock (OL-14); L15's instance lock already makes the engine the only writer.
Test: closing the last served page during a three-section audit still finishes all three; quitting during a call leaves no child process and no new score file.

**SR9. The queue does not survive a restart, on purpose.** After a restart nothing waits. A section a merge touched shows stale and joins SR7's offer. A section an audit had not reached keeps its old score. So a restart never undoes a cancel or starts calls the user did not see coming.
Test: quitting with four entries waiting and restarting starts no CLI; the merge-touched ones show stale and are in the offer.

**SR10. One call at a time, first in, first out.** One queue serves every project (M7). Entries run in the order they joined, each one project and one section. The M3 sign-in check runs when the queue goes from empty to busy and after every pause or Retry, not per section.
Test: audits of two projects asked for in turn run all of the first, then the second; a six-section audit runs the fake status command once.

**SR11. A run pins one head.** Entries of one project that run back to back form a run. The run reads the default branch head once (`GET /repos/{repo}/commits/{branch}` through B9) and the tree once, and every section in it reads that commit (SC4, SC5). A merge found during a run ends the run after its current section, and the next entry starts a new run at the new head.
Test: a merge that lands after the second of four sections gives the first three sections one SHA and the fourth the new one.

**SR12. Unchanged inputs get no call.** Before a call the engine computes SC17's input key. When it equals the stored score's key, no call goes out. The stored score keeps the commit the model read, and its `checked` commit moves to this head, which clears stale marks from merges before it (SR16). The hover adds "Unchanged at d4e5f6a."
Test: re-scoring `storage` after a merge that changed only `README.md` starts no CLI and moves `checked` to the new SHA.

**SR13. Cancel.** Cancel in the scoring line, or `work-map score --cancel`, empties the waiting entries, for one project or all, and kills the running call's process tree, writing nothing for it. Cancelled sections keep their scores. A later merge queues as usual. Cancel does not turn scoring off.
Test: cancel during the second of four calls leaves no child process, one new score file, and an empty queue.

## How scores are kept

**SR14. One file per section.** Each section's score is `projects/<id>/scores/<name>.json` in the data folder (L20), where `name` is the section id's letters, digits, `-` and `_`, then `-` and the first 8 hex of the id's SHA-256, so a file system that ignores case never merges two sections. The file holds the score SC17 lists, or null before the first success, the `checked` head (SR12) and the last failure (SC15). It keeps no history: a new score replaces the old one (SC20).

```json
{ "version": 1, "section": "editor",
  "score": { "built": 62, "reason": "Editing works; undo is a stub.", "commit": "a1b2c3d…", "head_read_at": "2026-10-21T03:00:30Z",
             "read_at": "2026-10-21T03:02:10Z", "files_read": 40, "files_owned": 52,
             "left_out": { "binary_or_generated": 3, "too_large": 2, "over_cap": 7 }, "partial": true,
             "cli": "claude", "model": null, "prompt_version": 1, "input_key": "9f2c…" },
  "checked": { "commit": "d4e5f6a…", "head_read_at": "2026-10-22T01:10:00Z" },
  "failure": null }
```

A section with units holds `units` in place of `built` and `reason`, as SC14's answer does. `failure` holds the raw answer (up to 64 KB), the cause and the time.
Test: scoring the example's `editor` writes one file of this shape, and its round trip through the reader gives the same view.

**SR15. Atomic writes, and a bad file never wedges scoring.** The engine writes a new temporary file in the same folder, flushes it to disk and renames it over the old one (MC-21), mode 600 on macOS and Linux. It writes each section's file as that section finishes, so a quit keeps every finished section. A file that fails to parse, or has a higher `version`, is renamed to `<name>.bad`, logged, and the section reads as never scored, with a scoring line naming the section. Files for sections no longer on the diagram are ignored.
Test: a fake crash between write and rename leaves the old file whole; a planted corrupt file is set aside and the other sections still show their scores.

**SR16. What makes a score stale.** A score is stale when a PR merged after its `checked.head_read_at` touches the section by SR5. The engine works it out from merges and file lists it has already read, at no call. A new score, or SR12's unchanged check at a newer head, clears it. Stale changes nothing in the maths: the bar keeps the score through the `scores` seam, and SC19's floor still rises with closed tickets.
Test: a score checked at 03:00 and a merge at 04:00 touching its section is stale; a merge at 02:59 is not; the bar's shares are the same either way.

**SR17. How stale shows.** The tag after the progress bar reads "AI 3d, stale". The hover adds "Changed since this read: #123, #130 and 2 more." with each PR linked, and the "Score again" button. The engine adds `stale: { prs, more } | null` and `checked_commit` to SC22's score note. The screen draws them and holds no age or count rule (S7, L8).
Test: the browser suite renders a stale card from a generated view and finds the tag and the PR list; a fresh card has neither.

## Pauses

**SR18. The seat guard.** The engine asks the guard before each section and again right before its call (G1). While it says wait, entries wait and G9 wakes them. Limits are G2's, 90% of the 5-hour window and 85% of the week, settable (Q10). With no guard (G7), Claude Code scoring runs with the quiet note (Q11). Codex scoring with no guard, or with the guard turned off, waits instead, and the line reads "Codex scoring needs Seat Gauge running. No seat guard: Seat Gauge isn't running." with G7's note, re-checked every 60 seconds as in G9 (Q13). Codex stays on offer with M1's warning that recommends Claude Code, and the release after a tools-off check (M10) shows a Codex command running drops Codex (Q12). M8's rate-limit pause waits beside the guard until its reset time.
Test: Claude Code with no Seat Gauge file sends its call with the note; Codex with no file sends nothing and shows the needs-Seat-Gauge line; writing a recent `seats` row starts it on the next check.

**SR19. The GitHub budget.** Scoring reads only REST: the head, the tree, blobs and PR file lists. They take their turn in B2's one-at-a-time line through B9's cache. Scoring has its own floor, 40% of the REST limit, above B10's 30%, so scoring never takes what a poll or Sync needs. Before each section the engine counts the reads it still needs (the head and tree at a run's start, plus blobs not cached) and waits while the remainder minus that count is under 40%. Waiting lasts until the reset plus 5 seconds and starts with `GET /rate_limit` (B10). B12's stop signals pause scoring too. The line reads "Scoring paused: GitHub budget low, 1,900 left. Resumes after 2:05 pm." A section waits while either the guard or the budget says wait.
Test: with 2,100 of 5,000 left and a section needing 150 blob reads, nothing goes out until the reset; a poll during that wait still runs.

## Turning scoring off, and not ready

**SR20. Off again.** Setting `ai_scoring.cli` to `off` does what Cancel does (SR13) and stops every start in SR1. Stored scores stay, pinned, tagged with their dates and still marked stale as merges land. Frozen scores do not come back (SC24). The guard line goes (G10). Turning scoring on again queues nothing: it shows SR2's offer when no section has a score, else SR7's when one is stale. Deleting a project's `scores` folder forgets its AI scores, and frozen scores show again.
Test: turning scoring off mid-audit kills the call and empties the queue, every stored score still shows "AI" with its age, and turning it on again shows the stale offer only.

**SR21. Not ready holds the queue.** In every M9 state but `ready` and `paused_limit`, nothing joins the queue and waiting entries hold. Merges in that time only mark sections stale (SR7). Retry runs M3 again and, on `ready`, resumes the held entries. A section that failed (SC15) is not tried again by itself; "Score again" is the way.
Test: a `signed_out` status holds three entries, a merge during it queues nothing, and Retry after signing in runs the three.

**SR22. The engine decides, the screen draws.** The view gains `scoring` per project: `state` (`off`, `idle`, `running`, `paused_seat`, `paused_budget`, `paused_limit`, `needs_seat_gauge` or `not_ready`), the line text, the running section and its start, the waiting count, and the offer (`setup` or `stale`, with its sections and estimate line) or null. The screen holds no 40%, 60-second or token constant.
Test: the view for SR19's case is `paused_budget` with 1 waiting; the screen code has no 40 or 0.4 constant.

## Notes for other tickets

- App layout: L2 gains `score` as a fifth entry, L17 an op `score`, the contract two calls (SR3), and L19 a narrowing for the scoring queue (SR8).
- #40, build tickets, roughly: triggers and touched sections (SR1 to SR7), about 220 lines; the queue, runs, cancel and pauses (SR8 to SR13, SR18, SR19, SR21), about 300; the store and staleness (SR14 to SR17), about 200; the CLI command, control op and contract calls (SR3, SR4), about 150; the scoring line, offer and stale tag on the screen (SR17, SR22), about 150.
- SC7 reads one blob per file. A deep audit of a large repository could spend a few thousand REST requests. One tarball read per run (`GET /repos/{repo}/tarball/{sha}`) costs one request; whether to use it is proposed as its own ticket.
