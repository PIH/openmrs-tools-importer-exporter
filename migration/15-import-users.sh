#!/usr/bin/env bash
# Step 15: import the users on the target server (HAI-1314).
#   15-import-users.sh [settings-file]
# Saves the uuids of the users that exist on the target before the import (needed by step 16; needs the
# counts step 13 saved), sets innodb_flush_log_at_trx_commit = 2 for the
# import, and runs importUsers.js in a docker container in tmux session "import-users" on the target,
# with the console output copied to <TARGET_SERVER_DIR>/logs/import-users-console.log. It waits for the
# session to end and prints a summary. Run it again while the session is running to see progress
# (it starts nothing then). Run it again after it finished until no new users are created.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 15 "import users on the target server"
require_settings TARGET_SERVER_DIR NODE_IMAGE TARGET_DOCKER TARGET_DB TARGET_MYSQL_CONTAINER

q_dir=$(printf '%q' "$TARGET_SERVER_DIR")
q_exports=$(printf '%q' "$TARGET_SERVER_DIR/exports")
q_logs=$(printf '%q' "$TARGET_SERVER_DIR/logs")
q_console=$(printf '%q' "$TARGET_SERVER_DIR/logs/import-users-console.log")

# Number of json files per result folder, files still waiting, and the end of the console log.
show_progress() {
  echo "--- Files per folder in $TARGET_SERVER_DIR/exports ---"
  run_on tgt "cd $q_exports 2>/dev/null && { for d in successful failed mapped_to_existing; do echo \"\$d: \$(find \"\$d\" -maxdepth 1 -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' ')\"; done; echo \"waiting (not yet processed): \$(find . -maxdepth 1 -type f -name '*_user.json' | wc -l | tr -d ' ')\"; }; true"
  echo "--- Last lines of the console log ---"
  run_on tgt "tail -n 5 $q_console 2>/dev/null; true"
}

if tmux_running tgt import-users; then
  echo "The user import is running (tmux session 'import-users' on the target server; attach with: tmux attach -t import-users)."
  show_progress
  echo
  echo "Nothing started. Run this script again to see progress."
  exit 0
fi

# Per-table and object counts of both databases: step 13 saves them before the first export.
counts="$WORKDIR/counts"
for f in source-before.txt target-before.txt target-tables-before.txt; do
  if [ ! -f "$counts/$f" ]; then
    echo "$counts/$f not found: run 13-export.sh first (it saves the counts before the export)." >&2
    exit 2
  fi
done
echo "Counts were already saved by step 13 in $counts (source-before.txt, target-before.txt, target-tables-before.txt)"

# Users on the target before the first import: step 16 must not touch their passwords.
# First line "# target=<host> db=<db>" says which target the list belongs to.
before="$WORKDIR/target-users-before-import.txt"
header="# target=$TARGET_HOST db=$TARGET_DB"
if [ -f "$before" ]; then
  if [ "$(head -n 1 "$before")" != "$header" ]; then
    echo "$before is from another target (its first line is '$(head -n 1 "$before")', current settings say '$header')." >&2
    echo "Move or delete it if it is stale, then run this script again." >&2
    exit 2
  fi
  echo "Keeping the existing $before (users that existed before the first import run; delete it only to start over)"
else
  { printf '%s\n' "$header"; tgt_sql "select uuid from users order by uuid"; } > "$before.part"
  mv "$before.part" "$before"
  echo "Saved $(grep -c -v '^#' "$before" | tr -d ' ') target user uuids in $before (uuids only)"
fi
n_before=$(grep -c -v '^\(#\|$\)' "$before" || true)

# Faster import: do not flush the InnoDB log at every commit. Reset it to 1 after step 17.
flush=$(tgt_sql "SELECT @@innodb_flush_log_at_trx_commit")
if [ "$flush" = 2 ]; then
  echo "innodb_flush_log_at_trx_commit is already 2"
else
  tgt_sql_write "SET GLOBAL innodb_flush_log_at_trx_commit = 2"
  echo "innodb_flush_log_at_trx_commit is now: $(tgt_sql "SELECT @@innodb_flush_log_at_trx_commit")"
fi

# $(id -u) and $(id -g) expand on the server (tmux runs the command there). The server dir is mounted at the same path so the host paths in the importer .env exist in the container.
node_cmd="$TARGET_DOCKER run --rm --user \"\$(id -u):\$(id -g)\" -e HOME=/tmp --network host -v $q_dir:$q_dir -w $q_dir/repo/src $NODE_IMAGE node importUsers.js"
start_in_tmux tgt import-users work "mkdir -p $q_logs && { $node_cmd; } 2>&1 | tee -a $q_console"

echo "Started. Waiting for it to finish (Ctrl-C is safe: it keeps running, run this script again to see progress)."
n=0
while tmux_running tgt import-users; do
  sleep 1; n=$((n + 1))
  [ $((n % 30)) -ne 0 ] || echo "  ... still running ($n s)"
done

echo
echo "The user import has finished. Summary:"
show_progress
errors=$(run_on tgt "grep -c -i 'error' $q_console 2>/dev/null; true")
echo "Lines with 'error' in the console log: ${errors:-0}"
total=$(tgt_sql "select count(*) from users")
echo "Users on the target now: $total (before the import: $n_before)"
echo "Users still waiting or failed? Fix the cause, then run this script again: run again until no new users are created (the users count above stops growing)."

next_step "16-copy-password-hashes.sh" "run it now, before anyone can log in; first look at the 'failed' count above"
