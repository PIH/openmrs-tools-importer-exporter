#!/usr/bin/env bash
# Step 22: open the target again for its users (HAI-1309).
#   22-open-target.sh [settings-file]
# Asks three questions first (anything but yes stops with nothing changed). Then un-retires only the users retired by
# this migration: reason 'Temp - migrating data' (step 05) and 'Migrating from <SOURCE_NAME>' (copied from the source
# by step 15). Users retired for any other reason stay retired. Checks innodb_flush_log_at_trx_commit.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 22 "open the target"
require_settings TARGET_MYSQL_CONTAINER TARGET_DB SOURCE_NAME

is_yes() { case "$1" in y|Y|yes|YES|Yes) return 0 ;; esac; return 1; }
for q in "Has the verify output (step 19) been reviewed and accepted?" \
         "Has the search index rebuild (step 20) finished?" \
         "Are the spot checks (step 21) done?"; do
  a=$(ask "$q [y/N]")
  is_yes "$a" || { echo "Not confirmed, stopping. Nothing was changed." >&2; exit 1; }
done

unretire() { # reason expected_zero_note
  local reason=$1 note=$2 q n sql
  q=$(sql_quote "$reason")
  n=$(tgt_sql "select count(*) from users where retired = 1 and retire_reason = $q")
  echo "$n users retired with reason '$reason' on the target"
  if [ "$n" -gt 0 ]; then
    sql="update users set retired = 0, retire_reason = null, retired_by = null, date_retired = null where retired = 1 and retire_reason = $q"
    tgt_sql_write "$sql"
  else
    echo "Nothing to un-retire for this reason, no write.${note:+ $note}"
  fi
}
unretire "Temp - migrating data" ""
if [ "$MIGRATION_MODE" = test ]; then
  unretire "Migrating from $SOURCE_NAME" "(0 is expected in test mode: the source was never locked)"
else
  unretire "Migrating from $SOURCE_NAME" ""
fi

flush=$(tgt_sql "select @@innodb_flush_log_at_trx_commit")
if [ "$flush" != 1 ]; then
  echo "!!! WARNING: innodb_flush_log_at_trx_commit is '$flush' on the target, not 1. Not changed by this script." >&2
  echo "!!! Set it back to 1 (durable commits) before the target goes live." >&2
else
  echo "innodb_flush_log_at_trx_commit = 1 (ok)"
fi

echo "Reminders (do these by hand):"
echo "  - re-enable backups in cron on the target and run one backup [42]"
echo "  - re-enable 2FA for the migrating user${MIGRATING_USERNAME:+ ($MIGRATING_USERNAME)} [43]"
next_step "23-shutdown-source.sh" "that users can log in to the target again, flush is 1, a backup was run and 2FA is back on"
