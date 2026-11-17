#!/usr/bin/env bash
# Exact row counts for every table in a database, or the difference between two such snapshots.
# Counts only: never reads row contents.
#
#   tools/table-counts.sh snapshot <database> <output file> [container]
#   tools/table-counts.sh diff <before file> <after file>
#
# The MySQL root password is read from MYSQL_PWD, or from an SDK server's openmrs-server.properties.
set -euo pipefail
case "${1:-}" in
  snapshot)
    DB=$2; OUTFILE=$3; C=${4:-mysql-openmrs}
    PW=${MYSQL_PWD:-$(grep -h '^connection.password=' ~/openmrs/*/openmrs-server.properties | head -1 | cut -d= -f2-)}
    q() { docker exec -i -e MYSQL_PWD="$PW" "$C" mysql -uroot -N "$DB" -e "$1"; }
    tables=$(q "SELECT table_name FROM information_schema.tables WHERE table_schema='$DB' AND table_type='BASE TABLE' ORDER BY table_name")
    sql=$(for t in $tables; do printf "SELECT '%s', COUNT(*) FROM \`%s\` UNION ALL " "$t" "$t"; done)
    q "${sql% UNION ALL }" > "$OUTFILE"
    echo "$(wc -l < "$OUTFILE") tables counted into $OUTFILE"
    ;;
  diff)
    # Prints tables whose count changed: table, before, after, change. Exit 1 if any changed.
    join -a1 -a2 -e 0 -o 0,1.2,2.2 <(sort "$2") <(sort "$3") \
      | awk '$2 != $3 { printf "%-45s %12d %12d %+10d\n", $1, $2, $3, $3 - $2; changed = 1 } END { exit changed }'
    ;;
  *)
    sed -n '2,8p' "$0"; exit 2 ;;
esac
