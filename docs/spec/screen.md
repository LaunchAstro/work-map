# The screen in this repo

How the kept React screen moves from the private archive into `web/`, what it depends on, what changes now that the engine sends every number, what retired code stays behind, which tests come across, and how it is built and embedded. Resolves #10.

Inputs: the settled decisions in #3 (5, 9 and 10), the contract and layout in `docs/spec/app-layout.md` (L1 to L23), the module map in `docs/review/architecture.md`, the kept-screen rules and findings in `docs/review/thermonuclear.md` (TN-28 to TN-34, TN-52 to TN-57, TN-64, TN-71 to TN-85), and the archive's screen, build files and tests, read on 21 October 2026. Detail that names private things is in the private companion issue.

## The answer in short

- The drawing moves as it is: the diagram, cards, bars, call-outs, header, overview strip, loading bay, camera, zoom and pan, saved views and every Safari and Chrome fix. That is about 3,650 lines of TypeScript and 1,270 of CSS.
- About 800 lines that count, judge ages or re-validate go, because the engine now sends those numbers. About 300 lines of polling and per-map paths give way to one client module of about 320 lines. About 1,050 lines of retired features are cut.
- The one private dependency, a UI token package fetched by git at a pinned commit, is replaced by a 60-line token sheet in `web/` and three open font packages from npm.
- Every copied file is relicensed from AGPL to MIT. The maintainer is the only author of the archive's screen, build files and tests.
- Node and pnpm are needed only to build the screen: by contributors working on it and by hosted release builds. Users get a binary with `web/dist` inside it (L3).
- About 2,700 lines of screen tests come across, rewritten against generated types. The engine-maths cases move to Rust. Retired and review-round proofs stay behind, apart from four browser cases copied into a new self-contained suite.

## Dependencies and what replaces each

The screen itself imports only React and React DOM. Everything else it pulls in arrives through the archive's engine code, which it imports from nineteen core modules (AR-07).

| Dependency | Public? | In this repo |
| --- | --- | --- |
| `react`, `react-dom` 19 | npm, MIT | Kept, pinned as the archive pins them |
| A private UI token package, fetched by git at a pinned commit | No, never published to npm | Gone. Its tokens and resets are copied into `web/src/styles/tokens.css` (S2) |
| That package's font imports | The three font packages are on npm under OFL-1.1 | `@fontsource/funnel-display`, `@fontsource-variable/funnel-sans` and `@fontsource-variable/chivo-mono`, as direct dependencies (S3) |
| That package's icon library | npm | Gone. The screen never used it |
| `zod`, via the core validators | npm | Gone. Generated types replace runtime checks (S8) |
| The archive's core modules (ticket counting, scope, Seat Gauge, time, freshness, contract) | Private archive | Gone. The engine sends their results (S7) |
| `@tauri-apps/api` | npm, MIT or Apache-2.0 | Added, for `invoke` and `Channel` in the window adapter only |
| Dev only: Vite, the React plugin, TypeScript, Vitest, jsdom, Playwright, oxlint, Prettier | npm | Kept at the archive's pins |

**S1. Every copied file is MIT.** The archive's files carry an AGPL-3.0-only SPDX header and its package says AGPL. The maintainer wrote every commit, so the copy is relicensed under settled decision 3, and each header becomes `SPDX-License-Identifier: MIT`.
Test: a repo test fails when any file under `web/` mentions AGPL, or when a source file under `web/src` lacks the MIT header.

**S2. The tokens live in this repo.** The screen uses five colour primitives (paper, cream paper, ink, muted ink, faint ink) and three font stacks from the package. It overrides the package's accent and rule colours and its whole dark theme already. It also relies on the package's base resets: box sizing, font smoothing, block SVGs, buttons that inherit their font, the focus ring, medium-weight bold and reduced motion. `web/src/styles/tokens.css` holds exactly those values, about 60 lines. The maintainer owns them, so they ship under MIT. The private companion issue lists them.
Test: every `var(--name)` used under `web/src` resolves to a property defined under `web/src`, so no outside sheet is needed.

**S3. Fonts are bundled, never fetched.** The three families load from their npm packages, Latin subsets only, in the weights the archive loads. Vite copies the font files into `web/dist`, so the binary carries them. The three OFL licence texts sit in `web/public/licences/` and ship with the build.
Test: the browser suite records every request the page makes and fails on any URL off the page's origin; a build check finds the three licence files in `web/dist`.

## Layout of `web/`

```text
web/
├── package.json, pnpm-lock.yaml   private, MIT, Node and pnpm pinned (S16)
├── index.html, vite.config.ts, tsconfig.json
├── public/      icons, first-paint.js, licences/
├── src/
│   ├── contract/     generated from engine::contract (L5)
│   ├── transport/    the one client module (S5)
│   ├── styles/       tokens.css, fonts.css, the archive's flow sheets
│   └── *.ts, *.tsx   the archive's screen files, flat, as today
└── test/        unit (Vitest, jsdom), browser (Playwright), fixtures/
```

**S4. No inline script or style.** The archive paints the saved dark theme from an inline script in `index.html` (TN-34). It moves to `public/first-paint.js`, a plain blocking script in `<head>`, so one CSP serves both modes: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. React's `style` props go through the CSSOM, which `style-src` does not block. Vite's asset inlining is off, so nothing becomes a `data:` address. The script reads the same storage keys as `saved-view.ts` (TN-81).
Test: the browser suite loads the built screen under this header in both engines and sees no `securitypolicyviolation`; a unit test checks the keys in `first-paint.js` equal the constants in `saved-view.ts`; the archive's first-paint theme test comes across.

## The contract client

**S5. One client module.** `web/src/transport/` holds `index.ts`, which picks the adapter once (L4), plus `tauri.ts` and `http.ts`. It is the only code that touches `fetch`, `EventSource`, `invoke` or `Channel`. The HTTP adapter sends L11's headers on each `POST` and reloads once on a version change (L9). About 200 lines.
Test: L4's shared contract suite runs against both adapters; an oxlint rule fails on those four names or a `@tauri-apps` import outside `transport/`.

**S6. `useMap` replaces the polls.** One hook of about 120 lines holds the `hello`, the project in the address (`?map=<id>`, as today) and its view. On a notice whose stamp differs it fetches the view. It keeps the painted board until the newly chosen map's view arrives, and drops any reply for a map no longer in the address. The five archive polls, the per-map path prefix and the hooks with no callers go (TN-28, TN-57, TN-82).
Test: switching from map A to map B while A's view is slow never paints A after B; a Sync on A that finishes while B is shown leaves B on screen (the archive's map-switch case).

## What changes because the engine sends the numbers

**S7. The screen draws and never counts.** It does no arithmetic on counts, shares or ages. Bar widths use each segment's exact share and labels use its shown share, which the engine rounds jointly to 100. Card tone, stage rollups, Next up order, spec closure, momentum, days left, the twelve merge-chart hours, Seat Gauge qualification and every part's freshness arrive computed (L8, AR-06, AR-07, AR-12). Arithmetic stays only for geometry: the camera, wires, call-out placement and the merge chart's axis.
Test: nothing under `web/src` imports engine code; a fixture whose shown shares differ from a fresh rounding of the exact ones renders the shown values.

**S8. No input checks.** The archive rejects the whole snapshot unless retired sweep and legacy measure fields are present, rejects the agents file without retired lane fields, and recounts the ticket census (TN-64). All of that goes in the same change. Types come from Rust (L5), and the engine's own tests prove the maths.
Test: the screen bundle contains no validator or schema library, and a view with every optional part `null` renders.

**S9. Times in the viewer's zone.** One `time.ts` formats instants with `Intl.DateTimeFormat` in the viewer's locale and zone, replacing the fixed UTC+10 formatter (TN-56). An instant up to five minutes ahead of the viewer's clock reads "just now", not "not yet read" (TN-72). The only timer re-renders relative times every 30 seconds and on `visibilitychange`, as the archive does.
Test: under `TZ=America/New_York` and `TZ=Asia/Kolkata` the same instant shows each zone's local time; an instant one second ahead says "just now".

The view's inner shapes, as the screen needs them (the build ticket writes the exact `ts-rs` types):

```ts
interface Board {
  title: string; header: { bars: Bar[]; tickets: TicketCounts | null; days_left: number | null; unplaced_prs: PrRef[] };
  stages: { id: string; title: string; bars: Bar[] }[];
  cards: Card[];                       // drawing order
  wires: { from: WireEnd; to: WireEnd; gap: number | null; lane: number; kind: "flow" | "dash" | "loop" | "blocker" | "dependency"; label: string | null }[];   // WireEnd = { id; side: "l" | "r" | "t" | "b"; offset }, as RF12
}
interface Card {
  id: string; title: string; text: string; stage: string; row: number;
  tone: "unstarted" | "plain" | "above_90";
  bars: Bar[];                         // progress, tickets, review, as the basis uses them
  tickets: TicketCounts | null;        // completed, total, absorbed, dropped, unknown, bugs open and fixed
  momentum: { kind: "moved"; tickets: number; days: number } | { kind: "quiet"; days: number } | null;
  days_left: number | null; last_merge: Instant | null;
  next_up: { group: "in_pr" | "unblocked" | "blocked"; ticket: TicketRef; blockers: TicketRef[] }[];
  open_prs: PrRef[]; unreviewed_merged: PrRef[];
  planning: { step: "map" | "tickets" | "spec" | "build"; state: "done" | "missing" | "pending" }[];
}
interface Bar {
  kind: "progress" | "tickets" | "review";
  segments: { tone: "live" | "merged" | "rest" | "reviewed" | "completed"; exact: number; shown: number; count: number | null }[];
  pending: PendingWhy | null;          // a closed list of reason codes; the screen holds the words
}
interface MergeFlow {
  hours: { start: Instant; end: Instant; merges: number }[];   // twelve clock hours, newest last
  average: number; last_hour: number; queue: { length: number; first: PrRef[] }; loading_bay: BayRow[];
}
interface Agents { cards: Record<string, { open: Session[]; last_closed: Session | null; total: number }>; unmapped: number }
```

`Versions` and `GapReport` are what the `versions` and `map_gaps` modules return. The engine buckets merge hours on the machine's local hour boundaries. `serve` is loopback only (L10, Q5), so the viewer is normally on that machine and the labels match. A viewer on another device, through the guide's tunnel or mesh VPN, sees bars on the host's hours. The scope bar has no `built` segment (Q3, MC-39).

**S10. Every reason code has words.** The pending words, the zero-segment filter and the "<1%" label live in one module (TN-81).
Test: a type check fails when a `PendingWhy` code has no entry in the words table.

**S11. GitHub states and Sync.** The header draws L23's line for each `GitHubState`, with a Retry button that calls `retrySignIn`, and disables Sync in every state but `ready`. The Sync button draws each `SyncOutcome` kind and stays disabled while one runs. Its label drops "and round context".
Test: each state and outcome fixture renders its line and the right enabled state.

**S20. A newer release is one footer line.** When `hello.newer_release` is set (release spec R16), the footer says "Work map 1.3.0 is out on GitHub Releases." The line is a link to `url` in both modes; in the window S14's handler passes it to the OS browser. There is no dismiss button and no download.
Test: a `hello` fixture with `newer_release` shows the line as a link in both modes, and in a window build a click reaches the fake opener (S14); without it the footer has no such line.

## What is cut

| Retired feature | Screen code cut | Rough lines |
| --- | --- | --- |
| Codex audit, with scan status | Three audit panels, the audit reader and its Sync step, the scan line, the audit stylesheet, and the audit and scan lines in the app shell, board, card, header and call-out | 660 in whole files, about 150 woven |
| Estimated scope | The estimate module and the estimate lines in the section brief and bar models | 18, about 30 woven |
| Luna re-checks | The five-second status poll and the re-check lines in the shell, board, card, header and Sync | about 70 |
| Deep sync | The button, its confirm dialog and its Sync request | 55, about 50 woven |
| Sweeps, direct herdr reads | Only the retired fields the validators demanded, which go with S8 | in S8 |
| Local-model runtime, launchd jobs | None in the screen | 0 |

TN-83's dead CSS goes too: 24 rules, about 120 lines.

## Safari and Chrome fixes that survive

The window runs on WebKit on macOS and Linux and on Chromium (WebView2) on Windows, so the archive's two browser engines are exactly the three webviews.

| Fix | Pinned by |
| --- | --- |
| F1. The board scales with CSS `zoom`, not a transform, and frames, bars and dividers are real 1 px borders, never inset shadows, so both engines snap them to device pixels at fractional zoom (TN-31) | The archive's browser case, copied: computed border widths at zoom 1, 0.868 and 1.02 in Chromium and WebKit, each engine with its own expected width |
| F2. Geometry changes under half a pixel are ignored, because Chromium snaps layout to 1/64 px at each zoom and would re-home the camera every frame (TN-30) | The camera unit test for half-pixel geometry, and the hook test that cumulative changes still apply |
| F3. Safari's trackpad pinch through its own gesture events with a cumulative scale; Chrome's pinch as Ctrl and wheel; Command and wheel for a mouse (TN-32) | Hook tests with synthetic gesture and wheel events; a manual pinch check in the macOS window at each release, since no runner has a trackpad |
| F4. The wheel listener is non-passive, so its `preventDefault` stops page scroll and page zoom | A browser case: Ctrl and wheel zooms the map, and the page's scroll position stays at 0 |
| F5. `user-select: none` with the `-webkit-` prefix on the board, text selection kept in call-outs, `-webkit-user-drag: none` on links, and `dragstart` cancelled (TN-33) | A new self-contained browser case in both engines: a drag across a card and its link selects no text, follows no link and opens no card (TN-71) |
| F6. Native scroll on the clipping viewport is zeroed, never turned into a pan, since focus scrolls even an `overflow: hidden` box | A hook test: a scroll event leaves the view unchanged and resets the scroll to 0 |
| F7. Safari's disclosure marker is hidden on the section brief's groups | A WebKit browser case on the marker's computed style |
| F8. One 228 px column at every stage count, and header controls on one row at 1,080 px | The archive's two- and four-stage case and its header-row case, copied, in both engines |

## Fixes made in the move

**S12. Modifier keys pass through.** The 0, + and − shortcuts ignore any press with Command, Ctrl or Alt, so the browser keeps its own zoom in served mode (TN-52).
Test: each shortcut pressed with each modifier leaves the camera unchanged and is not prevented.

**S13. Cards open with Space as well as Enter** (TN-53).
Test: Space on a focused card pins its call-out.

**S14. Links leave the window for the default browser.** Links keep `target="_blank" rel="noreferrer"`. In the window, the app's navigation and new-window handlers keep the webview on the embedded screen and hand `https:` addresses to the OS from Rust. The webview gets no opener permission, so L13 stands. The section brief's Copy uses `navigator.clipboard.writeText` inside the click, with no plugin.
Test: in a window build with a fake opener, a click on a PR link leaves the window on the map and passes that URL; a `file:` or `javascript:` link opens nothing; Copy is checked by hand in each OS window at release.

**S15. Saved views stay per origin.** The window's origin differs by OS and from served mode, so window and served pages keep separate saved views. Served on 4317, the archive's saved views carry over when map ids match (L10).
Test: the archive's saved-view tests come across unchanged, blocked storage included.

## Tests that come across

82 archive test files, 13,525 lines, touch the screen.

| Group | Files, lines | Fate |
| --- | --- | --- |
| Drawing and interaction: camera, call-out placement, inspection, saved view, theme, icon, bars, card face, loading bay, tabs, map switch, Seat Gauge pills, keep-last, ticket inventory, days left, Sync, header row | 25, about 2,700 | Rewritten against generated fixtures, about 2,000 lines |
| Numbers the screen used to work out: meters, stages, Next up, clock hours, freshness, absorption, spec closure | 16, about 2,200 | Cases move to the engine's Rust tests (#6 lists them) |
| Retired features | 11, about 3,100 | Cut |
| Review-round proofs and validator tests | 30, about 5,500 | Dropped (TN-84, TN-85), except the browser cases in F1, F5 and F8 and the map-switch case in S6 |

**S16. Screen tests need no Rust and no dev server.** Unit tests run in Vitest with jsdom. The browser suite runs Playwright's Chromium and WebKit against the built `web/dist`, served by a small Node server that answers L4's routes from fixture files. The fixtures in `web/test/fixtures/` are views the engine writes from the example project (#11), never written by hand.
Test: a Rust test regenerates the fixtures and fails on any difference; `pnpm --dir web test` passes on a machine with no Rust toolchain.

## The build

**S17. Node only to build the screen.** `web/package.json` is private and MIT, pins `packageManager` to the archive's pnpm and `engines.node` to Node 24, and commits its lockfile. It keeps the archive's install hardening: a seven-day minimum release age, no dependency build scripts, no exotic sub-dependencies and no trust downgrades. Released binaries need neither.
Test: on a hosted runner with no Node on `PATH`, the released binary's `work-map serve --port 0` serves the screen (L2, L3).

**S18. Only the app crate needs `web/dist`.** Tauri embeds `web/dist` in the binary at compile time, and `serve` hands the same embedded files to the server (L3). `cargo test -p engine -p server` needs no Node; the server's tests use a fake `Assets`. Tauri's `beforeBuildCommand` runs `pnpm --dir web build` and `beforeDevCommand` starts Vite on `127.0.0.1:4318`, the archive's dev port. A plain `cargo build` of the app with no `web/dist` stops with one line naming that command.
Test: on a clean checkout, the engine and server tests pass without Node, and the app build fails with that line.

**S19. The build knows its version.** `vite.config.ts` reads the workspace version from `Cargo.toml` and bakes it into the screen for L9. The archive's dev-data middleware goes. In dev, Vite proxies `/api` to a running `work-map serve --port 4319` and rewrites `Host` and `Origin` to that address, so L11's guard passes.
Test: the version in the built screen equals `cargo metadata`'s workspace version.

## Notes for other tickets

- #6 takes the engine-maths test cases above, and TN-65's two hour rules on one strip, since the engine now sends both numbers.
- #9: S4 states the CSP that L11 and L13 refer to, and S14 adds the window's navigation handler, which L13 does not mention. S20 follows R16 as written; if #9 accepts S14, the window's release line could become a link too.
- #11's project ids become the saved-view keys (S15).
- #16 gets one build ticket for the move (S1 to S3, S8, the cuts) and one each for S5 and S6, the numbers handover (S7, S9 to S11), the browser suite (S16, F1 to F8) and the build (S17 to S19).

## Sources

- The archive's screen folder, `index.html`, `public/`, `vite.config.ts`, `tsconfig.web.json`, `package.json`, its pnpm settings and the 82 screen test files.
- The token package's stylesheets and package file at the archive's pin, read only.
- npm's registry for the three font packages (OFL-1.1, 5.3.0) and `@tauri-apps/api` (2.12).
- Tauri v2 docs: configuration reference (`frontendDist`, `devUrl`, `beforeBuildCommand`, CSP) and the webview per OS.
