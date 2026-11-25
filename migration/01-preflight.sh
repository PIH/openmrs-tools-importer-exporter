#!/usr/bin/env bash
# Step 01: check that the servers, containers, databases and settings are ready. Changes nothing
# (except pulling the importer's node image if it is missing, which asks first).
#   01-preflight.sh [settings-file]
# Every check runs and prints OK or PROBLEM with the value; exit 1 at the end if any PROBLEM.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
require_settings SOURCE_MYSQL_CONTAINER TARGET_MYSQL_CONTAINER SOURCE_DB TARGET_DB NODE_IMAGE SOURCE_SERVER_DIR TARGET_SERVER_DIR
step_header 01 "preflight checks"

problems=0
ok() { printf 'OK       %s: %s\n' "$1" "$2"; }
problem() { printf 'PROBLEM  %s: %s\n' "$1" "$2"; problems=$((problems + 1)); }
# check LABEL OKVALUE: ok when the command succeeded (rest of args), else problem. Never aborts the script.
check() {
  local label=$1 value=$2; shift 2
  if "$@" >/dev/null 2>&1; then ok "$label" "$value"; else problem "$label" "$value"; fi
}
# Setting of one side: side_var src HOST -> value of $SOURCE_HOST.
side_var() { local n; case "$1" in src) n=SOURCE_$2 ;; *) n=TARGET_$2 ;; esac; printf '%s' "${!n:-}"; }
side_name() { case "$1" in src) echo source ;; *) echo target ;; esac; }
sql_on() { if [ "$1" = src ]; then src_sql "$2"; else tgt_sql "$2"; fi; }
work_write_on() { if [ "$1" = src ]; then src_work_write "$2"; else tgt_work_write "$2"; fi; }

for side in src tgt; do
  name=$(side_name "$side"); host=$(side_var "$side" HOST); docker=$(side_var "$side" DOCKER)
  container=$(side_var "$side" MYSQL_CONTAINER); db=$(side_var "$side" DB); dir=$(side_var "$side" SERVER_DIR)
  echo "--- $name server ($host) ---"

  if [ "$host" = local ]; then
    ok "ssh $name" "local, no ssh needed"
  else
    check "ssh $name" "$host" ssh -o BatchMode=yes -o ConnectTimeout=10 "$host" true
    check "sudo -n true $name" "$host" run_on "$side" "sudo -n true"
  fi

  check "$name MySQL container" "$container" run_on "$side" "$docker inspect -f '{{.State.Running}}' $container | grep -qx true"
  # The mysql client connects to the database itself, so a missing database also shows as unreachable here.
  if sql_on "$side" "select 1" >/dev/null; then ok "$name MySQL reachable" "$container"; else problem "$name MySQL reachable" "$container (or database $db missing)"; fi
  found=$(sql_on "$side" "select count(*) from information_schema.schemata where schema_name = $(sql_quote "$db")" 2>/dev/null) || found=""
  if [ "$found" = 1 ]; then ok "$name database" "$db"; else problem "$name database" "$db not found"; fi

  if [ -z "${SOURCE_FACILITY_UUID:-}" ]; then
    problem SOURCE_FACILITY_UUID "not set"
  else
    n=$(sql_on "$side" "select count(*) from location where uuid = $(sql_quote "$SOURCE_FACILITY_UUID")" 2>/dev/null) || n=""
    if [ "$n" = 1 ]; then ok "SOURCE_FACILITY_UUID on $name" "$SOURCE_FACILITY_UUID"; else problem "SOURCE_FACILITY_UUID on $name" "$SOURCE_FACILITY_UUID is not a location on the $name database"; fi
  fi

  check "tmux $name" "installed" run_on "$side" "command -v tmux"
  if run_on "$side" "$docker image inspect $NODE_IMAGE" >/dev/null 2>&1; then
    ok "node image $name" "$NODE_IMAGE present"
  elif ( work_write_on "$side" "$docker pull $NODE_IMAGE" ); then
    ok "node image $name" "$NODE_IMAGE pulled"
  else
    problem "node image $name" "$NODE_IMAGE missing and not pulled"
  fi
  free_kb=$(run_on "$side" "df -Pk '$dir' | awk 'NR==2{print \$4}'" 2>/dev/null) || free_kb=""
  case "$free_kb" in
    ''|*[!0-9]*) problem "free disk in $dir ($name)" "cannot determine (folder missing?)" ;;
    *) ok "free disk in $dir ($name)" "$((free_kb / 1024 / 1024)) GB free" ;;
  esac
done

echo "--- settings ---"
if [ -z "${DOSSIER_PREFIX:-}" ]; then
  problem DOSSIER_PREFIX "not set"
else
  n=$(tgt_sql "select count(*) from idgen_seq_id_gen where prefix = $(sql_quote "$DOSSIER_PREFIX")" 2>/dev/null) || n=""
  if [ -n "$n" ] && [ "$n" -ge 1 ] 2>/dev/null; then ok DOSSIER_PREFIX "$DOSSIER_PREFIX ($n row in target idgen_seq_id_gen)"; else problem DOSSIER_PREFIX "$DOSSIER_PREFIX has no row in target idgen_seq_id_gen"; fi
fi
if [ -n "${ORDER_NUMBER_PREFIX:-}" ]; then ok ORDER_NUMBER_PREFIX "$ORDER_NUMBER_PREFIX"; else problem ORDER_NUMBER_PREFIX "empty"; fi
for f in EXPORT_USER_ROLE_MAPPINGS_FILE EXPORT_PATIENT_IDENTIFIERS_MAPPINGS_FILE EXPORT_PROGRAM_WORKFLOW_STATE_MAPPINGS_FILE EXPORT_CONCEPT_NAME_MAPPINGS_FILE; do
  path=${!f:-}
  [ -n "$path" ] || continue
  if [ -f "$path" ]; then ok "$f" "$path"; else problem "$f" "$path does not exist"; fi
done

echo "--- PIH EMR version (informational) ---"
for side in src tgt; do
  v=$(sql_on "$side" "select concat(property, ' = ', property_value) from global_property where property like '%pih%version%'" 2>/dev/null) || v=""
  echo "$(side_name "$side"): ${v:-no version-like global property found}"
done

echo
if [ "$problems" -gt 0 ]; then
  echo "$problems problem(s) found. Fix them and run this script again."
  exit 1
fi
next_step "02-check-source-data.sh" "all checks above say OK"
