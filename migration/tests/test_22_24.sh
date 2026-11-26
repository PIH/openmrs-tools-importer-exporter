# Tests for 22-open-target.sh, 23-shutdown-source.sh, 24-archive-and-clean.sh (7z is a stub on PATH).
_l22env() { cp tests/fixtures/test.env "$WORKDIR/l.env"; local kv; for kv in "$@"; do echo "$kv" >> "$WORKDIR/l.env"; done; }
_seed22() { testdb.sh sql tgt_db "delete from users; delete from person"
  testdb.sh sql tgt_db "insert into person(person_id,date_created,uuid,creator) values(1,now(),'u1',1),(2,now(),'u2',1),(3,now(),'u3',1),(4,now(),'u4',1);
    insert into users(user_id,system_id,username,person_id,date_created,creator,uuid,retired,retire_reason,retired_by,date_retired) values
    (11,'a','alice',1,now(),1,'x1',1,'Temp - migrating data',11,now()),
    (12,'b','bob',2,now(),1,'x2',1,'Migrating from TestSource',11,now()),
    (13,'c','carol',3,now(),1,'x3',1,'Left the clinic',11,now()),
    (14,'d','dave',4,now(),1,'x4',0,null,null,null)"; }
_stub7z() { mkdir -p "$WORKDIR/stub"
  cat > "$WORKDIR/stub/7z" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$WORKDIR/7z.argv"
for last; do :; done
for a; do case "$a" in *.7z) echo archive > "$a" ;; esac; done
exit 0
STUB
  chmod +x "$WORKDIR/stub/7z"; rm -f "$WORKDIR/7z.argv"; export PATH="$WORKDIR/stub:$PATH"; }
_retired22() { testdb.sh sql tgt_db "select group_concat(username order by username) from users where retired=1"; }

test_open_target_refuses_on_no() { _seed22; _l22env
  for ans in 'y\ny\ny\ny\nn\n' 'n\n' 'y\nmaybe\ny\ny\ny\n'; do
    out=$(printf "$ans" | ./22-open-target.sh "$WORKDIR/l.env" 2>&1); assert_eq 1 $? "$out"
    assert_eq "alice,bob,carol" "$(_retired22)"
  done
}
test_open_target_unretires_both_reasons_only() { _seed22; _l22env MIGRATION_MODE=real
  out=$(printf 'y\ny\ny\ny\ny\ny\ny\ny\n' | ./22-open-target.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_eq "carol" "$(_retired22)"
  assert_eq "Left the clinic" "$(testdb.sh sql tgt_db "select retire_reason from users where username='carol'")"
  assert_eq "NULL|NULL|NULL" "$(testdb.sh sql tgt_db "select concat(ifnull(retire_reason,'NULL'),'|',ifnull(retired_by,'NULL'),'|',ifnull(date_retired,'NULL')) from users where username='alice'")"
  assert_contains "$out" "1 users retired with reason 'Temp - migrating data'"
  assert_contains "$out" "[43]"; assert_contains "$out" "[42]"; assert_contains "$out" "Next: 23-shutdown-source.sh"
}
test_open_target_zero_rows_skips_write() { _seed22; testdb.sh sql tgt_db "update users set retired=0 where retire_reason like 'Temp%' or retire_reason like 'Migrating%'"; _l22env
  out=$(printf 'y\ny\ny\ny\ny\n' | ./22-open-target.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_contains "$out" "0 users retired"; assert_not_contains "$out" "Proceed?"
  assert_contains "$out" "0 is expected in test mode"
}
test_open_target_warns_when_flush_not_1() { _seed22; _l22env
  testdb.sh sql tgt_db "set global innodb_flush_log_at_trx_commit=2"
  out=$(printf 'y\ny\ny\ny\ny\ny\ny\ny\n' | ./22-open-target.sh "$WORKDIR/l.env" 2>&1); rc=$?
  testdb.sh sql tgt_db "set global innodb_flush_log_at_trx_commit=1"
  assert_eq 0 $rc "$out"; assert_contains "$out" "WARNING"; assert_contains "$out" "'2'"
}
test_shutdown_skipped_in_test_mode() { _l22env SOURCE_COMPOSE_DIR="$WORKDIR"
  out=$(printf 'y\n' | ./23-shutdown-source.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_contains "$out" "skipped in test mode"; assert_not_contains "$out" "Proceed?"
}
test_shutdown_runs_compose_down_with_setting() { mkdir -p "$WORKDIR/stub" "$WORKDIR/compose"
  printf '#!/usr/bin/env bash\necho "$*" >> "$WORKDIR/dk.argv"\n' > "$WORKDIR/stub/mydocker"; chmod +x "$WORKDIR/stub/mydocker"; rm -f "$WORKDIR/dk.argv"
  _l22env MIGRATION_MODE=real SOURCE_COMPOSE_DIR="$WORKDIR/compose" "SOURCE_DOCKER=$WORKDIR/stub/mydocker"
  out=$(printf 'y\n' | ./23-shutdown-source.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_eq "compose down" "$(cat "$WORKDIR/dk.argv")"; assert_contains "$out" "[41]"; assert_contains "$out" "Next: 24-archive-and-clean.sh"
}

_seed24() { _stub7z; rm -rf "$WORKDIR/exports" "$WORKDIR/logs-keep" "$WORKDIR/lists" "$WORKDIR/mappings" "$WORKDIR"/*.7z "$WORKDIR/files-a.zip" "$WORKDIR/patients-failed-pass1" "$WORKDIR/repo"
  mkdir -p "$WORKDIR/exports" "$WORKDIR/lists" "$WORKDIR/mappings" "$WORKDIR/repo/src" "$WORKDIR/patients-failed-pass1"
  : > "$WORKDIR/repo/src/.env"; : > "$WORKDIR/files-a.zip"; : > "$WORKDIR/exports/p.json"; : > "$WORKDIR/lists/x.csv"
  : > "$WORKDIR/logs/invalid-identifiers.csv"; }

test_clean_asks_about_invalid_identifiers_first() { _seed24; _l22env
  out=$(printf 'n\n' | ./24-archive-and-clean.sh "$WORKDIR/l.env" 2>&1); assert_eq 1 $? "$out"
  assert_contains "$out" "invalid-identifiers"; assert_contains "$out" "not Jira"
  [ -d "$WORKDIR/exports" ] && [ -f "$WORKDIR/logs/invalid-identifiers.csv" ] || { echo "deleted"; exit 1; }
  [ ! -e "$WORKDIR/7z.argv" ] || { echo "7z ran"; exit 1; }
}
test_clean_stops_when_archive_not_copied() { _seed24; _l22env
  out=$(printf 'y\ny\nn\n' | ./24-archive-and-clean.sh "$WORKDIR/l.env" 2>&1); assert_eq 1 $? "$out"
  assert_contains "$out" "7z a -p -mhe=on"; assert_contains "$out" "$WORKDIR/TestSource-exports-"
  assert_contains "$out" "[46.2-46.3]"
  [ -d "$WORKDIR/exports" ] && [ -f "$WORKDIR/files-a.zip" ] || { echo "deleted before backup confirmed"; exit 1; }
  ls "$WORKDIR"/TestSource-exports-*.7z >/dev/null
}
test_clean_deletes_confirmed_things_keeps_archive() { _seed24; _l22env
  out=$(printf 'y\ny\ny\ny\ny\ny\n' | ./24-archive-and-clean.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  for p in exports repo/src/.env files-a.zip lists mappings patients-failed-pass1; do [ ! -e "$WORKDIR/$p" ] || { echo "$p still there"; exit 1; }; done
  [ -d "$WORKDIR/repo" ] || { echo "repo removed"; exit 1; }
  ls "$WORKDIR"/TestSource-exports-*.7z >/dev/null
  assert_contains "$(cat "$WORKDIR/7z.argv")" "-p -mhe=on"; assert_contains "$out" "Migration steps complete."
  assert_not_contains "$out" "Next:"
}
test_clean_declined_deletion_keeps_files() { _seed24; _l22env
  out=$(printf 'y\ny\ny\nn\n' | ./24-archive-and-clean.sh "$WORKDIR/l.env" 2>&1); assert_eq 1 $? "$out"
  [ -d "$WORKDIR/exports" ] || { echo "deleted although declined"; exit 1; }
}
test_clean_refuses_root_server_dir() { _seed24
  for kv in SOURCE_SERVER_DIR=/ TARGET_SERVER_DIR=/ SOURCE_SERVER_DIR=; do
    _l22env "$kv"
    out=$(printf 'y\ny\ny\ny\ny\ny\n' | ./24-archive-and-clean.sh "$WORKDIR/l.env" 2>&1); rc=$?
    [ "$rc" -ne 0 ] || { echo "no refusal for $kv"; exit 1; }
    [ -d "$WORKDIR/exports" ] || { echo "deleted for $kv"; exit 1; }
  done
}

test_open_target_banner_and_items() { _seed22; _l22env
  out=$(printf 'y\ny\nn\n' | ./22-open-target.sh "$WORKDIR/l.env" 2>&1); assert_eq 1 $? "$out"
  assert_contains "$out" "lets users log in to the TARGET (production in real mode)"
  for w in "17 import finished" "18 files copied" "19 verify output reviewed" "20 index rebuilt" "21 spot checks done"; do assert_contains "$out" "$w"; done
  assert_eq "alice,bob,carol" "$(_retired22)"
}
test_open_target_flush_warning_before_confirm() { _seed22; _l22env
  testdb.sh sql tgt_db "set global innodb_flush_log_at_trx_commit=2"
  out=$(printf 'y\ny\ny\ny\ny\ny\ny\ny\n' | ./22-open-target.sh "$WORKDIR/l.env" 2>&1)
  testdb.sh sql tgt_db "set global innodb_flush_log_at_trx_commit=1"
  w=${out%%WARNING*}; c=${out%%Proceed?*}
  [ ${#w} -lt ${#c} ] || { echo "warning not before first confirm"; exit 1; }
  r=${out%%\[43\]*}; [ ${#r} -lt ${#c} ] || { echo "reminders not before confirm"; exit 1; }
}
test_clean_refuses_when_archive_exists() { _seed24; _l22env
  : > "$WORKDIR/TestSource-exports-$(date +%Y%m%d).7z"
  out=$(printf 'y\ny\ny\ny\ny\ny\n' | ./24-archive-and-clean.sh "$WORKDIR/l.env" 2>&1); assert_eq 2 $? "$out"
  assert_contains "$out" "already exists"; [ -d "$WORKDIR/exports" ] && [ ! -e "$WORKDIR/7z.argv" ] || exit 1
}
