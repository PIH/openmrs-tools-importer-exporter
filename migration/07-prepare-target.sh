#!/usr/bin/env bash
# Step 07: prepare the target: copy the dossier number sequence, switch off search indexing, restart.
#   07-prepare-target.sh [settings-file]
# Three parts, each shown and confirmed; saying no to one stops the script.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 07 "prepare target"
require_settings SOURCE_MYSQL_CONTAINER SOURCE_DB TARGET_MYSQL_CONTAINER TARGET_DB DOSSIER_PREFIX \
  TARGET_RUNTIME_PROPERTIES TARGET_RESTART_CMD TARGET_WAIT_URL

# 1. Dossier number sequence: the target continues where the source stopped.
echo "--- Part 1: dossier number sequence (prefix $DOSSIER_PREFIX)"
seq_sql="select next_sequence_value from idgen_seq_id_gen where prefix=$(sql_quote "$DOSSIER_PREFIX")"
src_seq=$(src_sql "$seq_sql" | head -n 1)
tgt_seq=$(tgt_sql "$seq_sql" | head -n 1)
for side in source target; do
  v=$src_seq; [ "$side" = target ] && v=$tgt_seq
  if [ -z "$v" ]; then
    echo "No idgen_seq_id_gen row with prefix '$DOSSIER_PREFIX' on the $side database; check DOSSIER_PREFIX and the dossier identifier source." >&2
    exit 2
  fi
done
echo "next_sequence_value: source $src_seq, target $tgt_seq"
if [ "$src_seq" -eq "$tgt_seq" ]; then
  echo "Sequence values are already equal, nothing to write."
else
  if [ "$src_seq" -lt "$tgt_seq" ]; then
    echo "WARNING: the source value ($src_seq) is LOWER than the target value ($tgt_seq). Setting the target to it can hand out dossier numbers that already exist."
    typed=$(ask "To go ahead anyway, type the source value ($src_seq) again:")
    if [ "$typed" != "$src_seq" ]; then echo "Value not matched, stopping." >&2; exit 1; fi
  fi
  tgt_sql_write "update idgen_seq_id_gen set next_sequence_value = $src_seq where prefix = $(sql_quote "$DOSSIER_PREFIX")"
  echo "Target next_sequence_value is now $(tgt_sql "$seq_sql" | head -n 1)"
fi

# 2. Switch off hibernate search indexing listeners (the index is rebuilt in step 20).
echo "--- Part 2: indexing property in $TARGET_RUNTIME_PROPERTIES"
sudo_prefix=${TARGET_FILE_SUDO:-}
prop=hibernate.search.indexing.listeners.enabled=false
q() { printf "'%s'" "$1"; }
file=$(q "$TARGET_RUNTIME_PROPERTIES")
echo "NOTE: puppet manages this file and may overwrite the change; if the server is reconfigured by puppet before the migration ends, check the line is still there."
echo "NOTE: while it is off, nothing is indexed for search; step 20 rebuilds the index."
if run_on tgt "$sudo_prefix grep -qxF $(q "$prop") $file"; then
  echo "$prop is already in the file, nothing to write."
elif run_on tgt "$sudo_prefix grep -q '^hibernate.search.indexing.listeners.enabled=' $file"; then
  echo "The file has hibernate.search.indexing.listeners.enabled with another value; fix it by hand, then re-run." >&2
  exit 2
else
  tgt_cmd_write "{ [ -z \"\$($sudo_prefix tail -c1 $file)\" ] || echo; echo $(q "$prop"); } | $sudo_prefix tee -a $file >/dev/null"
fi

# 3. Restart so the property takes effect, then wait until OpenMRS answers.
echo "--- Part 3: restart the target"
tgt_cmd_write "$TARGET_RESTART_CMD"
wait_for_target

next_step "08-check-no-sessions.sh" "that the target's login page loads and the dossier sequence is $src_seq"
