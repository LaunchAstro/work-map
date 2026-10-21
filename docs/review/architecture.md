# Architecture review of the archive

This is the architecture pass on the old TypeScript engine, run read-only on the private archive for ticket #5. It names the Rust modules the rewrite should have, what each one hides, which old areas it replaces, and which seams the old code put in the wrong place. It uses the `codebase-design` vocabulary: a module is deep when a lot of behaviour sits behind a small interface, a seam is where that interface lives, and an adapter fills a seam.

It covers what release one keeps (see the settled decisions in #3). Retired features appear only where their seam matters for cutting them out cleanly. Detail that names private things is in the private companion issue.

## The answer in short

The old engine got one big thing right. Its maths is pure: placement, progress and the read model take everything as arguments and read nothing themselves. The Rust engine keeps that, and keeps the injected GitHub runner, the site versions reader and the rule that a failed read keeps the last good values with their time.

It got the outer seams wrong. GitHub data sits in two caches with two shapes. Placement is worked out in five places with five slightly different orders of trust. Collectors are separate processes that pass JSON files to each other under lock scripts. The React screen imports the engine's own TypeScript and recounts the numbers it was given. Each project tab is its own server.

The rewrite redraws those seams:

1. One census of GitHub data per project, behind one typed GitHub port.
2. One placement module that settles every ticket and PR once.
3. Every number in the engine, at every level. The screen formats and draws; it never counts.
4. One process that owns all state, polls only while open, and holds every project.

The proposed engine is about 9,800 lines of Rust, tests aside, against about 8,700 lines of TypeScript covering the same ground today (some retired branches included). That leaves room under the 20k target in #16.

## How the old engine is shaped

The archive has four folders that matter here. The readers folder does all I/O: GitHub through the `gh` CLI, roadmap files, the Seat Gauge file, round logs. The core folder is pure logic. The cli folder composes the two into collector commands and runs the loopback server. The web folder is the React screen.

Data moves like this today:

1. A scheduled job starts a collector process. A lock wrapper takes a shared and an exclusive lock first.
2. The collector reads GitHub into cache files in the data folder, then builds the read model in layers: the snapshot (the old audit tree), then ticket progress, then the work view, merged together at the end.
3. It writes the read models as JSON files. A second collector writes the agents file, and reads the first collector's snapshot file back to place Seat Gauge sessions.
4. The server serves those files as they are. Sync spawns the collectors as child processes, then re-reads their files to judge whether the run was fresh.
5. The screen polls each file, re-validates it, recomputes parts of it and draws.

## The engine-to-screen boundary today

The transport is plain HTTP on a loopback port, one server per project. The screen polls static JSON files and posts one command.

| What the screen reads | Address | Poll | Shape |
| --- | --- | --- | --- |
| The map | `/data/snapshot.json` | 60 s | Schema `work-map/4`, below |
| Agents | `/data/agents.json` | 30 s | Schema `work-map-agents/2`: round lanes (state always unknown), section index, Seat Gauge report `work-map-seat-gauge/1`, lane documents |
| Site versions | `/data/versions.json` | 60 s | Schema `work-map-versions/1`: product main, one row per site with build, resolved commit, merges behind, last known |
| Project tabs | `/data/maps.json` | 60 s | Up to twenty `{ id, title, url }` entries, each URL another loopback server |
| Sync | `POST /sync` | on click | No body. Exact Host and Origin, a custom header and a JSON content type. Replies with complete, incomplete or failed, plus whether site versions were required, their watermark and warnings |

Tabs work through the address: `?map=<id>` makes every request go to `/m/<id>/...`, which the first server forwards to the other project's server. The screen also reads four retired files (the code audit registry, its decisions, scan status and the re-check status, the last every five seconds) and calls the audit and deep-sync routes.

The snapshot is three generations of read model in one file:

- The old audit tree. Map, stages, sections and units, each with `Measures`: the audit's coded share with its range, the live share, a review-label count, merges since the audit and a live estimate. Beside it sit merged PRs keyed by number with their placement class and links, switch-on issues, frontier, fog, the diagram's words and wires, merge pace (four hourly counts, the last thirty minutes, queue, approved, stalled) and sweep counts.
- The work view, added later. Per section: a state, four scope shares with jointly rounded display shares and a pending reason, review coverage by changed lines with the PR list, open PRs, the planning checklist (idea, map, tickets, spec, build), missing steps, blockers, spec documents and warnings. Map level: review totals, unplaced PRs, extra wires, spec closure progress, the last failure.
- Ticket progress, added last. Per section and in total, the counts (completed, total, absorbed, dropped, unknown, weighted built and live, where the credit came from) plus the full list of every ticket behind each count, and separate lists for bugs, questions, unplaced, outside and held sections.

The screen is not a thin client. It imports engine TypeScript from nineteen core modules. It re-runs ticket counting on the full ticket lists and drops the whole ticket layer to pending when its recount disagrees. It averages stage scope shares and deduplicates stage review itself. It builds the twelve clock-hour merge buckets from merged PR times, ignoring the engine's older four-hour figures. It qualifies Seat Gauge sessions again with its own freshness windows and schedules a re-render at the next expiry. It formats every time in one fixed time zone taken from the engine.

## Proposed modules

All modules below except the last three live in one engine library crate with no window, server or Tauri code in it. Rust signatures are sketches for the interface, not final types.

### `config`

```rust
pub fn load(path: &Path) -> Result<Project, ConfigError>;
pub fn frozen_inputs(dir: &Path, project: &Project) -> FrozenInputs;
```

`load` returns a checked project: its diagram sections and stages, repositories, ticket conventions, progress basis, Seat Gauge mapping, served sites and every optional part. It hides schema validation, safe relative paths, regex compilation and every cross-reference check (destinations exist in the diagram, repositories are configured, no duplicate keys ignoring case). It also parses the roadmap files a project names: the diagram, the audit, the plan's unit table, the section map and approved mappings. `frozen_inputs` reads the model-written files the retired features left behind, read-only (see the questions below).

It replaces the project reader, the roadmap file reader, the plan table parser and the table checks in core, and the site versions config and tab list that lived in the data folder. Project config v2 itself belongs to #11. About 900 lines.

### `github`

```rust
pub trait GitHub {
    fn graphql(&self, query: &Query) -> Result<Answer, GhError>;
    fn rest(&self, request: &RestRequest) -> Result<Answer, GhError>;
}
```

The port. It has two adapters, so it is a real seam. The live adapter uses the `gh` login (how the token is reached on each OS is #9's call). The recorded adapter replays saved answers, for tests, the example project and the parity harness. Behind the port sits one budget gate: it reads the rate limit, keeps the reserve floor, counts cost by the part of the map that asked, and stops a read with a typed error before the floor. It hides GraphQL text, paging cursors and answer schemas.

It replaces the `gh` runner that every reader took as "argv in, stdout out", and the rate-limit check and floor each reader repeated for itself. About 500 lines.

### `census`

```rust
impl Census {
    pub fn refresh(&mut self, gh: &dyn GitHub, project: &Project, scope: ReadScope, now: Instant) -> ReadReport;
}
pub enum ReadScope { Timer, Sync, Full }
```

The single store of what GitHub said for one project: issues with labels, parents, blockers, closure reason and closing comment, PRs open, merged and closed with heads, sizes, reviews, comments, closing references, timelines and file lists, the merge queue, spec members and spec documents. `refresh` brings it up to date for one scope. Timer reads only the merge panel. Sync reads what changed. Full reads everything. It hides per-repository watermarks for each kind, the ten-minute overlap, the change probe across up to fifteen repositories, the daily backstop, the full census and its staged swap, page limits, the merge-lag direct read, and keeping the last good values when a read fails part-way. The `ReadReport` says what was read, what it cost and what failed. Budget rules come from #12.

It replaces both old GitHub caches and their readers (the merge-panel reader and the cards reader), the spec member re-reads, the spec document checks and the PR file inventory that map gaps used. The old cache formats are not migrated. A first run reads in full. About 1,700 lines.

### `store`

```rust
impl Store {
    pub fn open(dir: &Path) -> Result<Store, StoreError>;
    pub fn load(&self, id: &ProjectId) -> Saved;
    pub fn save(&self, id: &ProjectId, saved: &Saved) -> Result<(), StoreError>;
}
```

Keeps each project's census and last observations (site versions, map gaps, Seat Gauge last seen) across restarts. It hides the per-OS data folder, atomic replace, a schema version that refuses unknown files, and a single-instance guard so two copies of the app cannot write one folder. Tests use a temporary folder rather than a second adapter, so there is no port here.

It replaces the lock wrapper scripts, the atomic writer, the read-with-fallback helper and the cache upgrade code. About 250 lines.

### `placement`

```rust
pub fn place(project: &Project, census: &Census, frozen: &FrozenInputs) -> Placement;
impl Placement {
    pub fn ticket(&self, key: &IssueKey) -> &Placed;
    pub fn pr(&self, key: &PrKey) -> &Placed;
}
```

Settles every ticket and PR once. `Placed` is a section, outside or unplaced, with a reason in words and whether it was inferred. It hides the whole order of trust: a `Section:` line, declared ticket or unit IDs, `Ticket: none`, IDs in a title or branch, a link to a unit's roadmap issue, approved mappings, project overrides, the section map's map entries, parent ancestry with loop checks, plan unit issues, the closing-PR second pass (a ticket nothing else places follows the merged PRs that closed it, and disagreeing PRs leave it unplaced), label and title-prefix rules, prose links that all agree, history, repository defaults and the frozen model placements. The two-pass dependency (PRs need ticket placement, unplaced tickets need PR placement) stays inside.

It replaces the PR reference rules, the issue placement rules, the deterministic step of the retired sweep, the open-PR placer in the work view, the ticket resolver and closing-PR pass in ticket progress, and the placement lookups Seat Gauge made. About 1,100 lines.

### `progress`

```rust
pub fn measure(project: &Project, census: &Census, placement: &Placement, frozen: &FrozenInputs, now: Instant) -> Progress;
```

Every number on a card, a stage and the header, for whichever basis the project uses. On a ticket map: work cards, bug cards and questions apart, status from state and closure reason, absorption chains, unit weights from the audit or section scores, weighted built and live, days left and momentum. On a scope map: the four exclusive shares, joint rounding that adds to 100, and the purple tone above 90%. On both: review coverage by changed lines with the trusted receipt rules, spec closure, and the pending reason when any input is incomplete. Stage and map rollups are computed here, with unique tickets and unique PRs, so a PR in two sections counts once.

It replaces ticket progress, unit and section scores, absorption, the scope and coverage maths, spec progress, the old audit `Measures` tree for scope maps, and the stage maths and pending checks that sat in the screen. About 1,500 lines, with ticket counting, scope, review and spec closure as internal parts behind the one function.

### `merges`

```rust
pub fn merges(census: &Census, placement: &Placement, now: Instant) -> MergeFlow;
```

The merge panel and the loading bay, both derived from PR history. Merges per clock hour for twelve hours with start and finish times, the rolling average and last hour, queue length and first entries, open approved PRs and the stall flag. The loading bay's opened, ready, queued, merged and dropped milestones with queue-removal reasons. It hides the hour bucketing and the ready-label rule.

It replaces the merge pace stats in the snapshot builder, the loading bay builder and the screen's clock-hour bucketing. About 350 lines.

### `map_gaps`

```rust
pub fn gaps(section_map: &SectionMap, census: &Census, last: Option<&GapReport>) -> GapReport;
```

Changed paths across tracked PRs that no section owns, with the most specific glob winning and shared paths excluded. It hides glob matching and keeping the last complete census when the file inventory is partial. The inventory itself is read by `census` on Sync.

It replaces the section map module, the map gap reader and the map gap report. About 250 lines.

### `versions`

```rust
pub fn observe(sites: &[Site], gh: &dyn GitHub, web: &dyn Fetch, last: Option<&Versions>, now: Instant) -> Versions;
```

Which build each served site runs and how many merged PRs it is behind main. It hides the bounded artefact fetch with no redirects, the page meta tag check, the commit compare, the ancestor interval, merge-commit membership and the last-known observation. The old reader already had this shape, with its runner and fetcher passed in. Keep it.

It replaces the site versions core and reader. Its config moves into project config v2. About 450 lines.

### `seat_gauge`

```rust
pub fn read(source: &dyn SessionSource, project: &Project, placement: &Placement, last: Option<&Agents>, now: Instant) -> Agents;
```

Agents on cards from the shared Seat Gauge file (format in `docs/seat-gauge-file/`). `Agents` carries each card's open sessions, working first, the last closed session, session totals, the anonymous unmapped count, and the next instant at which any of it goes stale. It hides the file safety checks, unknown versions, the 90-second freshness rule, coherent row times, repository label mapping, the branch-ticket and workspace patterns, de-duplication and the 15-minute last-seen hold. `SessionSource` has a file adapter on the per-OS folder and an example-file adapter for tests.

It replaces the Seat Gauge core and reader, and the qualification and card-agent logic the screen ran again. About 550 lines.

### `view`

```rust
pub fn build(project: &Project, state: &ProjectState, now: Instant) -> MapView;
```

The one read model the screen gets. `ProjectState` is the census, the last observations and the frozen inputs. `build` calls `place`, `measure`, `merges` and `gaps`, then adds the rest: the diagram's words and wires, blocker arrows and configured dependency arrows, the planning checklist, Next up in its order (named by an open PR, then unblocked, then blocked), blockers from native dependencies and "Blocked by" sections, fog and warnings. Each part carries a freshness state (current, last good with its time, never read, or failed since a time) instead of leaving the screen to judge ages.

It replaces the snapshot builder, the work view builder and its merge step, the agents read model, and the validators the screen ran on both files. The Rust types are the contract. TypeScript types for the screen are generated from them, so there is nothing to re-validate. About 900 lines.

### `engine`

```rust
impl Engine {
    pub fn open(settings: Settings, ports: Ports) -> Result<Engine, OpenError>;
    pub fn projects(&self) -> Vec<ProjectTab>;
    pub fn view(&self, id: &ProjectId) -> Arc<MapView>;
    pub async fn sync(&self, id: &ProjectId) -> SyncOutcome;
    pub fn changes(&self) -> watch::Receiver<ViewStamp>;
    pub fn kick(&self, id: &ProjectId);
}
```

The running service. It holds every configured project, so tabs are a list here, not a set of servers. It hides the poll loop that runs only while the app is open, which scope each tick reads, joining a second Sync onto the one running, the single writer of each project's state, rebuilding the view after each read, waking at the Seat Gauge deadline so stale agents drop on time, and saving through `store`. `sync` returns an outcome built from the `ReadReport` it just made. `kick` is the optional outside nudge after a merge.

It replaces the collector commands, the child-process Sync with its file-based freshness check, the map forwarder, the restart on a new tool commit and the scheduled jobs. About 600 lines.

### Outside the engine crate

- `server`. The loopback HTTP adapter for the windowless mode: the project list, a project's view, Sync, the kick and a change stream, with the exact Host and Origin checks the old server had. About 350 lines. Whether the window uses the same routes or Tauri commands is #9's call. One contract for both is the simpler answer, because the screen then has one transport adapter.
- `app`. The Tauri shell: window, Dock or taskbar entry, and wiring the engine's change stream to the screen. About 250 lines.
- `cli`. The binary's entry: window or windowless, and a dump of every card's numbers for the parity harness in #13. About 120 lines.

## Seams the old code got wrong

**AR-01. Two GitHub caches.** One cache holds the product repository's merged PRs and switch-on issues for the merge panel. The other holds issues and open, merged and closed PRs across all repositories for the cards. Merged PRs live in both, in two shapes with separate watermarks, and the review maths splits them into "tracked" and "legacy" lists to avoid counting one twice. The Rust engine keeps one census with one PR record.

**AR-02. The GitHub seam sits at the argv level.** Every reader builds GraphQL text and `gh` arguments by hand and parses stdout, and tests fake stdout strings. Each reader also re-reads the rate limit and applies its own floor and deadline: the merge panel, the cards, spec documents, map gaps, site versions and the retired estimate reader. The Rust engine raises the seam to typed queries and puts one budget gate behind it.

**AR-03. Processes and lock files instead of one owner.** Collectors are separate processes wrapped in Perl lock scripts, with shared and exclusive locks, lock-wait timeouts and a special exit code for "busy". They hand data over through JSON files with no transaction across them. This is what blocks Windows. The Rust engine is one process that owns each project's state, with a single-instance guard on the data folder.

**AR-04. Placement in five places.** Merged PRs, issues, tickets for progress, open PRs and lanes each have their own order of trust in their own module, joined by callbacks that pass one placement function into another. The orders differ in small ways, for example where a PR's own section-map entry sits against its linked issues. Fixing one ladder does not fix the others. The Rust engine has one `placement` module and one answer per key.

**AR-05. Seat Gauge reads the engine's own output back from disk.** To place a session, the agents collector parses the published snapshot file and the raw cards cache to learn where tickets and PRs sit. The read model became an internal data channel, so its shape could not change freely. The Rust engine passes the in-memory `Placement`.

**AR-06. Rollups split between engine and screen.** Ticket totals come from the engine. Stage scope averages, stage review de-duplication, the header recount for a group of sections and the clock-hour merge buckets are computed in the screen. The engine still emits four-hour merge figures that nothing draws. In the Rust engine every level is computed in `progress` and `merges`.

**AR-07. The screen recounts the engine.** The screen re-validates the snapshot and re-runs ticket counting, absorption chains and share rules on the full ticket lists, and shows pending when its recount disagrees. Sync runs the same check on the server. That is two copies of the maths, and an engine bug shows up as a silent pending rather than a failed test. The Rust engine proves the maths once, in its own tests, and the screen reads generated types.

**AR-08. One snapshot, three generations.** The old audit tree is computed for every map, including ticket maps that never draw it. The work view and ticket progress are optional layers merged in at the end, and extra wires are appended to the diagram's. Readers carry upgrade paths for older layer and cache versions. The Rust `MapView` has one shape per basis and no migrations.

**AR-09. A fixed time zone in the core.** Time labels are formatted in one fixed offset inside a core module, and the screen uses it too. The Rust engine sends UTC instants and the screen formats them in the viewer's own zone. This is one of the known fixes #6 lists.

**AR-10. Configuration in four places.** The project config lives in the roadmap repository. The site versions config and the tab list live in the data folder. Local paths come from environment variables and flags. Model-written score files are found by fixed names in the data folder. In the Rust engine, project config v2 holds the sites and the app keeps a list of project configs (#11). The frozen inputs are named in the project config.

**AR-11. The Seat Gauge file path is one macOS folder.** The reader hard-codes it. The Rust engine takes the per-OS folder from the shared format, behind `SessionSource`.

**AR-12. Seat Gauge evidence is judged twice.** The collector qualifies rows against 90-second windows. The screen qualifies them again, applies a separate 15-minute hold for card pills, and schedules its own re-render at the next deadline. The Rust engine qualifies once and re-emits the view at the deadline it computed.

**AR-13. Sync proves itself by reading files.** Because the collectors are child processes, Sync can only judge success by re-reading the published files and comparing their times and flags with when it started. The screen then re-reads them again and checks the site versions watermark. In the Rust engine, `sync` returns its outcome from the read it just made, and the screen gets the new view through the change stream.

**AR-14. One server per project tab.** Each project runs its own server on its own port. The first one forwards `/m/<id>/` requests to the others, swaps Host and Origin, and vouches for audit capabilities on their behalf. The tab list is a file of loopback URLs. In the Rust engine one process holds every project and tabs are `Engine::projects`.

**AR-15. Retired features woven through shared paths.** The code audit runs through the server's route table, the forwarder, capabilities and four screen polls. Re-check status rides in Sync's reply and a five-second poll. Sweep outputs are named files the snapshot builder reads directly. None of these had a seam of their own, which is why cutting them touches many files. The next section names where each one drops out.

## Where the retired features drop out

| Retired feature | Where it was wired | How the Rust engine leaves it out |
| --- | --- | --- |
| Codex audit | Audit routes, capabilities, forwarder, audit and scan files, screen polls | No module. The server has no audit routes. The screen's audit panels are cut in #10. |
| Estimated scope | A third progress basis, its own GitHub reader and evidence registry | Project config v2 has no such basis, so `progress` never sees it. |
| Luna re-checks and deep sync | The sweep's writers of the score store and status file, Sync's reply, the screen's status poll | No writer. The last score store is read through `FrozenInputs`, if the maintainer agrees (question 1). |
| Sweeps | Files of placements, box estimates, open-scope estimates and gap reports | No writer. The deterministic placement steps that lived in the sweep move into `placement`. Model output, if kept, arrives through `FrozenInputs`. |
| Local-model audit runtime | The audit worker and its loaders | Nothing to cut in the new code. |
| Direct herdr reads | Empty herdr and workspace inputs still passed to the agents builder | `seat_gauge` is the only agent source. |
| launchd jobs | The installer and scheduled collectors | The `engine` poll loop, running only while open. |

## Proposed crate and module map

```text
work-map/                      (Cargo workspace)
├── crates/engine/             library, no window and no server
│   ├── config      ~900       project config v2, roadmap files, frozen inputs
│   ├── github      ~500       GitHub port, gh adapter, recorded adapter, budget gate
│   ├── census      ~1,700     one store of GitHub data, refresh by scope
│   ├── store       ~250       per-OS data folder, atomic saves, single instance
│   ├── placement   ~1,100     every ticket and PR placed once, with reasons
│   ├── progress    ~1,500     tickets, scope shares, review, spec closure, rollups
│   ├── merges      ~350       merge panel, clock-hour chart, loading bay
│   ├── map_gaps    ~250       unowned changed paths
│   ├── versions    ~450       served site versions
│   ├── seat_gauge  ~550       agents from the shared file
│   ├── view        ~900       MapView, the screen's one read model
│   └── engine      ~600       running service, poll loop, Sync, tabs, kick
├── crates/server/   ~350      loopback HTTP adapter for the windowless mode
├── crates/app/      ~250      Tauri shell
└── crates/cli/      ~120      entry point, parity dump
                     ≈ 9,800 lines of Rust, tests aside
```

Dependencies point one way. `view` depends on `placement`, `progress`, `merges` and `map_gaps`, which depend on `config` and `census` types only. `census`, `versions` and `seat_gauge` reach the outside world only through their ports (`GitHub`, `Fetch`, `SessionSource`) and take time as an argument. `engine` is the only module that owns state, runs the clock or calls `store`. `server`, `app` and `cli` depend on `engine` and nothing below it.

Each port has two adapters: a live one and a recorded or example one. The recorded GitHub adapter serves three users, the tests, the example project in #11 and the parity harness in #13, which is why it earns its place.

## Questions for the maintainer

1. **Model-written numbers after the retirement.** On the maintainer's live maps some card numbers come from files that the retired re-checks, deep syncs and sweeps wrote: unit and section scores, and model placements of PRs. Once those features are gone nothing updates the files. If the new engine ignores them, those cards lose their scored built and live shares and switch-over cannot match. My recommendation is to read the last files once as frozen, read-only inputs, show their date on the hover, and let ticket closures move the bars from there. The doc is written around that. The trade-off is that those shares stop moving between releases until a later feature replaces the re-checks.
2. **Round context.** The old engine also read the fleet's round logs and saved task briefs and results. It used them to place open PRs by the lane that pushed them and to show lane documents. This is neither on the release-one list nor on the retired list. My recommendation is to leave it out of release one, since agents now come only through Seat Gauge and its workspace pattern already names a lane's PR or ticket. The cost is that an open PR placed only by its lane moves to "Not placed", which can change a card's PR count at switch-over. The parity harness should report those PRs as a known difference.

## Notes for other tickets

- #6, the carry-over list, can group behaviours by the modules above. The placement order of trust and the ticket status rules are where the old tests hold the most edge cases.
- #9 decides the transport. This review recommends one `MapView` contract for both modes, a change stream rather than per-file polling, and Sync as a command that returns its outcome.
- #11 should take the served sites and the frozen input file names into project config v2, and replace the tab file with a list of project configs.
- #12 sets the budget rules that `census` and the `github` budget gate apply.
- #13 needs the old engine's sweep and re-checks stopped on the build machine during the comparison, or its numbers keep moving while the new engine's are frozen.
