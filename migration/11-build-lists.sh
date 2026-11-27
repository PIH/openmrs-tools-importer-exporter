#!/usr/bin/env bash
# Step 11: build the uuid lists the exporter works through (wiki step 20).
#   11-build-lists.sh [settings-file]
# Read-only queries on the source database. Writes $WORKDIR/lists/{users,providers,patients,relationships}.csv
# (one uuid per line, nothing else; overwritten on every run) and prints the counts.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 11 "uuid lists"
require_settings SOURCE_MYSQL_CONTAINER SOURCE_DB

list_dir="$WORKDIR/lists"
mkdir -p "$list_dir"

# _build_list NAME SQL: runs the query and replaces $list_dir/NAME.csv with the result.
_build_list() {
  local name=$1 sql=$2 tmp="$list_dir/$1.csv.tmp"
  src_sql "$sql" > "$tmp"
  mv "$tmp" "$list_dir/$name.csv"
  echo "$name: $(wc -l < "$list_dir/$name.csv" | tr -d ' ')"
}

_build_list users "select uuid from users"
_build_list providers "select uuid from provider"
_build_list patients "select p.uuid from patient pt join person p on p.person_id = pt.patient_id where pt.voided = 0 and p.voided = 0"
_build_list relationships "select uuid from relationship where voided = 0"
echo "Files in $list_dir (uuids only)"

next_step "12-setup-servers.sh" "the counts look plausible for this site (voided patients and relationships are left out)"
