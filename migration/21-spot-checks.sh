#!/usr/bin/env bash
# Step 21: spot checks on the target (HAI-1309). Read-only.
#   21-spot-checks.sh [settings-file]
# Prints the number of non-voided patients on the target per Health Center value (the row of the source
# facility is marked), then asks for dossier numbers one at a time (empty line ends) and searches each
# through REST on the target, printing found/not found with the patient uuid and the identifier only (no names).
# The migrating user's password goes to curl on stdin, never into a command line.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 21 "spot checks"
require_settings HEALTH_CENTER_ATTRIBUTE_TYPE_UUID SOURCE_FACILITY_UUID TARGET_OPENMRS_URL MIGRATING_USERNAME \
  TARGET_MYSQL_CONTAINER TARGET_DB

echo "--- Patients per Health Center value on the target (value is the location id)"
hc=$(sql_quote "$HEALTH_CENTER_ATTRIBUTE_TYPE_UUID")
rows=$(tgt_sql "select pa.value, count(*) from patient p join person_attribute pa on pa.person_id = p.patient_id and pa.voided = 0 join person_attribute_type t on t.person_attribute_type_id = pa.person_attribute_type_id and t.uuid = $hc where p.voided = 0 group by pa.value order by count(*) desc, pa.value")
fac_id=$(tgt_sql "select location_id from location where uuid = $(sql_quote "$SOURCE_FACILITY_UUID")" | head -n 1)
[ -n "$fac_id" ] || echo "(the source facility $SOURCE_FACILITY_UUID is not a location on the target, so no row can be marked)"
if [ -z "$rows" ]; then echo "(no patient has a Health Center value)"; fi
printf 'value\tpatients\n'
while IFS=$'\t' read -r value count; do
  [ -n "$value" ] || continue
  mark=""; [ "$value" != "$fac_id" ] || mark="   <-- source facility"
  printf '%s\t%s%s\n' "$value" "$count" "$mark"
done <<<"$rows"

echo "--- Dossier numbers"
numbers=()
while :; do
  n=$(ask "Dossier number to look up (empty line to finish):")
  [ -n "$n" ] || break
  case "$n" in
    *[!A-Za-z0-9._-]*) echo "  '$n' skipped: only letters, digits, . _ - are allowed" ;;
    *) numbers+=("$n") ;;
  esac
done

if [ ${#numbers[@]} -gt 0 ]; then
  pw=$(ask_secret "OpenMRS password of $MIGRATING_USERNAME on the target (not shown):")
  cfg=$(curl_user_config "$MIGRATING_USERNAME" "$pw")
  unset pw
  for n in "${numbers[@]}"; do
    url="$TARGET_OPENMRS_URL/ws/rest/v1/patient?identifier=$n&v=custom:(uuid,identifiers:(identifier))"
    _dim "[target GET] $url (credentials on stdin)"
    reply=$(run_on tgt "curl -fsS --config - -H 'Accept: application/json' '$url'" < <(printf '%s\n' "$cfg"))
    # The custom representation holds only uuid and identifiers; the uuids are the patients'.
    uuids=$(printf '%s' "$reply" | grep -o '"uuid" *: *"[^"]*"' | sed 's/.*: *"\(.*\)"/\1/' || true)
    if [ -z "$uuids" ]; then
      echo "$n: NOT found"
    else
      matching=$(printf '%s' "$reply" | grep -o '"identifier" *: *"[^"]*"' | sed 's/.*: *"\(.*\)"/\1/' | grep -Fx -- "$n" | head -n 1 || true)
      echo "$n: found, patient $(printf '%s' "$uuids" | tr '\n' ' ' | sed 's/ $//'), identifier ${matching:-(no identifier equal to $n in the reply)}"
    fi
  done
  unset cfg
else
  echo "(no dossier numbers given)"
fi

next_step "22-open-target.sh" "the Health Center counts look like the source's patients and the looked-up patients are found"
