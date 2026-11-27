#!/usr/bin/env bash
# Step 00: create or edit the settings file for a migration.
#   00-create-settings.sh [settings-file]      (default: $MIGRATION_ENV)
# Asks for every setting listed in migration.env.example, one at a time, with its comment and the
# current value (the file's, else the example's default) shown. Enter keeps the shown value;
# end of input keeps the rest. Where the server settings already have values and the server answers,
# it offers lookups (docker containers, databases, facility by name, dossier prefixes); otherwise
# it says nothing. It never asks for or stores passwords. The file is written with mode 600.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"

file=${1:-${MIGRATION_ENV:-}}
if [ -z "$file" ]; then
  echo "Usage: $0 <settings-file>   (or set MIGRATION_ENV). Keep the file outside the repo." >&2
  exit 2
fi
example="$here/migration.env.example"

names=(); defaults=(); comments=()
pending=""
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    '# '*) pending="${pending:+$pending$'\n'}${line#\# }" ;;
    [A-Z]*=*)
      d=${line#*=}; case "$d" in \"*\") d=${d#\"}; d=${d%\"} ;; esac
      names+=("${line%%=*}"); defaults+=("$d"); comments+=("$pending"); pending="" ;;
    *) pending="" ;;
  esac
done < "$example"

# Value now in the existing file (expanded), or empty.
existing_value() {
  [ -f "$file" ] || return 0
  ( set +eu; set -a; trap - ERR; . "$file" >/dev/null 2>&1; printf '%s' "${!1}" ) 2>/dev/null || true
}
existing_has() { [ -f "$file" ] && grep -Eq "^(export[[:space:]]+)?$1=" "$file"; }

# --- lookups: only when the host setting has a value and the host answers; silent otherwise ---
val() { local v="_val_$1"; printf '%s' "${!v:-}"; }
# try SIDE CMD [STDIN]: runs on the host without ever prompting (ssh BatchMode, sudo -n); fails quietly.
try() {
  local side=$1 cmd=$2 input=${3:-} host
  host=$(val "${side}_HOST"); [ -n "$host" ] || return 1
  if [ "$host" = local ]; then
    printf '%s' "$input" | bash -c "$cmd" 2>/dev/null
  else
    printf '%s' "$input" | ssh -o BatchMode=yes -o ConnectTimeout=5 "$host" "$cmd" 2>/dev/null
  fi
}
docker_cmd() { local d; d=$(val "${1}_DOCKER"); [ -n "$d" ] || d="sudo docker"; case "$d" in "sudo "*) d="sudo -n ${d#sudo }" ;; esac; printf '%s' "$d"; }
# sql SIDE DB SQL: needs container and container-env auth.
sql_try() {
  local side=$1 db=$2 sql=$3 c
  c=$(val "${side}_MYSQL_CONTAINER"); [ -n "$c" ] || return 1
  [ "$(val "${side}_MYSQL_AUTH")" != prompt ] || return 1
  try "$side" "$(docker_cmd "$side") exec -i $c sh -c 'MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" exec mysql -uroot -N -B \"\$0\"' $db" "$sql"
}
list_line() { local out; out=$(tr '\n' ' ' | sed 's/ *$//'); [ -z "$out" ] || echo "  $1: $out"; }

lookup_before() {   # shown before asking for $1
  local n=$1 side out
  case "$n" in
    SOURCE_MYSQL_CONTAINER|TARGET_MYSQL_CONTAINER)
      side=SOURCE; [ "$n" = TARGET_MYSQL_CONTAINER ] && side=TARGET
      try "$side" "$(docker_cmd "$side") ps --format '{{.Names}}'" | list_line "Containers on the $(echo "$side" | tr A-Z a-z) server" || true ;;
    SOURCE_DB|TARGET_DB)
      side=SOURCE; [ "$n" = TARGET_DB ] && side=TARGET
      sql_try "$side" information_schema "show databases" | grep -vxE 'information_schema|mysql|performance_schema|sys' \
        | list_line "Databases in the $(echo "$side" | tr A-Z a-z) container" || true ;;
    DOSSIER_PREFIX)
      sql_try TARGET "$(val TARGET_DB)" "select prefix from idgen_seq_id_gen" | list_line "Dossier prefixes on the target" || true ;;
  esac
}
facility_search() {   # prints matching uuid + name for a name fragment
  local frag=$1 q
  q=$(sql_quote "%$frag%")
  sql_try SOURCE "$(val SOURCE_DB)" "select uuid, name from location where name like $q" | sed 's/^/  /' || true
}

# --- ask ---
for i in "${!names[@]}"; do
  n=${names[$i]}; raw_default=${defaults[$i]}
  if existing_has "$n"; then
    cur=$(existing_value "$n"); is_default=0
    # a value kept as a double-quoted default (may reference other settings) stays that way
    rawline=$(grep -E "^$n=" "$file" | tail -1 || true)
    case "$rawline" in "$n=\""*\") cur=${rawline#"$n=\""}; cur=${cur%\"}; is_default=1 ;; esac
  else cur=$raw_default; is_default=1; fi
  echo
  printf '%s\n' "${comments[$i]}"
  lookup_before "$n"
  while :; do
    printf '%s [%s]: ' "$n" "$cur"
    if ! IFS= read -r ans; then ans=""; echo; fi
    if [ "$n" = SOURCE_FACILITY_UUID ] && [ "${ans#\?}" != "$ans" ]; then facility_search "${ans#\?}"; continue; fi
    break
  done
  if [ -n "$ans" ] && [ "$ans" != "$cur" ]; then cur=$ans; is_default=0; fi
  printf -v "_val_$n" '%s' "$cur"
  if [ "$is_default" = 1 ]; then
    printf -v "_out_$n" '%s="%s"' "$n" "$cur"       # default: written as-is, so variables in it expand when sourced
  else
    printf -v "_out_$n" "%s='%s'" "$n" "${cur//\'/\'\\\'\'}"
  fi
done

mkdir -p "$(dirname "$file")"
tmp="$file.tmp.$$"
( umask 077
  {
    echo "# Migration settings, written by 00-create-settings.sh. No passwords belong here. Keep outside the repo."
    for n in "${names[@]}"; do v="_out_$n"; echo "${!v}"; done
  } > "$tmp" )
chmod 600 "$tmp"
mv "$tmp" "$file"
echo
echo "Wrote $file (mode 600)."
next_step "01-preflight.sh" "open $file once and look over the values; re-run this script any time to change them"
