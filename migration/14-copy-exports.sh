#!/usr/bin/env bash
# Step 14: copy the exported files from the source server to the target server.
#   14-copy-exports.sh [settings-file]
# tar of <SOURCE_SERVER_DIR>/exports streamed through this machine (nothing stored here) into
# <TARGET_SERVER_DIR>, then the number of export files per type (the exporters write <uuid>_user.json,
# _provider.json, _patient.json and _relationship.json flat in exports/) and per sub-folder, if any, is compared
# on both servers.
# Refuses once an import has started on the target (exports/successful, failed, mapped_to_existing, ... exist):
# copying again would put the processed files back at the top level, and the importers would read them again.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 14 "copy exports to the target server"
require_settings SOURCE_SERVER_DIR TARGET_SERVER_DIR

if tmux_running src export; then
  echo "The export is still running (tmux session 'export' on the source server). Wait for it to end (13-export.sh shows progress)." >&2
  exit 1
fi

q_src=$(printf '%q' "$SOURCE_SERVER_DIR")
q_tgt=$(printf '%q' "$TARGET_SERVER_DIR")
q_tgt_exports=$(printf '%q' "$TARGET_SERVER_DIR/exports")

started=$(run_on tgt "for d in $export_processed_dirs; do [ -d $q_tgt_exports/\$d ] && echo \$d; done; true" | tr '\n' ' ')
if [ -n "$started" ]; then
  echo "An import has already started on the target: $TARGET_SERVER_DIR/exports holds the folder(s) ${started% }." >&2
  echo "Copying again would put the processed files back and the importers would read them again. Nothing copied." >&2
  echo "Go on with the import steps instead, or see README (14) to start the import over." >&2
  exit 1
fi

# counts side dir: "<type or sub-folder/> <number of files>" per line, sorted.
counts() { run_on "$1" "$(export_counts_cmd "$2/exports")"; }

src_counts=$(counts src "$SOURCE_SERVER_DIR")
if [ -z "$src_counts" ] || [ "$(printf '%s\n' "$src_counts" | awk '{ n += $NF } END { print n + 0 }')" -eq 0 ]; then
  echo "No exported files found in $SOURCE_SERVER_DIR/exports on the source server; run 13-export.sh first." >&2
  exit 1
fi
echo "Files per type (and sub-folder) on the source:"; printf '%s\n' "$src_counts" | sed 's/^/    /'

src_cmd="tar c -C $q_src exports"
tgt_cmd="mkdir -p $q_tgt && tar x -C $q_tgt"
_dim "[source cmd] $src_cmd"
_dim "[target cmd] $tgt_cmd"
confirm "copy the exports to $TARGET_SERVER_DIR on the TARGET server (files only; existing files with the same name are overwritten)"
pipe_src_to_tgt "$src_cmd" "$tgt_cmd"

tgt_counts=$(counts tgt "$TARGET_SERVER_DIR")
echo "Files per type (and sub-folder) on the target:"; printf '%s\n' "$tgt_counts" | sed 's/^/    /'
bad=$(join -a1 -a2 -e MISSING -o 0,1.2,2.2 <(printf '%s\n' "$src_counts") <(printf '%s\n' "$tgt_counts") | awk '$2 != $3 { printf "%s (source %s, target %s)\n", $1, $2, $3 }')
if [ -n "$bad" ]; then
  echo "File counts differ in:" >&2
  printf '%s\n' "$bad" | sed 's/^/    /' >&2
  echo "MORE files on the target than on the source are leftovers of an earlier copy; remove them on the target and run this again." >&2
  exit 1
fi
echo "File counts match for every type and folder."

next_step "15-import-users.sh" "the counts above match"
