#!/usr/bin/env bash
# Step 02: look at the source (and target) data for things the migration does not cover. Read-only.
#   02-check-source-data.sh [settings-file]
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
require_settings SOURCE_MYSQL_CONTAINER TARGET_MYSQL_CONTAINER SOURCE_DB TARGET_DB
step_header 02 "check source data"

echo "--- data the migration does not move (source database) ---"
present=$(src_sql "select table_name from information_schema.tables where table_schema = database()")
total=0; label=""; found=""
while IFS= read -r line; do
  case "$line" in
    "-- item: "*)
      item=${line#-- item: }; label=${item%% | *}; table=${item##* | }
      if printf '%s\n' "$present" | grep -qx "$table"; then found=yes; else found=""; echo "  $label: table not present"; fi ;;
    select*)
      [ -n "$found" ] || continue
      n=$(src_sql "${line%;}")
      echo "  $label $n"
      total=$((total + n)) ;;
  esac
done < "$here/sql/unsupported-data.sql"
if [ "$total" -gt 0 ]; then
  echo "Unsupported data exists on the source (counts above); it will NOT be migrated."
  confirm "continue although unsupported data exists"
fi

echo "--- patients without the Health Center attribute (non-voided) ---"
hc=$(sql_quote "${HEALTH_CENTER_ATTRIBUTE_TYPE_UUID:?HEALTH_CENTER_ATTRIBUTE_TYPE_UUID not set}")
for side in src tgt; do
  label=source; [ "$side" = tgt ] && label=target
  q_type="select count(*) from person_attribute_type where uuid = $hc"
  q_miss="select count(*) from patient p where p.voided = 0 and not exists (select 1 from person_attribute pa join person_attribute_type t on t.person_attribute_type_id = pa.person_attribute_type_id where pa.person_id = p.patient_id and pa.voided = 0 and t.uuid = $hc)"
  if [ "$side" = src ]; then have=$(src_sql "$q_type"); miss=$(src_sql "$q_miss"); else have=$(tgt_sql "$q_type"); miss=$(tgt_sql "$q_miss"); fi
  echo "  patients without Health Center on $label: $miss"
  [ "$have" = 1 ] || echo "  (attribute type $HEALTH_CENTER_ATTRIBUTE_TYPE_UUID does not exist on the $label database, so this count is every patient)"
done

echo "--- providers (source) ---"
n=$(src_sql "select count(*) from provider p where p.retired = 0 and not exists (select 1 from users u where u.person_id = p.person_id)")
echo "  non-retired providers whose person has no user: $n"

echo "--- not covered by this migration, handle separately ---"
echo "  [5] ID/card printing"
echo "  [44] CommCare"
echo "  [45] ETL"

next_step "03-lock-source.sh" "the counts above; decide about anything unsupported or missing before locking"
