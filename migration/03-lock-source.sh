#!/usr/bin/env bash
# Step 03: retire every source user except the migrating user, so nobody changes data during the migration.
#   03-lock-source.sh [settings-file]
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 03 "lock source"
skip_in_test_mode "the source is never written to in test mode"
require_settings SOURCE_MYSQL_CONTAINER SOURCE_DB MIGRATING_USERNAME SOURCE_NAME

lock_users src "Migrating from $SOURCE_NAME" "$MIGRATING_USERNAME"
if [ "$lock_left" -gt 0 ]; then
  echo "The source is NOT locked: $lock_left users are still not retired (for example created during the update). Run this script again." >&2
  exit 1
fi

echo "Reminders (do these by hand):"
echo "  - disable 2FA for $MIGRATING_USERNAME on the source [6.1]"
echo "  - disable backups in cron on the source and on the target [7, 11]"
next_step "04-backup-source.sh" "that only the migrating user can still log in; 2FA and cron backups are off"
