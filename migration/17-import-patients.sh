#!/usr/bin/env bash
# Step 17: import providers, patients (two passes) and relationships on the target server (HAI-1309).
#   17-import-patients.sh [settings-file]
# Starts importProviders.js, importPatients.js, importPatients.js (the second pass retries what failed in
# the first) and importRelationships.js, one after the other, in one docker container run each, in tmux session
# "import-patients" on the target, with the console output copied to
# <TARGET_SERVER_DIR>/logs/import-patients-console.log. It does not wait: run it again to see progress
# (successful/failed/left of the current patient pass, and the failure classes in the importer's app.log).
# Run it once more after the import ended: it sets innodb_flush_log_at_trx_commit back to 1.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 17 "import providers, patients and relationships on the target server"
require_settings TARGET_SERVER_DIR NODE_IMAGE TARGET_DOCKER TARGET_DB TARGET_MYSQL_CONTAINER

q_dir=$(printf '%q' "$TARGET_SERVER_DIR")
q_logs=$(printf '%q' "$TARGET_SERVER_DIR/logs")
q_console=$(printf '%q' "$TARGET_SERVER_DIR/logs/import-patients-console.log")
q_applog=$(printf '%q' "$TARGET_SERVER_DIR/logs/app.log")
q_done=$(printf '%q' "$TARGET_SERVER_DIR/logs/import-patients.done")

# Counts for the current patient pass: everything after the last "Starting import of N patient files" line
# of importPatients.js ("Successfully processed patient from file ..." and "File ... moved to ... due to errors." per file).
show_progress() {
  local counts total ok failed
  counts=$(run_on tgt "awk '/Starting import of [0-9]+ patient files/ { n = \$0; sub(/.*Starting import of /, \"\", n); sub(/ patient files.*/, \"\", n); total = n; ok = 0; failed = 0; seen = 1 } /Successfully processed patient from file/ { ok++ } /moved to .* due to errors/ { failed++ } END { if (seen) print total, ok, failed }' $q_console 2>/dev/null; true")
  if [ -z "$counts" ]; then
    echo "No patient pass started yet (no 'Starting import of N patient files' line in the console log)."
  else
    read -r total ok failed <<<"$counts"
    echo "--- Current patient pass (from the console log: 'Successfully processed patient', 'moved to ... due to errors', 'Starting import of N patient files') ---"
    echo "successful: $ok"; echo "failed: $failed"; echo "left: $((total - ok - failed)) (of $total files in this pass)"
  fi
  echo "--- Failure classes in $TARGET_SERVER_DIR/logs/app.log (count, class) ---"
  run_on tgt "grep -ohE 'DrugOrder\.[A-Za-z.]+|Obs\.[A-Za-z.]+|Order\.[A-Za-z.]+|Visit\.[A-Za-z]+|Encounter\.[A-Za-z]+|AmbiguousOrder[A-Za-z]*|MissingRequired[A-Za-z]*|TransientObject[A-Za-z]*|status code [0-9]+' $q_applog 2>/dev/null | sort | uniq -c; true"
  echo "--- Last lines of the console log ---"
  run_on tgt "tail -n 3 $q_console 2>/dev/null; true"
}

if tmux_running tgt import-patients; then
  echo "The patient import is running (tmux session 'import-patients' on the target server; attach with: tmux attach -t import-patients)."
  show_progress
  echo
  echo "Nothing started. Run this script again to see progress."
  exit 0
fi

if tmux_running tgt import-users; then
  echo "The user import is still running (tmux session 'import-users' on the target server). Wait for it to end (15-import-users.sh shows progress)." >&2
  exit 1
fi

if run_on tgt "[ -f $q_done ]"; then
  echo "The patient import has finished (providers, both patient passes, relationships). Summary:"
  show_progress
  echo
  echo "Setting innodb_flush_log_at_trx_commit back to 1 (it was set to 2 for the imports)."
  tgt_sql_write "SET GLOBAL innodb_flush_log_at_trx_commit = 1"
  echo "innodb_flush_log_at_trx_commit is now: $(tgt_sql "SELECT @@innodb_flush_log_at_trx_commit")"
  next_step "18-copy-files.sh" "innodb_flush_log_at_trx_commit is 1 above; look at the failed count and the failure classes"
  exit 0
fi

if run_on tgt "[ -s $q_console ]"; then
  echo "The session 'import-patients' is gone, but there is no finished marker, and the console log exists: the import ended early." >&2
  show_progress >&2
  echo "Read the console log ($TARGET_SERVER_DIR/logs/import-patients-console.log), fix the cause, move that log away and run this script again to start over (already imported files are in exports/successful and are skipped)." >&2
  exit 1
fi

# $(id -u) and $(id -g) expand on the server (tmux runs the command there). The server dir is mounted at the same path so the host paths in the importer .env exist in the container.
node_cmd() { printf '%s' "$TARGET_DOCKER run --rm --user \"\$(id -u):\$(id -g)\" -e HOME=/tmp --network host -v $q_dir:$q_dir -w $q_dir/repo/src $NODE_IMAGE node $1.js"; }
chain="$(node_cmd importProviders) && $(node_cmd importPatients) && $(node_cmd importPatients) && $(node_cmd importRelationships)"
start_in_tmux tgt import-patients work "mkdir -p $q_logs && rm -f $q_done && { $chain && touch $q_done; } 2>&1 | tee -a $q_console"

echo "Started (it takes a long time; Ctrl-C is not needed, nothing waits). Run this script again to see progress, and once more after it ended."
