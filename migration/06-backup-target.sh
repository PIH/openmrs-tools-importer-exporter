#!/usr/bin/env bash
# Step 06: run the target server's backup commands (TARGET_BACKUP_CMDS, separated by ;), each shown and confirmed.
#   06-backup-target.sh [settings-file]
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 06 "backup target"
require_settings TARGET_BACKUP_CMDS

IFS=';' read -r -a cmds <<< "$TARGET_BACKUP_CMDS"
for cmd in "${cmds[@]}"; do
  cmd=${cmd#"${cmd%%[![:space:]]*}"}
  [ -n "$cmd" ] || continue
  tgt_cmd_write "$cmd"
done

next_step "07-prepare-target.sh" "that the backup files are on the target server and look the right size"
