#!/usr/bin/env bash
# Step 18: copy the data folders (COPY_DIRS) from the source to the target server (HAI-1309).
#   18-copy-files.sh [settings-file]
# Per folder that exists in SOURCE_DATA_DIR: zips it on the source (tools/create_archive.py, into
# <SOURCE_SERVER_DIR>; this only writes a zip, it does not touch the database or services, so it is allowed in test
# mode), streams the zip through this machine to <TARGET_SERVER_DIR>, merges it into the same-named folder in
# TARGET_DATA_DIR with tools/merge_extract.py (existing files are kept, conflicts go to
# <TARGET_SERVER_DIR>/logs/conflicts-<folder>.csv) and sets the owner TARGET_FILE_OWNER. Prints the file counts
# on both sides and the number of conflicts.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 18 "copy data folders to the target server"
require_settings SOURCE_SERVER_DIR TARGET_SERVER_DIR SOURCE_DATA_DIR TARGET_DATA_DIR COPY_DIRS TARGET_FILE_OWNER

# file_count side sudo-prefix dir: number of files below dir.
file_count() { run_on "$1" "$2 find $(printf '%q' "$3") -type f | wc -l | tr -d ' '"; }

for d in $COPY_DIRS; do
  echo
  echo "--- $d ---"
  q_sdir=$(printf '%q' "$SOURCE_DATA_DIR/$d"); q_tdir=$(printf '%q' "$TARGET_DATA_DIR/$d")
  q_szip=$(printf '%q' "$SOURCE_SERVER_DIR/files-$d.zip"); q_tzip=$(printf '%q' "$TARGET_SERVER_DIR/files-$d.zip")
  q_csv=$(printf '%q' "$TARGET_SERVER_DIR/logs/conflicts-$d.csv")
  if ! run_on src "${SOURCE_FILE_SUDO:-} test -d $q_sdir"; then
    echo "$d: skipped (not in $SOURCE_DATA_DIR)"
    continue
  fi
  n_src=$(file_count src "${SOURCE_FILE_SUDO:-}" "$SOURCE_DATA_DIR/$d")

  # Zip on the source (writes only the zip under SOURCE_SERVER_DIR); with sudo the zip is root's, hand it to the ssh user.
  zip_cmd="${SOURCE_FILE_SUDO:-} python3 $(printf '%q' "$SOURCE_SERVER_DIR/repo/tools/create_archive.py") --source-dir $q_sdir --output $q_szip"
  [ -z "${SOURCE_FILE_SUDO:-}" ] || zip_cmd="$zip_cmd && ${SOURCE_FILE_SUDO} chown \"\$(id -u):\$(id -g)\" $q_szip"
  src_work_write "$zip_cmd"

  src_cmd="cat $q_szip"
  tgt_cmd="mkdir -p $(printf '%q' "$TARGET_SERVER_DIR/logs") && cat > $q_tzip"
  _dim "[source cmd] $src_cmd"
  _dim "[target cmd] $tgt_cmd"
  confirm "copy $d.zip from the source to $TARGET_SERVER_DIR on the TARGET server (the zip only)"
  pipe_src_to_tgt "$src_cmd" "$tgt_cmd"

  # A conflict log from an earlier run is removed first: merge_extract.py writes it only when there are conflicts.
  merge_cmd="rm -f $q_csv && ${TARGET_FILE_SUDO:-} mkdir -p $q_tdir && ${TARGET_FILE_SUDO:-} python3 $(printf '%q' "$TARGET_SERVER_DIR/repo/tools/merge_extract.py") --zip $q_tzip --dest-dir $q_tdir --conflict-log $q_csv"
  tgt_cmd_write "$merge_cmd"
  tgt_cmd_write "${TARGET_FILE_SUDO:-} chown -R $TARGET_FILE_OWNER $q_tdir"

  n_tgt=$(file_count tgt "${TARGET_FILE_SUDO:-}" "$TARGET_DATA_DIR/$d")
  n_conf=$(run_on tgt "if [ -f $q_csv ]; then echo \$(( \$(wc -l < $q_csv) - 1 )); else echo 0; fi")
  echo "$d: source $n_src files, target $n_tgt files"
  if [ "$n_conf" -gt 0 ]; then
    echo "$d: conflicts: $n_conf (existing files were kept; see $TARGET_SERVER_DIR/logs/conflicts-$d.csv)"
  else
    echo "$d: conflicts: 0"
  fi
done

next_step "19-verify.sh" "file counts per folder above (the target may hold more than the source: it keeps its own files) and the conflicts"
