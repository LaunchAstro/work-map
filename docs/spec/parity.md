# Parity harness

How we prove the old TypeScript engine and the Rust engine show the same numbers on every card of the maintainer's two live maps, so switch-over can happen. The same comparison runs on the example project as an ordinary test. Resolves #13.

Inputs: the settled decisions in #3 (15 and 17), the known-differences seed KD-01 to KD-39 in `docs/spec/must-carry-over.md`, the view contract and `work-map dump` in `docs/spec/app-layout.md` (L2, L10, L15), the budget rules in `docs/spec/github-budget.md` (B2, B8, B11), what the old screen reads (TN-29 in `docs/review/thermonuclear.md`), the architecture review's notes on frozen inputs and the recorded adapter, and how the private archive's engine serves its answers today. The switch-over question on #2 was settled by the maintainer as recommended in batch one; items resting on it are marked (Q4). The scope bar has three shares, not four (Q3).

## The answer in short

- A comparison happens inside a window on the always-on build machine. Its operator pauses the old engine's sweeps, re-checks and five-minute GitHub timer, runs one full read on the old engine, and resumes them afterwards. The harness itself never starts, stops or writes to the old engine.
- The old side is a read-only capture: the files the old engine's servers already answer with, fetched over loopback with plain `GET`s, plus each Seat Gauge file version seen during the capture.
- The new side is `work-map dump`. It runs one full read into an empty data folder, builds every view at the old capture's moment, and writes one parity record. It opens no port, so the old engine keeps port 4317.
- A dev-only `parity` tool turns the old capture into the same record shape and compares the two, card by card and field by field.
- A card passes when it matches, or differs only in fields that a listed KD id covers, with a reason (Q4). A difference caused by GitHub changing between the two reads is "moved" and is checked again in the next run.
- Switch-over needs three clean runs on three different days, on one Rust engine commit, covering every card of both live maps.

## Words used here

- **Card.** One unit of comparison, named `<map id>/<card id>`. Each diagram section is a card under its section id. The map also has `header`, `stage:<id>`, `merges` (merge panel and clock-hour chart), `bay` (loading bay), `gaps`, `agents` and `site:<host>` cards.
- **Field.** A path inside a card's record, such as `tickets.left`, `scope.display.live` or `next_up[2]`.
- **Window.** The stretch of time from pausing the old engine's jobs to resuming them.
- **Run.** One window's capture, dump and comparison. Its id is the window's start time in UTC, such as `2026-11-02T01:00Z`.

## The window

**P1. Old jobs that move numbers are paused.** For the whole window the old engine's scheduled sweep, nightly full sweep, model re-checks and five-minute GitHub timer do not run. Its server and agents collector keep running. This keeps the model-written files still (KD-37) and the old answers from moving while the new engine reads. Pausing and resuming is the operator's step (see "Steps on the build machine"); the harness only checks it.
Check: the harness reads the old data folder's job log times, read-only, and voids the run when any paused job started inside the window.

**P2. Both engines make a full read inside the window.** The old engine's GitHub collector runs once in its full-read mode for each live map after the jobs are paused. The new engine reads into an empty data folder, so its first Sync is a full read (B8). A run with either read incomplete is void (KD-32, MC-16).
Check: the old run log marks each map's last GitHub run complete and full, started after the window opened; the dump's Sync outcome is `complete` and its read is full; otherwise the harness exits 2 with the reason.

**P3. One engine reads GitHub at a time.** The old full read finishes, the capture is taken, and only then does the dump start. The two engines never have requests open together, in the spirit of B2.
Check: the dump starts after the old run log's end time, and the report records both times.

**P4. The budget holds for two full reads.** The window opens only when both of the user's pools (REST and GraphQL) have at least 60% of their limit left. Either read that stops at its reserve (B11) voids the run. The report records each engine's spend, the old from its run log and the new from `SyncOutcome.spent`.
Check: with the fake GitHub reporting 2,900 of 5,000 left, the harness refuses to start; with a dump stopped at the reserve, the run is void and nothing is compared.

**P5. Both engines read the same inputs.** The new engine's project configs point at a roadmap checkout at the same commit the old snapshot records in its sources. Its frozen inputs [Q1] are copies of the model-written files as they stood when the window opened. The new engine reads the Seat Gauge file copy that P7 picks, through the shared file's override variable.
Check: a commit mismatch or a frozen input whose hash differs from the old data folder's file voids the run.

**P6. A window lasts at most two hours.** A longer one is void, so a forgotten pause cannot leave the old engine frozen for days. The report's last line always says whether the old jobs still need resuming.
Check: a capture taken 2 hours and 1 minute after the window opened gives a void run.

## The old side

**P7. The capture is a read-only copy of what the old servers answer.** For each live map the harness sends plain `GET`s on loopback for the map, agents, site versions and tabs files, the same answers the old screen polls. It never calls the old Sync route or any other `POST`. It writes them into `capture/<run id>/old/<map id>/` with a manifest of each file's fetch time, byte size, SHA-256 and the time the old engine stamped on it. Every 5 seconds during the capture it also keeps a copy of the Seat Gauge file under its `updated` stamp, and picks the copy that the old agents answer was built from.
Check: the harness's HTTP client refuses any method but `GET` and any host but `127.0.0.1`; a capture with no Seat Gauge copy matching the old agents answer retries for up to 2 minutes, then voids the run.

**P8. One adapter turns the old capture into a parity record.** It reads only the parts TN-29 lists as read by the old screen, plus the agents, site versions and tabs files. Retired fields are skipped. Where the old screen worked figures out itself (AR-07), the adapter repeats the old screen's rule, so the record holds what the maintainer saw: the twelve clock-hour bars from merged PR times at the panel's read time, stage averages and de-duplicated stage review, the ticket recount that dropped a layer to pending, and Seat Gauge freshness.
Check: each repeated screen rule has a test built from the old screen's own cases, described in the test by what it checks; a card the old screen would show as pending comes out of the adapter as pending.

## The new side

**P9. `work-map dump` writes the parity record.** `work-map dump --as-at <instant> --agents-at <instant> [--project ID]... --out <file>`. It runs one Sync per project, builds each `MapView` with the view clock set to `--as-at` (the old map answer's stamp) and the Seat Gauge read time set to `--agents-at` (the old agents answer's stamp), then maps every view to the record and exits. It runs with `WORK_MAP_DIR` set to an empty folder, so it takes its own instance lock (L15) and touches nothing else. It opens no port. Exit codes: 0 written, 2 usage, 5 read incomplete.
Check: a dump over the recorded adapter with a fake clock writes the same bytes twice; a dump whose Sync stops at the reserve writes no record and exits 5.

**P10. Viewing the new engine by eye uses another port.** When someone wants to look at the new map beside the old one during a window, they run `work-map serve --port <free port>` on the dump's data folder after the dump ends. Port 4317 belongs to the old engine until switch-over (L10).
Check: `serve` on 4317 while the old engine holds it exits 4, as L10 says.

**P11. One record shape for both sides.** The record is JSON: `{ "parity": 1, "engine": "rust" | "archive", "commit", "as_at", "maps": [{ "id", "read": { "complete", "full", "started_at", "finished_at" }, "cards": [{ "id", "fields": { ... } }] }] }`. Field names follow the view contract, not the old snapshot. The record lists the repository-qualified key and `updatedAt` of every item behind a card, so P15 can tell drift from a bug. The Rust types live in the `parity` crate, which depends on `engine` and is never part of a release download.
Check: both the adapter's and the dump's output pass one schema test, and `cargo tree` for the release binary lists no `parity` crate.

## Comparing

**P12. Cards pair by id, on both maps.** A card on one side only fails as `card missing` on the other. Maps pair by project id.
Check: a dump missing one section gives one `FAIL ... card missing` line for it.

**P13. What is compared.** Each section card: its state and pending reason, the scope display shares and the raw fractions behind them (three in the new engine, Q3; an old built-but-unmerged share above 0, or a section the old engine held pending for its open PRs, is a KD-31 difference), the Tickets bar (completed, total, absorbed, dropped, unknown, left), weighted built and live, days left, the Review bar's line counts, state and PR lists, open PRs, placed PRs, blockers, Next up, the planning checklist, missing steps and spec documents. The map cards add the header totals, stage bars, unplaced PRs, the merge panel's figures and queue, the twelve bars, the loading bay, map-gap count and paths, each site's revision and merge distance, and each agent row's identity, place, state and token totals.
Check: a fixture that changes each listed field by one gives exactly one `FAIL` line naming that field.

**P14. What is not compared.** Read and build times, ages, stamps, notes, hover wording, budget figures, the placement step that put a PR somewhere (only the section it lands in counts), layout and camera, and every retired field.
Check: two records differing only in these fields compare clean.

**P15. Exact, with three tolerances.** Counts, display shares, lists and states must be equal. Raw fractions may differ by at most 1e-9, for floating-point order between the two languages. Times compare as UTC instants to the second (KD-01). Days left compares as its shown value, "<1 day" or a whole number. Repository keys compare ignoring case (MC-01).
Check: fractions 0.3 and 0.30000000000000004 match; 0.3 and 0.3000001 fail; `Owner/Repo#7` matches `owner/repo#7`.

**P16. Order counts only where the screen fixes it.** Stages, sections, Next up, the twelve bars and the merge queue compare in order. Every other list compares as a set sorted by key.
Check: Next up with two rows swapped fails; open PRs in a different order match.

**P17. Drift is "moved", not a failure.** When a field differs and any item behind it, on either side, has an `updatedAt` later than the old full read's start, or a site's served revision differs between the two reads, the field is `MOVED`. A moved card is not counted as compared in that run.
Check: a fixture where one issue closes between the reads gives `MOVED` naming that issue, and the run can still be clean.

## Known differences

**P18. One list, keyed by KD id.** `parity/known-differences.toml` holds one entry per KD row in `docs/spec/must-carry-over.md`, with its TN or B ids, a one-line reason, and the field patterns it may excuse. Rows marked "No" in the KD table excuse no number field. KD-18 and KD-34, marked "lists only", excuse only their lists. A new deliberate fix gets the next KD id in the must-carry-over list first, then an entry here. Nothing else excuses a difference.
Check: an entry whose id is not in the must-carry-over table, or a "No" row naming a number field, fails the list's own test.

**P19. Each excused difference names its KD id and its reason (Q4).** Some KD entries carry a mechanical test, and the comparator applies those by itself: KD-02 (a merge exactly on an hour boundary), KD-30 (a PR the old engine placed by its lane) and KD-39 (a read exactly on the hour). Every other excuse is a line in the run's `explanations.toml`: card, field, KD id and a reason for this case, such as "PR 812 had only a lane placement". The comparator rejects an explanation whose KD entry does not cover that field.
Check: a planted KD-30 difference passes with no explanation line; an explanation naming KD-12 for a `next_up` field is rejected.

**P20. Stale explanations fail.** An explanation that matches no difference in the run makes the run fail, so old excuses cannot hide a later change.
Check: a run with one unused explanation line exits 1.

## The report

**P21. One line per difference, then a summary.** The text report goes to stdout and `capture/<run id>/report.txt`, and the same content to `report.json`. Each line names the result, card, field, both values and any KD id:

```text
FAIL   main/build   tickets.left          old=12 new=11
KNOWN  main/build   open_prs              old=[#812] new=[]  KD-30 "PR 812 had only a lane placement"
MOVED  main/merges  queue.length          old=3 new=2        item=owner/repo#815 updated 01:12:40Z, after 01:10:00Z
run 2026-11-02T01:00Z  maps=2  cards=148  match=139  known=7  moved=2  fail=0  clean
old jobs paused since 01:00Z: resume them now
```

Values longer than 80 characters are cut in the text and kept whole in the JSON. Exit codes: 0 clean, 1 any `FAIL`, 2 void.
Check: the example project's planted mismatch gives exactly the `FAIL` line above, with exit 1.

**P22. Runs are kept.** Every run keeps its capture, both records, explanations and report under `capture/<run id>/` on the build machine. It is outside the repo, because it holds the maintainer's private data.
Check: the harness refuses an output folder inside a git checkout.

## The switch-over rule

**P23. Three clean runs (Q4).** A run is clean when no card fails. Switch-over needs three clean runs in a row, on three different days, all on one Rust engine commit. Every card of both live maps must be compared, not moved, in at least two of the three. A void run neither counts nor breaks the streak. A failing run resets it. A new engine commit starts a new streak.
Check: the `parity streak` command reads the kept reports and prints `ready` only for such a sequence; with one card moved in two of three runs it prints which card still needs a run.

**P24. Switch-over is still the maintainer's call.** `ready` means the numbers agree. The maintainer decides when to retire the old engine's jobs and give port 4317 to the Rust app.
Check: none; this is a process rule.

## The example project test

**P25. The harness is an ordinary test too.** `cargo test -p parity` runs the dump code as a library over the example project (#11), the recorded GitHub adapter, a fake clock and the Seat Gauge example files. It compares against a hand-written old capture for the same project, written fresh in the archive's served shape, MIT, with no private data. That capture carries one KD-30 difference, one difference covered by an explanation file and one moved issue, so the test runs every result type.
Check: the test passes on a clean checkout with no network, no old engine and no GitHub login, on macOS, Windows and Linux.

**P26. A planted bug must fail it.** A second fixture changes one ticket's state in the old capture.
Check: the comparison exits 1 with one `FAIL` line naming that card and `tickets.left`.

## Steps on the build machine

Written for whoever runs the window. The private companion runbook (see Notes) names the jobs and ports.

1. Check both GitHub pools are at 60% or more (P4).
2. Pause the old engine's sweep, nightly full sweep, re-checks and five-minute GitHub timer. Leave its server and agents collector running. Note the time: the window is open.
3. Run the old GitHub collector once in its full-read mode for each live map, one after the other.
4. Run `parity capture`, then `work-map dump` with an empty `WORK_MAP_DIR`, then `parity compare`.
5. Resume every paused job, even when the run was void.
6. Write `explanations.toml` for any unexplained difference that a KD entry covers, and run `parity compare` again on the same capture. That second compare spends no GitHub budget.

## Notes for other tickets

- #11: project config v2 must let the dump point at a roadmap checkout and a frozen-input folder, so P5 can pin both.
- #7's override variable for the Seat Gauge file is what P5 and P9 rely on.
- The build tickets add `crates/parity` (capture, adapter, compare, streak) and the `dump` entry from L2.
- A private companion runbook on the archive should name the old engine's jobs, the two live maps' loopback ports and how to pause and resume each. It is not written yet.
