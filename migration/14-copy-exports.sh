#!/usr/bin/env bash
# Step 14: copy the exported files from the source server to the target server.
#   14-copy-exports.sh [settings-file]
# tar of <SOURCE_SERVER_DIR>/exports streamed through this machine (nothing stored here) into
# <TARGET_SERVER_DIR>, then the number of files per sub-folder is compared on both servers.
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

# counts side dir: "<sub-folder> <number of files>" per line, sorted.
counts() {
  local q; q=$(printf '%q' "$2/exports")
  run_on "$1" "cd $q && for d in */; do [ -d \"\$d\" ] && echo \"\${d%/} \$(find \"\$d\" -type f | wc -l | tr -d ' ')\"; done | sort; true"
}

src_counts=$(counts src "$SOURCE_SERVER_DIR")
if [ -z "$src_counts" ]; then
  echo "No export sub-folders found in $SOURCE_SERVER_DIR/exports on the source server; run 13-export.sh first." >&2
  exit 1
fi
echo "Files per folder on the source:"; printf '%s\n' "$src_counts" | sed 's/^/    /'

src_cmd="tar c -C $q_src exports"
tgt_cmd="mkdir -p $q_tgt && tar x -C $q_tgt"
_dim "[source cmd] $src_cmd"
_dim "[target cmd] $tgt_cmd"
confirm "copy the exports to $TARGET_SERVER_DIR on the TARGET server (files only; existing files with the same name are overwritten)"
pipe_src_to_tgt "$src_cmd" "$tgt_cmd"

tgt_counts=$(counts tgt "$TARGET_SERVER_DIR")
echo "Files per folder on the target:"; printf '%s\n' "$tgt_counts" | sed 's/^/    /'
bad=$(join -a1 -a2 -e MISSING -o 0,1.2,2.2 <(printf '%s\n' "$src_counts") <(printf '%s\n' "$tgt_counts") | awk '$2 != $3 { printf "%s (source %s, target %s)\n", $1, $2, $3 }')
if [ -n "$bad" ]; then
  echo "File counts differ in:" >&2
  printf '%s\n' "$bad" | sed 's/^/    /' >&2
  echo "A target folder with MORE files than the source holds leftovers of an earlier copy; remove them on the target and run this again." >&2
  exit 1
fi
echo "File counts match in every folder."

next_step "15-import-users.sh" "the counts above match"
