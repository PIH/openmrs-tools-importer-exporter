#!/usr/bin/env bash
# Step 19: verify the import (HAI-1309).
#   19-verify.sh [settings-file]
# Starts verifyPatients.js, verifyRelationships.js, verifyUsers.js and verifyComplexObs.js one after the other
# (a failing verifier does not stop the next ones), then verifyUsers.js again for each entry of EARLIER_IMPORTS
# (exportsdir|usermappings|facilityuuid, separated by ;; both paths must be under TARGET_SERVER_DIR, the only directory the node container mounts), in tmux session "verify" on the target, with the console
# output copied to <TARGET_SERVER_DIR>/logs/verify-console.log. The verifiers only read the target through REST.
# It does not wait: run it again to see progress. Run it once more after it ended: it prints the per-table count
# differences against the counts saved by step 13, the object counts before and after, and the row counts of the
# report CSVs in the target logs. It prints, it does not judge: you read the numbers.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 19 "verify the import"
require_settings TARGET_SERVER_DIR NODE_IMAGE TARGET_DOCKER TARGET_DB TARGET_MYSQL_CONTAINER SOURCE_NAME

# EARLIER_IMPORTS paths must be under TARGET_SERVER_DIR: only that directory is mounted in the node container. Checked before anything starts.
IFS=';' read -r -a entries <<<"${EARLIER_IMPORTS:-}"
for entry in "${entries[@]}"; do
  [ -n "${entry// /}" ] || continue
  IFS='|' read -r e_dir e_map e_fac <<<"$entry"
  if [ -z "$e_dir" ] || [ -z "$e_map" ] || [ -z "$e_fac" ]; then
    echo "EARLIER_IMPORTS entry '$entry' must be exportsdir|usermappings|facilityuuid" >&2; exit 2
  fi
  for p in "$e_dir" "$e_map"; do
    case "$p" in
      "${TARGET_SERVER_DIR%/}"/*) ;;
      *) echo "EARLIER_IMPORTS entry '$entry': '$p' is not under TARGET_SERVER_DIR ($TARGET_SERVER_DIR); the node container only sees that directory. Copy it there." >&2; exit 2 ;;
    esac
  done
done

q_dir=$(printf '%q' "$TARGET_SERVER_DIR")
q_logs=$(printf '%q' "$TARGET_SERVER_DIR/logs")
q_console=$(printf '%q' "$TARGET_SERVER_DIR/logs/verify-console.log")
q_done=$(printf '%q' "$TARGET_SERVER_DIR/logs/verify.done")
counts="$WORKDIR/counts"

# Row counts (header excluded) of the report files in the target logs; "absent" when there is none.
csv_row_counts() {
  local patterns="source-data-fixes*.csv source-data-review*.csv visits-before-birthdate*.csv invalid-identifiers*.csv verify-users*.csv complex-obs-missing*.csv"
  run_on tgt "cd $q_logs 2>/dev/null || { echo 'no logs directory: $TARGET_SERVER_DIR/logs'; exit 0; }; for p in $patterns; do found=0; for f in \$p; do [ -f \"\$f\" ] || continue; found=1; echo \"\$f: \$(( \$(wc -l < \"\$f\") - 1 )) rows\"; done; [ \$found = 1 ] || echo \"\$p: absent\"; done"
}

# Put the site name on the CSV reports in the target logs (idempotent); asks only when there is something to rename.
suffix_csvs() {
  local pending; pending=$(run_on tgt "$(csv_suffix_pending_cmd "$TARGET_SERVER_DIR/logs")")
  [ -n "$pending" ] || return 0
  echo "CSV reports without the site name:"; printf '%s\n' "$pending"
  tgt_work_write "$(csv_suffix_cmd "$TARGET_SERVER_DIR/logs")"
}

report() {
  echo "--- Verifier results in the console log ---"
  run_on tgt "echo \"patients verified OK: \$(grep -c 'verified successfully' $q_console 2>/dev/null)\"; echo \"patients with differences: \$(grep -c 'Verification failed for patient' $q_console 2>/dev/null)\"; grep -h 'Complex obs check:' $q_console 2>/dev/null; true"
  run_on tgt "n() { find $q_dir/exports/\$1 -maxdepth 1 -name '*_patient.json' 2>/dev/null | wc -l | tr -d ' '; }; echo \"verify: verified \$(n verified), failed verification \$(n failed_verification), not verified \$(n successful)\""
  mkdir -p "$counts"
  local f
  for f in target-before.txt source-before.txt target-tables-before.txt; do
    [ -f "$counts/$f" ] || { echo "$counts/$f not found: step 13 saves it before the export." >&2; exit 1; }
  done
  echo "--- Per-table row counts of the target now compared with before the import (tools/table-counts.sh diff: table, before, after, change) ---"
  local tables t sql=""
  tables=$(tgt_sql "select table_name from information_schema.tables where table_schema = '$TARGET_DB' and table_type = 'BASE TABLE' order by table_name")
  for t in $tables; do sql="${sql}select '$t', count(*) from \`$t\` union all "; done
  _mysql_run tgt "${sql% union all }" > "$counts/target-tables-after.txt.part"
  mv "$counts/target-tables-after.txt.part" "$counts/target-tables-after.txt"
  "$here/../tools/table-counts.sh" diff "$counts/target-tables-before.txt" "$counts/target-tables-after.txt" || true
  echo "--- Object counts (tools/omrs_object_count.sql): source before, target before, target now ---"
  _dim "[target SQL] tools/omrs_object_count.sql (read-only)"
  _mysql_run tgt "$(cat "$here/../tools/omrs_object_count.sql")" > "$counts/target-after.txt.part"
  mv "$counts/target-after.txt.part" "$counts/target-after.txt"
  awk -F' = ' 'FNR == 1 { file++ } { k = $1; gsub(/ +$/, "", k); if (!(k in seen)) { seen[k] = 1; order[++n] = k } v[file, k] = $2 }
    END { printf "%-26s %12s %12s %12s\n", "", "source-before", "target-before", "target-now"; for (i = 1; i <= n; i++) { k = order[i]; printf "%-26s %12s %12s %12s\n", k, v[1, k], v[2, k], v[3, k] } }' \
    "$counts/source-before.txt" "$counts/target-before.txt" "$counts/target-after.txt"
  echo "--- Report files in $TARGET_SERVER_DIR/logs (data rows, header excluded) ---"
  suffix_csvs
  csv_row_counts
}

if tmux_running tgt verify; then
  echo "The verification is running (tmux session 'verify' on the target server; attach with: tmux attach -t verify)."
  echo "--- Last lines of the console log ---"
  run_on tgt "tail -n 3 $q_console 2>/dev/null; true"
  echo
  echo "Nothing started. Run this script again to see progress."
  exit 0
fi

restart_needed=0
if run_on tgt "[ -f $q_done ]"; then
  echo "The verification has finished. Summary:"
  report
  if ! ( confirm "start the verification again (the console log is moved aside; verified patient files are not checked again)" ); then
    next_step "20-rebuild-index.sh" "the numbers above are what you expect: failed patients, table count changes, missing complex obs, report file rows"
    exit 0
  fi
  restart_needed=1
elif run_on tgt "[ -s $q_console ]"; then
  echo "The session 'verify' is not running and the verification did not finish (no finished marker; the console log exists)."
  echo "Read the console log ($TARGET_SERVER_DIR/logs/verify-console.log) for the cause."
  confirm "start the verification again (the console log is moved aside)"
  restart_needed=1
fi
if [ "$restart_needed" = 1 ]; then
  tgt_work_write "rm -f $q_done && { [ ! -f $q_console ] || mv $q_console $q_logs/verify-console.\$(date +%Y%m%d-%H%M%S).log; }"
fi

# $(id -u) and $(id -g) expand on the server (tmux runs the command there). The server dir is mounted at the same path so the host paths in the importer .env exist in the container.
# $2: extra docker -e options (dotenv does not override variables that are already set).
node_cmd() { printf '%s' "$TARGET_DOCKER run --rm --user \"\$(id -u):\$(id -g)\" -e HOME=/tmp $2--network host -v $q_dir:$q_dir -w $q_dir/repo/src $NODE_IMAGE node $1.js"; }
chain="$(node_cmd verifyPatients ""); $(node_cmd verifyRelationships ""); $(node_cmd verifyUsers ""); $(node_cmd verifyComplexObs "")"
# Earlier imports into the same target (exportsdir|usermappings|facilityuuid): their users are verified with their own settings.
earlier=0
IFS=';' read -r -a entries <<<"${EARLIER_IMPORTS:-}"
for entry in "${entries[@]}"; do
  [ -n "${entry// /}" ] || continue
  IFS='|' read -r e_dir e_map e_fac <<<"$entry"
  if [ -z "$e_dir" ] || [ -z "$e_map" ] || [ -z "$e_fac" ]; then
    echo "EARLIER_IMPORTS entry '$entry' must be exportsdir|usermappings|facilityuuid" >&2; exit 2
  fi
  envs="-e TARGET_DIR=$(printf '%q' "$e_dir") -e EXPORT_USER_MAPPINGS_FILE=$(printf '%q' "$e_map") -e OPENMRS_SOURCE_FACILITY_UUID=$(printf '%q' "$e_fac") "
  chain="$chain; $(node_cmd verifyUsers "$envs")"
  earlier=$((earlier + 1))
done
echo "Verifiers: verifyPatients, verifyRelationships, verifyUsers, verifyComplexObs; verifyUsers again for $earlier earlier import(s)."
start_in_tmux tgt verify work "mkdir -p $q_logs && rm -f $q_done && { $chain; touch $q_done; } 2>&1 | tee -a $q_console"

echo "Started (it takes a long time; nothing waits). Run this script again to see progress, and once more after it ended."
