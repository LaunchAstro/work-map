# The example project's fixture

An outline of `examples/demo/`, the example the binary carries (CF21 to CF24 in `../config-v2.md`). It is fictional: a small notes app built in one repository, `LaunchAstro/work-map-demo`. The build ticket writes the files; this outline fixes what they must hold, so that one first open shows every part of the map and the tests can pin each case.

## Files

```text
examples/demo/
├── work-map.json          the config, as ../example/work-map.json
├── roadmap/
│   ├── flow.json          the diagram: three stages, seven sections, wires
│   └── section-map.json   path globs per section, shared paths, one map issue
├── github/                recorded answers, one file per request, times as offsets
├── sites/                 the recorded build file and home page of the one site
└── seat-gauge/log.json    a Seat Gauge version 1 file, times as offsets
```

Every recorded time is an offset from one reference instant, written `T-3h12m`. The recorder and the replaying adapter belong to the `github` module's build ticket; the offset form is fixed here (CF23). The fixture also records a full GraphQL and REST budget of 5,000 each, so the header shows no budget line.

## The diagram

| Stage | Section | What the card shows |
| --- | --- | --- |
| Foundations | `accounts` | Every ticket done: the purple card |
| Foundations | `storage` | Work under way: one open PR in the merge queue, one blocked ticket, one dropped |
| Features | `editor` | A built spec, an agent working, an absorbed ticket, bugs open and fixed |
| Features | `sharing` | Tickets placed through a map issue, one waiting on `editor` |
| Features | `search` | Nothing started: the warm grey, dotted card |
| Launch | `docs` | A planning section, built by a docs-only PR; waits on `editor` by a configured arrow |
| Launch | `release` | A ticket closed with no reason, so its count is pending |

Wires run stage to stage. The configured dependency draws `editor` to `docs` dashed.

## Issues

| # | What | Placed by | Case it covers |
| --- | --- | --- | --- |
| 1 | `Map: Work map demo`, label `map` | | The map step on every card |
| 2 | `Map: Sharing`, label `map`, parent of 4 and 20 to 23 | section map's `maps` entry | Parent-map placement (MC-27) |
| 3 | `Spec: Editor`, label `spec`, members 10 to 12 | `area:editor` | Spec built by completed closes (MC-46) |
| 4 | `Spec: Sharing`, label `spec`, open | parent 2 | Spec step open; its spec document is missing |
| 5 to 8 | Accounts work, all closed as completed | `area:accounts` | A finished section |
| 9 | Storage work, done | `area:storage` | |
| 13 | Storage work, open, named by open PR 60 | `area:storage` | Next up's "in a PR" group |
| 14 | Storage work, open, blocked by 13 | `area:storage` | Next up's blocked group (MC-62) |
| 15 | Storage work, closed as not planned | `area:storage` | Dropped, stays in the total (MC-30) |
| 10 to 12 | Editor work, done | `area:editor` | |
| 16 | Editor work, open, named by open PR 61 | `area:editor` | An agent on a card |
| 17 | Editor work, closed as duplicate, comment "Absorbed into #16" | `area:editor` | Absorption (MC-31) |
| 18, 19 | Bugs, label `bug`; 18 open, 19 fixed | `area:editor` | Bugs counted apart (MC-32) |
| 20 | Sharing work, done | parent 2 | |
| 21 | Sharing work, open, label `ready` | parent 2 | Next up's unblocked group |
| 22 | Sharing work, open, blocked by 16 | parent 2 | A "waits on" arrow to `editor` (MC-63) |
| 23 | A question, label `question` | parent 2 | Left out of the counts, listed |
| 24, 25 | `Search: index notes`, `Search: ranking`, open | title prefix | An unstarted card |
| 26 | `Docs: getting started`, open | title prefix | |
| 27 | `Release: first tag`, open | title prefix | |
| 28 | `Release: changelog`, closed with no reason | title prefix | A pending count (MC-38) |
| 29 | A ticket with no label, prefix or closing PR | | "Not on the map" |
| 30 | A ticket whose body says `Section: storage` | Section line | |
| 31 | A ticket the config overrides to `outside` | config `issues` | Outside the plan |
| 32 | A ticket closed by merged PR 67 only | closing PR | The closing-PR second pass (MC-28) |

## Pull requests

- About 24 merged PRs: 14 in the last 12 hours, spread unevenly so the clock-hour chart has tall, short and empty bars, and one merge exactly on an hour boundary (KD-02); the rest over the three weeks before. Each closes or names a ticket above. Half carry a formal approval on their last head, so the Review bar is partly reviewed.
- 60, open, closes 13, approved, first in the merge queue.
- 61, open, closes 16, branch `wm/16-editor-toolbar`, label `ready-to-merge` (the loading bay's ready).
- 62, open draft, names nothing: an unplaced PR.
- 63, open, `Ticket: none`: outside the plan (KD-23).
- 64, merged, changes only `docs/getting-started.md`, `Section: docs`: ticks the build step in a planning section (MC-29).
- 65, merged, changes `scripts/release.sh`, which no section owns: one map gap.
- 66, closed without merging: pending in the loading bay, no inferred drop.
- 67, merged, `Section: sharing`, `Closes #32`.
- The last three merges come after the site's build, so the site shows 3 behind.

## The section map

Globs per section under `src/<section>/**`, `docs/**` for `docs` and `.github/**` for `release`; `README.md` and `package.json` shared. `scripts/` is owned by nobody, which gives PR 65's gap. `maps` places issue 2's children in `sharing`.

## Agents

One machine, labelled `machine-a`, with four sessions, all inside the 90-second window after each read (CF23):

- working on `wm/16-editor-toolbar` in workspace `work-map-demo`: on `editor`, through PR 61;
- idle on `wm/21-share-links`: on `sharing`, through ticket 21;
- closed ten minutes ago on `wm/13-wal`: shown dimmed on `storage`;
- working under a repository label the config does not map: one anonymous agent.

## The site

`https://demo.example.com` serves `/build.json` and a home page meta tag `build`, both naming the same 12-character revision, an ancestor of main with three merged PRs after it.

## Expected numbers

The header should show about half the work tickets done, two bugs with one fixed, one question, one ticket not on the map and one outside. The exact counts become `examples/demo/expected.json`, written by the engine once the fixture exists, reviewed by hand, and checked by a test from then on. A change to the fixture changes that file in the same PR.
