#!/bin/sh
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin"
APP="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${WORK_MAP_DATA:-$HOME/.local/share/work-map/data}"
: "${WORK_MAP_PROJECT:?Set WORK_MAP_PROJECT to the project config file}"
: "${WORK_MAP_ROADMAP:?Set WORK_MAP_ROADMAP to a fresh roadmap clone}"
NODE="${WORK_MAP_NODE:-node}"
[ "$("$NODE" -p 'process.versions.node.split(".")[0]')" = 24 ] || { echo 'Node 24 is required' >&2; exit 2; }
export PATH="$(dirname "$(command -v "$NODE")"):$PATH"
mkdir -p "$DATA"
cd "$APP"
build_if_moved() {
  head=$(git rev-parse HEAD)
  if [ "$(cat "$DATA/built-commit" 2>/dev/null || true)" != "$head" ] || [ ! -f dist/index.html ]; then
    pnpm install --frozen-lockfile --silent
    pnpm exec vite build --logLevel error
    echo "$head" > "$DATA/built-commit"
  fi
}
case "${1:-}" in
  serve) exec "$NODE" src/cli/serve.ts --data "$DATA" ;;
  build) build_if_moved ;;
  prepare)
    # Self-update: pull this tool's own checkout. Unset means on, as installs from before the setting expect;
    # ops/install.sh writes 0 unless asked.
    [ "${WORK_MAP_SELF_UPDATE:-1}" = 0 ] || git pull -q --ff-only || echo 'Tool refresh failed; using the current checkout' >&2
    git -C "$WORK_MAP_ROADMAP" pull -q --ff-only || echo 'Config refresh failed; using the current checkout' >&2
    build_if_moved
    ;;
  github)
    perl ops/hold-lock.pl "$DATA/checkout.lockf" 120 sh ops/run.sh prepare
    exec "$NODE" src/cli/generate.ts github --data "$DATA" --project "$WORK_MAP_PROJECT" --repo-root "$WORK_MAP_ROADMAP"
    ;;
  agents) exec "$NODE" src/cli/generate.ts agents --data "$DATA" --project "$WORK_MAP_PROJECT" --repo-root "$WORK_MAP_ROADMAP" ;;
  *) echo 'usage: ops/run.sh serve|github|agents|build|prepare' >&2; exit 2 ;;
esac
