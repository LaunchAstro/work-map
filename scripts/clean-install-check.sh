#!/bin/sh
# Proves the install and quick start on a clean macOS user. It makes a temporary HOME, clones one commit of this
# repository into it, follows the README's steps (corepack, pnpm install, pnpm build, the example map), installs the
# example with ops/install.sh --no-launchd, and runs the browser check against the example map. Everything runs
# under a sandbox profile that refuses any write outside the temporary folder and refuses to run launchctl, so the
# machine outside it, the real HOME and its launchd jobs among them, can't change.
#
#   sh scripts/clean-install-check.sh [commit (default HEAD)]
#
# Needs macOS, Node 24 on PATH (or WORK_MAP_NODE), network access for packages, and Playwright's browsers already
# downloaded (read from their usual cache; nothing is written there).
set -eu
SRC="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT=$(git -C "$SRC" rev-parse --verify "${1:-HEAD}^{commit}")
NODE="${WORK_MAP_NODE:-$(command -v node)}"
[ "$("$NODE" -p 'process.versions.node.split(".")[0]')" = 24 ] || { echo 'Node 24 is required' >&2; exit 2; }
REAL_HOME="$HOME"
BROWSERS="${PLAYWRIGHT_BROWSERS_PATH:-$REAL_HOME/Library/Caches/ms-playwright}"
TMP=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/work-map-clean.XXXXXX")" && pwd -P)
case "$TMP" in "$REAL_HOME"/*) echo "the temporary folder $TMP is inside HOME" >&2; exit 2 ;; esac
PORT=$("$NODE" -e 'const s=require("node:net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
mkdir -p "$TMP/home" "$TMP/tmp"
cat > "$TMP/sandbox.sb" <<EOF
(version 1)
(allow default)
(deny file-write*)
(allow file-write* (subpath "$TMP") (subpath "/dev"))
(deny process-exec (literal "/bin/launchctl"))
EOF
echo "clean HOME: $TMP/home; commit $COMMIT; port $PORT"

# The steps a stranger runs, in a shell that sees only the clean HOME.
cat > "$TMP/steps.sh" <<'EOF'
set -eu
# The sandbox holds: nothing can be written outside the temporary folder, and launchctl can't run.
for probe in "$REAL_HOME/.work-map-sandbox-probe" /private/tmp/.work-map-sandbox-probe; do
  if touch "$probe" 2>/dev/null; then echo "the sandbox let a write to $probe" >&2; exit 3; fi
done
if /bin/launchctl print "gui/$(id -u)" > /dev/null 2>&1; then echo 'the sandbox let launchctl run' >&2; exit 3; fi
echo 'sandbox: writes outside the temporary folder and launchctl are refused'
cd "$HOME"
git clone -q "$SRC" work-map
cd work-map
git -c advice.detachedHead=false checkout -q "$COMMIT"
mkdir -p "$HOME/bin"
corepack enable --install-directory "$HOME/bin"
pnpm install --frozen-lockfile
pnpm build
WORK_MAP_PORT=$PORT sh examples/demo/run.sh > "$HOME/demo.log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
for _ in $(seq 1 100); do curl -fs "http://127.0.0.1:$PORT/" > /dev/null && break; sleep 0.2; done
curl -fs "http://127.0.0.1:$PORT/data/snapshot.json" | node -e '
  const s = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  const cards = s.stages.flatMap((stage) => stage.nodes);
  console.log(`snapshot: ${s.title}, ${s.stages.length} stages, ${cards.length} cards`);
  if (cards.length === 0) process.exit(1);'
printf 'WORK_MAP_PROJECT=%s\nWORK_MAP_ROADMAP=%s\n' "$PWD/examples/demo/roadmap/project.json" "$PWD/examples/demo/roadmap" > "$HOME/work-map.conf"
sh ops/install.sh --config "$HOME/work-map.conf" --no-launchd --no-build
ls "$HOME/Library/LaunchAgents"
WORK_MAP_URLS="demo=http://127.0.0.1:$PORT" WORK_MAP_SHOTS="$HOME/shots" node scripts/browser-check.mjs > /dev/null
node -e 'const r = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); console.log(`browser check: ${r.report.length} map renders, ${r.failures.length} failures`)' "$HOME/shots/report.json"
EOF
status=0
sandbox-exec -f "$TMP/sandbox.sb" env -i HOME="$TMP/home" TMPDIR="$TMP/tmp" \
  PATH="$TMP/home/bin:$(dirname "$NODE"):/usr/bin:/bin" PLAYWRIGHT_BROWSERS_PATH="$BROWSERS" \
  SRC="$SRC" COMMIT="$COMMIT" PORT="$PORT" REAL_HOME="$REAL_HOME" sh "$TMP/steps.sh" || status=$?
[ "$status" = 0 ] && echo "clean install: passed" || echo "clean install: failed ($status)"
echo "left for inspection: $TMP"
exit "$status"
