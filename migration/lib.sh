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
  if grep -Eq '^[[:space:]]*(export[[:space:]]+)?(MIGRATION_CONFIRM_INPUT|MIGRATION_UNDER_TEST|MIGRATION_PROMPT_PW_FILE|SKIP_NPM_CI)=' "$file"; then
    echo "Settings file must not set MIGRATION_CONFIRM_INPUT, MIGRATION_UNDER_TEST, MIGRATION_PROMPT_PW_FILE or SKIP_NPM_CI (test-harness only)" >&2
    exit 2
  fi
  set -a
  # shellcheck disable=SC1090
  source "$file"
  set +a
  : "${SOURCE_DOCKER:=sudo docker}"; : "${TARGET_DOCKER:=sudo docker}"
  : "${SOURCE_MYSQL_AUTH:=container-env}"; : "${TARGET_MYSQL_AUTH:=container-env}"
  : "${WAIT_TIMEOUT_SECONDS:=1800}"
  export SOURCE_DOCKER TARGET_DOCKER SOURCE_MYSQL_AUTH TARGET_MYSQL_AUTH MIGRATION_MODE WAIT_TIMEOUT_SECONDS
  require_settings WORKDIR SOURCE_HOST TARGET_HOST MIGRATION_MODE
  case "$MIGRATION_MODE" in test|real) ;; *) echo "Setting MIGRATION_MODE must be exactly 'test' or 'real' (got '$MIGRATION_MODE')" >&2; exit 2 ;; esac
  # SOURCE_NAME ends up in file names and shell commands on the servers: only plain characters.
  if [ -n "${SOURCE_NAME:-}" ] && ! [[ $SOURCE_NAME =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "Setting SOURCE_NAME '$SOURCE_NAME' may only contain letters, digits, '.', '_' and '-'" >&2; exit 2
  fi
  # Prompt once, up front, in this shell (a later $(src_sql ...) subshell could not keep the answer).
  [ "$SOURCE_MYSQL_AUTH" != prompt ] || _load_mysql_pw src
  [ "$TARGET_MYSQL_AUTH" != prompt ] || _load_mysql_pw tgt
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

# run_on_tty src|tgt CMD: like run_on, but with a terminal (ssh -t) so the command can prompt (e.g. 7z asking for a password).
# stdin must be the operator's terminal. Local hosts run the command directly.
run_on_tty() {
  local side=$1 cmd=$2 host
  case "$side" in
    src) host=${SOURCE_HOST:?SOURCE_HOST not set} ;;
    tgt) host=${TARGET_HOST:?TARGET_HOST not set} ;;
    *) echo "run_on_tty: side must be src or tgt" >&2; return 2 ;;
  esac
  if [ "$host" = local ]; then bash -c "$cmd"; else ssh -t "$host" "$cmd"; fi
}

# MYSQL_AUTH=prompt: ask once per side (sets a global, so call it without $(...)).
# MIGRATION_PROMPT_PW_FILE (read instead of the tty) is honoured only under MIGRATION_UNDER_TEST=1.
_SRC_PW=""; _TGT_PW=""
_load_mysql_pw() {
  local var=_SRC_PW pw
  [ "$1" = tgt ] && var=_TGT_PW
  [ -z "${!var}" ] || return 0
  if [ "${MIGRATION_UNDER_TEST:-}" = 1 ] && [ -n "${MIGRATION_PROMPT_PW_FILE:-}" ]; then
    IFS= read -r pw <"$MIGRATION_PROMPT_PW_FILE"
  else
    read -rsp "MySQL root password for the $1 server: " pw </dev/tty; echo >&2
  fi
  printf -v "$var" '%s' "$pw"
}

# mysql_cmd side [MYSQL_FLAGS]: prints the remote command (to give to run_on) that runs the mysql
# client inside the container, reading SQL from stdin (-N -B plus MYSQL_FLAGS). The password never
# appears on a command line or in a log: container-env reads the container's own
# MYSQL_ROOT_PASSWORD; prompt expects the typed one as the first stdin line (see mysql_input),
# read inside the container (no -e, no host env var, so it also works with "sudo docker").
mysql_cmd() {
  local side=$1 flags=${2:-} docker container db auth
  if [ "$side" = src ]; then
    docker=$SOURCE_DOCKER; container=${SOURCE_MYSQL_CONTAINER:?SOURCE_MYSQL_CONTAINER not set}; db=${SOURCE_DB:?SOURCE_DB not set}; auth=$SOURCE_MYSQL_AUTH
  else
    docker=$TARGET_DOCKER; container=${TARGET_MYSQL_CONTAINER:?TARGET_MYSQL_CONTAINER not set}; db=${TARGET_DB:?TARGET_DB not set}; auth=$TARGET_MYSQL_AUTH
  fi
  case "$auth" in
    container-env)
      printf '%s' "$docker exec -i $container sh -c 'MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" exec mysql -uroot -N -B $flags \"\$0\"' $db" ;;
    prompt)
      printf '%s' "$docker exec -i $container sh -c 'IFS= read -r MYSQL_PWD; export MYSQL_PWD; exec mysql -uroot -N -B $flags \"\$0\"' $db" ;;
    *) echo "Unknown MYSQL_AUTH '$auth' for the $side server (use container-env or prompt)" >&2; return 2 ;;
  esac
}

# mysql_pw_line side: prints the first stdin line the mysql_cmd needs: the typed password for
# prompt auth, nothing for container-env. Call it without $(...) only if the password is not loaded yet.
mysql_pw_line() {
  local side=$1 auth=$SOURCE_MYSQL_AUTH pw=_SRC_PW
  [ "$side" = tgt ] && { auth=$TARGET_MYSQL_AUTH; pw=_TGT_PW; }
  if [ "$auth" = prompt ]; then _load_mysql_pw "$side"; printf '%s\n' "${!pw}"; fi
}

# mysql_input side SQL: prints everything mysql_cmd expects on stdin (password line if needed, then SQL).
mysql_input() { mysql_pw_line "$1"; printf '%s\n' "$2"; }

# _mysql_run side SQL: runs SQL with the mysql client inside the container. -N -B tab output.
_mysql_run() {
  local side=$1 sql=$2 cmd
  cmd=$(mysql_cmd "$side") || return $?
  run_on "$side" "$cmd" < <(mysql_input "$side" "$sql")
}

# Read-only queries: print the SQL first, rows on stdout.
# Anything that is not select/show/describe/desc/explain/with is rejected: use *_sql_write.
_require_read_only_sql() {
  local s=$1
  local kw
  while :; do
    if [[ $s =~ ^[[:space:]]+ ]]; then s=${s#"${BASH_REMATCH[0]}"}
    elif [[ $s == --* ]]; then case "$s" in *$'\n'*) s=${s#*$'\n'} ;; *) s="" ;; esac
    elif [[ $s == /\** ]]; then case "$s" in *'*/'*) s=${s#*'*/'} ;; *) s="" ;; esac
    else break; fi
  done
  kw=$(printf '%s' "$s" | tr -c 'A-Za-z\n' ' ' | awk '{print tolower($1); exit}')
  case "$kw" in select|show|describe|desc|explain|with) return 0 ;; esac
  echo "src_sql/tgt_sql are read-only (select/show/describe/explain/with only); use src_sql_write/tgt_sql_write for: $1" >&2
  exit 2
}
src_sql() { _require_read_only_sql "$1"; _dim "[source SQL] $1"; _mysql_run src "$1"; }
tgt_sql() { _require_read_only_sql "$1"; _dim "[target SQL] $1"; _mysql_run tgt "$1"; }

# confirm "what this changes": y/yes continues, anything else (or no tty) exits 1.
# MIGRATION_CONFIRM_INPUT replaces /dev/tty ONLY when MIGRATION_UNDER_TEST=1 (set by tests/run.sh);
# load_settings refuses settings files that set either. MIGRATION_MODE=test does not enable it.
confirm() {
  local ans=""
  echo "About to: $1" >&2
  printf 'Proceed? [y/N] ' >&2
  local in=/dev/tty
  [ "${MIGRATION_UNDER_TEST:-}" = 1 ] && in=${MIGRATION_CONFIRM_INPUT:-/dev/tty}
  read -r ans 2>/dev/null <"$in" || true
  echo >&2
  case "$ans" in y|Y|yes|YES|Yes) return 0 ;; esac
  echo "Not confirmed, stopping." >&2
  exit 1
}

# ask "prompt": prints the prompt, reads one line and prints it on stdout (for retyping a value).
# Same input source and harness-only rule as confirm.
ask() {
  local ans="" in=/dev/tty
  printf '%s ' "$1" >&2
  [ "${MIGRATION_UNDER_TEST:-}" = 1 ] && in=${MIGRATION_CONFIRM_INPUT:-/dev/tty}
  read -r ans 2>/dev/null <"$in" || true
  echo >&2
  printf '%s\n' "$ans"
}

# ask_secret "prompt": reads one line without echo (prints it on stdout; call as $(...) only if you do not need the
# terminal state afterwards). Under MIGRATION_UNDER_TEST=1 MIGRATION_PROMPT_PW_FILE is read instead of the tty.
ask_secret() {
  local pw=""
  if [ "${MIGRATION_UNDER_TEST:-}" = 1 ] && [ -n "${MIGRATION_PROMPT_PW_FILE:-}" ]; then
    IFS= read -r pw <"$MIGRATION_PROMPT_PW_FILE" || true
  else
    read -rsp "$1 " pw </dev/tty || true; echo >&2
  fi
  printf '%s\n' "$pw"
}

# curl_user_config USER PASSWORD: prints a curl config (for `curl --config -`) with the credentials, so they
# travel on stdin and never appear in a command line.
curl_user_config() {
  local u=$1 p=$2 bs='\' q='"'
  u=${u//"$bs"/"$bs$bs"}; u=${u//"$q"/"$bs$q"}
  p=${p//"$bs"/"$bs$bs"}; p=${p//"$q"/"$bs$q"}
  printf 'user = "%s:%s"\n' "$u" "$p"
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
# tgt_cmd_write_stdin CMD STDIN_TEXT: like tgt_cmd_write, but STDIN_TEXT (e.g. a curl config with a password) goes to
# the command's stdin; only CMD is printed.
tgt_cmd_write_stdin() { _dim "[target cmd] $1 (credentials on stdin)"; confirm "run this command on the TARGET server"; run_on tgt "$1" < <(printf '%s\n' "$2"); }
# Shell snippets (run on a server) that put the site name on the CSV reports in DIR: <name>.csv -> <name>-<SOURCE_NAME>.csv.
# Files that already end in -<SOURCE_NAME>.csv are left alone, so running it again changes nothing. If the suffixed
# file exists already (a re-run wrote a new unsuffixed one), its data rows are appended to it and the new file removed.
# csv_suffix_pending_cmd DIR prints the files that would change; csv_suffix_cmd DIR does it.
csv_suffix_pending_cmd() {
  local qd qn; qd=$(printf '%q' "$1"); qn=$SOURCE_NAME   # SOURCE_NAME is validated in load_settings
  printf '%s' "cd $qd 2>/dev/null || exit 0; for f in *.csv; do [ -f \"\$f\" ] || continue; case \"\$f\" in *-$qn.csv) continue;; esac; echo \"\$f\"; done; true"
}
csv_suffix_cmd() {
  local qd qn; qd=$(printf '%q' "$1"); qn=$SOURCE_NAME   # SOURCE_NAME is validated in load_settings
  printf '%s' "cd $qd && for f in *.csv; do [ -f \"\$f\" ] || continue; case \"\$f\" in *-$qn.csv) continue;; esac; n=\"\${f%.csv}-$qn.csv\"; if [ -e \"\$n\" ]; then tail -n +2 \"\$f\" >> \"\$n\" && rm -f \"\$f\"; else mv \"\$f\" \"\$n\"; fi; done"
}
# export_counts_cmd DIR: shell snippet (run on a server) printing the export files in DIR, one "<name> <count>" line
# each, sorted: the exporters write <uuid>_user.json, _provider.json, _patient.json and _relationship.json flat in DIR,
# counted per type ("users", "providers", "patients", "relationships"); any sub-folder is listed as "<folder>/" with
# its file count. Prints nothing when DIR does not exist.
export_counts_cmd() {
  local qd; qd=$(printf '%q' "$1")
  printf '%s' "cd $qd 2>/dev/null || exit 0; { for t in user provider patient relationship; do echo \"\${t}s \$(find . -maxdepth 1 -type f -name \"*_\$t.json\" | wc -l | tr -d ' ')\"; done; for d in */; do [ -d \"\$d\" ] && echo \"\$d \$(find \"\$d\" -type f | wc -l | tr -d ' ')\"; done; } | sort; true"
}
# Folders the importers and verifiers create inside the exports folder (files move there once processed).
export_processed_dirs="successful failed mapped_to_existing verified failed_verification"
src_work_write() { _dim "[source cmd] $1"; confirm "run this work command (files/repo/image only) on the SOURCE server"; run_on src "$1"; }
tgt_work_write() { _dim "[target cmd] $1"; confirm "run this work command (files/repo/image only) on the TARGET server"; run_on tgt "$1"; }

# Source and target servers can't SSH to each other at the moment, so cross-server data goes through this laptop. This may change (to research with IT); if it does, this can become a direct ssh/scp between the servers.
# Optional third argument: name of a laptop shell function that reads the source output on stdin and writes what the target gets on stdout (to add statements before/after it); nothing is stored.
# stdin of this function goes to the source command.
pipe_src_to_tgt() {
  (
    set -o pipefail
    if [ -n "${3:-}" ]; then run_on src "$1" | "$3" | run_on tgt "$2"; else run_on src "$1" | run_on tgt "$2"; fi
  )
}

# sql_quote STRING: prints STRING as a SQL string literal ('' for ', \\ for \).
sql_quote() {
  local s=$1 q="'" bs='\'
  s=${s//"$bs"/"$bs$bs"}
  s=${s//"$q"/"$q$q"}
  printf "'%s'" "$s"
}

# lock_users src|tgt REASON KEEP_USERNAME...: retires every non-retired user except the KEEP_USERNAMEs
# (retired_by = the first one's user_id). 0 to retire: says so and writes nothing (safe to re-run).
lock_users() {
  local side=$1 reason=$2 migrator=$3 keep="" name id n left sql
  shift 2
  for name in "$@"; do keep="${keep:+$keep, }$(sql_quote "$name")"; done
  _lock_q() { if [ "$side" = src ]; then src_sql "$1"; else tgt_sql "$1"; fi; }
  id=$(_lock_q "select user_id from users where username = $(sql_quote "$migrator")" | head -n 1)
  if [ -z "$id" ]; then
    echo "User '$migrator' (MIGRATING_USERNAME) does not exist on the $side database; create it first." >&2
    exit 2
  fi
  n=$(_lock_q "select count(*) from users where retired = 0 and ifnull(username, '') not in ($keep)")
  echo "$n users to retire on the $side server (kept: $*)"
  if [ "$n" -gt 0 ]; then
    sql="update users set retired = 1, retire_reason = $(sql_quote "$reason"), retired_by = $id, date_retired = now() where retired = 0 and ifnull(username, '') not in ($keep)"
    if [ "$side" = src ]; then src_sql_write "$sql"; else tgt_sql_write "$sql"; fi
    left=$(_lock_q "select count(*) from users where retired = 0 and ifnull(username, '') not in ($keep)")
    echo "$left users left that should be retired (expected 0)"
  fi
}

tmux_running() { run_on "$1" "tmux has-session -t =$2" >/dev/null 2>&1; }

# refuse_while_running tgt|src WHY SESSION...: exits 1 naming the first of the tmux SESSIONs running on that server.
refuse_while_running() {
  local side=$1 why=$2 s; shift 2
  for s in "$@"; do
    if tmux_running "$side" "$s"; then
      echo "tmux session '$s' is still running on the $side server: $why. Wait for it to end (attach with: tmux attach -t $s). Nothing changed." >&2
      exit 1
    fi
  done
}

# target_property_line LINE: is LINE (a whole line) in TARGET_RUNTIME_PROPERTIES on the target? Read with
# TARGET_FILE_SUDO. Returns 0 = there, 1 = not there, 2 = could not read the file (missing, unreadable, sudo or ssh
# failed). A sentinel proves grep itself ran: a failing sudo/ssh also exits 1, like grep's "no match".
target_property_line() {
  local file probe out rc
  file="'${TARGET_RUNTIME_PROPERTIES:?TARGET_RUNTIME_PROPERTIES not set}'"
  probe="grep -qxF '$1' $file; echo \"grep-rc=\$?\""
  out=$(run_on tgt "${TARGET_FILE_SUDO:-} sh -c $(printf '%q' "$probe")" 2>/dev/null || true)
  rc=$(printf '%s\n' "$out" | sed -n 's/^grep-rc=\([0-9][0-9]*\)$/\1/p')
  [ "$(printf '%s\n' "$rc" | grep -c .)" = 1 ] || rc=unknown
  case "$rc" in 0) return 0 ;; 1) return 1 ;; *) return 2 ;; esac
}

# start_in_tmux src|tgt SESSION work|cmd CMD: prints CMD, confirms, starts it detached; refuses if
# SESSION is already running. kind "cmd" (database/service changes) is refused on src in test mode;
# "work" (only reads the DB and writes files under *_SERVER_DIR, e.g. export) is allowed.
start_in_tmux() {
  local side=$1 session=$2 kind=$3 cmd=$4
  case "$kind" in work|cmd) ;; *) echo "start_in_tmux: kind must be work or cmd" >&2; return 2 ;; esac
  [ "$side$kind" = srccmd ] && _refuse_in_test_mode "tmux command" source
  if tmux_running "$side" "$session"; then
    echo "tmux session '$session' is already running on the $side server; attach with: tmux attach -t $session" >&2
    return 1
  fi
  _dim "[$side tmux:$session] $cmd"
  confirm "start this in tmux session '$session' on the $side server"
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
  echo "Mode: ${MIGRATION_MODE:-?}   ${SOURCE_NAME:-source} (${SOURCE_HOST:-?}) -> target (${TARGET_HOST:-?})"
}

# next_step "NN-name.sh" "check first": footer, only reached when the script succeeded.
next_step() { echo; echo "Done. Check: $2"; echo "Next: $1"; }

skip_in_test_mode() {
  if [ "${MIGRATION_MODE:-}" = test ]; then echo "skipped in test mode: $1"; exit 0; fi
}
