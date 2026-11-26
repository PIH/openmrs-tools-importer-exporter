#!/usr/bin/env bash
# Step 13: export users, providers, patients and relationships on the source server.
#   13-export.sh [settings-file]
# Runs the importer's export scripts in a docker container inside tmux session "export" on the source
# (it only reads the source through REST and writes JSON under <SOURCE_SERVER_DIR>/exports), with the
# console output copied to <SOURCE_SERVER_DIR>/logs/export-console.log. Run it again while the session
# is running to see progress (it starts nothing then). Run it again after it finished to retry the
# failures only (the exporter skips what is already exported), or to clear everything and start over.
# Before the first start it saves object counts of the source and target databases (and per-table
# counts of the target) in $WORKDIR/counts/ for the verification step; existing files are kept.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 13 "export from the source server"
require_settings SOURCE_SERVER_DIR NODE_IMAGE SOURCE_DOCKER SOURCE_NAME

q_dir=$(printf '%q' "$SOURCE_SERVER_DIR")
q_exports=$(printf '%q' "$SOURCE_SERVER_DIR/exports")
q_logs=$(printf '%q' "$SOURCE_SERVER_DIR/logs")
q_console=$(printf '%q' "$SOURCE_SERVER_DIR/logs/export-console.log")

# Last "Export summary" lines (the console log, else any log file) and the number of exported json files per type.
show_progress() {
  echo "--- Export summary lines (latest) ---"
  run_on src "if [ -f $q_console ]; then grep -h 'Export summary' $q_console | tail -n 5; else grep -rh 'Export summary' $q_logs 2>/dev/null | tail -n 5; fi; true"
  echo "--- Exported json files per folder ---"
  run_on src "cd $q_exports 2>/dev/null && for d in */; do [ -d \"\$d\" ] && echo \"\${d%/}: \$(find \"\$d\" -type f -name '*.json' | wc -l | tr -d ' ')\"; done; true"
}

if tmux_running src export; then
  echo "The export is running (tmux session 'export' on the source server; attach with: tmux attach -t export)."
  show_progress
  echo
  echo "Nothing started. Run this script again to see progress; start step 14 when the session is gone."
  exit 0
fi

# Review warnings in the export log against the two report CSVs (every warning is in exactly one of them):
# A = warning lines in app.log; B = rows in source-data-review*.csv; C = changed cases (distinct rule,list,uuid)
# with a review note in source-data-fixes*.csv. Reports only.
review_py='import csv, glob
b = sum(sum(1 for _ in csv.DictReader(open(f, newline=""))) for f in glob.glob("source-data-review*.csv"))
c = set()
for f in glob.glob("source-data-fixes*.csv"):
    for r in csv.DictReader(open(f, newline="")):
        if r.get("review"):
            c.add((r.get("rule"), r.get("list"), r.get("uuid")))
print(b, len(c))'
review_check() {
  local a bc b c
  a=$(run_on src "grep -h WARN $q_logs/app.log 2>/dev/null | grep -c 'left as it is\\|left as they are\\|(review)'; true" | head -n 1)
  bc=$(run_on src "cd $q_logs 2>/dev/null && python3 -I -c $(printf '%q' "$review_py"); true" | tail -n 1)
  read -r b c <<<"$bc"
  a=${a:-0}; b=${b:-0}; c=${c:-0}
  echo "review warnings in export app.log: $a; rows in source-data-review*.csv: $b; changed cases with a review note in source-data-fixes*.csv: $c (B + C should equal A)"
  if [ $((b + c)) -ne "$a" ]; then
    echo "DOES NOT ADD UP ($b + $c is not $a) - look at the export app.log review lines"
  fi
}
# Put the site name on the CSV reports (idempotent); asks only when there is something to rename.
suffix_csvs() {
  local pending; pending=$(run_on src "$(csv_suffix_pending_cmd "$SOURCE_SERVER_DIR/logs")")
  [ -n "$pending" ] || return 0
  echo "CSV reports without the site name:"; printf '%s\n' "$pending"
  src_work_write "$(csv_suffix_cmd "$SOURCE_SERVER_DIR/logs")"
}

# Previous run: exports or logs present.
if run_on src "[ -n \"\$(ls -A $q_exports $q_logs 2>/dev/null)\" ]"; then
  echo "Found exports and/or logs from an earlier export run:"
  show_progress
  review_check
  suffix_csvs
  echo
  answer=$(ask "r = re-run (retries only the failures), c = clear exports and logs and start fresh, anything else = stop [r/c]:")
  case "$answer" in
    r|R) ;;
    c|C)
      # Counts below stay valid: they describe the databases, not the exports.
      src_work_write "rm -rf $q_exports $q_logs && mkdir -p $q_exports $q_logs" ;;
    *) echo "Stopping, nothing changed."; exit 1 ;;
  esac
fi

# Object counts for the verification step: counts only, saved on this machine. Kept if they exist.
counts="$WORKDIR/counts"
mkdir -p "$counts"
count_sql=$(cat "$here/../tools/omrs_object_count.sql")
table_sql() { # prints a select with one row per table: name, exact row count
  local db=$1 tables t sql=""
  tables=$(tgt_sql "select table_name from information_schema.tables where table_schema = '$db' and table_type = 'BASE TABLE' order by table_name")
  for t in $tables; do sql="${sql}select '$t', count(*) from \`$t\` union all "; done
  printf '%s' "${sql% union all }"
}
if [ -f "$counts/source-before.txt" ]; then
  echo "Keeping the existing $counts/source-before.txt (delete it to save new counts)"
else
  echo "Saving object counts of the source database (tools/omrs_object_count.sql)"
  _dim "[source SQL] tools/omrs_object_count.sql (read-only)"
  _mysql_run src "$count_sql" > "$counts/source-before.txt.part"; mv "$counts/source-before.txt.part" "$counts/source-before.txt"
fi
if [ -f "$counts/target-before.txt" ]; then
  echo "Keeping the existing $counts/target-before.txt (delete it to save new counts)"
else
  echo "Saving object counts of the target database (tools/omrs_object_count.sql)"
  _dim "[target SQL] tools/omrs_object_count.sql (read-only)"
  _mysql_run tgt "$count_sql" > "$counts/target-before.txt.part"; mv "$counts/target-before.txt.part" "$counts/target-before.txt"
fi
if [ -f "$counts/target-tables-before.txt" ]; then
  echo "Keeping the existing $counts/target-tables-before.txt (delete it to save new counts)"
else
  echo "Saving per-table row counts of the target database (same format as tools/table-counts.sh)"
  tsql=$(table_sql "${TARGET_DB:?TARGET_DB not set}")
  _dim "[target SQL] select '<table>', count(*) from <table> union all ... (one per table)"
  _mysql_run tgt "$tsql" > "$counts/target-tables-before.txt.part"; mv "$counts/target-tables-before.txt.part" "$counts/target-tables-before.txt"
fi
echo "Counts in $counts: $(wc -l < "$counts/source-before.txt" | tr -d ' ') source, $(wc -l < "$counts/target-before.txt" | tr -d ' ') target, $(wc -l < "$counts/target-tables-before.txt" | tr -d ' ') target tables"

# $(id -u) and $(id -g) expand on the server (tmux runs the command there). The server dir is mounted at the same path so the host paths in the importer .env (exports, logs, lists) exist in the container.
node_cmd="$SOURCE_DOCKER run --rm --user \"\$(id -u):\$(id -g)\" -e HOME=/tmp --network host -v $q_dir:$q_dir -w $q_dir/repo/src $NODE_IMAGE sh -c 'node exportUsers.js && node exportProviders.js && node exportPatients.js && node exportRelationships.js'"
start_in_tmux src export work "mkdir -p $q_logs && { $node_cmd; } 2>&1 | tee -a $q_console"

echo "Started. Run this script again to see progress, or: tmux attach -t export (on the source server)."
next_step "14-copy-exports.sh" "the export session has ended (run this script to see it), no failures in the Export summary lines (or re-run to retry them)"
