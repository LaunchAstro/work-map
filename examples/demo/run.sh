#!/bin/sh
# Builds the Kettle example map from its made-up GitHub read and serves it on this machine only, with no GitHub
# login and no network. Run it from a built tool clone (pnpm install --frozen-lockfile && pnpm build).
#
#   sh examples/demo/run.sh [data folder (default .data/demo)]
#
# WORK_MAP_PORT picks the port (default 4317) and WORK_MAP_DIST the built page (default dist). Ctrl-C stops the
# server. The server runs without a project to refresh from, so Sync never reads GitHub here.
set -eu
APP="$(cd "$(dirname "$0")/../.." && pwd)"
DEMO="$APP/examples/demo"
DATA="${1:-$APP/.data/demo}"
DIST="${WORK_MAP_DIST:-$APP/dist}"
NODE="${WORK_MAP_NODE:-node}"
[ "$("$NODE" -p 'process.versions.node.split(".")[0]')" = 24 ] || { echo 'Node 24 is required' >&2; exit 2; }
[ -f "$DIST/index.html" ] || { echo 'Build the page first: pnpm build' >&2; exit 2; }
"$NODE" "$DEMO/seed.ts" "$DATA"
"$NODE" "$APP/src/cli/generate.ts" snapshot --project "$DEMO/roadmap/project.json" --repo-root "$DEMO/roadmap" --data "$DATA"
exec env -u WORK_MAP_PROJECT -u WORK_MAP_ROADMAP \
  "$NODE" "$APP/src/cli/serve.ts" --port "${WORK_MAP_PORT:-4317}" --data "$DATA" --dist "$DIST"
