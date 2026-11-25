# Tests for migration.env.example and 00-create-settings.sh. Run with tests/run.sh.

test_example_has_every_setting_used() {
  # Every ALL-CAPS variable referenced in migration/*.sh must be a setting in the example,
  # except lib-internal / harness-only / shell names.
  local excluded=" MIGRATION_LIB_DIR MIGRATION_UNDER_TEST MIGRATION_CONFIRM_INPUT MIGRATION_PROMPT_PW_FILE MIGRATION_ENV HOME PATH SECONDS LINENO BASH_SOURCE PWD BASH_REMATCH MYSQL_ROOT_PASSWORD "
  local name missing=""
  for name in $(grep -ohE '\$\{?[A-Z][A-Z0-9_]*' ./*.sh | tr -d '${' | sort -u); do
    case "$excluded" in *" $name "*) continue ;; esac
    grep -q "^$name=" migration.env.example || missing="$missing $name"
  done
  [ -z "$missing" ] || { echo "settings used in scripts but missing from migration.env.example:$missing"; exit 1; }
  assert_contains "$(cat migration.env.example)" "MIGRATION_MODE=test"
}

_answers() { printf '%s\n' "$@"; }   # one answer per prompt, in file order; end of input keeps the rest
_fresh() { rm -f "$WORKDIR"/s.env "$WORKDIR"/s2.env; }

test_create_settings_writes_answers() { _fresh;
  _answers test hsn local local | ./00-create-settings.sh "$WORKDIR/s.env" >/dev/null 2>&1; assert_eq 0 $?
  assert_contains "$(cat "$WORKDIR/s.env")" "TARGET_HOST='local'"
  assert_contains "$(cat "$WORKDIR/s.env")" "SOURCE_NAME='hsn'"
  assert_contains "$(cat "$WORKDIR/s.env")" 'TARGET_DATA_DIR="/home/tomcat/.OpenMRS"'
  assert_contains "$(cat "$WORKDIR/s.env")" 'TARGET_RUNTIME_PROPERTIES="$TARGET_DATA_DIR/openmrs-runtime.properties"'
  # the written file is a valid settings file with the expected values once sourced
  assert_eq "local|/home/tomcat/.OpenMRS/openmrs-runtime.properties" "$( set +eu; . "$WORKDIR/s.env"; echo "$TARGET_HOST|$TARGET_RUNTIME_PROPERTIES")"
}

test_create_settings_rerun_keeps_values() { _fresh;
  _answers test hsn local local | ./00-create-settings.sh "$WORKDIR/s.env" >/dev/null 2>&1
  ./00-create-settings.sh "$WORKDIR/s.env" </dev/null >/dev/null 2>&1; assert_eq 0 $?
  assert_contains "$(cat "$WORKDIR/s.env")" "SOURCE_NAME='hsn'"
  assert_contains "$(cat "$WORKDIR/s.env")" "TARGET_HOST='local'"
  # a changed answer replaces the old one, others stay
  printf '\n\n\nssh-alias\n' | ./00-create-settings.sh "$WORKDIR/s.env" >/dev/null 2>&1
  assert_contains "$(cat "$WORKDIR/s.env")" "TARGET_HOST='ssh-alias'"
  assert_contains "$(cat "$WORKDIR/s.env")" "SOURCE_HOST='local'"
}

test_create_settings_file_mode_600() { _fresh;
  ./00-create-settings.sh "$WORKDIR/s.env" </dev/null >/dev/null 2>&1
  assert_eq 600 "$(stat -c %a "$WORKDIR/s.env" 2>/dev/null || stat -f %Lp "$WORKDIR/s.env")"
  chmod 644 "$WORKDIR/s.env"
  ./00-create-settings.sh "$WORKDIR/s.env" </dev/null >/dev/null 2>&1
  assert_eq 600 "$(stat -c %a "$WORKDIR/s.env" 2>/dev/null || stat -f %Lp "$WORKDIR/s.env")"
}

test_create_settings_needs_a_path() { _fresh; assert_exit 2 bash -c 'unset MIGRATION_ENV; ./00-create-settings.sh </dev/null'; }

test_create_settings_never_asks_for_passwords() { _fresh;
  out=$(./00-create-settings.sh "$WORKDIR/s.env" </dev/null 2>&1)
  assert_not_contains "$out" "password:"; assert_not_contains "$(cat "$WORKDIR/s.env")" "PASSWORD"
}

test_create_settings_offers_lookups_from_test_container() { _fresh;
  out=$(_answers test hsn local local docker docker container-env container-env hai1309-test-mysql hai1309-test-mysql src_db tgt_db | ./00-create-settings.sh "$WORKDIR/s.env" 2>&1)
  assert_contains "$out" "Containers on the source server: "; assert_contains "$out" "hai1309-test-mysql"
  assert_contains "$out" "Databases in the source container: "; assert_contains "$out" "src_db"
  assert_contains "$out" "Databases in the target container: "; assert_contains "$out" "tgt_db"
  testdb.sh sql src_db "delete from location where name='Zzz Test Clinic'"
  testdb.sh sql src_db "insert into location(name,uuid) values('Zzz Test Clinic','aaaa-bbbb')" 2>/dev/null || skip_msg=1
  if [ -z "${skip_msg:-}" ]; then
    # ?part-of-name searches the source locations, then asks again
    out=$( (_answers test hsn local local docker docker container-env container-env hai1309-test-mysql hai1309-test-mysql src_db tgt_db '' '' '' '?Zzz Test' 'aaaa-bbbb') | ./00-create-settings.sh "$WORKDIR/s2.env" 2>&1)
    assert_contains "$out" "aaaa-bbbb"; assert_contains "$out" "Zzz Test Clinic"
    assert_contains "$(cat "$WORKDIR/s2.env")" "SOURCE_FACILITY_UUID='aaaa-bbbb'"
    testdb.sh sql src_db "delete from location where name='Zzz Test Clinic'"
  fi
}

test_create_settings_skips_lookups_silently_when_host_unreachable() { _fresh;
  out=$(_answers test hsn nonexistent-host.invalid nonexistent-host.invalid docker docker | ./00-create-settings.sh "$WORKDIR/s.env" 2>&1); assert_eq 0 $?
  assert_not_contains "$out" "Containers on"; assert_not_contains "$out" "FAILED"
  assert_contains "$(cat "$WORKDIR/s.env")" "SOURCE_HOST='nonexistent-host.invalid'"
}

test_create_settings_rerun_keeps_defaults_that_reference_other_settings() {
  _fresh
  ./00-create-settings.sh "$WORKDIR/s.env" </dev/null >/dev/null 2>&1
  ./00-create-settings.sh "$WORKDIR/s.env" </dev/null >/dev/null 2>&1
  assert_contains "$(cat "$WORKDIR/s.env")" 'TARGET_RUNTIME_PROPERTIES="$TARGET_DATA_DIR/openmrs-runtime.properties"'
}
