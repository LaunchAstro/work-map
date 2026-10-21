# Work map

Work map is being rewritten in Rust and packaged with Tauri. The plan lives in this repo's issues, starting from the issue labelled `wayfinder:map`. Until the build starts there is no product code here, only planning docs under `docs/` and this repo's own map in `.work-map/`.

## Rules

- This repo is public. Nothing private goes in an issue, comment, commit or file: no client or business names, machine names, seat or account names, internal paths, IP addresses, email addresses or private repo contents. Use neutral wording such as "the maintainer's live maps" or "an always-on build machine".
- Use Australian English. No em dashes.
- Commit with the repo's configured author and no Co-Authored-By lines.

## Sections

This repo's own map is in `.work-map/`, and its sections and the paths each owns are in `docs/spec/own-map.md`. If it is not on the map, it does not exist.

- Every PR body carries exactly one line `Section: <id>`, with an id from `.work-map/flow.json`. Planning and docs PRs say `Section: docs`. The PR template starts with it.
- Every build ticket's body carries the same line, from the table in `docs/spec/own-map.md`.
- Before merging, run this from a checkout of the PR head, with `PR` set to its number, and do not merge if it exits 1:

```sh
s=$(gh pr view "$PR" --json body --jq .body | tr -d '\r' | sed -n 's/^Section: *\([a-z][a-z0-9-]*\) *$/\1/p' | sort -u)
[ "$(printf '%s\n' "$s" | grep -c .)" = 1 ] && jq -e --arg s "$s" 'any(.nodes[]; .id == $s and .note != true)' .work-map/flow.json >/dev/null || { echo "won't land: no single known Section line"; exit 1; }
```

- Changed files that no section owns are a map gap: say so in the PR and open a ticket to give them an owner. They never hold the merge.
- When `work-map where` exists, it replaces the check above.

## Agent skills

### Issue tracker

GitHub issues on `LaunchAstro/work-map`, with sub-issues and native dependencies for the wayfinder map. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root, created when terms or decisions are settled. See `docs/agents/domain.md`.
