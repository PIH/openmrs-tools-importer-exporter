#!/usr/bin/env bash
# Step 08: make sure nobody is still logged in to the source. OpenMRS keeps sessions in memory, so
# there is nothing to query; restarting it drops them.
#   08-check-no-sessions.sh [settings-file]
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 08 "check no sessions on the source"
skip_in_test_mode "the source is never restarted in test mode"
require_settings SOURCE_NAME

: "${SOURCE_RESTART_CMD:=cd ${SOURCE_COMPOSE_DIR:?SOURCE_COMPOSE_DIR not set} && sudo docker compose restart}"
echo "All source users except the migrating user are retired now and cannot log back in,"
echo "but sessions that were already open stay valid until OpenMRS restarts [17]."
echo "Restart command: $SOURCE_RESTART_CMD"
echo "Restarting drops every open session (and takes the source offline for a few minutes)."
src_cmd_write "$SOURCE_RESTART_CMD"

next_step "09-export-source.sh" "that the source OpenMRS is back up and nobody is logged in"
