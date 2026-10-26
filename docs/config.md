# Config reference

This page lists every file the work map reads to draw a project, and every field in them. The examples come from Kettle, the made-up tea shop in `examples/demo/`. For installing and scheduling the collectors, see [the README](../README.md#use-it-on-your-own-project).

## Files

A project keeps its config in its own roadmap repository. Each running map also has a data folder on the machine that runs it. The data folder holds what the collectors write, plus two optional files you add by hand.

| File                           | Lives in           | Needed | What it holds                                                                       |
| ------------------------------ | ------------------ | ------ | ----------------------------------------------------------------------------------- |
| `project.json`                 | roadmap repository | yes    | Repositories, file names, labels and optional features.                             |
| diagram (`files.flow`)         | roadmap repository | yes    | Stages, section cards and the wires between them.                                   |
| audit (`files.audit`)          | roadmap repository | yes    | Weighted build units and how far each one is built. May be empty.                   |
| units table (`files.plan`)     | roadmap repository | yes    | A Markdown table of units and the ticket IDs in each. May be empty.                 |
| PR mapping (`files.mapping`)   | roadmap repository | no     | Hand-approved placements for merged PRs and switch-on issues.                       |
| section map (`files.sections`) | roadmap repository | no     | Which source paths each section owns, and which map issues belong to which section. |
| `maps.json`                    | data folder        | no     | Tabs that link several local maps.                                                  |
| `versions.config.json`         | data folder        | no     | Public sites whose served build is compared with the product repository.            |

The collectors take `--project` (the path to `project.json`), `--repo-root` and `--data`. Every path inside `project.json` is resolved against `--repo-root`. Without `--repo-root`, paths are resolved against the folder that holds `project.json`. The data folder defaults to `.data` in the tool's own folder.

Kettle's roadmap folder looks like this:

```
examples/demo/roadmap/
  project.json
  flow.json
  audit.json
  units.md
  mapping.json
  section-map.json
```

Kettle counts tickets, so its audit, units table and mapping are empty. A project can start the same way and add weighted units later.

## project.json

The file is checked when a collector starts. A value of the wrong shape stops the collector with an error that names the field.

Unknown keys are dropped without a warning at the top level and inside `ticketConventions` and `seatGauge`, so check your spelling. Inside `progress`, unknown keys are refused.

Kettle's `project.json`:

```json
{
  "version": 1,
  "id": "kettle",
  "title": "Kettle work map",
  "roadmapRepo": "example-work-map/kettle-roadmap",
  "productRepo": "example-work-map/kettle",
  "repos": ["example-work-map/kettle"],
  "files": {
    "flow": "flow.json",
    "audit": "audit.json",
    "plan": "units.md",
    "mapping": "mapping.json",
    "sections": "section-map.json"
  },
  "lanePrefix": "KT-",
  "laneRules": [],
  "ticketConventions": {
    "readyLabel": "ready",
    "ticketLabels": ["ready"],
    "mapLabel": "map",
    "ideaLabels": [],
    "ideaPattern": "^Idea:",
    "specLabels": [],
    "specPattern": "^Spec:"
  },
  "progress": {
    "basis": "ticket-count",
    "repositories": {},
    "notPlaced": "sections",
    "placement": {
      "example-work-map/kettle": {
        "titlePrefixes": {
          "Accounts": "accounts",
          "Catalogue": "catalogue",
          "Basket": "basket",
          "Checkout": "checkout",
          "Subscriptions": "subscriptions",
          "Dispatch": "dispatch",
          "Launch": "launch"
        }
      }
    }
  },
  "dependencies": []
}
```

### Shapes used below

- **Repository name**: `owner/name`. The owner is letters, digits and `-`. The name is letters, digits, `.`, `_` and `-`. For example `example-work-map/kettle`.
- **Issue key**: a repository name, `#`, then a number from 1. For example `example-work-map/kettle#12`.
- **Relative path**: not empty, not absolute, and no `..` part.
- **Pattern**: a JavaScript regular expression, written as a JSON string, so a backslash is doubled (`"\\d"`).
- **Capturing pattern**: a pattern with at least one capture group `( )`. The first group is the value read.
- **Section id**: the `id` of a node in the diagram.

### Required fields

| Field               | Shape                                  | What it does                                                                                                                                                                            |
| ------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`           | the number `1`                         | The config format. Only `1` is accepted.                                                                                                                                                |
| `id`                | text, not empty                        | The map's id. It is stored with the data folder's GitHub read, and matched by the map tabs in `maps.json` and the Seat Gauge report. Keep one data folder per map.                      |
| `title`             | text, not empty                        | The map's heading. A title ending in "roadmap" is shown ending in "work map".                                                                                                           |
| `roadmapRepo`       | repository name                        | The repository that holds this config. A merged PR that links one of its issues, and the units table cites that issue for a unit, is placed on that unit.                               |
| `productRepo`       | repository name                        | The main code repository. Its merged PRs feed the merge panel and weighted progress. Map gaps, switch-on issues and site versions are read from it.                                     |
| `repos`             | list of repository names, at least one | Every repository whose issues and PRs the map reads. Every repository named elsewhere in this file must be in this list.                                                                |
| `files`             | object                                 | The roadmap files, each a relative path: `flow`, `audit`, `plan`, `mapping` and `sections`. All five keys are required. The `mapping` and `sections` files themselves may be missing.   |
| `lanePrefix`        | text (may be empty)                    | Used only by the agent run log. See [Agent run log](#agent-run-log).                                                                                                                    |
| `laneRules`         | list (may be empty)                    | Used only by the agent run log. See [Agent run log](#agent-run-log).                                                                                                                    |
| `ticketConventions` | object                                 | How the map recognises tickets, maps, ideas and specs. See below.                                                                                                                       |
| `dependencies`      | list (may be empty)                    | Extra arrows to draw between sections. Each entry is `{ "from": "<section id>", "to": "<section id>", "label": "<text>" }`. An entry whose ends are not both on the diagram is skipped. |

### ticketConventions

These decide the four-step planning checklist on each card (map, tickets, spec, build) and the idea evidence in a section's details.

| Field                      | Shape                                            | What it does                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `readyLabel`               | text                                             | An issue with this label counts as a ticket for the tickets step.                                                                                                                                      |
| `ticketLabels`             | list of text, default `[]`                       | More labels that count an issue as a ticket, in every repository.                                                                                                                                      |
| `ticketLabelsByRepository` | optional, `{ "<repository>": ["<label>", ...] }` | More ticket labels for one repository only. Keys must be in `repos`, compared without case, and must not repeat.                                                                                       |
| `mapLabel`                 | text                                             | An issue with this label is a map. A map placed on a section ticks its map step. A map whose tickets span several sections is treated as an umbrella and ticks a section only when it is placed there. |
| `ideaLabels`               | list of text                                     | An issue with one of these labels is idea evidence.                                                                                                                                                    |
| `ideaPattern`              | pattern                                          | An issue whose title matches is idea evidence. Matching ignores case. An empty pattern matches every title.                                                                                            |
| `specLabels`               | list of text                                     | An issue with one of these labels is a spec.                                                                                                                                                           |
| `specPattern`              | pattern                                          | An issue whose title matches is a spec. Matching ignores case. A spec ticks the spec step and never counts toward the tickets step, even with a ticket label.                                          |

Labels are compared exactly, case included.

### Progress

A map shows progress in one of three ways, chosen by `progress`.

#### No `progress`: weighted units

Leave `progress` out to measure progress from weighted build units. The audit gives each unit a size in days, a built share and a live state. The units table lists the ticket IDs in each unit. Each diagram node lists the units it owns. Progress is the built share weighted by days.

A merged PR is placed on a unit from what it states: [ticket-lines.md](ticket-lines.md) describes the lines and their order of trust.

A project with no weighted units can use an empty audit and an empty units table. Its scope stays pending, and its cards still show planning, PRs, review and blockers.

#### `basis: "ticket-count"`

Count GitHub issues instead. Each issue in `repos` is placed on one section, or outside the plan, and the card counts closed against open. Only an issue closed as completed counts as done. Pull requests are never counted as tickets. An issue closed as not planned or as a duplicate is counted by the issue it was absorbed into, or dropped from the total when there is none; `CONTRACT.md` ("Optional ticket completion progress") has the counting rules.

| Field          | Shape                                                       | What it does                                                                                                                                                                                                  |
| -------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `basis`        | `"ticket-count"`                                            | Picks this mode.                                                                                                                                                                                              |
| `repositories` | `{ "<repository>": "<section id>" }`, required, may be `{}` | A default section for a repository's issues. The repository must be in `repos`. The value must be a section id, not `outside`. A default also places that repository's open PRs that nothing else places.     |
| `issues`       | optional, `{ "<issue key>": "<section id>" or "outside" }`  | Places one issue, ahead of all other evidence. The repository must be in `repos`. A key that the census does not find holds the whole count pending, so remove keys for deleted issues.                       |
| `bugLabels`    | optional, list of labels                                    | An issue with any of these is a bug card. Bug cards are counted as open bugs on the card footer, never in Progress or Tickets. A label ending in `*` matches by prefix: `severity:*` matches `severity:high`. |
| `skipLabels`   | optional, list of labels                                    | An issue with any of these, and no bug label, is a question. Questions are listed but counted nowhere. `*` works as in `bugLabels`.                                                                           |
| `notPlaced`    | optional, `"sections"`                                      | Splits the header's "Not placed" figure into three counts: tickets on no section, PRs on no section (PRs declared outside left out), and files no section owns. Without it the header shows one figure.       |
| `placement`    | optional, see below                                         | Last-resort rules for issues that nothing else places.                                                                                                                                                        |
| `unitAudit`    | optional, see below                                         | Weights tickets by build unit, using a separate audit file.                                                                                                                                                   |
| `recheck`      | optional                                                    | Retired. See [Accepted but ignored](#accepted-but-ignored).                                                                                                                                                   |

With neither `bugLabels` nor `skipLabels`, every issue is a work card.

**How an issue finds its section.** An entry in `progress.issues` wins over everything. Otherwise the issue's own `Section:`, `Ticket:` or `Unit:` line, the section map's `maps`, its parent issue, its repository's default in `repositories`, the merged PRs that closed it and, last, its repository's `placement` rule can each place it. `CONTRACT.md` ("Ticket placement") has the full order. An issue nothing places is listed as "not on the map".

A repository with a default in `repositories` never reaches its `placement` rule. Kettle sets no defaults, so its title prefixes do the work.

**`placement`** is keyed by repository, which must be in `repos`. Each entry may have:

- `labels`: `{ "<label>": "<section id>" or "outside" }`. Labels match exactly. If an issue's labels point to different sections, the label rule is skipped.
- `titlePrefixes`: `{ "<prefix>": "<section id>" or "outside" }`. The prefix is the text before the title's first colon, trimmed, compared without case. `Basket: keep the basket after sign-in` goes to `basket`.

The labels rule is tried before the title prefix. The value `outside` marks the issue as outside the plan: it is listed apart and counted on no section. Every other value must be a section id. The collector refuses an unknown one when it can read the diagram.

```json
"placement": {
  "example-work-map/kettle": {
    "labels": { "area:dispatch": "dispatch", "chore": "outside" },
    "titlePrefixes": { "Basket": "basket" }
  }
}
```

**`unitAudit`** weights each work card by the build unit it belongs to:

- `file`: a path, relative to the roadmap root, to a JSON file `{ "asAt": "<date>", "units": { "<unit id>": { "code": 0.4, "days": 3, "live": "partly" } } }`. `code` is 0 to 1. `days` is above 0 (default 1). `live` is `yes`, `partly` or `no` (default `no`). A path outside the roadmap root, or a missing or invalid file, gives no scores and no error.
- `unitPattern`: a capturing pattern. Its first group, read from the ticket's title (or the title of the issue it was absorbed into), is the unit id.
- `recheck`: retired. See [Accepted but ignored](#accepted-but-ignored).

`CONTRACT.md` ("Unit scores") describes how the audit's days and shares weigh the cards.

#### `basis: "estimated-scope"`

Retired. `{ "basis": "estimated-scope", "scope": "<relative path>" }` is still accepted so older configs load, but nothing reads it. The map shows the same scope bar as a map with no `progress`.

### Optional features

#### Time zone and locale

`timeZone`: an IANA zone name, such as `Europe/London`. Every time on the map is shown in this zone, whoever views it, and the merge chart's bars are its clock hours. Unset, it is the zone of the machine that runs the map's jobs. A name Node doesn't know, or a UTC offset such as `+01:00`, is refused.

`locale`: a BCP 47 locale, such as `en-GB`, for how dates and times are written. Unset, it is `en-AU`. A malformed locale, or one Node doesn't have, is refused.

Both go into `snapshot.json` as `display`. A browser that lacks the zone shows UTC+10 instead, and one that lacks the locale writes `en-AU`; the other setting still holds.

#### Planning sections

`planningSections`: a list of section ids. A PR that changes only documentation (every file under `docs/` or ending `.md`) counts as build work only in these sections. Elsewhere a documentation-only PR does not tick the build step.

#### Spec documents

`specDocuments`: `{ "<section id>": ["<repository>:<path>", ...] }`. Each entry names a file on that repository's default branch, for example `"example-work-map/kettle:docs/checkout-spec.md"`. The repository must be in `repos`. The path is relative, has no `..` part, and uses letters, digits, spaces and `._/-`. When the collector finds the file, it ticks the section's spec step and links to it. A missing or unchecked file is no evidence.

#### Spec membership

`specMembership` lists, per section, which spec issues the section has and which tickets each spec needs. A spec's built state comes from its tickets' closures, with a complete, current read; `CONTRACT.md` ("Spec built state from ticket closure") gives the rule.

```json
"specMembership": [
  {
    "section": "checkout",
    "complete": true,
    "specs": [
      {
        "key": "example-work-map/kettle#30",
        "complete": true,
        "tickets": ["example-work-map/kettle#31", "example-work-map/kettle#32"]
      }
    ]
  }
]
```

- `section`: a section id. Each section appears once.
- `complete`: `true` when this list covers the section's whole spec set. Otherwise its specs stay pending.
- `specs[].key`: the spec's issue key. Each spec appears once.
- `specs[].complete`: `true` when `tickets` is the spec's whole ticket set.
- `specs[].tickets`: issue keys, no repeats, and none may be another spec's key.

Repositories must be in `repos`. Key comparison ignores case. At most 200 distinct issue keys in total. An invalid list, or one naming an unknown section or repository, gives no built results. This count does not change Progress.

#### Review receipts

`reviewReceiptAuthors`: a list of GitHub logins (letters, digits and `-`). The Review bar counts a PR as reviewed when GitHub shows a current approval with nothing outstanding. With this list, a comment from one of these logins can also approve the PR's current head, when it ends with these five lines exactly:

```
Reviewer: <name>
Model: <name>
Head SHA: <40 lowercase hex characters>
Verdict: approve
Code review: no findings
```

Without the list, comments never establish review. `CONTRACT.md` gives the full receipt rules, negative receipts included.

`reviewDebtLabels`: a list of labels, none empty. A PR carrying one of them is not counted as reviewed by a GitHub approval alone (a receipt still counts). Unset, the labels are `needs-sol`, `unreviewed` and `needs-second-model`. An empty list means no label holds a PR's review.

#### Switch-on title

`switchOnTitle`: the text a switch-on issue's title starts with, in any case, followed by anything but a letter, digit or `_`. It is also the phrase the map searches issue titles for, so it is 1 to 100 characters with no `"`, `\`, control characters or spaces at either end (GitHub trims titles). Unset, it is `Switch-on`. Changing it drops the switch-on issues read under the old title; until the next GitHub run that isn't skipped for the rate limit, the map shows none.

#### Loading bay ready label

`ledgerPrReadyLabel`: a PR label, not empty. The loading bay shows a PR as ready when it carries this label. Without it, readiness is not shown. `ticketConventions.readyLabel` is an issue label and does not affect this.

#### Seat Gauge

Seat Gauge is a macOS app that publishes the agent sessions running on a Mac. With `seatGauge` set, the map shows working sessions on the section their PR or ticket sits in.

```json
"seatGauge": {
  "repositories": { "kettle": "example-work-map/kettle" },
  "branchTicket": "^[a-z]+/([1-9][0-9]*)-",
  "workspace": { "pattern": "^KT-[A-Za-z]+-([1-9][0-9]*)", "repository": "example-work-map/kettle" }
}
```

- `repositories`: required in `seatGauge`. Maps the repository label Seat Gauge reports for a session (up to 512 characters) to a repository name. A destination not in `repos` leaves the session unmapped.

  When a session's row carries Seat Gauge's `repository`, the GitHub `owner/name` of the session's remote, that repository wins over this label map and the workspace pattern. A row naming a repository outside `repos` is not this project's session. A row with no `repository`, a null one or a malformed one falls back to the label map.

- `branchTicket`: optional capturing pattern, up to 256 characters. Its first group, read from the session's branch, is a ticket number in the session's repository. With the example, `kt/42-basket-badge` reads as `#42`.
- `workspace`: optional `{ "pattern": <capturing pattern, up to 256 characters>, "repository": <repository name> }`. The first group, read from the session's workspace name, is a PR or ticket number in `repository`. If it is an open PR, it joins the session's PRs. Otherwise it is treated as a ticket.

  Without a `workspace` pattern, a workspace label that carries a number before its last part is read as a ticket: `KT-Basket-27-Alex` is repository label `KT`, section `Basket` and #27 in the session's repository, where Seat Gauge's own split would give repository label `KT-Basket` and section `27`. A number that is part of a mapped repository label is skipped. Labels with no such number keep Seat Gauge's split. With a `workspace` pattern, the pattern alone reads numbers from labels.

A session sits where the map placed its open PR, else its ticket, else on a section id Seat Gauge reports exactly. With `branchTicket` or `workspace` set, a session with no PR and no placed ticket is only counted, anonymously.

#### Agent run log

The agents collector can read an optional log of agent runs: an `events.log` in the newest `round-*` folder under `$WORK_MAP_ROUND_ROOT` (or `$OA_ROUND_ROOT`, its older name; default `.local` in the roadmap root), or in the folder `--round` names. Each line is `<ISO time ending in Z> <name> <VERB> <text>`. `ops/install.sh` writes `WORK_MAP_ROUND_ROOT` into the jobs; run without it and with `OA_ROUND_ROOT` set, it uses that and says so.

- `BOOTED` starts a run named `<name>`. `TICKET` changes its ticket. On either line, `Ticket:`, `Unit:` and `Section:` name its work, as in PR bodies.
- `WRAPPED` ends the run. So does a line from `ORCH` with `CLOSED <name>`.
- `PR-OPENED`, `PUSHING`, `FIX-PUSHED` and `READY` lines record the PR numbers the run worked on (`#` and three to six digits, such as `#123`). An open PR that nothing else places is placed where its run sits, marked inferred.

A run that names no `Section:` or ticket can still be placed by `laneRules`; `CONTRACT.md` describes the other evidence the collector uses.

- `lanePrefix`: text removed from the start of a run's name before it is matched to a brief file or to `laneRules`. Kettle uses `KT-`.
- `laneRules`: a list of `{ "pattern": <pattern>, "box": "<section id>" }`. The first pattern that matches the run's name, ignoring case, gives its section. The collector does not check that `box` is on the diagram.

```json
"laneRules": [{ "pattern": "^checkout", "box": "checkout" }]
```

### Accepted but ignored

- `progress.basis: "estimated-scope"` and its `scope`: accepted so older configs load; ignored.
- `recheck`, at `progress.recheck` or `progress.unitAudit.recheck`: `{ "enabled": <true or false>, "dailyCalls": <1 to 200, default 20>, "confidence": <0 to 1, default 0.6>, "deepCalls": <1 to 200, default 40> }`. `enabled` is required when `recheck` is present. A map with `unitAudit` takes `recheck` only under `unitAudit.recheck`: `progress.recheck` beside `unitAudit` stops the collector. Only `confidence` is read: the lowest confidence a kept score in the data folder's `unit-scores.json` needs to stand. `enabled`, `dailyCalls` and `deepCalls` are accepted so older configs load; ignored. On a map without `unitAudit`, setting `progress.recheck` also makes the map read kept section scores from `unit-scores.json`. Nothing writes that file any more.

## The diagram (files.flow)

```json
{
  "title": "Kettle: a made-up online tea shop",
  "lede": "An example project for the work map. Every name, ticket and pull request in it is invented.",
  "stages": ["Groundwork", "Ordering", "Repeat orders", "Fulfilment", "Launch"],
  "nodes": [
    {
      "id": "basket",
      "title": "Basket",
      "repo": "kettle",
      "text": "Adding, changing and saving a basket across visits.",
      "stage": 2,
      "row": 1,
      "units": []
    }
  ],
  "wires": [{ "from": ["basket", "b"], "to": ["checkout", "t"] }]
}
```

- `title`, `lede`: text. Kept in the snapshot. The page heading comes from `project.json` `title`.
- `stages`: the column names, left to right. Any number.
- `nodes`: one per section card.
  - `id`: the section id that every other file uses. A `Section:` line can only name an id of lowercase letters, digits and `-` that starts with a letter, so use that shape.
  - `title`: the card's name. `text`: its description.
  - `stage`: the column, counting from 1.
  - `row`: the order within the column, smallest first.
  - `units`: the audit units this section owns. **Required for the card to appear**, even as `[]`. Each unit must be in the audit and in only one node.
  - `repo`: text, kept in the snapshot.
- `wires`: arrows. `from` and `to` are `["<section id>", "<side>"]`, where side is `l`, `r`, `t` or `b`. An optional third number from 0 to 1 sets the point along that side (default 0.5, the middle). Optional `gap` (a stage gap number) and `lane` (an offset) route the wire through the space between two columns. Optional `kind` adds a style (`dash` or `loop`). Optional `label` is shown while either end is selected.
- Optional `overallNote`, `footnote` and `steps` (`[{ "title", "text" }]`) are kept in the snapshot.

The diagram file is read as it is, with no schema check, and the cards follow it. A `status` field on a node, as in Kettle's file, is ignored: the map works out each section's status itself.

## The audit (files.audit)

```json
{
  "asAt": "20 October 2026",
  "units": {}
}
```

- `asAt`: required. A date written as day, month name and year (`20 October 2026`). It may add a time in AEST: `13 October 2026, about 8:45 pm AEST`. With no time it means the end of that day. PRs merged after it count as "since the audit".
- `units`: `{ "<unit id>": { ... } }`. Use `U` and digits for unit ids (`U01`): the units table reads no other shape. Each unit has:
  - `title`: text.
  - `days`: above 0. The unit's size and weight.
  - `code`, `low`, `high`: 0 to 1, with `low` at or below `code` and `code` at or below `high`. The built share and its range.
  - `live`: `yes`, `partly` or `no`. A unit's code counts as live in full for `yes`, half for `partly`.
  - `why`: optional note.

Every unit must sit in exactly one diagram node's `units`. A unit in the audit with no row in the units table, or the other way round, is shown as a warning.

## The units table (files.plan)

A Markdown file with a `## Units by wave` heading (not on the file's first line). Only tables under that heading, up to the next `##` heading, are read. Each row needs at least six columns, in this order:

```markdown
## Units by wave

| Unit | Title  | What it covers | Tickets absorbed            | Components owned | Days |
| ---- | ------ | -------------- | --------------------------- | ---------------- | ---- |
| U01  | Basket | Saved baskets  | KT-1, KT-2 and KT-3 (split) | basket           | 3    |
```

- **Unit**: `U` and digits. Rows with anything else in this column are skipped, so the header row is safe.
- **Tickets absorbed**: ticket IDs separated by commas or `and`. Text in brackets after an ID is ignored. An ID starts with a capital letter, then capitals and digits, then optional `-` parts (`KT-1`, `C80`). Anything else in this column stops the collector, so leave it empty when there are none. A ticket in two units also stops it.
- The other columns are read as text or not at all.

Anywhere in the file, `U01 (#45)` cites issue 45 in `roadmapRepo` as unit U01's issue.

The heading must exist even when the table is empty, as in Kettle's `units.md`.

## The PR mapping (files.mapping)

Hand-approved placements, for PRs that state nothing or state the wrong thing. The file may be missing.

```json
{
  "prs": {
    "41": { "ids": ["KT-2"], "approvedBy": "a reviewer", "note": "named the ticket in a comment" },
    "57": { "none": true, "approvedBy": "a reviewer" }
  },
  "switchOns": {
    "60": { "units": ["U01"], "approvedBy": "a reviewer" }
  }
}
```

- `prs`: keyed by PR number in `productRepo`. `ids` lists plan tickets or units. `none: true` marks the PR outside the plan. An entry replaces whatever the PR states.
- `switchOns`: keyed by issue number in `productRepo`. The map reads issues whose title starts with `switchOnTitle` (default `Switch-on`) as switch-on issues. `units` lists the audit units the issue switches on; an unknown unit stops the collector.
- Every entry needs a non-empty `approvedBy`. Without it the entry is pending: counted, but not used.
- `note` is optional. Keys starting with `_` are skipped, so `"_comment"` is safe.

## The section map (files.sections)

```json
{
  "repo": "example-work-map/kettle",
  "maps": {},
  "shared": ["package.json", "README.md"],
  "boxes": {
    "basket": ["src/basket/**"],
    "checkout": ["src/checkout/**"]
  }
}
```

- `repo`: the repository the globs describe. Files no section owns ("map gaps") are counted only when this equals `productRepo`.
- `boxes`: `{ "<section id>": ["<glob>", ...] }`. `**` spans folders, `*` stays inside one folder, `?` is one character. When several globs match a file, the one with the most literal characters wins.
- `shared`: globs that belong to no section and are not gaps.
- `maps`: optional, `{ "<issue or PR key>": "<section id>" or "outside" }`. Places a map issue, and the tickets under it as GitHub sub-issues, on a section. A PR key places that PR. An entry naming a section that is not on the diagram places nothing.

The file may be missing. Then there are no map gaps and no `maps`.

## maps.json (data folder)

Optional tabs that switch between maps running on the same machine. Put the same file in each map's data folder.

```json
[
  { "id": "kettle", "title": "Kettle", "url": "http://127.0.0.1:4317/" },
  { "id": "teapot", "title": "Teapot", "url": "http://127.0.0.1:4321/" }
]
```

- 1 to 20 entries, with no other keys.
- `id`: up to 80 characters. Match it to each map's `project.json` `id`. The tabs appear only when the current map's id is in the list, and that tab is marked as current.
- `title`: up to 120 characters.
- `url`: exactly `http://127.0.0.1:<port>/`, with an explicit port and the trailing slash.
- Ids and URLs must be unique.

An invalid list is ignored as a whole, and the page shows the map's own title instead.

## versions.config.json (data folder)

Optional. Lists public sites whose served build is compared with `productRepo`, to show how many merged PRs each site is behind. Without the file this is off. The browser never sees this file.

```json
[
  {
    "name": "Shop",
    "origin": "https://shop.example.com",
    "buildPath": "/build.json",
    "metaName": "kettle-build"
  }
]
```

- 1 to 10 sites, each `origin` once. An empty list counts as invalid.
- `name`: 1 to 100 characters.
- `origin`: `https://` and a host name with a dot, nothing after it (no path, port or trailing slash), and no user name or password.
- `buildPath`: starts with `/`, ends with `.json`, and uses letters, digits, `/`, `_` and `-`.
- `metaName`: 1 to 100 letters, digits, `_` or `-`.

The site must serve a JSON file at `origin` + `buildPath` with a `build` field: twelve lowercase hex characters of a git revision. Its home page must carry exactly one `<meta name="<metaName>" content="<the same build>">`. A build ending in `-dirty` is read but cannot be compared. An invalid file shows the version card as pending and does not stop the rest of the map.
