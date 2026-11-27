#!/usr/bin/env bash
# Step 22: open the target again for its users (HAI-1309).
#   22-open-target.sh [settings-file]
# Refuses (nothing changed) while step 07's hibernate.search.indexing.listeners.enabled=false line is still in
# TARGET_RUNTIME_PROPERTIES (step 20 not done). Then asks one question per earlier step (anything but yes stops with
# nothing changed). Then un-retires only the users retired by
# this migration: reason 'Temp - migrating data' (step 05) and 'Migrating from <SOURCE_NAME>' (copied from the source
# by step 15). Users retired for any other reason stay retired. Checks innodb_flush_log_at_trx_commit.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 22 "open the target"
require_settings TARGET_MYSQL_CONTAINER TARGET_DB SOURCE_NAME TARGET_RUNTIME_PROPERTIES

is_yes() { case "$1" in y|Y|yes|YES|Yes) return 0 ;; esac; return 1; }

# Indexing must be back on (step 20) before users get in: read the runtime properties (read-only).
prop=hibernate.search.indexing.listeners.enabled=false
rc=0; target_property_line "$prop" || rc=$?
case "$rc" in
  0) echo "$prop is still in $TARGET_RUNTIME_PROPERTIES on the target: search indexing is off. Run 20-rebuild-index.sh first. Nothing changed." >&2; exit 1 ;;
  2) echo "Could not read $TARGET_RUNTIME_PROPERTIES on the target (file missing or unreadable, or sudo/ssh failed). Nothing changed." >&2; exit 2 ;;
esac
echo "$prop is not in $TARGET_RUNTIME_PROPERTIES (ok, indexing is on)"

# Read-only check first: the operator sees the warning before answering anything.
flush=$(tgt_sql "select @@innodb_flush_log_at_trx_commit")
if [ "$flush" != 1 ]; then
  echo "!!! WARNING: innodb_flush_log_at_trx_commit is '$flush' on the target, not 1. Not changed by this script." >&2
  echo "!!! Set it back to 1 (durable commits) before the target goes live." >&2
else
  echo "innodb_flush_log_at_trx_commit = 1 (ok)"
fi

echo
echo "This step lets users log in to the TARGET (production in real mode). Everything else must be finished first:"
for q in "16 password hashes copied after the last 15 run" "17 import finished" "18 files copied" "19 verify output reviewed" "20 index rebuilt" "21 spot checks done"; do echo "  - $q"; done
for q in "16: have the password hashes been copied after the last 15 run?" "17: has the patient import finished?" "18: have the files been copied?" "19: has the verify output been reviewed and accepted?" \
         "20: has the search index rebuild finished?" "21: are the spot checks done?"; do
  a=$(ask "$q [y/N]")
  is_yes "$a" || { echo "Not confirmed, stopping. Nothing was changed." >&2; exit 1; }
done

echo "Before users get in (do these by hand, right after if not yet done):"
echo "  - re-enable backups in cron on the target and run one backup [42]"
echo "  - re-enable 2FA for the migrating user${MIGRATING_USERNAME:+ ($MIGRATING_USERNAME)} [43]"

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

next_step "23-shutdown-source.sh" "that users can log in to the target again, flush is 1, a backup was run and 2FA is back on"
