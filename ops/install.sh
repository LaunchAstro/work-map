#!/bin/sh
# Installs one map as three launchd jobs for this user: serve (kept alive), github (every five minutes) and
# agents (every 45 seconds). The server binds only to 127.0.0.1. Re-running replaces this map's jobs.
#
#   sh ops/install.sh [--config FILE] [--no-launchd] [--no-build] [--remove]
#
# Each setting comes from FILE, KEY=value lines read as text and never run, or else from the environment.
# A value starting ~/ is under $HOME.
#   WORK_MAP_PROJECT      the project's project.json (required)
#   WORK_MAP_ROADMAP      a clone of the project's roadmap repo (required)
#   WORK_MAP_NODE         a Node 24 executable (default: node on PATH)
#   WORK_MAP_LABEL        the jobs' label prefix (default local.work-map.<project id>)
#   WORK_MAP_PORT         the server's loopback port (default 4317)
#   WORK_MAP_DATA         the runtime data folder (default ~/.local/share/work-map/<project id>)
#   WORK_MAP_SELF_UPDATE  1 lets the github job pull this tool's checkout before each run (default 0)
#   WORK_MAP_ROUND_ROOT   a folder of round-*/events.log logs the agents job reads (optional; must exist);
#                         unset, OA_ROUND_ROOT from the environment (its older name) is used
# --no-launchd writes the job files and prints the launchctl commands instead of running them; it still builds
# the page in this checkout (pnpm install, so it needs the network) unless --no-build is given too.
# --no-build leaves the page unbuilt. --remove takes this map's jobs out and needs only the label: WORK_MAP_LABEL,
# or else the project file and Node 24 to name the default.
set -eu
APP="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
KEYS='WORK_MAP_PROJECT WORK_MAP_ROADMAP WORK_MAP_NODE WORK_MAP_LABEL WORK_MAP_PORT WORK_MAP_DATA WORK_MAP_SELF_UPDATE WORK_MAP_ROUND_ROOT'
config='' launchd=1 build=1 remove=0
while [ $# -gt 0 ]; do
  case "$1" in
    --config) config="${2:?--config needs a file}"; shift 2 ;;
    --no-launchd) launchd=0; shift ;;
    --no-build) build=0; shift ;;
    --remove) remove=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
fail() { echo "$1" >&2; exit 2; }

if [ -n "$config" ]; then
  [ -f "$config" ] || fail "no config file at $config"
  # Every line that isn't blank or a comment must be KEY=value with a known key.
  known=$(printf '%s' "$KEYS" | tr ' ' '|')
  unknown=$(grep -v -E "^[[:space:]]*(#|\$)" "$config" | grep -v -E "^($known)=" || true)
  [ -z "$unknown" ] || fail "unknown setting in $config (each line is KEY=value): $unknown"
fi
# The config file's last value for $1, else the environment's; "~/" becomes $HOME. A value is one line.
NL='
'
setting() {
  if [ -n "$config" ] && grep -q "^$1=" "$config"; then
    value=$(grep "^$1=" "$config" | tail -n 1 | cut -d= -f2-)
  else
    eval "value=\${$1:-}"
  fi
  case "$value" in *"$NL"*) fail "$1 must be one line" ;; "~/"*) value="$HOME/${value#"~/"}" ;; esac
  printf '%s' "$value"
}

PROJECT=$(setting WORK_MAP_PROJECT)
ROADMAP=$(setting WORK_MAP_ROADMAP)
NODE=$(setting WORK_MAP_NODE)
[ -n "$NODE" ] || NODE=$(command -v node || true)
LABEL=$(setting WORK_MAP_LABEL)
node24() { [ -n "$NODE" ] && [ "$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null)" = 24 ]; }
project_id() {
  "$NODE" -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).id ?? ""))' "$PROJECT"
}
bad_id() { case "$ID" in '' | [!A-Za-z0-9]* | *[!A-Za-z0-9._-]*) return 0 ;; esac; return 1; }
check_label() {
  case "$LABEL" in [!A-Za-z0-9]* | *[!A-Za-z0-9.-]*) fail "WORK_MAP_LABEL '$LABEL' must be letters, digits, dots and dashes" ;; esac
}

launchctl_() {
  if [ "$launchd" = 1 ]; then launchctl "$@"; else echo "launchctl $*"; fi
}

# Removing needs only the label: the roadmap clone, the project file or Node may be gone by then.
if [ "$remove" = 1 ]; then
  if [ -z "$LABEL" ]; then
    # The default label comes from the project id; without a readable one, only WORK_MAP_LABEL can name the jobs.
    ID=''
    [ -f "$PROJECT" ] && node24 && ID=$(project_id 2>/dev/null) || true
    ! bad_id || fail "Set WORK_MAP_LABEL to the label prefix of the jobs to remove (no usable project id in '$PROJECT')"
    LABEL="local.work-map.$ID"
  fi
  check_label
  for job in serve github agents; do
    launchctl_ bootout "$DOMAIN/$LABEL.$job" 2>/dev/null || true
    rm -f "$AGENTS/$LABEL.$job.plist"
  done
  echo removed
  exit 0
fi

[ -f "$PROJECT" ] || fail 'Set WORK_MAP_PROJECT to the project.json file'
[ -d "$ROADMAP" ] || fail 'Set WORK_MAP_ROADMAP to a clone of the roadmap repo'
node24 || fail 'Set WORK_MAP_NODE to a Node 24 executable'
ID=$(project_id) || fail "could not read the project id from $PROJECT"
DATA=$(setting WORK_MAP_DATA)
PORT=$(setting WORK_MAP_PORT)
SELF_UPDATE=$(setting WORK_MAP_SELF_UPDATE)
ROUND_ROOT=$(setting WORK_MAP_ROUND_ROOT)
ROUND_NAME=WORK_MAP_ROUND_ROOT
# Jobs installed before WORK_MAP_ROUND_ROOT carried OA_ROUND_ROOT; a re-install run the old way keeps the folder.
if [ -z "$ROUND_ROOT" ] && [ -n "${OA_ROUND_ROOT:-}" ]; then
  ROUND_ROOT=$(setting OA_ROUND_ROOT)
  ROUND_NAME=OA_ROUND_ROOT
  echo "using OA_ROUND_ROOT, the older name, as WORK_MAP_ROUND_ROOT: $ROUND_ROOT" >&2
fi
if { [ -z "$LABEL" ] || [ -z "$DATA" ]; } && bad_id; then
  fail "the project id '$ID' can't name a label or folder; set WORK_MAP_LABEL and WORK_MAP_DATA"
fi
: "${LABEL:=local.work-map.$ID}" "${DATA:=$HOME/.local/share/work-map/$ID}" "${PORT:=4317}" "${SELF_UPDATE:=0}"
check_label
case "$PORT" in *[!0-9]*) fail "WORK_MAP_PORT '$PORT' must be a port from 1024 to 65535" ;; esac
[ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || fail "WORK_MAP_PORT '$PORT' must be a port from 1024 to 65535"
case "$SELF_UPDATE" in 0 | 1) ;; *) fail "WORK_MAP_SELF_UPDATE must be 0 or 1" ;; esac
[ -z "$ROUND_ROOT" ] || [ -d "$ROUND_ROOT" ] || fail "$ROUND_NAME '$ROUND_ROOT' is not a folder"

xml() { printf '%s' "$1" | sed 's/\&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g'; }
plist() {
  f="$AGENTS/$LABEL.$1.plist"
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0"><dict>'
    echo "<key>Label</key><string>$LABEL.$1</string>"
    echo "<key>ProgramArguments</key><array><string>/bin/sh</string><string>$(xml "$APP")/ops/run.sh</string><string>$1</string></array>"
    echo '<key>EnvironmentVariables</key><dict>'
    echo "<key>WORK_MAP_PROJECT</key><string>$(xml "$PROJECT")</string>"
    echo "<key>WORK_MAP_ROADMAP</key><string>$(xml "$ROADMAP")</string>"
    echo "<key>WORK_MAP_NODE</key><string>$(xml "$NODE")</string>"
    echo "<key>WORK_MAP_DATA</key><string>$(xml "$DATA")</string>"
    echo "<key>WORK_MAP_PORT</key><string>$PORT</string>"
    echo "<key>WORK_MAP_SELF_UPDATE</key><string>$SELF_UPDATE</string>"
    [ -z "$ROUND_ROOT" ] || echo "<key>WORK_MAP_ROUND_ROOT</key><string>$(xml "$ROUND_ROOT")</string>"
    echo '</dict>'
    case "$2" in
      0) echo '<key>KeepAlive</key><true/><key>RunAtLoad</key><true/>' ;;
      *) echo "<key>StartInterval</key><integer>$2</integer><key>RunAtLoad</key><true/>" ;;
    esac
    echo "<key>StandardOutPath</key><string>$(xml "$DATA")/$1.log</string>"
    echo "<key>StandardErrorPath</key><string>$(xml "$DATA")/$1.log</string>"
    echo '</dict></plist>'
  } > "$f"
  echo "$f"
}

# Build before touching the running jobs, so a failed build leaves the map as it was.
[ "$build" = 0 ] || WORK_MAP_PROJECT="$PROJECT" WORK_MAP_ROADMAP="$ROADMAP" WORK_MAP_NODE="$NODE" \
  WORK_MAP_DATA="$DATA" sh "$APP/ops/run.sh" build
mkdir -p "$DATA" "$AGENTS"
for job in serve github agents; do
  launchctl_ bootout "$DOMAIN/$LABEL.$job" 2>/dev/null || true
done
launchctl_ bootstrap "$DOMAIN" "$(plist serve 0)"
launchctl_ bootstrap "$DOMAIN" "$(plist github 300)"
launchctl_ bootstrap "$DOMAIN" "$(plist agents 45)"
echo "installed $LABEL; open it with: WORK_MAP_PORT=$PORT sh $APP/ops/open-window.sh"
