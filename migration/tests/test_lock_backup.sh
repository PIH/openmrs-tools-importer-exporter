# Tests for 03-lock-source, 04-backup-source, 05-lock-target, 06-backup-target, 08-check-no-sessions.

_seed_users() { # db
  testdb.sh sql "$1" "delete from users; delete from person"
  testdb.sh sql "$1" "insert into person(person_id,date_created,uuid,creator) values(1,now(),'u1',1),(2,now(),'u2',1),(3,now(),'u3',1),(4,now(),'u4',1);
    insert into users(user_id,system_id,username,person_id,date_created,creator,uuid,retired) values
    (11,'a','migrator',1,now(),1,'x1',0),(12,'b','alice',2,now(),1,'x2',0),(13,'c','ccIntegrationUser',3,now(),1,'x3',0),(14,'d','bob',4,now(),1,'x4',1)"
}
_lenv() { cp tests/fixtures/test.env "$WORKDIR/l.env"; local kv; for kv in "$@"; do echo "$kv" >> "$WORKDIR/l.env"; done; }
_retired() { testdb.sh sql "$1" "select group_concat(username order by username) from users where retired=1"; }

test_lock_source_skipped_in_test_mode() { _seed_users src_db; _lenv
  out=$(printf 'y\n' | ./03-lock-source.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_contains "$out" "skipped in test mode"; assert_eq "bob" "$(_retired src_db)"
}
test_lock_source_retires_all_but_migrating_user() { _seed_users src_db; _lenv MIGRATION_MODE=real
  out=$(printf 'y\n' | ./03-lock-source.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_contains "$out" "2 users to retire"
  assert_eq "alice,bob,ccIntegrationUser" "$(_retired src_db)"
  assert_eq "0" "$(testdb.sh sql src_db "select retired from users where username='migrator'")"
  assert_eq "11" "$(testdb.sh sql src_db "select retired_by from users where username='alice'")"
  assert_contains "$out" "2FA"; assert_contains "$out" "cron"; assert_contains "$out" "Next: 04-backup-source.sh"
}
test_lock_source_reason_exact() { _seed_users src_db; _lenv MIGRATION_MODE=real SOURCE_NAME=hsn
  printf 'y\n' | ./03-lock-source.sh "$WORKDIR/l.env" >/dev/null 2>&1
  assert_eq "Migrating from hsn" "$(testdb.sh sql src_db "select retire_reason from users where username='alice'")"
}
test_lock_source_rerun_is_noop() { _seed_users src_db; _lenv MIGRATION_MODE=real
  printf 'y\n' | ./03-lock-source.sh "$WORKDIR/l.env" >/dev/null 2>&1
  out=$(./03-lock-source.sh "$WORKDIR/l.env" </dev/null 2>&1); assert_eq 0 $? "$out"
  assert_contains "$out" "0 users to retire"; assert_not_contains "$out" "Proceed?"
}
test_lock_source_unknown_migrating_user_stops() { _seed_users src_db; _lenv MIGRATION_MODE=real MIGRATING_USERNAME=nobody
  out=$(printf 'y\n' | ./03-lock-source.sh "$WORKDIR/l.env" 2>&1); assert_eq 2 $?
  assert_contains "$out" "nobody"; assert_eq "bob" "$(_retired src_db)"
}
test_lock_source_quotes_username() { _seed_users src_db; _lenv MIGRATION_MODE=real "MIGRATING_USERNAME=\"o'x\""
  testdb.sh sql src_db "update users set username='o\\'x' where user_id=11"
  printf 'y\n' | ./03-lock-source.sh "$WORKDIR/l.env" >/dev/null 2>&1
  assert_eq "alice,bob,ccIntegrationUser" "$(_retired src_db)"
}
test_lock_target_keeps_ccIntegrationUser() { _seed_users tgt_db; _lenv
  out=$(printf 'y\n' | ./05-lock-target.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_eq "alice,bob" "$(_retired tgt_db)"
  assert_eq "Temp - migrating data" "$(testdb.sh sql tgt_db "select retire_reason from users where username='alice'")"
  assert_contains "$out" "Next: 06-backup-target.sh"
}
test_lock_target_rerun_is_noop() { _seed_users tgt_db; _lenv
  printf 'y\n' | ./05-lock-target.sh "$WORKDIR/l.env" >/dev/null 2>&1
  out=$(./05-lock-target.sh "$WORKDIR/l.env" </dev/null 2>&1); assert_eq 0 $? "$out"; assert_contains "$out" "0 users to retire"
}
test_backup_source_skipped_in_test_mode() { rm -f "$WORKDIR/src.backup"; _lenv
  out=$(printf 'y\ny\n' | ./04-backup-source.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_contains "$out" "skipped in test mode"; [ ! -e "$WORKDIR/src.backup" ] || { echo "backup ran"; exit 1; }
}
test_backup_source_runs_each_command_confirmed() { rm -f "$WORKDIR/src.backup"; _lenv MIGRATION_MODE=real
  out=$(printf 'y\ny\n' | ./04-backup-source.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_eq "b1 b2" "$(tr '\n' ' ' < "$WORKDIR/src.backup" | sed 's/ $//')"
  assert_eq 2 "$(printf '%s' "$out" | grep -c 'Proceed?')"; assert_contains "$out" "Next: 05-lock-target.sh"
}
test_backup_target_runs_in_test_mode() { rm -f "$WORKDIR/tgt.backup"; _lenv
  out=$(printf 'y\ny\n' | ./06-backup-target.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_eq "t1 t2" "$(tr '\n' ' ' < "$WORKDIR/tgt.backup" | sed 's/ $//')"; assert_contains "$out" "Next: 07-"
}
test_backup_declined_stops() { rm -f "$WORKDIR/tgt.backup"; _lenv
  out=$(printf 'n\n' | ./06-backup-target.sh "$WORKDIR/l.env" 2>&1); assert_eq 1 $?; [ ! -e "$WORKDIR/tgt.backup" ] || exit 1
}
test_check_sessions_skipped_in_test_mode() { rm -f "$WORKDIR/restart.marker"; _lenv
  out=$(printf 'y\n' | ./08-check-no-sessions.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_contains "$out" "skipped in test mode"; [ ! -e "$WORKDIR/restart.marker" ] || exit 1
}
test_check_sessions_offers_restart() { rm -f "$WORKDIR/restart.marker"; _lenv MIGRATION_MODE=real
  out=$(printf 'y\n' | ./08-check-no-sessions.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_contains "$out" "retired"; [ -e "$WORKDIR/restart.marker" ] || { echo "no restart"; exit 1; }
  assert_contains "$out" "Next: 09-"
}
test_check_sessions_restart_declined() { rm -f "$WORKDIR/restart.marker"; _lenv MIGRATION_MODE=real
  out=$(printf 'n\n' | ./08-check-no-sessions.sh "$WORKDIR/l.env" 2>&1); [ ! -e "$WORKDIR/restart.marker" ] || exit 1
}
