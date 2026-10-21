# The Seat Gauge sessions file

> Draft. Moves to the seat-gauge repo when the Rust version takes that name. Seat Gauge owns this format.

Seat Gauge writes `log.json`, one snapshot of the agent sessions it can see. The work map reads it to put agents on its cards. Each tool works alone. When both are installed, this file is the only thing they share.

This spec is version 1, the format the Swift Seat Gauge writes today. The Rust Seat Gauge writes the same version 1, so the work map reads either one without a change.

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

## Reading the file

A reader opens the file, reads it whole, closes it at once, then parses. On Windows it opens with delete sharing so the writer's rename still works (Rust's `File::open` does this by default).

The reader refuses a file that is a symlink, is not a regular file, or is larger than 4,000,000 bytes. It also refuses one whose size or modified time changed during the read.

| Case | What the reader does |
| --- | --- |
| Folder or file missing | Seat Gauge is not installed or has not run yet. Show no agents and a quiet note. This is not an error. |
| File is not valid JSON, or fails the field rules below | Half-written or damaged. Treat this read as failed, keep the last good read, and try again next round. |
| `version` is missing or not a whole number | Damaged. Same as above. |
| `version` is higher than the reader knows | A newer Seat Gauge. Parse nothing else. Show no agents and say Seat Gauge is newer than this reader. Never guess at the fields. |
| `updated` older than 90 seconds, or more than 60 seconds ahead of the reader's clock | Stale. Rows may still be shown as last seen, but none counts as current. |
| `problems` not empty | The writer could not read some machines. Rows from those machines are not current; rows from other machines may be. |

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
| `stale` | true or false | yes | True when this row's last observation failed, so its token totals may be behind. It does not by itself change the row's status. |
| `model` | text | nullable | Model name the session runs, when known. |
| `effort` | text | nullable | Reasoning effort, when known. |
| `repo` | text | nullable | Repo label the writer read from the workspace label. A label, not a GitHub name; the reader maps it. |
| `section` | text | nullable | Section label the writer read from the workspace label. |
| `seat` | text | nullable | Seat label the writer read from the workspace label. |
| `branch` | text | nullable | The git branch checked out in the session's working folder. |
| `started_at` | time | nullable | When the session was first seen working. |
| `closed_at` | time | nullable | When the pane went away or its agent exited. Set exactly when `status` is `closed` or `superseded`. |
| `tokens` | token counts | nullable | Whole-session totals. Missing while totals are pending. |
| `usd` | number, 0 or more | nullable | List-price US dollars for the whole session. Missing when a model has no known price. |
| `models` | object | optional | Model name to token counts. The work map ignores it. |

Readers take `repo`, `section` and `seat` as written and never derive them again from `workspace`. A reader may still match its own patterns against `workspace`, as the work map does to find a ticket or PR number.

Token counts are an object with seven whole numbers, all required: `responses`, `input`, `output`, `thinking`, `cacheRead`, `cacheWrite5m`, `cacheWrite1h`. `thinking` is part of `output`, not added to it. The camel-case keys inside token counts are version 1 as written; they stay until a version 2.

### Statuses

`working`, `idle`, `blocked` and `done` come from herdr's agent status for the pane. `done` means a turn finished and the session is still open. Seat Gauge adds `closed` when the pane or agent is gone, and `superseded` when a placeholder row was replaced by the session's real id. `unknown` means herdr reported nothing usable.

A reader shows any status it does not know as text, and counts that row as not current.

## What the format leaves out

The file names herdr ideas (workspace, pane, agent status) and nothing tied to one OS. It holds no process ids, file paths, process arguments, prompts, commands or message content. Machine labels come from the writer's config, so a Mac, a Windows machine and a Linux machine all write the same shape.

Seat Gauge also writes `headroom.json` (seat windows), `machines.json` (machine load) and `spend.csv` beside this file. They are Seat Gauge's own files for agents and people, not part of this format. The work map reads none of them in release one. The old engine read `headroom.json` only for the Codex audit's seat cap, which is retired. A later reader that needs seat room gets it added to this spec first.

## Examples

`examples/` pins the format. The work map's tests read these files with the clock set to `2026-10-21T03:00:30Z`.

| File | What it shows | Reader result at the test clock |
| --- | --- | --- |
| `normal.json` | Three sessions on one machine: one working with totals and price, one idle with no known price, one closed. Nullable fields appear both as `null` and as missing keys. | Fresh. All three rows fresh; the closed one keeps its totals but is no longer an agent at work. |
| `empty.json` | Seat Gauge running with no sessions. | Fresh, no agents. |
| `future-version.json` | `version` 2 with a changed shape. | Refused as newer. No agents, "Seat Gauge is newer" note. |
| `stale.json` | A snapshot left behind when the app quit, with one machine failing. | Stale. Rows shown as last seen, none current. |
| `half-written.json` | A file cut off part way. Not valid JSON on purpose. | Read failed. Last good read kept. |

A missing file has no example: the test removes the file.
