#!/bin/sh
# Opens the map served on WORK_MAP_PORT (default 4317) in its own window: Chrome's app mode, no tabs or
# address bar, or the default browser when Chrome isn't installed.
URL="http://127.0.0.1:${WORK_MAP_PORT:-4317}/"
# Asks Launch Services for Chrome's bundle id, which neither starts Chrome nor opens a Finder window.
osascript -e 'id of application "Google Chrome"' > /dev/null 2>&1 || exec open "$URL"
exec open -na "Google Chrome" --args --app="$URL" --window-size=1600,1000
