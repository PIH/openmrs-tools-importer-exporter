# Tests for lib.sh. Run with tests/run.sh (cwd is migration/, lib.sh and test.env are loaded).

test_require_settings_names_missing() { out=$( (FOO=; require_settings FOO) 2>&1 ); assert_eq 2 $?; assert_contains "$out" "FOO"; }
test_run_on_local_runs_directly()    { assert_eq "hi" "$(run_on src 'echo hi')"; }
test_src_sql_prints_sql_and_returns_rows() { out=$(src_sql "select 1+1" 2>&1); assert_contains "$out" "select 1+1"; assert_contains "$out" "2"; }
test_confirm_no_exits_1()            { assert_exit 1 bash -c 'source lib.sh; confirm x </dev/null'; }   # no tty → treated as "no"
# Compares before/after: other test files leave retired users in src_db, so an absolute 0 only holds when run alone.
test_test_mode_blocks_source_writes() { MIGRATION_MODE=test; local before; before=$(testdb.sh sql src_db 'select count(*) from users where retired=1')
  assert_exit 3 src_sql_write "update users set retired=1"; assert_eq "$before" "$(testdb.sh sql src_db 'select count(*) from users where retired=1')"; }
test_test_mode_blocks_source_cmd_writes() { MIGRATION_MODE=test; assert_exit 3 src_cmd_write "touch $WORKDIR/should-not-exist"; [ ! -e "$WORKDIR/should-not-exist" ] || { echo "command ran"; exit 1; }; }
test_test_mode_allows_target_writes() { MIGRATION_MODE=test; testdb.sh sql tgt_db "delete from global_property where property='t'"; yes | tgt_sql_write "insert into global_property(property,property_value,uuid) values('t','v',uuid())" >/dev/null 2>&1; assert_eq 0 $?; assert_eq 1 "$(testdb.sh sql tgt_db "select count(*) from global_property where property='t'")"; testdb.sh sql tgt_db "delete from global_property where property='t'"; }
test_test_mode_allows_work_writes()  { MIGRATION_MODE=test; yes | src_work_write "touch $WORKDIR/work-src" >/dev/null 2>&1; yes | tgt_work_write "touch $WORKDIR/work-tgt" >/dev/null 2>&1; [ -e "$WORKDIR/work-src" ] && [ -e "$WORKDIR/work-tgt" ] || { echo "work write did not run"; exit 1; }; }
test_work_write_needs_confirmation() { MIGRATION_MODE=test; echo n | src_work_write "touch $WORKDIR/declined" >/dev/null 2>&1; assert_eq 1 $?; [ ! -e "$WORKDIR/declined" ] || { echo "ran despite no"; exit 1; }; }
test_failed_sql_stops_script()       { out=$(bash -c 'source lib.sh; load_settings tests/fixtures/test.env; src_sql "select * from nope"; next_step 99-x.sh ok' 2>&1); assert_not_contains "$out" "99-x.sh"; assert_contains "$out" "FAILED in"; }
test_log_never_contains_mysql_password() {
  load_settings tests/fixtures/test.env; src_sql "select 1" >/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do cat "$WORKDIR"/logs/*.log 2>/dev/null | grep -q 'select 1' && break; sleep 0.3; done
  assert_contains "$(cat "$WORKDIR"/logs/*.log)" "select 1"
  assert_not_contains "$(cat "$WORKDIR"/logs/*.log)" "pw-9f3k"
}
test_pipe_src_to_tgt_streams()       { assert_eq "abc" "$(pipe_src_to_tgt 'echo abc' 'cat')"; }
test_pipe_src_to_tgt_fails_if_source_fails() { assert_exit 1 pipe_src_to_tgt 'exit 1' 'cat'; }
test_sql_quote_escapes_quote()       { assert_eq "'O''Brien'" "$(sql_quote "O'Brien")"; assert_eq "'a\\\\b'" "$(sql_quote 'a\b')"; }
test_wait_for_target_times_out()     { TARGET_WAIT_URL=http://127.0.0.1:9/ WAIT_TIMEOUT_SECONDS=1 assert_exit 1 wait_for_target; }
test_skip_in_test_mode_exits_0()     { out=$( (MIGRATION_MODE=test; skip_in_test_mode "why"; echo after) 2>&1 ); assert_eq 0 $?; assert_contains "$out" "skipped in test mode: why"; assert_not_contains "$out" after; }
test_tmux_refuses_duplicate_session() { s=hai1309-t$$; yes | start_in_tmux src "$s" work 'sleep 30' >/dev/null 2>&1; tmux_running src "$s" || { echo "not running"; exit 1; }; assert_exit 1 start_in_tmux src "$s" work 'sleep 30'; tmux kill-session -t "$s"; }
test_tmux_cmd_refused_on_src_in_test_mode() { MIGRATION_MODE=test; assert_exit 3 start_in_tmux src hai1309-never cmd 'sleep 30'; ! tmux_running src hai1309-never || { echo started; exit 1; }; }
test_tmux_needs_confirmation()       { echo n | start_in_tmux src hai1309-declined work 'sleep 30' >/dev/null 2>&1; assert_eq 1 $?; ! tmux_running src hai1309-declined || { tmux kill-session -t hai1309-declined; echo started; exit 1; }; }
test_prompt_auth_asks_once_and_works_with_test_container() {
  echo pw-9f3k >"$WORKDIR/pw"; export MIGRATION_PROMPT_PW_FILE="$WORKDIR/pw"
  { cat tests/fixtures/test.env; echo SOURCE_MYSQL_AUTH=prompt; } >"$WORKDIR/p.env"
  load_settings "$WORKDIR/p.env"; rm "$WORKDIR/pw"
  assert_eq 2 "$(src_sql 'select 1+1' 2>/dev/null)"
  assert_eq 2 "$(src_sql 'select 1+1' 2>/dev/null)" "(second query must reuse the cached password)"
}
test_prompt_auth_wrong_password_fails() { echo nope >"$WORKDIR/pw"; export MIGRATION_PROMPT_PW_FILE="$WORKDIR/pw"; { cat tests/fixtures/test.env; echo SOURCE_MYSQL_AUTH=prompt; } >"$WORKDIR/p.env"; load_settings "$WORKDIR/p.env"; assert_exit 1 src_sql 'select 1'; }
test_settings_file_cannot_enable_confirm_bypass() {
  for v in MIGRATION_CONFIRM_INPUT MIGRATION_UNDER_TEST MIGRATION_PROMPT_PW_FILE SKIP_NPM_CI; do
    { cat tests/fixtures/test.env; echo "$v=1"; } >"$WORKDIR/bad.env"
    assert_exit 2 bash -c 'source lib.sh; load_settings "$1"' _ "$WORKDIR/bad.env"
  done
}
test_confirm_ignores_input_override_without_harness() { assert_exit 1 bash -c 'unset MIGRATION_UNDER_TEST; export MIGRATION_CONFIRM_INPUT=/dev/stdin MIGRATION_MODE=test; source lib.sh; echo y | confirm x'; }
test_mode_must_be_test_or_real() {
  for m in "" testing live; do
    sed "s/^MIGRATION_MODE=.*/MIGRATION_MODE=$m/" tests/fixtures/test.env >"$WORKDIR/m.env"
    out=$(bash -c 'source lib.sh; load_settings "$1"' _ "$WORKDIR/m.env" 2>&1); assert_eq 2 $? "(mode '$m')"; assert_contains "$out" MIGRATION_MODE
  done
  sed "s/^MIGRATION_MODE=.*/MIGRATION_MODE=real/" tests/fixtures/test.env >"$WORKDIR/m.env"
  assert_exit 0 bash -c 'source lib.sh; load_settings "$1"' _ "$WORKDIR/m.env"
}
test_sql_read_helpers_reject_writes() {
  for m in test real; do MIGRATION_MODE=$m
    assert_exit 2 src_sql "update users set retired=1"; assert_exit 2 tgt_sql "  /* c */ -- x
delete from users"
  done
  assert_eq 2 "$(src_sql '  -- hi
 SELECT 1+1' 2>/dev/null)"
}
test_load_settings_rejects_source_name_with_space() { cp tests/fixtures/test.env "$WORKDIR/bad.env"; echo 'SOURCE_NAME="a b"' >> "$WORKDIR/bad.env"
  out=$(bash -c 'source lib.sh; load_settings "$1"' _ "$WORKDIR/bad.env" 2>&1); assert_eq 2 $? "$out"; assert_contains "$out" "SOURCE_NAME"
}
# M4: logs, lists and mappings hold usernames and patient identifiers: files the scripts create are private.
test_load_settings_sets_umask_077() {
  out=$(bash -c 'source lib.sh; load_settings tests/fixtures/test.env >/dev/null; umask; touch "$WORKDIR/umask-probe"' 2>&1); assert_contains "$out" "0077"
  assert_eq 600 "$(stat -c %a "$WORKDIR/umask-probe" 2>/dev/null || stat -f %Lp "$WORKDIR/umask-probe")"
}
