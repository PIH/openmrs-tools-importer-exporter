#!/usr/bin/env bash
# Step 23: shut down the source OpenMRS (docker compose down). Skipped in test mode.
#   23-shutdown-source.sh [settings-file]
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 23 "shut down the source"
skip_in_test_mode "the source is never shut down in a test migration"
require_settings SOURCE_COMPOSE_DIR SOURCE_DOCKER

src_cmd_write "cd $(printf '%q' "$SOURCE_COMPOSE_DIR") && $SOURCE_DOCKER compose down"

echo "Reminders (do these by hand):"
echo "  - backups are off on the source (cron entry stays disabled) [41]"
next_step "24-archive-and-clean.sh" "that the source containers are stopped"
