#!/usr/bin/env bash
# Step 20: switch search indexing back on and rebuild the search index on the target (HAI-1309).
#   20-rebuild-index.sh [settings-file]
# 1. removes hibernate.search.indexing.listeners.enabled=false (added by step 07) from TARGET_RUNTIME_PROPERTIES,
# 2. restarts the target and waits until it answers,
# 3. asks for the migrating user's OpenMRS password and starts an asynchronous index rebuild
#    (POST searchindexupdate); the password goes to curl on stdin, never into a command line,
# 4. polls the global property search.indexVersion until it has a new value.
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
if run_on tgt "$sudo_prefix grep -qxF $(q "$prop") $file"; then
  # GNU sed (the target is Linux); no .bak copy, the file holds passwords.
  tgt_cmd_write "$sudo_prefix sed -i '/^hibernate\\.search\\.indexing\\.listeners\\.enabled=false\$/d' $file"
  echo "--- Part 2: restart the target"
  tgt_cmd_write "$TARGET_RESTART_CMD"
else
  echo "$prop is not in the file, nothing to remove and no restart needed."
fi
wait_for_target

# 3. Start the rebuild.
echo "--- Part 3: rebuild the search index as $MIGRATING_USERNAME"
before=$(_mysql_run tgt "select property_value from global_property where property='search.indexVersion'" | head -n 1 || true)
pw=$(ask_secret "OpenMRS password of $MIGRATING_USERNAME on the target (not shown):")
tgt_cmd_write_stdin "curl -fsS --config - -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{\"async\": true}' $(q "$TARGET_OPENMRS_URL/ws/rest/v1/searchindexupdate")" \
  "$(curl_user_config "$MIGRATING_USERNAME" "$pw")"
unset pw
echo "Rebuild requested."

# 4. Wait for search.indexVersion to be set (a changed value if there was one before).
echo "--- Part 4: waiting for the property search.indexVersion (up to ${WAIT_TIMEOUT_SECONDS}s)"
sql="select property_value from global_property where property='search.indexVersion'"
_dim "[target SQL] $sql (every 10 s)"
start=$SECONDS
while :; do
  v=$(_mysql_run tgt "$sql" | head -n 1 || true)
  if [ -n "$v" ] && [ "$v" != "$before" ]; then echo "search.indexVersion is set after $((SECONDS - start))s"; break; fi
  waited=$((SECONDS - start)); left=$((WAIT_TIMEOUT_SECONDS - waited))
  if [ "$left" -le 0 ]; then echo "Timed out after ${waited}s waiting for search.indexVersion; check the OpenMRS log on the target." >&2; exit 1; fi
  echo "  ${waited}s elapsed, not set yet..."
  sleep $((left < 10 ? left : 10))
done
echo "The index is rebuilt; puppet can run on the target again now."

next_step "21-spot-checks.sh" "search.indexVersion is set and a patient search in the target UI finds a migrated patient"
