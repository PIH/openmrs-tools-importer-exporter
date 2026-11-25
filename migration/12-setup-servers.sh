#!/usr/bin/env bash
# Step 12: set up the importer on the source and the target server.
#   12-setup-servers.sh [settings-file]
# Per server (source first): git clone or fetch+checkout of the importer into <SERVER_DIR>/repo,
# npm ci in a docker container, the importer's src/.env (mode 600), and the uuid lists (source) and
# mapping files (target) copied up from this machine. The OpenMRS passwords are typed here (read -s),
# are sent to the server over stdin only, and are never printed or logged (the .env is shown with ***).
#
# What the importer reads (src/utils/config.js):
#  - source .env: exports only talk to the source OpenMRS and read the uuid lists; the mapping files
#    and the target settings are not read by them, so they are not written there.
#  - target .env: the import and verify scripts only talk to the target OpenMRS (the exporter service's
#    default SOURCE server is never used by them), so there are no OPENMRS_SOURCE_* values there; they do
#    read OPENMRS_SOURCE_FACILITY_UUID (importUsers, verifyUsers) and OPENMRS_HEALTH_CENTER_ATTRIBUTE_UUID
#    (importerService, verifyPatients). The FIX_* / INCLUDE_* options are left at the importer's defaults.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 12 "set up the importer on both servers"
require_settings SOURCE_SERVER_DIR TARGET_SERVER_DIR REPO_URL REPO_REF NODE_IMAGE SOURCE_OPENMRS_URL TARGET_OPENMRS_URL \
  MIGRATING_USERNAME SOURCE_FACILITY_UUID ORDER_NUMBER_PREFIX IMPORT_PATIENTS_BATCH_SIZE HEALTH_CENTER_ATTRIBUTE_TYPE_UUID

list_dir="$WORKDIR/lists"
map_dir="$WORKDIR/mappings"
list_names="users providers patients relationships"
optional_map_settings="EXPORT_USER_ROLE_MAPPINGS_FILE EXPORT_PATIENT_IDENTIFIERS_MAPPINGS_FILE EXPORT_PROGRAM_WORKFLOW_STATE_MAPPINGS_FILE EXPORT_CONCEPT_NAME_MAPPINGS_FILE"

# Everything that must exist on this machine, checked before anything is changed.
missing=""
for n in $list_names; do [ -f "$list_dir/$n.csv" ] || missing="$missing $list_dir/$n.csv"; done
for f in user_mappings.csv provider_mappings.csv; do [ -f "$map_dir/$f" ] || missing="$missing $map_dir/$f"; done
for s in $optional_map_settings; do
  if [ -n "${!s:-}" ] && [ ! -f "${!s}" ]; then missing="$missing ${!s} ($s)"; fi
done
if [ -n "$missing" ]; then
  echo "Missing files (run steps 09-11 first, or fix the settings):$missing" >&2
  exit 2
fi

# _ask_pw side: reads the OpenMRS password for that side with read -s (nothing echoed or logged) into
# src_pw / tgt_pw. MIGRATION_PROMPT_PW_FILE (harness only): line 1 = source, line 2 = target.
src_pw=""; tgt_pw=""
_ask_pw() {
  local side=$1 label=source n=1 pw
  [ "$side" = tgt ] && { label=target; n=2; }
  if [ "${MIGRATION_UNDER_TEST:-}" = 1 ] && [ -n "${MIGRATION_PROMPT_PW_FILE:-}" ]; then
    pw=$(sed -n "${n}p" "$MIGRATION_PROMPT_PW_FILE")
  else
    read -rsp "OpenMRS password of $MIGRATING_USERNAME on the $label server: " pw </dev/tty; echo >&2
  fi
  [ -n "$pw" ] || { echo "Empty password for the $label server" >&2; exit 2; }
  if [ "$side" = src ]; then src_pw=$pw; else tgt_pw=$pw; fi
}

# _dq VALUE: VALUE as a dotenv value: bare if it only has safe characters, else quoted with whichever
# of ' " ` it does not contain.
_dq() {
  local v=$1
  case "$v" in *$'\n'*|*$'\r'*) echo "A value with a line break can't go in a .env file" >&2; exit 2 ;; esac
  if [[ $v =~ ^[A-Za-z0-9_./:@%+=,-]+$ ]]; then printf '%s' "$v"
  elif [[ $v != *"'"* ]]; then printf "'%s'" "$v"
  elif [[ $v != *'"'* ]]; then printf '"%s"' "$v"
  elif [[ $v != *'`'* ]]; then printf '`%s`' "$v"
  else echo "A value containing ', \" and \` can't go in a .env file" >&2; exit 2; fi
}

# _env_text side show_pw: the .env content for that side; the password is *** unless show_pw is 1.
_env_text() {
  local side=$1 show=$2 dir pw s
  if [ "$side" = src ]; then
    dir=$SOURCE_SERVER_DIR; pw=$src_pw
    echo "OPENMRS_SOURCE_CONTEXT_PATH=$(_dq "$SOURCE_OPENMRS_URL")"
    echo "OPENMRS_SOURCE_USERNAME=$(_dq "$MIGRATING_USERNAME")"
    if [ "$show" = 1 ]; then echo "OPENMRS_SOURCE_PASSWORD=$(_dq "$pw")"; else echo "OPENMRS_SOURCE_PASSWORD=***"; fi
    echo "TARGET_DIR=$(_dq "$dir/exports")"
    echo "LOG_HOME=$(_dq "$dir/logs")"
    echo "ORDER_NUMBER_PREFIX=$(_dq "$ORDER_NUMBER_PREFIX")"
    echo "OPENMRS_SOURCE_FACILITY_UUID=$(_dq "$SOURCE_FACILITY_UUID")"
    echo "EXPORT_USER_LIST_FILE=$(_dq "$dir/lists/users.csv")"
    echo "EXPORT_PROVIDER_LIST_FILE=$(_dq "$dir/lists/providers.csv")"
    echo "EXPORT_PATIENT_LIST_FILE=$(_dq "$dir/lists/patients.csv")"
    echo "EXPORT_RELATIONSHIP_LIST_FILE=$(_dq "$dir/lists/relationships.csv")"
  else
    dir=$TARGET_SERVER_DIR; pw=$tgt_pw
    echo "OPENMRS_TARGET_CONTEXT_PATH=$(_dq "$TARGET_OPENMRS_URL")"
    echo "OPENMRS_TARGET_USERNAME=$(_dq "$MIGRATING_USERNAME")"
    if [ "$show" = 1 ]; then echo "OPENMRS_TARGET_PASSWORD=$(_dq "$pw")"; else echo "OPENMRS_TARGET_PASSWORD=***"; fi
    echo "TARGET_DIR=$(_dq "$dir/exports")"
    echo "LOG_HOME=$(_dq "$dir/logs")"
    echo "OPENMRS_SOURCE_FACILITY_UUID=$(_dq "$SOURCE_FACILITY_UUID")"
    echo "OPENMRS_HEALTH_CENTER_ATTRIBUTE_UUID=$(_dq "$HEALTH_CENTER_ATTRIBUTE_TYPE_UUID")"
    echo "IMPORT_PATIENTS_BATCH_SIZE=$(_dq "$IMPORT_PATIENTS_BATCH_SIZE")"
    echo "EXPORT_USER_MAPPINGS_FILE=$(_dq "$dir/mappings/user_mappings.csv")"
    echo "EXPORT_PROVIDER_MAPPINGS_FILE=$(_dq "$dir/mappings/provider_mappings.csv")"
    for s in $optional_map_settings; do
      [ -z "${!s:-}" ] || echo "$s=$(_dq "$dir/mappings/$(basename "${!s}")")"
    done
  fi
}

# _work side CMD: print + confirm + run (stdin goes to the command), allowed in test mode.
_work() { if [ "$1" = src ]; then src_work_write "$2"; else tgt_work_write "$2"; fi; }

# _put side LOCALFILE REMOTE_DIR REMOTE_NAME: copies the file up with cat > file.
_put() {
  local q; q=$(printf '%q' "$3")
  _work "$1" "mkdir -p $q && cat > $q/$(printf '%q' "$4")" < "$2"
}

_setup() {
  local side=$1 label dir docker repo qdir qrepo qurl qref s f
  if [ "$side" = src ]; then label=source; dir=$SOURCE_SERVER_DIR; docker=$SOURCE_DOCKER; else label=target; dir=$TARGET_SERVER_DIR; docker=$TARGET_DOCKER; fi
  repo="$dir/repo"
  qdir=$(printf '%q' "$dir"); qrepo=$(printf '%q' "$repo"); qurl=$(printf '%q' "$REPO_URL"); qref=$(printf '%q' "$REPO_REF")
  echo; echo "--- $label server: $dir ---"

  if run_on "$side" "test -d $qrepo/.git"; then
    # The merge only moves a checked-out branch forward; on a tag or commit (no upstream) it does nothing.
    _work "$side" "git -C $qrepo fetch --tags && git -C $qrepo checkout $qref && { git -C $qrepo merge --ff-only '@{u}' >/dev/null 2>&1 || true; }"
  else
    _work "$side" "mkdir -p $qdir && git clone $qurl $qrepo && git -C $qrepo checkout $qref"
  fi

  if [ "${MIGRATION_UNDER_TEST:-}" = 1 ] && [ "${SKIP_NPM_CI:-}" = true ]; then
    echo "npm ci skipped (SKIP_NPM_CI, test harness)"
  else
    _work "$side" "$docker run --rm -v $qrepo:/app -w /app $NODE_IMAGE npm ci"
  fi

  _work "$side" "mkdir -p $(printf '%q' "$dir/exports") $(printf '%q' "$dir/logs")"

  if [ "$side" = src ]; then
    for f in $list_names; do _put src "$list_dir/$f.csv" "$dir/lists" "$f.csv"; done
  else
    for f in user_mappings.csv provider_mappings.csv; do _put tgt "$map_dir/$f" "$dir/mappings" "$f"; done
    for s in $optional_map_settings; do
      [ -z "${!s:-}" ] || _put tgt "${!s}" "$dir/mappings" "$(basename "${!s}")"
    done
  fi

  _ask_pw "$side"
  echo "The $label .env (passwords hidden):"
  _env_text "$side" 0 | sed 's/^/    /'
  # Content goes over stdin only: never on a command line. umask 077 so it is never readable by others.
  _env_text "$side" 1 | _work "$side" "umask 077 && cat > $qrepo/src/.env && chmod 600 $qrepo/src/.env"
}

_setup src
_setup tgt

next_step "13-export.sh" "the two .env files above look right (the passwords are in them, not shown here)"
