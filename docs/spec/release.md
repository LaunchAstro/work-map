# Release packaging

What each release ships for each OS, how hosted runners build it and attach it to a GitHub Release at no cost, how the Windows console and a Linux machine with no display are handled, how versions work, how the app learns of a newer release, and what the README tells someone opening an unsigned app for the first time. Resolves #14.

Inputs: the settled decisions in #3 (2, 5, 6, 7, 16, 17), the build method in #2's Notes, `docs/spec/app-layout.md` (L1 to L23) and `docs/spec/github-budget.md` (B1 to B14). Facts were read from primary docs on 21 October 2026 and are listed at the end.

## The answer in short

- Six downloads per release, all unsigned, plus `SHA256SUMS`: one universal macOS disk image, one Windows setup program, a Linux AppImage and deb, and a headless Linux build for x86_64 and aarch64.
- One workflow, `.github/workflows/build.yml`, runs on every push and pull request on macOS, Windows and Linux. No branch rule waits for it. On a `v*` tag it also builds the bundles and publishes them to a GitHub Release. It uses standard runners and `GITHUB_TOKEN` only, so it costs nothing on a public repo.
- On Windows, `work-map.exe` is the window and a console companion, `work-map-cli.exe`, runs `serve`, `kick` and `dump` in a terminal. Shells wait for the companion and see its exit code.
- The headless build is the same app crate built without its `window` feature. It has no Tauri, GTK or WebKit in it. It is the Linux server download and also the Windows companion.
- One semver version for the binary and the screen, set once in the workspace `Cargo.toml`. Tags are `vX.Y.Z`. Release one is `v1.0.0`.
- While open, the app checks GitHub Releases at most once a day and shows one quiet line when a newer version is out. It never downloads or installs anything.

## Facts that shape it

- Tauri 2 makes `.app` and `.dmg` on macOS, `.msi` (WiX, Windows only) and NSIS `-setup.exe` on Windows, and `.deb`, `.rpm` and `.AppImage` on Linux. Each must be built on its own OS. NSIS installs per user into `%LOCALAPPDATA%\<productName>` with no administrator rights by default. The default WebView2 mode downloads the runtime only when it is missing; Windows 10 1803 and later ship it.
- Platform files (`tauri.windows.conf.json` and the like) merge into `tauri.conf.json` by JSON Merge Patch, and arrays are replaced whole. With no `version` in the Tauri config, Tauri uses the crate's version.
- `bundle.externalBin` copies extra binaries into the bundle next to the main binary, with the `-<target triple>` suffix removed from the name.
- The Linux build needs WebKitGTK 4.1. Build on the oldest base you support: Ubuntu 22.04 or Debian 12. The deb depends on `libwebkit2gtk-4.1-0` and `libgtk-3-0`. An AppImage carries its libraries but needs FUSE 2 (`libfuse2`, renamed `libfuse2t64` in Ubuntu 24.04), or `--appimage-extract-and-run`.
- GitHub Actions is free for public repositories on standard GitHub-hosted runners, macOS and Windows included. Larger runners are billed even on public repos. `macos-latest` is Apple Silicon. `ubuntu-22.04-arm` is a standard runner for public repos.
- `GET /repos/{owner}/{repo}/releases/latest` returns the newest release that is neither a draft nor a prerelease.
- A Windows GUI-subsystem program gets no console, and cmd and PowerShell do not wait for it. `AttachConsole(ATTACH_PARENT_PROCESS)` lets it write to the parent's console, but the shell has already moved on. The `consoleAllocationPolicy` manifest setting, which gives a console program GUI behaviour from Explorer, needs Windows 11 24H2.
- Since macOS 15, Control-click Open no longer overrides Gatekeeper. The user goes to System Settings, Privacy & Security, and clicks Open Anyway, within about an hour of the blocked try. Apple Silicon needs every downloaded app signed, and an ad-hoc signature (`signingIdentity: "-"`) is enough to reach that path.
- SmartScreen blocks a new unsigned program with "Windows protected your PC". "More info" then "Run anyway" lets it through. Smart App Control, which Windows 11 turns on by itself on many new installs, blocks unsigned apps and has no per-app override.
- The `gh` MSI, which winget also installs, puts `gh.exe` in `%ProgramFiles%\GitHub CLI\`, adds that folder to the system `PATH` and records it under `HKLM\SOFTWARE\GitHub\CLI`, value `InstallDir`.

## Artefacts

`productName` is `Work Map`, `mainBinaryName` is `work-map`, and the identifier stays `com.launchastro.workmap` (L20). The workflow renames Tauri's output to these names. `<v>` is the version without the `v`.

| Download | OS | Contents |
| --- | --- | --- |
| `work-map-<v>-macos-universal.dmg` | macOS, Intel and Apple Silicon | `Work Map.app`, ad-hoc signed, not notarised |
| `work-map-<v>-windows-x64-setup.exe` | Windows 10 and 11, x64 (Windows 11 on Arm runs it emulated) | NSIS per-user installer with `work-map.exe` and `work-map-cli.exe` |
| `work-map-<v>-linux-x86_64.AppImage` | Linux x86_64, glibc 2.35 or later | the window app with its GTK and WebKitGTK |
| `work-map-<v>-linux-x86_64.deb` | Ubuntu 22.04 or later, Debian 12 or later | the window app, installs `/usr/bin/work-map` |
| `work-map-headless-<v>-linux-x86_64.tar.gz` | Linux x86_64, glibc 2.35 or later | `work-map` (no window), `LICENSE`, `README.md` |
| `work-map-headless-<v>-linux-aarch64.tar.gz` | Linux aarch64, glibc 2.35 or later | the same for Arm servers |
| `SHA256SUMS` | all | one line per download above |

**R1. Exactly these assets, all unsigned.** No MSI (it needs administrator rights and WiX), no rpm, Flatpak or Snap, no Windows Arm build and no macOS headless build in release one. On macOS the app's own binary runs `serve`, `kick` and `dump`.
Check: the publish job compares the release's asset names with the table for the tag's version and fails on any difference; `SHA256SUMS` matches every file.

**R2. The Mac app carries an ad-hoc signature.** `tauri.macos.conf.json` sets `bundle.macOS.signingIdentity` to `-` and `bundle.targets` to `["app", "dmg"]`, built with `--target universal-apple-darwin`. Without a signature an Apple Silicon Mac reports the download as damaged rather than unverified.
Check: on the macOS runner, `codesign --verify --deep --strict` passes on the built app and `lipo -archs` on its binary lists `x86_64 arm64`.

## The headless build

**R3. One crate, a `window` feature.** The app crate has a default feature `window` that brings in Tauri. Built with `--no-default-features`, the binary has `serve`, `kick` and `dump`, and a plain launch prints "this build has no window, run `work-map serve`" and exits 2. It serves the screen through L3's `rust-embed` adapter, so that fallback is required for this build. The window build keeps `Context::assets()`.
Check: `cargo tree -p work-map --no-default-features` lists no `tauri`, `gtk` or `webkit2gtk`; on Linux `ldd` on the binary shows no `libgtk` or `libwebkit`; L2's no-display test and L3's same-bytes test pass against it.

**R4. Linux bundles.** `tauri.linux.conf.json` sets `bundle.targets` to `["deb", "appimage"]`, built on `ubuntu-22.04` for the glibc floor. The headless build is built on `ubuntu-22.04` and `ubuntu-22.04-arm`. A `serve` on a server or a machine with no display uses the headless tarball. The AppImage and deb need a desktop session for the window.
Check: the bundle job installs the deb in a clean `ubuntu-22.04` container with `apt-get install ./<file>.deb`, and `work-map serve --port 0` reaches its serving line there with no display; the headless binary does the same on a runner with no WebKitGTK installed.

**R5. A headless `gh` login is `gh`'s own plain file.** On a Linux machine with no Secret Service, `gh auth login` stores the token in `$HOME/.config/gh/hosts.yml` in plain text. The engine reads it only through `gh auth token` (L22) and never copies it. The README offers `GH_TOKEN` in the `serve` process's environment as the alternative.
Check: with a fake `gh` reading a fake `hosts.yml` under `HOME`, no file the engine writes contains the token.

## Windows console

**R6. A console companion, not console attach.** The window stays a GUI-subsystem program. Attaching to the parent console prints text, but cmd and PowerShell have already returned, so the prompt mixes with the output, Ctrl-C does not reach the program, and scripts never see `kick`'s exit code. The manifest route needs Windows 11 24H2 and opens a console window from the Start menu on older Windows. So the headless build (R3), compiled for the console subsystem, ships as `work-map-cli.exe`. `tauri.windows.conf.json` lists it in `bundle.externalBin` (the workflow stages it as `binaries/work-map-cli-x86_64-pc-windows-msvc.exe`) and sets `bundle.targets` to `["nsis"]`, so it installs next to `work-map.exe` in `%LOCALAPPDATA%\Work Map\`. The installer does not change `PATH`.
Check: on the Windows runner, after a silent install, `& "$env:LOCALAPPDATA\Work Map\work-map-cli.exe" kick` in PowerShell prints "work map is not running" and sets `$LASTEXITCODE` to 3.

**R7. The window binary refuses terminal commands.** `work-map.exe serve`, `kick`, `dump`, `where` or `sections` calls `AttachConsole(ATTACH_PARENT_PROCESS)`. When that succeeds it prints "On Windows, run work-map-cli <same arguments>" and exits 2. With no parent console it exits 2 silently. It never runs those commands.
Check: `work-map.exe kick` started from a test harness with a pipe as stdout exits 2 and starts no control-port connection.

**R8. Finding `gh` on Windows.** After `WORK_MAP_GH` and `PATH` (L21), the engine tries the `InstallDir` value under `HKLM\SOFTWARE\GitHub\CLI`, then `%ProgramFiles%\GitHub CLI\gh.exe`, then `%USERPROFILE%\scoop\shims\gh.exe`. It starts `gh` with `CREATE_NO_WINDOW` (L22), so no console window flashes.
Check: with `PATH` emptied and a fake `gh.exe` in each known folder in turn, the engine finds it.

## Workflow

**R9. One workflow, two jobs that never block a merge.** `build.yml` runs on `pull_request`, on `push` to `main` and `v*` tags, and on `workflow_dispatch`. The `test` job runs on `ubuntu-22.04`, `windows-latest` and `macos-latest`: `pnpm install --frozen-lockfile` (S17), type check, tests and build in `web/`, then `cargo fmt --check`, `cargo clippy --workspace -- -D warnings`, `cargo test --workspace` and the headless build. The `bundle` job runs on pushes and tags, not on pull requests, and builds every artefact in R1 with `cargo tauri build` (the Tauri CLI pinned in `web/package.json`). No branch rule requires either job, as #2's Notes ask. Runs on a pull request cancel the older run for the same branch.
Check: the repository's branch rules list no required status checks; a pull request with a failing test can still merge.

**R10. Free by construction.** Every `runs-on` label is a standard runner from the list above. No larger runner, no paid add-on, no secret beyond `GITHUB_TOKEN`. Actions are pinned to full commit hashes. The workflow's default permission is `contents: read`. Only the release jobs ask for `contents: write`, and only the report job asks for `issues: write`.
Check: a repo test parses `build.yml` and fails on a `runs-on` label outside the standard list, a `secrets.` name other than `GITHUB_TOKEN`, an action not pinned to a 40-character hash, or a write permission at workflow level.

**R11. A tag publishes a complete release or nothing.** On a `v*` tag, a `draft` job checks that the tag equals `v` plus the workspace version (R13), then runs `gh release create <tag> --draft --verify-tag --generate-notes`. Each bundle job uploads its renamed files with `gh release upload --clobber`. A `publish` job, after every bundle job passes, writes and uploads `SHA256SUMS`, runs R1's asset check and then `gh release edit <tag> --draft=false`, adding `--prerelease` when the tag has a hyphen. A failed bundle leaves a draft, which "latest" never returns. Re-running the failed jobs finishes it.
Check: a test tag `v0.0.1-rc.1` produces a prerelease with exactly R1's assets; a run with one bundle job forced to fail leaves only a draft.

**R12. A red run on `main` becomes a ticket.** A `report` job runs when any job fails on a push to `main`, a tag or a manual run. It opens an issue titled "Hosted build red on main" with the label `hosted-build-red` and the run's link, or comments on the open one. It never closes issues.
Check: a manual run with the `fail` input set, which makes `test` fail on purpose, opens one issue; a second such run comments on it.

## Versions

**R13. One version, set once.** The workspace `Cargo.toml` holds `[workspace.package] version`, and every crate uses `version.workspace = true`. `tauri.conf.json` has no `version`, so bundles take the crate's. `web/package.json` carries the same version, and the screen build embeds it for L9. `hello.app_version` is that version. The contract number in `Hello` is separate and changes only with the contract.
Check: a Rust test reads `Cargo.toml`, `web/package.json` and `tauri.conf.json` and fails unless the first two match and the third has no `version`.

**R14. Semver tags.** Tags are `vMAJOR.MINOR.PATCH`, with `-rc.N` for prereleases. A major bump means a change that breaks a user's `settings.json`, the command lines of `serve`, `kick`, `dump`, `where` or `sections`, their exit codes, or the data folder's names. A minor bump adds features. A patch fixes. Release one is `v1.0.0`, tagged after switch-over (#3, decision 15). Builds before it are `v1.0.0-rc.N`. A version bump is its own small PR, and the tag goes on its merge commit.
Check: the `draft` job rejects a tag that is not semver or does not match the workspace version.

## Newer release notice

**R15. A quiet check, at most once a day, while someone looks.** The engine asks `GET /repos/LaunchAstro/work-map/releases/latest` only while a viewer exists (L19) and GitHub is `ready`, no sooner than 10 minutes after start, and no more than once in 24 hours, with the last check time kept in the data folder's `update.json`. It goes through the engine's GitHub port: one request in flight (B2), logged with its cost (B3), conditional with the stored ETag so an unchanged answer is a free 304 (B9), skipped under the light floor (B10) or during any pause (B12), and never retried. A failure waits for the next day. That is about one REST request a day, almost always free.
Check: over a fake 72 hours with a viewer, the fake GitHub sees three requests to that path, the second and third conditional; with no viewer, or under the floor, it sees none.

**R16. One line, no auto-update.** When the latest `tag_name` is a higher semver than the app's own version, `Hello` gains `newer_release: { version, url }`, with `url` the release's `html_url`, accepted only when it starts with `https://github.com/LaunchAstro/work-map/releases/`. The screen shows one line in the footer: "Work map 1.3.0 is out on GitHub Releases." It is a link in both modes. In the window, S14's navigation handler hands the `https:` address to the OS browser from Rust, so the webview still has no opener permission (L13). There is no download, no Tauri updater and no dismiss button. `"check_for_updates": false` in `settings.json` or `WORK_MAP_NO_UPDATE_CHECK=1` turns the check off.
Check: a fake answer with a higher tag puts `newer_release` in `hello` and the footer line on screen; an equal or lower tag, or a foreign `html_url`, adds nothing; with the setting off, no request goes out.

## README first-launch text

**R17. The README carries this text, kept short.** The README's install section uses the text below, with the version in the file names left as `<version>`.
Check: the README's install section contains these four headings and the `xattr` line verbatim.

> **These downloads are not signed.** Signing costs money each year, so macOS and Windows will warn you the first time. Check the download against `SHA256SUMS` on the release page if you like.
>
> **macOS.** Open the `.dmg` and drag Work Map to Applications. Open it once. macOS says it cannot check the app; click Done. Open System Settings, then Privacy & Security, scroll to Security and click Open Anyway, then enter your password. Do this within an hour of the first try. If macOS says the app is damaged, run `xattr -dr com.apple.quarantine "/Applications/Work Map.app"` in Terminal and open it again. To use it from a terminal, add `alias work-map="/Applications/Work Map.app/Contents/MacOS/work-map"` to your shell profile.
>
> **Windows.** Run the setup program. If Windows says "Windows protected your PC", click More info, then Run anyway. If your browser holds the download back, choose Keep. If Smart App Control is on, Windows blocks unsigned apps with no way round it, and Work Map cannot run on that PC. In a terminal, use `work-map-cli` from `%LOCALAPPDATA%\Work Map\` for `serve` and `kick`.
>
> **Linux.** For a desktop, install the `.deb`, or make the AppImage executable and run it (it needs `libfuse2`, called `libfuse2t64` on Ubuntu 24.04). For a server with no display, unpack the headless tarball and run `./work-map serve`. Where `gh` has no keyring it keeps its login in a plain-text file; you can set `GH_TOKEN` for the `serve` process instead.

## Notes for other tickets

- #9 and #10: `Hello` gains `newer_release` (R16). The window shows the notice as a link through S14's handler, with no opener permission (L13).
- #11: `settings.json` gains `check_for_updates`, default true.
- #13: parity runs use the headless build on the build machine.

## Sources

- Tauri v2 docs: Distribute, Windows Installer, AppImage, Debian, macOS code signing, Sidecar, Configuration Files, Prerequisites, GitHub pipeline; tauri-apps/tauri-action README; the tauri-bundler source (external binary copy, NSIS install folder).
- GitHub docs: Actions billing, GitHub-hosted runners reference, REST releases ("Get the latest release").
- Microsoft Learn: AttachConsole, Console Allocation Policy; Microsoft Support: Smart App Control.
- Apple: Mac User Guide, "Open a Mac app from an unknown developer"; Apple Developer news, "Updates to runtime protection in macOS Sequoia" (6 August 2024).
- AppImage docs: FUSE troubleshooting. cli/cli: `docs/install_windows.md` and `build/windows/gh.wxs`.
