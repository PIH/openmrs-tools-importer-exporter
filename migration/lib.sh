#!/usr/bin/env bash
# Shared functions for the numbered migration scripts. Source it, don't run it.
# Works with bash 3.2+ (macOS) and Linux. Only GNU-specific thing: none in this file
# (date/sed/tee used with portable flags only).
#
# Scripts using this should start with `set -euo pipefail` and `source "$(dirname "$0")/lib.sh"`.

MIGRATION_LIB_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Any failing command ends the script with a pointer to where.
set -o errtrace
_on_err() {
  local rc=$1 line=$2
  echo "FAILED in ${_SCRIPT_NAME:-$(basename "$0")} at line $line (exit $rc)" >&2
  exit "$rc"
}
trap '_on_err $? $LINENO' ERR

_dim() { if [ -t 2 ]; then printf '\033[2m%s\033[0m\n' "$*" >&2; else printf '%s\n' "$*" >&2; fi; }

# require_settings NAME...: exits 2 naming the first unset/empty one.
require_settings() {
  local name
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      echo "Missing setting: $name (set it in your settings file)" >&2
      exit 2
    fi
  done
}

# load_settings [file]: file, else $MIGRATION_ENV. Exports everything, creates $WORKDIR/logs
# and starts logging all output of the script to $WORKDIR/logs/<script>.<timestamp>.log.
load_settings() {
  local file=${1:-${MIGRATION_ENV:-}}
  if [ -z "$file" ] || [ ! -f "$file" ]; then
    echo "Settings file not found: '${file}'. Pass it as the first argument or set MIGRATION_ENV (create one with 00-create-settings.sh)." >&2
    exit 2
  fi
  set -a
  # shellcheck disable=SC1090
  source "$file"
  set +a
  : "${SOURCE_DOCKER:=sudo docker}"; : "${TARGET_DOCKER:=sudo docker}"
  : "${SOURCE_MYSQL_AUTH:=container-env}"; : "${TARGET_MYSQL_AUTH:=container-env}"
  : "${MIGRATION_MODE:=live}"; : "${WAIT_TIMEOUT_SECONDS:=1800}"
  export SOURCE_DOCKER TARGET_DOCKER SOURCE_MYSQL_AUTH TARGET_MYSQL_AUTH MIGRATION_MODE WAIT_TIMEOUT_SECONDS
  require_settings WORKDIR SOURCE_HOST TARGET_HOST
  mkdir -p "$WORKDIR/logs"
  _SCRIPT_NAME=$(basename "$0")
  exec > >(tee -a "$WORKDIR/logs/${_SCRIPT_NAME}.$(date +%Y%m%d-%H%M%S).log") 2>&1
}

# run_on src|tgt CMD: ssh to the host, or bash -c when the host is "local". stdin is passed through.
run_on() {
  local side=$1 cmd=$2 host
  case "$side" in
    src) host=${SOURCE_HOST:?SOURCE_HOST not set} ;;
    tgt) host=${TARGET_HOST:?TARGET_HOST not set} ;;
    *) echo "run_on: side must be src or tgt" >&2; return 2 ;;
  esac
  if [ "$host" = local ]; then bash -c "$cmd"; else ssh "$host" "$cmd"; fi
}

# MYSQL_PWD for MYSQL_AUTH=prompt: asked once per side, kept in this shell only.
_SRC_PW=""; _TGT_PW=""
_mysql_pw() {
  local side=$1 var=_SRC_PW
  [ "$side" = tgt ] && var=_TGT_PW
  if [ -z "${!var}" ]; then
    local pw
    read -rsp "MySQL root password for the ${side} server: " pw </dev/tty; echo >&2
    printf -v "$var" '%s' "$pw"
  fi
  printf '%s' "${!var}"
}

# _mysql_run side SQL: runs SQL with the mysql client inside the container. -N -B tab output.
# The password never appears on a command line or in a log: container-env reads the
# container's own MYSQL_ROOT_PASSWORD; prompt sends the typed one as the first stdin line.
_mysql_run() {
  local side=$1 sql=$2 docker container db auth
  if [ "$side" = src ]; then
    docker=$SOURCE_DOCKER; container=${SOURCE_MYSQL_CONTAINER:?SOURCE_MYSQL_CONTAINER not set}; db=${SOURCE_DB:?SOURCE_DB not set}; auth=$SOURCE_MYSQL_AUTH
  else
    docker=$TARGET_DOCKER; container=${TARGET_MYSQL_CONTAINER:?TARGET_MYSQL_CONTAINER not set}; db=${TARGET_DB:?TARGET_DB not set}; auth=$TARGET_MYSQL_AUTH
  fi
  case "$auth" in
    container-env)
      run_on "$side" "$docker exec -i $container sh -c 'MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" exec mysql -uroot -N -B \"\$0\"' $db" <<<"$sql" ;;
    prompt)
      local pw; pw=$(_mysql_pw "$side")
      run_on "$side" "IFS= read -r MYSQL_PWD; export MYSQL_PWD; $docker exec -i -e MYSQL_PWD $container sh -c 'exec mysql -uroot -N -B \"\$0\"' $db" <<<"$pw"$'\n'"$sql" ;;
    *) echo "Unknown MYSQL_AUTH '$auth' for the $side server (use container-env or prompt)" >&2; return 2 ;;
  esac
}

# Read-only queries: print the SQL first, rows on stdout.
src_sql() { _dim "[source SQL] $1"; _mysql_run src "$1"; }
tgt_sql() { _dim "[target SQL] $1"; _mysql_run tgt "$1"; }

# confirm "what this changes": y/yes continues, anything else (or no tty) exits 1.
# MIGRATION_CONFIRM_INPUT is TEST-ONLY (replaces /dev/tty); never put it in a settings file.
confirm() {
  local ans=""
  echo "About to: $1" >&2
  printf 'Proceed? [y/N] ' >&2
  read -r ans 2>/dev/null <"${MIGRATION_CONFIRM_INPUT:-/dev/tty}" || true
  echo >&2
  case "$ans" in y|Y|yes|YES|Yes) return 0 ;; esac
  echo "Not confirmed, stopping." >&2
  exit 1
}

_refuse_in_test_mode() {
  if [ "${MIGRATION_MODE:-}" = test ]; then
    echo "Refused in test mode: $1 on the $2 server" >&2
    exit 3
  fi
}

# Writes to a database or service. print + confirm; the source ones are refused in test mode.
src_sql_write() { _refuse_in_test_mode "SQL write" source; _dim "[source SQL] $1"; confirm "run this SQL on the SOURCE database"; _mysql_run src "$1"; }
tgt_sql_write() { _dim "[target SQL] $1"; confirm "run this SQL on the TARGET database"; _mysql_run tgt "$1"; }
src_cmd_write() { _refuse_in_test_mode "command" source; _dim "[source cmd] $1"; confirm "run this command on the SOURCE server"; run_on src "$1"; }
tgt_cmd_write() { _dim "[target cmd] $1"; confirm "run this command on the TARGET server"; run_on tgt "$1"; }
# Work writes: repo checkout, docker image pull, files under *_SERVER_DIR only. Allowed in test mode.
src_work_write() { _dim "[source cmd] $1"; confirm "run this work command (files/repo/image only) on the SOURCE server"; run_on src "$1"; }
tgt_work_write() { _dim "[target cmd] $1"; confirm "run this work command (files/repo/image only) on the TARGET server"; run_on tgt "$1"; }

# Source and target servers can't SSH to each other at the moment, so cross-server data goes through this laptop. This may change (to research with IT); if it does, this can become a direct ssh/scp between the servers.
pipe_src_to_tgt() { ( set -o pipefail; run_on src "$1" | run_on tgt "$2" ); }

# sql_quote STRING: prints STRING as a SQL string literal ('' for ', \\ for \).
sql_quote() {
  local s=$1 q="'" bs='\'
  s=${s//"$bs"/"$bs$bs"}
  s=${s//"$q"/"$q$q"}
  printf "'%s'" "$s"
}

tmux_running() { run_on "$1" "tmux has-session -t =$2" >/dev/null 2>&1; }

# start_in_tmux src|tgt SESSION CMD: starts CMD detached; refuses if SESSION is already running.
# Does not confirm by itself: callers confirm (and respect test mode) before calling.
start_in_tmux() {
  local side=$1 session=$2 cmd=$3
  if tmux_running "$side" "$session"; then
    echo "tmux session '$session' is already running on the $side server; attach with: tmux attach -t $session" >&2
    return 1
  fi
  _dim "[$side tmux:$session] $cmd"
  run_on "$side" "tmux new-session -d -s $session $(printf '%q' "$cmd")"
}

# wait_for_target: polls TARGET_WAIT_URL (curl on the target server) every 10 s, up to WAIT_TIMEOUT_SECONDS.
wait_for_target() {
  local url=${TARGET_WAIT_URL:?TARGET_WAIT_URL not set} timeout=${WAIT_TIMEOUT_SECONDS:-1800} start=$SECONDS left
  echo "Waiting for $url (up to ${timeout}s)..." >&2
  while ! run_on tgt "curl -fsS -o /dev/null '$url'" >/dev/null 2>&1; do
    left=$(( timeout - (SECONDS - start) ))
    if [ "$left" -le 0 ]; then echo "Timed out waiting for $url" >&2; return 1; fi
    sleep $(( left < 10 ? left : 10 ))
  done
  echo "$url is up" >&2
}

step_header() {
  echo "=== Step $1: $2 ==="
  echo "Mode: ${MIGRATION_MODE:-live}   ${SOURCE_NAME:-source} (${SOURCE_HOST:-?}) -> target (${TARGET_HOST:-?})"
}

# next_step "NN-name.sh" "check first": footer, only reached when the script succeeded.
next_step() { echo; echo "Done. Check: $2"; echo "Next: $1"; }

skip_in_test_mode() {
  if [ "${MIGRATION_MODE:-}" = test ]; then echo "skipped in test mode: $1"; exit 0; fi
}
