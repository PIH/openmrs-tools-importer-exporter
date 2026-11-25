#!/usr/bin/env bash
# Throwaway MySQL 5.6 container for the migration script tests.
#   testdb.sh up | seed FILE DB | sql DB SQL | down
set -euo pipefail
CONTAINER=hai1309-test-mysql
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# Distinctive on purpose: the tests check this never shows up in logs.
ROOT_PW=pw-9f3k

mysql_in() { docker exec -i "$CONTAINER" env MYSQL_PWD="$ROOT_PW" mysql -uroot "$@"; }

case "${1:-}" in
  up)
    if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
      docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
      docker run -d --name "$CONTAINER" -e MYSQL_ROOT_PASSWORD="$ROOT_PW" mysql:5.6 >/dev/null
    fi
    for _ in $(seq 1 90); do
      mysql_in -e 'select 1' >/dev/null 2>&1 && break
      sleep 1
    done
    mysql_in -e 'select 1' >/dev/null
    for db in src_db tgt_db; do
      mysql_in -e "drop database if exists $db; create database $db character set utf8"
      mysql_in "$db" < "$HERE/fixtures/schema.sql"
    done
    ;;
  seed) mysql_in "$3" < "$2" ;;
  sql)  mysql_in -N -B "$2" -e "$3" ;;
  down) docker rm -f "$CONTAINER" >/dev/null 2>&1 || true ;;
  *) echo "usage: testdb.sh up | seed FILE DB | sql DB SQL | down" >&2; exit 2 ;;
esac
