# Agent guide

Read `README.md`, `CONTRIBUTING.md` and `docs/config.md` before changing anything. `CONTRACT.md` describes the two files the page reads, `snapshot.json` and `agents.json`.

## Layout

- `src/readers/`: reads GitHub (through `gh`, queries only), the project's roadmap files and the optional local integrations.
- `src/core/`: pure logic that turns those reads into the published read models. It reads nothing itself.
- `src/cli/`: the collectors (`generate.ts`) and the loopback server (`serve.ts`).
- `src/web/`: the React page.
- `ops/`: the installer and the launchd job runner.
- `examples/demo/`: the example project, with a recorded GitHub read.

## Rules

- Tests first: a test that fails for the right reason, then the change.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` and `pnpm build` before you push.
- Project names, sections, labels and conventions come from the project's config, never from the code.
- Read-only: no GitHub writes, no network listener beyond `127.0.0.1`, no paid API and no model calls.
- A new GitHub read must say what it costs in GraphQL points; the map shares the user's hourly budget.
- Runtime data stays in the data folder, outside Git.
- Australian English in docs, comments and messages.
