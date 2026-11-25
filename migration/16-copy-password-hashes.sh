#!/usr/bin/env bash
# Step 16: copy password hashes of the imported users from the source to the target (HAI-1314).
#   16-copy-password-hashes.sh [settings-file]
# The importer gives imported users random passwords; this copies the real hash and salt. One target
# mysql session receives, through this machine, a temporary table with the source hashes (generated
# by a read-only source query) and one with the uuids of the users that existed on the target before
# the import (from step 15), then runs the update and prints only how many rows it changed.
# The hashes go straight from ssh source to ssh target: nothing is written to disk here and nothing
# is printed or logged (the work dir holds only uuids). Run it right after step 15, before anyone can log in.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$here/lib.sh"
load_settings "${1:-}"
step_header 16 "copy password hashes to the target"
if [ "${SKIP_HASH_COPY_IN_TEST:-}" = true ]; then skip_in_test_mode "SKIP_HASH_COPY_IN_TEST=true"; fi
require_settings SOURCE_MYSQL_CONTAINER SOURCE_DB TARGET_MYSQL_CONTAINER TARGET_DB

before="$WORKDIR/target-users-before-import.txt"
if [ ! -f "$before" ]; then
  echo "$before not found: run 15-import-users.sh first (it saves the users that existed before the import)." >&2
  exit 1
fi
n_before=$(wc -l < "$before" | tr -d ' ')

# Source side: read-only query that prints the insert statements.
src_gen="select concat('insert into tmp_hashes values (', quote(uuid), ',', quote(password), ',', quote(salt), ');') from users where password is not null"
_require_read_only_sql "$src_gen"

head_sql="create temporary table tmp_hashes(uuid char(38) character set utf8 collate utf8_general_ci primary key, password varchar(128) character set utf8 collate utf8_general_ci, salt varchar(128) character set utf8 collate utf8_general_ci);
create temporary table tmp_before(uuid char(38) character set utf8 collate utf8_general_ci primary key);"
update_sql="update users u join tmp_hashes h on u.uuid = h.uuid set u.password = h.password, u.salt = h.salt where u.uuid not in (select uuid from tmp_before);
select row_count();"

echo "Source query (read-only): $src_gen"
echo "Target session (one connection, temporary tables only, then the update):"
printf '%s\n' "$head_sql"
echo "<uuids from $before ($n_before), inserted into tmp_before>"
echo "<hashes streamed from source>"
printf '%s\n' "$update_sql"
confirm "update users.password and users.salt on the TARGET database for every imported user (not the $n_before users that existed before the import); hashes are streamed from the source and never shown or stored"

# Laptop-side filter between the servers: target password line (prompt auth), table definitions, the
# before-import uuids, the source inserts, then the update. Stores nothing.
_wrap_for_target() {
  mysql_pw_line tgt
  printf '%s\n' "$head_sql"
  awk '{ gsub(/\\/, "\\\\"); gsub(/\047/, "\047\047"); print "insert into tmp_before values (\047" $0 "\047);" }' "$before"
  cat
  printf '%s\n' "$update_sql"
}

flags='--raw --default-character-set=utf8'
# Errors from mysql may quote the statement that failed: hide anything in quotes.
result=$(pipe_src_to_tgt "$(mysql_cmd src "$flags")" "$(mysql_cmd tgt "$flags")" _wrap_for_target \
  < <(mysql_input src "$src_gen") 2> >(sed -E "s/'[^']*'/'<hidden>'/g" >&2))
count=$(printf '%s\n' "$result" | tail -n 1)
case "$count" in ''|*[!0-9]*) echo "Unexpected result from the target (expected a row count)" >&2; exit 1 ;; esac
echo "Password hashes copied for $count users"

next_step "17-import-patients.sh" "the count above equals the number of users the import created (15 printed the users count); users that failed to import have no hash"
