#!/usr/bin/env bash
# Step 04: run the source server's backup commands (SOURCE_BACKUP_CMDS, separated by ;), each shown and confirmed.
#   04-backup-source.sh [settings-file]
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 04 "backup source"
skip_in_test_mode "the source is never written to in test mode"
require_settings SOURCE_BACKUP_CMDS

IFS=';' read -r -a cmds <<< "$SOURCE_BACKUP_CMDS"
for cmd in "${cmds[@]}"; do
  cmd=${cmd#"${cmd%%[![:space:]]*}"}
  [ -n "$cmd" ] || continue
  src_cmd_write "$cmd"
done

next_step "05-lock-target.sh" "that the backup files are on the source server and look the right size"
