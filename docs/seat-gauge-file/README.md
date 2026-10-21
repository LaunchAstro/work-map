# The Seat Gauge sessions file

> Draft. Moves to the seat-gauge repo when the Rust version takes that name. Seat Gauge owns this format.

Seat Gauge writes `log.json`, one snapshot of the agent sessions it can see and of the room left on each seat. The work map reads it to put agents on its cards, and from its release two to pause AI scoring when the scoring seat is near its limit (`docs/spec/seat-cap-guard.md`). Each tool works alone. When both are installed, this file is the only thing they share.

This spec is version 1, the format the Swift Seat Gauge writes today. The Rust Seat Gauge writes the same version 1, so the work map reads either one without a change. Seat room, the top-level `seats` list, joined version 1 on 21 October 2026 as an added field (#37). A writer that predates it leaves the key out, and a reader that predates it ignores the key, as the version rules below allow. Attribution joined version 1 the same way on 21 October 2026 (#7): `workspace_pattern` at the top says how `repo`, `section` and `seat` were read from each workspace label, and `pr` in a row gives the PR the session is working on.

## Where the file lives

One folder per user, named by the app identifier `com.launchastro.seatgauge`:

| OS | Folder |
| --- | --- |
| macOS | `~/Library/Application Support/com.launchastro.seatgauge/` |
| Windows | `%LOCALAPPDATA%\com.launchastro.seatgauge\` |
| Linux | `$XDG_DATA_HOME/com.launchastro.seatgauge/`, or `~/.local/share/com.launchastro.seatgauge/` when `XDG_DATA_HOME` is unset or empty |

These are Tauri's local app-data folders for that identifier, so a Tauri build gets them without extra code. Windows uses the local folder, not the roaming one, because the file describes one machine.

`SEAT_GAUGE_DIR` overrides the folder on every OS. When it is set and not empty, the writer and every reader use it as the folder, as is. Tests and side-by-side builds use it. A development build may write under a suffixed identifier such as `com.launchastro.seatgauge.dev`; readers never look there unless `SEAT_GAUGE_DIR` points at it.

The folder should be readable by its owner only (mode 700 on macOS and Linux), because rows carry workspace and branch names.

## Writing the file

- Write the whole file on every round, every 30 seconds, even when nothing changed. `updated` moving forward is the heartbeat.
- Write atomically. Write the new content to a temporary file in the same folder, flush it to disk, then rename it over `log.json`. Never write `log.json` in place.
- On Windows the rename replaces the old file (Rust's `std::fs::rename` does this). If the rename fails, delete the temporary file and try again on the next round.
- Leave `log.json` in place when the app quits. Readers see it go stale.
- Encode as UTF-8 JSON with no byte order mark. Write times in UTC with a `Z` suffix.
- Stay under the reader limits below. Drop the oldest closed rows first if a file would pass them.
- Split every workspace label with the user's pattern (see workspace labels below) and write that pattern as `workspace_pattern`.
- Write `pr` only from the evidence named under PR evidence below. Never guess one from a workspace label or a ticket number; that is the reader's job.
- Write `seats` from the seat readings the writer already holds. Seats are read on their own, slower schedule, so most rounds copy the same readings again. Filling `seats` must never start a model turn or any other read that costs the seat usage.

## Reading the file

A reader opens the file, reads it whole, closes it at once, then parses. On Windows it opens with delete sharing so the writer's rename still works (Rust's `File::open` does this by default).

The reader refuses a file that is a symlink, is not a regular file, or is larger than 4,000,000 bytes. It also refuses one whose size or modified time changed during the read.

| Case | What the reader does |
| --- | --- |
| Folder or file missing | Seat Gauge is not installed or has not run yet. Show no agents and a quiet note. This is not an error. |
| File is not valid JSON, or fails the field rules below (seat room aside: a bad `seats` value or seat row drops alone) | Half-written or damaged. Treat this read as failed, keep the last good read, and try again next round. |
| `version` is missing or not a whole number | Damaged. Same as above. |
| `version` is higher than the reader knows | A newer Seat Gauge. Parse nothing else. Show no agents and say Seat Gauge is newer than this reader. Never guess at the fields. |
| `updated` older than 90 seconds, or more than 60 seconds ahead of the reader's clock | Stale. Rows may still be shown as last seen, but none counts as current. |
| `problems` not empty | The writer could not read some machines. The check is per machine (TN-42): only rows whose `machine` is a key in `problems` stop being current. Rows from other machines, and the file's freshness, are judged as if `problems` were empty. |

How long a reader keeps showing stale rows is its own choice. The work map shows last-seen agents for 15 minutes after `updated`, then none.

## Versions

`version` is a whole number at the top of the file. A reader handles only the versions it knows.

Within version 1 the writer may add new fields, at the top or in a row. Readers ignore fields they do not know. Anything that would break a version 1 reader needs version 2: removing or renaming a field, changing its type or meaning, or adding a status that changes what `closed_at` means. When the Rust Seat Gauge needs version 2, it writes version 2 and the work map gains a reader for it before that release ships.

## Fields

"Required" means the key is always present with a value of the stated type. "Nullable" means the key may be missing or `null`, and both mean "not known". Text fields hold at most 512 characters. Times are ISO 8601 with an offset; readers accept any offset and fractional seconds.

### Top level

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `version` | whole number | yes | Format version, `1` here. |
| `updated` | time | yes | When the writer finished this snapshot. |
| `sessions` | array of rows | yes | At most 5,000 rows. May be empty. Newest start first, though readers must not rely on order. |
| `problems` | object | yes | Machine label to a message, for each machine whose last read failed. May be empty. Messages are for people at that machine; readers must not republish them. |
| `workspace_pattern` | text | nullable | The pattern every row's `repo`, `section` and `seat` were read with. See workspace labels below. Missing means the writer did not say. |
| `seats` | array of seat rows | optional | Seat room, one row per seat in the writer's config. At most 100 rows. Missing means this writer does not share seat room; empty means it shares it and has no seats. See below. |

### Session row

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `machine` | text, not empty | yes | Label of the machine the session runs on, as the writer's config names it. |
| `session_id` | text, not empty | yes | The agent's own session id. `machine` plus `session_id` is the row's key and is unique in the file. |
| `workspace` | text | yes | The herdr workspace label. May be empty. |
| `pane` | text | yes | The herdr pane id. |
| `tool` | text | yes | The agent CLI, such as `claude` or `codex`. |
| `status` | text | yes | See statuses below. |
| `as_of` | time | yes | When the writer last observed this session. Never later than `updated`. |
| `stale` | true or false | optional | True when this row's last observation failed, so its token totals may be behind. It does not by itself change the row's status. The Swift Seat Gauge still writes it on every row, because its own reader requires it, so writers keep writing it in version 1. Readers must not require it (TN-66); the work map ignores it. |
| `model` | text | nullable | Model name the session runs, when known. |
| `effort` | text | nullable | Reasoning effort, when known. |
| `repo` | text | nullable | Repo label the writer read from the workspace label with `workspace_pattern`. A label, not a GitHub name; the reader maps it. |
| `section` | text | nullable | Section label read the same way. One word under the default split (Q15). Only the repo-label fallback can give one with hyphens, such as `S0-1f` from an older label. |
| `seat` | text | nullable | Seat label read the same way. |
| `branch` | text | nullable | The git branch checked out in the session's working folder. |
| `started_at` | time | nullable | When the session was first seen working. |
| `closed_at` | time | nullable | When the pane went away or its agent exited. Set exactly when `status` is `closed` or `superseded`. |
| `tokens` | token counts | nullable | Whole-session totals. Missing while totals are pending. |
| `usd` | number, 0 or more | nullable | List-price US dollars for the whole session. Missing when a model has no known price. |
| `pr` | PR evidence | nullable | The PR the session is working on, and how the writer found it. See PR evidence below. |
| `models` | object | optional | Model name to token counts. The work map ignores it. |

### Workspace labels

The writer's user sets the pattern; the default is `<repo>-<section>-<seat>`. A pattern holds `<section>` once, may hold `<repo>` and `<seat>` once each, and has literal text, such as `-`, between any two of them. It may also have literal text before the first or after the last.

Section ids and seat names are one word, with no hyphens (Q15, settled through Q20). So a label splits from the right, and the writer splits each one like this:

1. A cut places the pattern's literal text in the label and leaves no part empty. A label with no cut gets `repo`, `section` and `seat` all null.
2. The default split fills the parts from the right. Each part takes as little of the label as it can, and the leftmost one takes the rest, hyphens included. Under the default pattern the seat is the last word, the section the word before it, and the rest is the repo.
3. The repo-label list is a fallback for older labels only, written before section ids lost their hyphens. When the user lists repo labels and the pattern holds `<repo>`, a label whose step 2 repo is not on the list, but which has a cut whose repo is a listed label, takes that cut instead: the longest listed label that fits is the repo, the parts after it fill from the right as in step 2, and the part next to the repo takes what is left, hyphens included. A label that fits no listed label keeps its step 2 split.

Seat names come from the writer's config, so the writer warns its user about a seat name that is not one word, because a label naming it splits the wrong way.

`web-app-board-seat2` gives repo `web-app`, section `board` and seat `seat2` with no list. The older label `web-app-S0-1f-seat1` gives repo `web-app-S0` and section `1f` by step 2; with `web-app` listed, the fallback gives repo `web-app`, section `S0-1f` and seat `seat1`.

The Swift Seat Gauge writes no `workspace_pattern`. It splits on every hyphen: the last piece is the seat, the one before it the section, and the rest the repo. That is step 2 under the default pattern, so with one-word ids and seat names it gives the same result. It has no list and no pattern setting, so an older label with a hyphenated section is cut short.

Readers take `repo`, `section` and `seat` as written and never derive them again from `workspace`, with `workspace_pattern` or otherwise. A reader uses the pattern to explain a placement or a "Not placed" reason, and may warn when it differs from the pattern the project expects. It may still match its own patterns against `workspace`, as the work map does to find a ticket or PR number.

### PR evidence

`pr` is an object, one PR per row:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `repo` | text, not empty | yes | The PR's GitHub repository as `owner/name`. Unlike the row's `repo`, a GitHub name, not a label. |
| `number` | whole number, 1 or more | yes | The PR number. |
| `url` | text | nullable | The PR's web address, when the writer has it. |
| `source` | text | yes | How the writer found the PR. |

Sources, strongest first:

- `branch`: an open PR whose head branch is exactly the row's `branch`, in the repository the session's working folder pushes to, so a fork never matches (the rule in MC-58).
- `herdr`: herdr reported the PR for the pane or its workspace.
- `agent`: the agent reported it in its own output, such as its hand-back line.

When the evidence names more than one PR, the writer keeps the one from the strongest source and leaves `pr` out if two from that source disagree. A closed row keeps its `pr`, so it still says what it made. The Swift Seat Gauge reads the branch from git in the session's working folder but knows no PR, so it writes no `pr`.

Reading `pr`:

- `pr` is evidence, not proof. A reader uses it only when the PR is in its own PR list for one of the project's repositories. When the reader's own branch match (MC-58) finds a different PR, the reader's match wins.
- A source the reader does not know is shown as text and ranks below `agent`. A writer may add sources within version 1.
- A bad `pr` (not an object, a missing `repo` or `source`, a `number` that is not a whole number of 1 or more) drops alone; the row reads as usual.
- The work map's placement layer 3, who made it, ties a PR to a session through `pr` or its own branch match, and takes the section from the row's `section`.

### Token counts

Token counts are an object with seven whole numbers, all required: `responses`, `input`, `output`, `thinking`, `cacheRead`, `cacheWrite5m`, `cacheWrite1h`. `thinking` is part of `output`, not added to it. The camel-case keys inside token counts are version 1 as written; they stay until a version 2.

### Seat room

The writer puts every seat its config names into `seats`, read or not, so a reader can tell a seat with no reading from a seat that does not exist. A seat's windows are account-wide, so seat rows carry no `machine`, and `problems` does not touch them.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `seat` | text, not empty | yes | The seat's label in the writer's config. Unique in the list. When a workspace label names this seat, the session rows' `seat` uses the same label. |
| `tool` | text | yes | The CLI the seat signs in to, in the session rows' words: `claude` or `codex`. |
| `read_at` | time | nullable | When the writer took the windows below. Missing until the seat has been read. Never later than `updated`. A seat whose last read failed keeps its last windows and their `read_at`, so the age tells the reader how old they are. |
| `windows` | object | nullable | Window name to a window. Missing or empty when `read_at` is missing. |

A window is an object with two required fields: `used`, a whole number from 0 to 100 giving the percent of the window used, and `resets`, the time the window starts again. Version 1 names two windows, `five_hour` and `weekly`, each written only when the seat's provider reports it. The writer may add other names, such as a window that one model has to itself. Readers ignore names they do not know.

A seat row holds no account, address, plan, token file or login path. The seat label is the only name in it.

Reading seat room:

- A bad `seats` value, one that is not an array, drops `seats` alone. The sessions and the rest of the file read as usual.
- A seat row that breaks a rule above (a missing `seat` or `tool`, a `read_at` that is not a time, a `used` outside 0 to 100) is dropped alone, as is a bad window inside an otherwise good row. Two rows with the same `seat` are both dropped.
- A seat reading counts as recent when its `read_at` is at most 15 minutes old and not more than 60 seconds ahead of the reader's clock. The file's own 90-second freshness rule is for sessions, not seat room: a file can be stale for agents while its seat readings are still recent. A file whose `updated` is more than 15 minutes old means Seat Gauge is not running, and none of its seat readings counts as recent.
- A window whose `resets` time has passed has started again since the reading. A reader counts it as 0 used.

### Statuses

`working`, `idle`, `blocked` and `done` come from herdr's agent status for the pane. `done` means a turn finished and the session is still open. Seat Gauge adds `closed` when the pane or agent is gone, and `superseded` when a placeholder row was replaced by the session's real id. `unknown` means herdr reported nothing usable.

A reader shows any status it does not know as text, and counts that row as not current.

## What the format leaves out

The file names herdr ideas (workspace, pane, agent status) and nothing tied to one OS. It holds no process ids, file paths, process arguments, prompts, commands or message content. Machine labels come from the writer's config, so a Mac, a Windows machine and a Linux machine all write the same shape.

Seat Gauge also writes `headroom.json` (seat windows), `machines.json` (machine load) and `spend.csv` beside this file. They are Seat Gauge's own files for agents and people, not part of this format, and the work map reads none of them. The old engine read `headroom.json` for the Codex audit's seat cap, which is retired. Seat room now comes through `seats` in this file, because settled decision 12 has the two tools share one file. `seats` is a smaller copy of the same readings: no plan, no `left` (it is 100 minus `used`), and no stale flag, since `read_at` gives the age and readers must not depend on a writer's flag (TN-66).

## Examples

`examples/` pins the format. The work map's tests read these files with the clock set to `2026-10-21T03:00:30Z`.

| File | What it shows | Reader result at the test clock |
| --- | --- | --- |
| `normal.json` | Three sessions on one machine: one working with totals and price, one idle with no known price, one closed. Nullable fields appear both as `null` and as missing keys. The closed row leaves out `stale` (TN-66). `workspace_pattern` is the default; the working row has a PR found by branch, the idle row a `null` `pr`, and the closed row a PR the agent reported. | Fresh. All three rows fresh; the closed one keeps its totals but is no longer an agent at work. |
| `empty.json` | Seat Gauge running with no sessions. | Fresh, no agents. |
| `future-version.json` | `version` 2 with a changed shape. | Refused as newer. No agents, "Seat Gauge is newer" note. |
| `one-machine-failing.json` | A fresh snapshot from two machines, one of them in `problems` (TN-42). | Fresh. The working row on the healthy machine is current; the failing machine's row is shown as last seen, not current. |
| `stale.json` | A snapshot left behind when the app quit, with one machine failing. | Stale. Rows shown as last seen, none current. |
| `half-written.json` | A file cut off part way. Not valid JSON on purpose. | Read failed. Last good read kept. |
| `seat-room.json` | One working session and six seat rows: a Claude seat past 90% of its 5-hour window, a Codex seat past 85% of its week, a Claude seat read 40 minutes ago, a Codex seat whose high 5-hour window reset at 03:00 and which carries a window name readers do not know, a Claude seat never read, and a Codex seat whose `read_at` is not a time. | Fresh, one agent. Five seat rows: `seat6` is dropped alone. `seat1`, `seat2` and `seat4` have recent readings; `seat3` and `seat5` have none. `seat4`'s 5-hour window counts as 0 used. The seat-cap guard's results for this file are in its spec. |
| `attribution.json` | Three sessions under the default pattern. One is the fallback case: the older label `web-app-S0-1f-seat1`, split with `web-app` on the repo list into the hyphenated section `S0-1f`, with a PR found through herdr. One has the one-word section `board`, split from the right with no list, and a PR with a source readers do not know. One has a label that fits no cut, so `repo`, `section` and `seat` are null, and a `pr` whose `number` is text. | Fresh, three rows. The first places in section `S0-1f` with PR 57. The second's source shows as text and ranks below `agent`. The third has no section, and its bad `pr` drops alone. |

The first six files have no `seats` key, and only `normal.json` and `attribution.json` carry `workspace_pattern` and `pr`. A file without them looks like a writer from before 21 October 2026: a reader finds no seat room, no pattern and no PR evidence.

A missing file has no example: the test removes the file.
