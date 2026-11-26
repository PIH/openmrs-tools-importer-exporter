#!/usr/bin/env bash
# Step 20: switch search indexing back on and rebuild the search index on the target (HAI-1309).
#   20-rebuild-index.sh [settings-file]
# 1. removes hibernate.search.indexing.listeners.enabled=false (added by step 07) from TARGET_RUNTIME_PROPERTIES,
# 2. restarts the target and waits until it answers,
# 3. asks for the migrating user's OpenMRS password and rebuilds the index with a synchronous POST
#    searchindexupdate (returns when done; the password goes to curl on stdin, never into a command line).
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 20 "rebuild the search index"
require_settings TARGET_RUNTIME_PROPERTIES TARGET_RESTART_CMD TARGET_WAIT_URL TARGET_OPENMRS_URL MIGRATING_USERNAME \
  TARGET_MYSQL_CONTAINER TARGET_DB

sudo_prefix=${TARGET_FILE_SUDO:-}
q() { printf "'%s'" "$1"; }
file=$(q "$TARGET_RUNTIME_PROPERTIES")
prop=hibernate.search.indexing.listeners.enabled=false

# 1 + 2. Remove the property and restart (nothing to do if step 07's line is not there).
echo "--- Part 1: indexing property in $TARGET_RUNTIME_PROPERTIES"
# The sentinel proves grep itself ran: a failing sudo/ssh also exits 1, like grep's "no match".
probe="grep -qxF $(q "$prop") $file; echo \"grep-rc=\$?\""
probe_out=$(run_on tgt "$sudo_prefix sh -c $(printf '%q' "$probe")" || true)
rc=$(printf '%s\n' "$probe_out" | sed -n 's/^grep-rc=\([0-9][0-9]*\)$/\1/p')
[ "$(printf '%s\n' "$rc" | grep -c .)" = 1 ] || rc=unknown
case "$rc" in 0|1) ;; *)
  echo "Could not read $TARGET_RUNTIME_PROPERTIES on the target (grep status: $rc; file missing or unreadable, or sudo/ssh failed); not touching anything." >&2
  exit 2 ;;
esac
if [ "$rc" = 0 ]; then
  # GNU sed (the target is Linux); no .bak copy, the file holds passwords.
  tgt_cmd_write "$sudo_prefix sed -i '/^hibernate\\.search\\.indexing\\.listeners\\.enabled=false\$/d' $file"
  echo "--- Part 2: restart the target"
  tgt_cmd_write "$TARGET_RESTART_CMD"
else
  echo "$prop is not in the file, nothing to remove and no restart needed."
fi
wait_for_target

# 3. Rebuild the index. async=false: the call returns when the rebuild is done (about 12 minutes on a ZL Central copy).
echo "--- Part 3: rebuild the search index as $MIGRATING_USERNAME (synchronous, up to ${WAIT_TIMEOUT_SECONDS}s)"
pw=$(ask_secret "OpenMRS password of $MIGRATING_USERNAME on the target (not shown):")
start=$SECONDS
tgt_cmd_write_stdin "curl --fail -sS --max-time $WAIT_TIMEOUT_SECONDS --config - -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{\"async\": false}' -o /dev/null -w 'HTTP result: %{http_code}\n' $(q "$TARGET_OPENMRS_URL/ws/rest/v1/searchindexupdate")" \
  "$(curl_user_config "$MIGRATING_USERNAME" "$pw")"
unset pw
echo "The index is rebuilt (took $((SECONDS - start))s); puppet can run on the target again now."

next_step "21-spot-checks.sh" "that a patient search in the target UI finds a migrated patient"
