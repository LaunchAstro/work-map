# App layout and the screen-to-engine contract

How the Rust work map is laid out as crates and folders, how the React screen talks to the engine in a window and in the windowless mode, where the app keeps its files, when it polls, how an outside script kicks it, and how it gets the `gh` login's token. Resolves #9.

Inputs: the settled decisions in #3 (5 to 8 and 17), the module map in `docs/review/architecture.md`, the budget rules in `docs/spec/github-budget.md` (B1 to B14), the shared file in `docs/seat-gauge-file/README.md`, and how the archive's screen reads its data today. Tauri and `gh` facts come from their own docs and source, read on 21 October 2026 (Tauri 2.12, `dirs` 7, `gh` 2.x). Sources are listed at the end.

## The answer in short

- One Cargo workspace: the engine library, a server library for the windowless mode, and one app crate that builds the single `work-map` binary. The React screen sits in `web/`.
- One contract for both modes: five calls (`hello`, `view`, `subscribe`, `sync`, `retry_sign_in`) with types generated from Rust. In the window they are Tauri commands and a Tauri channel. Served, they are four HTTP routes and a server-sent events stream. The screen has one `Transport` interface with two small adapters.
- The change stream carries small notices. The screen fetches a view when its stamp changes. Sync is a call that returns its outcome.
- `work-map serve` serves the same built screen on `127.0.0.1:4317` only.
- Everything lives in the OS's local app-data folder for `com.launchastro.workmap`, with the HTTP cache in the OS cache folder.
- The poll timer runs only while someone is looking: a window exists, or a served page holds the change stream open.
- `work-map kick` is the outside script's call. It reaches the running app through a token-guarded control port on loopback. The engine coalesces kicks over 30 seconds.
- The token comes from `gh auth token --hostname github.com`, run with no shell and held in memory. Missing, signed-out and rejected logins each get their own line and a Retry button.

## Layout

```text
work-map/
├── Cargo.toml             workspace, members crates/*
├── crates/engine/         library: the twelve modules from the review, plus `contract`
├── crates/server/         library: loopback HTTP adapter for `work-map serve`
├── crates/app/            the one binary, `work-map`, and Tauri's project folder
│   ├── tauri.conf.json    identifier, frontendDist = ../../web/dist, devUrl = the Vite server
│   ├── capabilities/      the window may call the five contract commands and nothing else
│   ├── build.rs, icons/
│   └── src/  main.rs (arguments), window.rs (Tauri shell), control.rs (instance and kick)
├── web/                   the React screen, moved here by #10
│   ├── src/contract/      TypeScript types generated from `engine::contract`, checked in
│   └── src/transport/     `Transport` with tauri.ts and http.ts
└── examples/              the example project (#11)
```

The review's separate `cli` crate folds into `crates/app`. Tauri's CLI needs the binary target in the crate that holds `tauri.conf.json`, and the binary is where the arguments are read, so a second crate would only hold `main.rs`. The review's line counts stand.

**L1. Dependencies point one way.** `server` and `app` depend on `engine`. `engine` depends on neither, and on no Tauri, HTTP server or window crate. `server` does not depend on Tauri.
Test: `cargo tree -p engine` lists no `tauri`, `axum` or `hyper` server crate, and `cargo tree -p server` lists no `tauri`.

**L2. One binary, four entries.** `work-map` opens the window. `work-map serve [--port N] [--open]` runs windowless. `work-map kick [--project ID]` kicks a running app. `work-map dump` writes the parity numbers (its shape is #13's). Anything else prints usage and exits 2. `serve` never builds a Tauri app, so it starts no GTK or WebKit and needs no display.
Test: `work-map serve --port 0` runs to its "serving" line on a CI runner with no display, and `work-map frob` exits 2.

**L3. The screen is built once and embedded once.** Tauri embeds `web/dist` in the binary. `serve` reads the same embedded files through `Context::assets()` and hands them to `server` behind a small `Assets` trait. Tauri marks that API unstable. If it breaks, the fallback is to embed `web/dist` a second time with `rust-embed`, behind the same trait.
Test: every file in `web/dist` comes back from `serve` with the same bytes and a matching content type.

## The view contract

The Rust types in `engine::contract` are the contract. `ts-rs` generates `web/src/contract/` from them. Times are UTC RFC 3339 strings and the screen formats them in the viewer's own zone. The inner shapes of the board, merges, agents, versions and gaps belong to the `view` module and #10. This spec fixes the envelope around them.

The view's contents start from TN-29: its list of what the archive's screen reads from the snapshot is what `view` has to supply, not the old snapshot. The parts TN-29 marks as never read (the four-hour and thirty-minute stats, the stalled flag, fog, frontier, destination, switch-ons and inferred PRs) stay out unless #10 asks for one.

The screen's input checks are trimmed in the same change that moves it onto this contract (TN-64). The checks that demand the retired sweep and legacy measure objects, the agents file's retired direct-lane fields and a recounted census are deleted, not fed by engine stubs.

```ts
type ProjectId = string;
type Stamp = string;        // opaque; changes whenever the project's view changes
type Instant = string;      // UTC, e.g. "2026-10-21T03:00:30Z"

interface Hello {
  contract: 1;
  app_version: string;
  mode: "window" | "served";
  projects: { id: ProjectId; title: string }[];   // in settings order
  github: GitHubState;
}
type GitHubState =
  | { kind: "starting" }
  | { kind: "ready"; budget: Budget }
  | { kind: "gh_missing" }
  | { kind: "gh_too_old"; version: string | null }
  | { kind: "signed_out" }
  | { kind: "rejected" }                          // a 401 twice in a row (B1)
  | { kind: "gh_failed"; message: string };
interface Budget {
  graphql: Pool; rest: Pool;
  pause: null | { why: "low" | "slow_down" | "unreachable"; until: Instant | null; since: Instant };
  spent_last_hour: { graphql: number; rest: number };
}
interface Pool { remaining: number; limit: number; resets_at: Instant }

interface MapView {
  project: ProjectId; stamp: Stamp; built_at: Instant;
  basis: "tickets" | "scope";
  board: Part<Board>;                    // diagram, cards, stages, header, Next up, blockers
  merges: Part<MergeFlow>;               // merge panel, clock-hour chart, loading bay
  agents: Part<Agents>;
  versions: Part<Versions> | null;       // null when the project serves no sites
  gaps: Part<GapReport> | null;          // null when the project has no section map
  sync: { running: boolean; last: SyncOutcome | null };
}
interface Part<T> {
  state: "current" | "last_good" | "never_read" | "failed";
  read_at: Instant | null; failed_since: Instant | null; note: string | null;
  value: T | null;                       // last good value; null only when never read
}

type Change =
  | { kind: "hello"; hello: Hello }      // first on every subscription; again when tabs or GitHub state change
  | { kind: "view"; project: ProjectId; stamp: Stamp };

interface SyncOutcome {
  project: ProjectId; joined: boolean;   // joined a Sync that was already running
  started_at: Instant; finished_at: Instant;
  result:
    | { kind: "complete" }
    | { kind: "incomplete"; skipped: string[]; why: "reserve" | "read_failed" | "slow_down"; detail: string }
    | { kind: "refused"; why: "below_reserve" | "paused" | "signed_out"; until: Instant | null }
    | { kind: "failed"; message: string };
  spent: { graphql: number; rest: number };
  view_stamp: Stamp;                     // the first view that includes this Sync's reads
}
interface ContractError { kind: "unknown_project" | "internal"; message: string }
```

The engine side, extending the review's `Engine` sketch:

```rust
impl Engine {
    pub fn hello(&self) -> Hello;
    pub fn view(&self, id: &ProjectId) -> Result<Arc<MapView>, ContractError>;
    pub fn subscribe(&self) -> broadcast::Receiver<Change>;
    pub async fn sync(&self, id: &ProjectId) -> Result<SyncOutcome, ContractError>;
    pub async fn retry_sign_in(&self) -> GitHubState;
    pub fn viewer(&self) -> Viewer;                  // dropping it removes one viewer
    pub fn kick(&self, id: Option<&ProjectId>) -> Kicked;
}
```

**L4. One contract, two adapters.** The screen talks only to this interface, picked once at start: the Tauri adapter when Tauri's globals are present, the HTTP adapter otherwise.

```ts
interface Transport {
  hello(): Promise<Hello>;
  view(project: ProjectId, known?: Stamp): Promise<MapView | "unchanged">;
  subscribe(onChange: (c: Change) => void): () => void;
  sync(project: ProjectId): Promise<SyncOutcome>;
  retrySignIn(): Promise<GitHubState>;
}
```

Test: one shared contract suite runs against both adapters, over a recorded engine, and passes the same cases.

**L5. Generated types never drift.** The checked-in TypeScript equals a fresh `ts-rs` export.
Test: a Rust test exports to a temporary folder and fails on any difference from `web/src/contract/`.

**L6. Notices, then fetch.** A change notice carries only a project and a stamp. The screen fetches a view when the stamp differs from the one it holds. Every subscription starts with a `hello` and one `view` notice per project, so a reconnect needs no replay. A receiver that falls behind is closed, and the screen subscribes again.
Test: a lagged broadcast receiver gets closed, and the new subscription's first messages are a `hello` and the current stamp for each project.

**L7. Sync answers with its outcome.** `sync` returns when the Sync ends, joined or not. The notice for `view_stamp` goes out before the reply, so the screen never shows the outcome over an older board. A second `sync` while one runs joins it and gets the same outcome with `joined: true`. `refused` covers B11's reserve and the B1 sign-in stop.
Test: two `sync` calls at once make one set of GitHub reads, return equal outcomes apart from `joined`, and the `view_stamp` notice comes first.

**L8. The screen draws and never judges.** The engine sets each part's `state`. It also builds a new view at each Seat Gauge deadline, so stale agents drop on time. The screen's only timer re-renders relative times such as "3 hours ago". It never recounts, re-validates or changes a part's state.
Test: with a fake clock passing a Seat Gauge deadline, the engine sends a new stamp whose agents part has no current sessions, and the screen code has no age threshold constant.

**L9. An upgraded app reloads an old page.** Each screen build carries its app version. When `hello.app_version` differs from it, the page reloads once.
Test: the HTTP adapter given a `hello` with another version calls reload once, and does not loop.

## Served mode

| Contract call | Window | Served |
| --- | --- | --- |
| `hello` | command `hello` | `GET /api/hello` |
| `view` | command `view` with `known` | `GET /api/projects/{id}/view`, ETag is the stamp, 304 when it matches |
| `subscribe` | command `subscribe` with a `Channel<Change>` | `GET /api/changes`, server-sent events, a comment line every 25 s |
| `sync` | command `sync` | `POST /api/projects/{id}/sync`, held open until it ends |
| `retry_sign_in` | command `retry_sign_in` | `POST /api/github/retry` |

Static files from L3 answer every other `GET`. An unknown path gets 404. The project in view stays in the address as `?map=<id>` in both modes, as the archive's screen does.

**L10. Loopback only, one fixed port.** `serve` binds `127.0.0.1:4317` and nothing else, never `0.0.0.0` or `::`. 4317 is the archive's port, so bookmarks and saved views keep their origin. A taken port is an error naming the port, exit 4, never a quiet move to another port. `--port 0` asks the OS for a free one. The first stdout line is `work-map serving http://127.0.0.1:<port>`. `--open` then opens it in the default browser.
Test: with 4317 taken, `serve` exits 4 and names the port; a connection to the machine's other addresses on that port is refused.

**L11. The archive's request guard, kept.** Every request needs a `Host` that is an IP address and a port, such as `127.0.0.1:<port>`, never a name. A DNS-rebinding page always arrives under its own name, so this blocks it. A mesh VPN that hands its inbound connections to loopback arrives under the host's VPN address, so the guide's VPN route works with no setting (Q5). An SSH tunnel arrives as `127.0.0.1` with the device's local port. An `Origin`, when sent, must equal `http://` and that `Host`. Browsers send no `Origin` on same-origin `GET`s and event streams, so those pass on `Host`. Each `POST` needs that exact `Origin`, `X-Work-Map: 1`, `Content-Type: application/json`, an empty body, and `Sec-Fetch-Site: same-origin` when present. The server never sends CORS headers. Every answer carries the same CSP as the window, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`, and `/api` answers carry `Cache-Control: no-store`.
Test: a `POST` with a foreign `Origin`, a missing header, a body, or `Host: localhost:<port>` gets 403 and starts no Sync; a `GET` with `Host: work.example:<port>` gets 403; a `GET` with `Host: 192.0.2.7:<port>` and no `Origin` gets 200.

**L12. The event stream stays well formed.** `/api/changes` answers 200 with `text/event-stream`. Any refusal happens before the stream starts. A browser's `EventSource` reconnects by itself after a dropped connection, and L6 makes that safe.
Test: closing the stream from the server leads the HTTP adapter to resubscribe and receive `hello` again.

## Window mode

**L13. Only the five commands, nothing more.** The capability file allows the five contract commands and no plugin (no file system, shell, HTTP or opener). The window loads only the embedded screen. Window mode opens no HTTP port. `useHttpsScheme` stays off for good, because changing it moves the Windows webview's storage and loses saved views.
Test: a build check fails when the capability file grants anything beyond the five commands, or when `tauri.conf.json` sets `useHttpsScheme` or a remote URL.

**L14. Dock and close behaviour.** On macOS, closing the window leaves the app in the Dock. The engine catches `ExitRequested` with no exit code and prevents it, and a Dock click (`Reopen`) opens the window again. Quit from the menu or Cmd-Q exits. On Windows and Linux, closing the last window quits the app. Release one has no tray icon. Seat Gauge is the tray app, and a Linux tray adds an appindicator dependency.
Test: on macOS, closing the window keeps the process alive and drops the viewer count to 0; on Linux, closing it ends the process.

## One running copy, and the kick

**L15. One instance per data folder.** At start the app takes an exclusive OS lock on `instance.lock` in the data folder and holds it until exit; the OS frees it after a crash. It then binds a control port on `127.0.0.1:0` and writes `instance.json` (owner-only, atomic replace) with its pid, mode, served URL, app version, control port and a fresh random 32-byte token. It removes `instance.json` on a clean exit. Tauri's single-instance plugin is not used: it needs the Tauri runtime, so it cannot guard `serve`.
Test: a second copy with the same `WORK_MAP_DIR` cannot take the lock; after a killed first copy, a new copy starts cleanly.

**L16. A second launch hands over and leaves.** A plain `work-map` launch that finds the lock held sends `show`. A window instance brings its window forward, or opens it on macOS. A served instance replies with its URL, and the second launch opens that URL in the browser. Either way the second launch exits 0. A second `serve` prints that a copy is already running, with its mode and URL, and exits 3.
Test: launching twice leaves one process and one window; `serve` beside a running window exits 3.

**L17. The control port.** One request per connection: a single JSON line of at most 4 KB, read within 2 seconds, answered with one JSON line. Requests are `{"token": "...", "op": "kick", "project": null}` or `{"token": "...", "op": "show"}`. A wrong token or a malformed line closes the connection with no answer. This port takes nothing else. An HTTP request sent to it fails as a malformed line.
Test: a request with the wrong token, a browser-style HTTP `POST`, and a 5 KB line all get no answer and change nothing.

**L18. `work-map kick` is the outside script's call.** It reads `instance.json`, sends `kick` for the named project or every project, prints one line, and exits 0 when the app took the kick. When no copy holds the lock it prints "work map is not running" and exits 3, and nothing queues (B14). Scripts that do not care add `|| true`. In the engine, a kick runs B5's poll at once, unless a kick already started a poll for that project in the last 30 seconds. Kicks follow B10 to B12 and never read cards. With no viewer (L19), a kick sends nothing, because the next viewer's arrival polls anyway.
Test: five `kick` calls in ten seconds produce one poll; `kick` with no app running exits 3; `kick` with no viewer sends no request.

## Polling only while someone looks

**L19. Viewers gate the timer.** A viewer is a window that exists (shown, hidden or minimised, so B4's "no slow-down when hidden" holds) or an open `/api/changes` stream. When the count rises from 0, the engine polls at once if the last poll is older than 300 seconds, then every 300 seconds (B4). When it falls to 0, the timer stops: at once for a window, after a 60-second grace for a served stream so a page reload does not cost a poll. While nobody looks, the engine sends no GitHub request and reads no Seat Gauge file. This narrows B4's "while it runs" for a served app that nobody has open.
Test: over a fake hour with no viewer the fake GitHub sees no request; a served page reloaded within 60 seconds causes no extra poll.

## Folders

The engine works out its folders with the `dirs` crate (the major version Tauri uses) and the identifier, so `serve` needs no Tauri handle. The results match Tauri's own path functions.

| Folder | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Data | `$HOME/Library/Application Support/com.launchastro.workmap/` | `%LOCALAPPDATA%\com.launchastro.workmap\` | `$XDG_DATA_HOME/com.launchastro.workmap/`, else `$HOME/.local/share/...` |
| Cache | `$HOME/Library/Caches/com.launchastro.workmap/` | `%LOCALAPPDATA%\com.launchastro.workmap\cache\` | `$XDG_CACHE_HOME/com.launchastro.workmap/`, else `$HOME/.cache/...` |
| Logs | `$HOME/Library/Logs/com.launchastro.workmap/` | data folder `\logs\` | data folder `/logs/` |

The data folder holds `settings.json` (the list of project configs, #11), `instance.lock`, `instance.json` and `projects/<id>/state.json` (the `store` module). The cache holds `http/`, B9's conditional-request cache, which is safe to delete. Logs hold B3's run log, rotated at 5 MB with three kept. Windows uses the local folder, not the roaming one, because the files describe one machine; Tauri's own cache folder there is the data folder itself, so the engine adds `cache\`. Tauri also keeps the webview's storage in the data folder on Windows and Linux; the engine touches only its own names.

**L20. Folders match Tauri and stay private.** `WORK_MAP_DIR`, when set and not empty, replaces the data folder, and the cache and logs go under it. Debug builds use the identifier `com.launchastro.workmap.dev`. On macOS and Linux the folders are mode 700 and `instance.json` is 600.
Test: on each OS's CI runner, the engine's data, cache and log folders equal Tauri's `app_local_data_dir`, `app_cache_dir` (plus `cache` on Windows) and `app_log_dir`; with `WORK_MAP_DIR` set, nothing is written outside it.

## The `gh` token

`gh auth token` prints the active account's token. When `GH_TOKEN` or `GITHUB_TOKEN` is set it prints that instead. Otherwise it reads `gh`'s config file or the OS credential store (the macOS login store, Windows Credential Manager, or the Linux Secret Service), giving the store up to 60 seconds. Where no credential store exists, as on a headless Linux machine, `gh auth login` falls back to a plain-text config file and `gh auth token` reads that. Signed out, it exits 1 with "no oauth token found for github.com". It first shipped in `gh` 2.17.

**L21. Find `gh` without a shell.** The engine uses `WORK_MAP_GH` when set. Otherwise it searches `PATH`, then known install folders: on macOS `/opt/homebrew/bin` and `/usr/local/bin`, because an app opened from the Dock or Finder does not get the shell's `PATH`; on Linux `/usr/bin`, `/usr/local/bin` and `/snap/bin`. It never runs the user's login shell to learn a `PATH`.
Test: with `PATH` emptied and a fake `gh` in a known folder, the engine finds it; with `WORK_MAP_GH` pointing at a fake, it runs that one.

**L22. Run it, keep it in memory.** The engine runs `gh auth token --hostname github.com` directly, with no shell, stdin closed, stdout and stderr captured and a 75-second limit. On Windows it starts `gh` with `CREATE_NO_WINDOW`, so no console window flashes. It passes no `--user`, so a token in the app's environment wins, as it does for `gh` itself. B1 governs the rest: one run at start, one more after a 401, never written to disk or a log.
Test: a fake `gh` that prints a token and a fake GitHub that answers 401 twice lead to two `gh` runs and `rejected`; the token string appears in no file the engine wrote.

**L23. Name the problem and offer Retry.** Polling stops and Sync is disabled in every state but `ready`. Cards keep their last values with their ages (B13). Retry re-runs L22.

| State | When | Header line |
| --- | --- | --- |
| `gh_missing` | no `gh` found | The GitHub CLI (`gh`) is not installed. Install it from cli.github.com, run `gh auth login`, then press Retry. |
| `gh_too_old` | `gh` has no `auth token` command | This `gh` is too old. Update it to 2.17 or later, then press Retry. |
| `signed_out` | exit 1 with "no oauth token" | `gh` is not signed in. Run `gh auth login` in a terminal, then press Retry. |
| `rejected` | 401 after the second token | GitHub refused `gh`'s login. Run `gh auth login` again, then press Retry. |
| `gh_failed` | timeout or any other failure | `gh` could not give a token: the first stderr line, at most 200 characters. Press Retry. |

Test: each fake `gh` behaviour (absent, unknown command, signed out, timeout, a stray error) yields its state and line, and Retry after a fix reaches `ready` and polls.

## Notes for other tickets

- #10 moves the screen into `web/`, writes the two adapters and drops the per-file polls, `mapPath` forwarding and the screen-side recounts.
- #11 owns `settings.json` and project config v2.
- #13: during the comparison the archive's engine already holds port 4317 on the build machine, so the new engine runs there with `--port`.
- Reaching a served map from another machine is settled (Q5): loopback only in release one, no network option. The getting-started guide (config-v2 outline, step 7) gives two routes: an SSH tunnel, and a mesh VPN whose client hands inbound connections to loopback.

## Sources

- Tauri: project structure, calling Rust, calling the frontend, configuration reference, single-instance plugin, system tray and the file-system plugin pages on v2.tauri.app; `Context`, `Assets`, `RunEvent` and `ExitRequestApi` on docs.rs; the path resolver, webview manager and runtime source in tauri-apps/tauri.
- `dirs` 7 on docs.rs for each OS's folders.
- Microsoft docs: AttachConsole, console creation and process creation flags.
- GitHub CLI manual: `gh auth token`, `gh auth login`, `gh auth status`, exit codes; the cli/cli source for the token order, the keyring timeout and the release notes for 2.17, 2.24 and 2.26.
- WHATWG HTML (server-sent events) and Fetch (when `Origin` is sent).
