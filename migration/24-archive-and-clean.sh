#!/usr/bin/env bash
# Step 24: archive the migration's files (password protected), then delete what the migration left behind (HAI-1309).
#   24-archive-and-clean.sh [settings-file]
# Order: (1) invalid-identifiers*.csv must have been passed on, (2) the source logs/ (export-side report CSVs) streamed
# through this machine into <TARGET_SERVER_DIR>/source-logs, (3) 7z archive on the target of exports, logs, source-logs
# and mappings (7z asks for the password itself on the server's terminal), (4) archive copied to the backup location,
# (5) confirmed deletions.
# Runs in both modes: everything deleted is a file under *_SERVER_DIR or the laptop work dir. The archive is kept.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 24 "archive and clean"
require_settings SOURCE_SERVER_DIR TARGET_SERVER_DIR SOURCE_NAME

for d in "$SOURCE_SERVER_DIR" "$TARGET_SERVER_DIR"; do
  case "$d" in /|//*|"") echo "Refusing: server dir '$d' is empty or /" >&2; exit 2 ;; esac
  case "${d%/}" in "") echo "Refusing: server dir '$d' is /" >&2; exit 2 ;; esac
done
sdir=${SOURCE_SERVER_DIR%/}; tdir=${TARGET_SERVER_DIR%/}
is_yes() { case "$1" in y|Y|yes|YES|Yes) return 0 ;; esac; return 1; }

archive="$tdir/$SOURCE_NAME-exports-$(date +%Y%m%d).7z"
if run_on tgt "test -e $(printf '%q' "$archive")"; then
  echo "Refusing: $archive already exists on the target (7z would update it, possibly under a different password). Move or remove it first." >&2
  exit 2
fi

echo "--- invalid-identifiers (wiki 47) ---"
run_on tgt "ls -l $(printf '%q' "$tdir/logs")/invalid-identifiers*.csv 2>/dev/null || echo 'no invalid-identifiers*.csv in $tdir/logs'"
echo "File(s): $tdir/logs/invalid-identifiers*.csv on the target server."
a=$(ask "Has it been copied to the Haiti team through the usual channel (not Jira)? [y/N]")
is_yes "$a" || { echo "Not confirmed, stopping before anything is deleted." >&2; exit 1; }

q_tdir=$(printf '%q' "$tdir"); q_slogs=$(printf '%q' "$sdir/logs")
echo "--- source logs (export report CSVs) into $tdir/source-logs, so they go into the archive ---"
if run_on src "[ -d $q_slogs ]"; then
  src_cmd="tar c -C $q_slogs ."
  tgt_cmd="mkdir -p $q_tdir/source-logs && tar x -C $q_tdir/source-logs"
  _dim "[source cmd] $src_cmd"
  _dim "[target cmd] $tgt_cmd"
  confirm "copy the source logs to $tdir/source-logs on the TARGET server"
  pipe_src_to_tgt "$src_cmd" "$tgt_cmd"
else
  echo "There is no logs folder on the source ($sdir/logs); nothing to copy."
fi

# What goes in the archive: the folders that exist (7z stops on a missing one).
items=$(run_on tgt "cd $q_tdir && for d in exports logs source-logs mappings; do [ -e \$d ] && echo \$d; done; true" | tr '\n' ' ')
items=${items% }
case " $items " in *" exports "*) ;; *) echo "Refusing: there is no $tdir/exports on the target to archive." >&2; exit 2 ;; esac
cmd="cd $q_tdir && 7z a -p -mhe=on $(printf '%q' "$archive") $items"
_dim "[target cmd, interactive] $cmd"
confirm "create the encrypted archive on the TARGET server (7z asks for the password on the server's terminal)"
run_on_tty tgt "$cmd"
echo "Archive on the target server:"
run_on tgt "ls -l $(printf '%q' "$archive")"
echo "Reminder: copy it to the Azure backup, and use the default backup password for database backups [46.2-46.3]"
a=$(ask "Has the archive been copied to the backup location? [y/N]")
is_yes "$a" || { echo "Not confirmed, stopping before anything is deleted." >&2; exit 1; }

echo "--- deletions ---"
tgt_work_write "cd $(printf '%q' "$tdir") && rm -rf exports logs source-logs repo/src/.env files-*.zip mappings patients-failed-pass1"
src_work_write "cd $(printf '%q' "$sdir") && rm -rf exports logs files-*.zip repo/src/.env lists"
echo "Laptop: $WORKDIR/lists and $WORKDIR/mappings (mappings hold usernames)"
confirm "delete $WORKDIR/lists and $WORKDIR/mappings on this machine"
rm -rf "${WORKDIR:?}/lists" "${WORKDIR:?}/mappings"

echo
echo "Migration steps complete."
echo "The archive $archive is kept on the target ($items)."
echo
echo "Left on this laptop:"
echo "  $WORKDIR/logs"
echo "  $WORKDIR/counts"
echo "  $WORKDIR/target-users-before-import.txt"
echo "  the settings file: ${1:-${MIGRATION_ENV:-}}"
echo "The logs contain patient identifiers and usernames - delete them or keep them protected."
