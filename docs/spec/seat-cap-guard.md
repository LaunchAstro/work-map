# The seat-cap guard

> Release two. Resolves #37.

AI scoring (release two, from the maintainer's Q1 answer on #2) runs one model through the user's own Claude Code or Codex subscription. The guard stops scoring from eating the seat the user's agents work on: it pauses scoring while Seat Gauge shows that seat near its 5-hour or weekly limit. It needs Seat Gauge. Without it, scoring runs and the window says there is no seat guard.

Inputs: settled decision 12 in #3 (Seat Gauge owns the shared file, each tool works alone), the shared file spec (`docs/seat-gauge-file/README.md`, whose `seats` list was added for this guard), the old engine's Codex seat cap (a weekly floor of 15% left, read from Seat Gauge's own `headroom.json`), and the screen rule that the engine computes and the screen only draws (S7, L8). The old cap's usage ledger and per-call token reserve stay retired, as the Q1 answer says.

## Where seat room comes from

Seat Gauge writes one row per seat into `log.json`'s `seats` list: the seat's label, its CLI, when it was read, and each window's percent used and reset time. It stays version 1, so a release one reader still reads the file. The file spec has the fields, the reading rules and the example `examples/seat-room.json`. The guard reads nothing else from Seat Gauge, and never `headroom.json`.

## The rules

Each rule has a test. The tests read the example files with the clock at `2026-10-21T03:00:30Z` and the default settings, unless the test says otherwise.

**G1. The guard gates scoring calls only.** The engine asks the guard before each scoring call, one section at a time, not once per run. A call already sent runs to its end; stopping it would waste what it spent. GitHub reads, Sync, agents on cards and every other part of the map ignore the guard.
Test: a deep audit of four sections where the seat crosses its limit after the second call sends exactly two calls and leaves two waiting; a Sync during the pause runs as usual.

**G2. Settings.** `settings.json` gains `seat_guard`, read in release two: `{ "on": true, "seat": null, "five_hour": 90, "weekly": 85 }`. Every key is optional, with those defaults. `seat` is a seat label or `null`. The two limits are whole numbers from 1 to 100, the percent used at which scoring pauses; 100 pauses only on a full window. A bad value is named in a settings line (CF2) and its default is used. With `on` false the guard is off: scoring runs and no guard line shows.
Test: `"five_hour": 120` gives a settings line naming it and pauses at 90; `"on": false` lets scoring run on `seat-a` with no guard line.

**G3. Which seat is the seat.** The scoring CLI is the one the user chose for scoring (#36), `claude` or `codex`. With `seat` set, the seat is the `seats` row with that label, compared exactly. With `seat` unset, the candidates are every row whose `tool` is the scoring CLI. One candidate is the seat. With several, the guard pauses if any candidate with a recent reading is near its limit, and the guard line asks the user to pick a seat in settings. Seat Gauge cannot tell which login the CLI uses, so the guard never guesses one.
Test: with `seat: "seat-d"` and Codex, scoring runs; unset with Codex, the candidates are `seat-b` and `seat-d` and scoring pauses on `seat-b`, with the pick-a-seat note.

**G4. Near its limit.** The seat is near its limit when its `five_hour` window's `used` is at or above `five_hour`, or its `weekly` window's `used` is at or above `weekly`. A window the row does not have cannot trip the guard. Other window names are ignored.
Test: `seat-a` pauses on its 5-hour window (92 against 90); `seat-b` pauses on its week (88 against 85); `seat-d` ignores its `weekly_model_x` at 99.

**G5. A window that has reset is empty.** A window whose `resets` time has passed counts as 0 used, whatever the reading said.
Test: `seat-d`'s 5-hour window at 97, reset at 03:00:00, does not pause scoring; at a clock of 02:59:30 it does.

**G6. Only recent readings count.** The guard judges a seat only on a recent reading, as the file spec defines it: `read_at` at most 15 minutes old and in a file updated at most 15 minutes ago. A failed read of the file keeps the last good read, under the same age rule. It never pauses for lack of a reading, because a pause that only a running Seat Gauge could lift would stop scoring with no sign of why.
Test: `seat-c` (read 40 minutes ago) and `seat-e` (never read) let scoring run with a no-recent-reading note; `seat-a` (read at 02:58:00) still pauses at a clock of 03:13:00, and at 03:13:01 runs with the note.

**G7. No seat guard, said quietly.** In these cases scoring runs and the guard line says why there is no guard. The note is quiet: grey text in the scoring line, no warning colour, no badge.

| Case | Note |
| --- | --- |
| No Seat Gauge folder or no `log.json` | No seat guard: Seat Gauge isn't installed. |
| `updated` more than 15 minutes old | No seat guard: Seat Gauge isn't running. |
| `version` higher than 1 | No seat guard: Seat Gauge is newer than this work map. |
| No `seats` key, or a bad one | No seat guard: this Seat Gauge doesn't share seat room. |
| No row for the named seat, or no row for the scoring CLI | No seat guard: Seat Gauge lists no seat named `seat-x` (or: no Claude seat). |
| The named seat's `tool` is not the scoring CLI | No seat guard: `seat-x` is a Codex seat, and scoring uses Claude. |
| The seat has no recent reading (G6) | No seat guard: no recent reading for `seat-x`. |

Test: one test per row, built from the example files (`normal.json` for no `seats` key, `future-version.json`, `stale.json` with the clock 20 minutes on, a removed file, and `seat-room.json` with `seat` set to `seat-f`, `seat-a` under Codex, and `seat-c`).

**G8. The guard reads the file itself.** Before each scoring call the guard reads `log.json` once, by the shared file's reading rules (MC-56), even when L19 has stopped the agents part for want of a viewer. It reads nothing else and runs no program. A read that fails keeps the last good read (G6).
Test: with no viewer and a queued section, the engine reads `log.json` exactly once before the call; a symlinked `log.json` is refused and the last good read decides.

**G9. While paused.** The waiting sections stay queued in order (#39 owns the queue and cancel). The guard reads the file again every 60 seconds while anything waits, and scoring resumes on the first read where the seat has room or the guard no longer applies (G7). A deep audit or a merge re-score asked for during a pause joins the queue. There is no "run anyway" button: the user raises a limit or turns the guard off in settings.
Test: rewriting the file with `seat-a` at 85% resumes scoring on the next 60-second check, and no sooner; an on-demand audit during the pause adds its sections to the queue and sends nothing.

**G10. What the screen shows.** While paused, the scoring line reads, for example, "Scoring paused: seat-a has used 92% of its 5-hour window. Resumes after 3:00 pm." (05:00 UTC on a map set to +10:00) and below it "2 sections waiting". The reset time shows in the map's time zone (config `timeZone`, else the computer's). Section bars keep their last scores with the dates and commits they were read at; nothing on a card changes because of a pause. When scoring runs with a guard and room, the line shows nothing extra; its hover gives the seat and both windows ("seat-a: 5-hour 42%, week 61%"). With scoring off, which is the default, no guard line shows at all.
Test: the browser suite renders a paused view from `seat-a` and finds the line, the waiting count and unchanged section bars.

**G11. The engine decides, the screen draws.** The engine sends the guard's state in the view: `off`, `clear`, `paused` or `unguarded`, with the seat label, the window that tripped, its percent used, the reset time and the note text. The screen formats the time and draws; it holds no threshold or age constant (S7, L8).
Test: the screen code has no 90, 85 or 15-minute constant; the view for `seat-b` under Codex is `paused` on `weekly` at 88 with reset `2026-10-23T09:00:00Z`.

**G12. The same on every OS.** The guard uses only the shared file, the clock and settings. It runs no OS command, reads no CLI login file and holds no per-OS path beyond the shared file's folder rules.
Test: the guard tests above run in the hosted test job on macOS, Windows and Linux.

## Results for the example

`seat-room.json` at the test clock, default limits:

| Setting | Result |
| --- | --- |
| Claude, `seat` unset | Paused on `seat-a`'s 5-hour window; pick-a-seat note (`seat-c` and `seat-e` have no recent reading) |
| Codex, `seat` unset | Paused on `seat-b`'s week; pick-a-seat note |
| `seat-a` / `seat-b` | Paused, 5-hour / week |
| `seat-d` | Clear |
| `seat-c` / `seat-e` | Unguarded, no recent reading |
| `seat-f` | Unguarded, no seat of that name (its row is dropped) |

## Notes for other tickets

- #36: the guard needs the scoring CLI's name, `claude` or `codex`, as the seat rows write it.
- #39: the queue, cancel and "one run at a time" are yours; the guard only answers "send this call now or wait" and wakes the queue (G9). The GitHub budget pause sits beside it, and a call waits while either says wait.
- #40: build ticket, about 250 lines of Rust plus tests: the `seats` reader in the Seat Gauge module, the guard, the settings keys and the view state. About 40 lines of screen.
- Seat Gauge (#20): the writer needs `seats` in `log.json`. Until a Seat Gauge writes it, the guard says "doesn't share seat room" and scoring runs.
