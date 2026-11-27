#!/usr/bin/env bash
# Step 05: retire every target user except the migrating user and ccIntegrationUser.
#   05-lock-target.sh [settings-file]
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 05 "lock target"
require_settings TARGET_MYSQL_CONTAINER TARGET_DB MIGRATING_USERNAME

lock_users tgt "Temp - migrating data" "$MIGRATING_USERNAME" ccIntegrationUser

next_step "06-backup-target.sh" "that only $MIGRATING_USERNAME and ccIntegrationUser can still log in to the target"
