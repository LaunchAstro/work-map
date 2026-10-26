# Contributing

Thanks for helping. Bug reports, config questions and pull requests are all welcome. For a security problem, follow `SECURITY.md` instead of opening an issue.

## Set up

You need macOS, Node 24 and pnpm (the version in `package.json`'s `packageManager`; `corepack enable` picks it up).

```sh
git clone https://github.com/LaunchAstro/work-map.git
cd work-map
pnpm install --frozen-lockfile
pnpm exec playwright install chromium webkit
```

The browser tests run in Playwright's Chromium and WebKit.

## The five checks

Run all five before you push. The Checks workflow (`.github/workflows/checks.yml`) runs the same commands, in this order, on every pull request and on each push to `main`.

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

`pnpm format` fixes formatting. The tests need no network and no GitHub login.

## Pull requests

- **Tests first.** Write the test that shows the bug or the new behaviour, watch it fail for the right reason, then change the code until it passes. A pull request that changes behaviour without a test that would have caught the old behaviour isn't ready.
- **Keep it small.** One change per pull request, ideally a few hundred lines. Split a big change into steps that each work on their own.
- **Say why.** The description says what changed and why, links the issue it closes, and has a before-and-after screenshot for anything visible.
- **Docs match the code.** If the change alters what the README, `docs/` or a comment says, update them in the same pull request.
- **Mind the GitHub budget.** The map reads GitHub under each user's own login and shares that login's hourly GraphQL budget with everything else they run. A change that reads more must say how many points a five-minute read or a Sync now costs.
- **Read-only stays read-only.** The work map never writes to GitHub and only listens on `127.0.0.1`. A change that breaks either won't be merged.

Use Australian English in docs and messages.

## Project config stays out of the code

The tool reads everything about a project (its repositories, sections, labels and diagram) from that project's own config. Don't add a project's names or rules to the code; add a config setting and document it in `docs/config.md`.

## Licence

The work map is licensed under the GNU Affero General Public License, version 3 only (`AGPL-3.0-only`, in `LICENSE`). By contributing, you agree that your contribution is licensed the same way. Keep a file's `SPDX-License-Identifier: AGPL-3.0-only` line where it has one.
