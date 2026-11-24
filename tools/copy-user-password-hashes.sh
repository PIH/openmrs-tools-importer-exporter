#!/usr/bin/env bash
# WORK IN PROGRESS (HAI-1314): only tested locally with a single test user, with both databases on
# the same machine and no SSH. Not yet tested against real servers. Review before using it in a
# migration.
#
# Copies users.password and users.salt (the salted password hash) from the source database to the
# target database, for an explicit list of user uuids, so migrated users keep their passwords. The
# importer can't do this: the hash isn't available over REST.
#
#   SOURCE_MYSQL='<command>' TARGET_MYSQL='<command>' tools/copy-user-password-hashes.sh <uuid file> [--dry-run]
#
# <uuid file>   One user uuid per line (blank lines and lines starting with # are ignored). Use the
#               uuids of the users the import *created*. Never pass mapped users or users that
#               already existed on the target.
# --dry-run     Loads the hashes into the target session and reports the counts, but updates nothing.
#
# SOURCE_MYSQL and TARGET_MYSQL are shell commands that run the mysql client connected to the
# OpenMRS database and read SQL from stdin, for example:
#   SOURCE_MYSQL='sudo docker exec -i mysql56 mysql -u root openmrs'
#   TARGET_MYSQL='ssh zl-central "sudo docker exec -i mysql56 mysql -u root openmrs"'
# Supply the password in a way that doesn't put it on the command line, e.g. a ~/.my.cnf
# inside the container, or MYSQL_PWD set in the environment the client runs in.
#
# How it works: the source query prints one `insert` statement per user (uuid, password, salt
# only). They are piped straight into a temporary table in the target's mysql session, then one
# `update` copies password and salt onto the matching target users. Nothing is written to disk, the
# hashes are never printed, and the temporary table disappears when the session ends. Plain inserts
# are used instead of LOAD DATA LOCAL INFILE, which needs local_infile enabled on client and server.
#
# Safeguards:
#   - Uuids must be well-formed, so nothing else can get into the SQL.
#   - The admin and daemon accounts are always skipped, on both sides: they can share a uuid
#     between servers (seen with HSN and SSPE vs ZL Central), and the target's must never be
#     overwritten.
#   - Only lines that are exactly a well-formed insert (hex hash and salt) are passed to the
#     target; the script stops if the source returns anything else.
set -euo pipefail

usage() { sed -n '2,24p' "$0"; exit 2; }
[ $# -ge 1 ] || usage
UUID_FILE=$1
DRY_RUN=${2:-}
[ -z "$DRY_RUN" ] || [ "$DRY_RUN" = "--dry-run" ] || usage
[ -f "$UUID_FILE" ] || { echo "No such file: $UUID_FILE" >&2; exit 2; }
: "${SOURCE_MYSQL:?Set SOURCE_MYSQL (see the header of this script)}"
: "${TARGET_MYSQL:?Set TARGET_MYSQL (see the header of this script)}"

UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
uuids=$(sed -e 's/[[:space:]]//g' -e '/^$/d' -e '/^#/d' "$UUID_FILE" | sort -u)
[ -n "$uuids" ] || { echo "No uuids in $UUID_FILE" >&2; exit 2; }
bad=$(grep -cvE "$UUID_RE" <<< "$uuids" || true)
[ "$bad" -eq 0 ] || { echo "$bad line(s) in $UUID_FILE are not uuids; nothing copied" >&2; exit 2; }
requested=$(wc -l <<< "$uuids")
in_list=$(sed "s/.*/'&'/" <<< "$uuids" | paste -sd, -)

NOT_SYSTEM="coalesce(username, '') not in ('admin', 'daemon') and coalesce(system_id, '') not in ('admin', 'daemon')"
INSERT_RE="^insert into tmp_hashes values \('[0-9a-fA-F-]{36}','[0-9a-fA-F]+','[0-9a-fA-F]+'\);$"

source_inserts() {
  bash -c "$SOURCE_MYSQL" <<SQL
select concat('insert into tmp_hashes values (', quote(uuid), ',', quote(password), ',', quote(salt), ');')
from users where uuid in ($in_list) and $NOT_SYSTEM and password is not null and salt is not null;
SQL
}

# Keeps only well-formed insert lines (this also drops the column header mysql prints in batch mode).
# Stops if anything else comes back, without printing it.
checked_inserts() {
  local out
  out=$(source_inserts)
  local unexpected
  unexpected=$(tail -n +2 <<< "$out" | grep -cvE "$INSERT_RE" || true)
  if [ "$unexpected" -ne 0 ]; then
    echo "The source returned $unexpected line(s) that aren't a well-formed insert; nothing copied" >&2
    return 1
  fi
  grep -E "$INSERT_RE" <<< "$out" || true
}

if [ -n "$DRY_RUN" ]; then
  apply="select 'dry run: nothing updated' as result;"
else
  apply="update users u join tmp_hashes t on t.uuid = u.uuid set u.password = t.password, u.salt = t.salt
         where coalesce(u.username, '') not in ('admin', 'daemon') and coalesce(u.system_id, '') not in ('admin', 'daemon');
         select row_count() as target_users_updated;"
fi

inserts=$(checked_inserts)
received=$( [ -n "$inserts" ] && wc -l <<< "$inserts" || echo 0)
echo "uuids requested: $requested"
echo "hashes received from the source (admin/daemon and users without a hash skipped): $received"
[ "$received" -gt 0 ] || { echo "Nothing to copy"; exit 0; }

{
  echo "create temporary table tmp_hashes (uuid char(38) not null primary key, password varchar(128) not null, salt varchar(128) not null);"
  printf '%s\n' "$inserts"
  echo "select count(*) as target_users_matched from users u join tmp_hashes t on t.uuid = u.uuid
        where coalesce(u.username, '') not in ('admin', 'daemon') and coalesce(u.system_id, '') not in ('admin', 'daemon');"
  echo "$apply"
} | bash -c "$TARGET_MYSQL"
