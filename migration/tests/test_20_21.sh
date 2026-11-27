# Tests for 20-rebuild-index.sh and 21-spot-checks.sh (curl is a stub on PATH recording argv and stdin).
_l20env() { cp tests/fixtures/test.env "$WORKDIR/l.env"; local kv; for kv in "$@"; do echo "$kv" >> "$WORKDIR/l.env"; done; }

_PWFILE() { printf '%s\n' 'S3cret"pw\x' > "$WORKDIR/pw"; export MIGRATION_PROMPT_PW_FILE="$WORKDIR/pw"; }
# Stub curl: appends argv (one line per call) and stdin to files; the rebuild POST fails (exit 22) when STUB_CURL_FAIL is set
# (the patient search answers from $WORKDIR/curl.reply).
_stub_curl() {
  mkdir -p "$WORKDIR/stub"
  cat > "$WORKDIR/stub/curl" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$WORKDIR/curl.argv"
case "$*" in *"--config -"*) cat >> "$WORKDIR/curl.stdin" ;; esac
case "$*" in
  *searchindexupdate*) [ -z "${STUB_CURL_FAIL:-}" ] || exit 22 ;;
  *"/patient?identifier="*) cat "$WORKDIR/curl.reply" 2>/dev/null ;;
esac
exit 0
STUB
  chmod +x "$WORKDIR/stub/curl"
  rm -f "$WORKDIR/curl.argv" "$WORKDIR/curl.stdin" "$WORKDIR/curl.reply"
  export PATH="$WORKDIR/stub:$PATH"
}
# TARGET_SERVER_DIR is $WORKDIR in test.env: 20 needs the finished markers of 17 and 19 in $WORKDIR/logs.
_env20() { _l20env "$@"; _stub_curl; _PWFILE
  rm -f "$WORKDIR/openmrs-runtime.properties" "$WORKDIR/tgt.restart" "$WORKDIR/up"; : > "$WORKDIR/up"
  mkdir -p "$WORKDIR/logs"; : > "$WORKDIR/logs/import-patients.done"; : > "$WORKDIR/logs/verify.done"
  export TMUX_TMPDIR="$WORKDIR"; trap 'tmux -S "$WORKDIR/tmux-$(id -u)/default" kill-server >/dev/null 2>&1 || true' EXIT
}
# I3: 20 must not restart the target or rebuild the index under a running import or verify, nor before both finished.
_assert20_untouched() { assert_eq 1 "$(grep -c indexing "$WORKDIR/openmrs-runtime.properties")"; [ ! -e "$WORKDIR/tgt.restart" ] && [ ! -s "$WORKDIR/curl.stdin" ] || { echo "changed something"; exit 1; }; }
test_rebuild_refuses_while_import_or_verify_runs() { command -v tmux >/dev/null || return 0
  for s in import-users import-patients verify; do _env20
    printf 'hibernate.search.indexing.listeners.enabled=false\n' > "$WORKDIR/openmrs-runtime.properties"
    tmux new-session -d -s "$s" "sleep 30"
    out=$(printf 'y\ny\ny\n' | ./20-rebuild-index.sh "$WORKDIR/l.env" 2>&1); assert_eq 1 $? "$out ($s)"
    assert_contains "$out" "'$s'"; assert_not_contains "$out" "Proceed?"; _assert20_untouched
    tmux kill-session -t "$s"
  done
}
test_rebuild_refuses_before_import_and_verify_finished() {
  for m in import-patients.done verify.done; do _env20
    printf 'hibernate.search.indexing.listeners.enabled=false\n' > "$WORKDIR/openmrs-runtime.properties"
    rm -f "$WORKDIR/logs/$m"
    out=$(printf 'y\ny\ny\n' | ./20-rebuild-index.sh "$WORKDIR/l.env" 2>&1); assert_eq 1 $? "$out ($m)"
    assert_contains "$out" "$m"; assert_not_contains "$out" "Proceed?"; _assert20_untouched
  done
  rm -f "$WORKDIR/logs/import-patients.done" "$WORKDIR/logs/verify.done"
}

test_indexing_line_removed() { _env20
  printf 'a=b\nhibernate.search.indexing.listeners.enabled=false\nc=d\n' > "$WORKDIR/openmrs-runtime.properties"
  out=$(printf 'y\ny\ny\n' | ./20-rebuild-index.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_eq 0 "$(grep -c 'indexing' "$WORKDIR/openmrs-runtime.properties")"
  assert_eq "a=b c=d" "$(tr '\n' ' ' < "$WORKDIR/openmrs-runtime.properties" | sed 's/ $//')"
  assert_eq restarted "$(cat "$WORKDIR/tgt.restart")"
  assert_contains "$out" "puppet can run on the target again now"; assert_contains "$out" "Next: 21-spot-checks.sh"
}
test_indexing_line_absent_skips() { _env20
  printf 'a=b\n' > "$WORKDIR/openmrs-runtime.properties"
  out=$(printf 'y\ny\n' | ./20-rebuild-index.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_contains "$out" "not in"; [ ! -e "$WORKDIR/tgt.restart" ] || { echo "restarted although nothing changed"; exit 1; }
  assert_eq a=b "$(cat "$WORKDIR/openmrs-runtime.properties")"
}
test_missing_properties_file_fails() { _env20
  rm -f "$WORKDIR/openmrs-runtime.properties"
  out=$(printf 'y\ny\ny\n' | ./20-rebuild-index.sh "$WORKDIR/l.env" 2>&1); rc=$?
  assert_eq 2 "$rc" "$out"
  assert_contains "$out" "$WORKDIR/openmrs-runtime.properties"; assert_not_contains "$out" "nothing to remove"
  assert_not_contains "$out" "Next: 21"; [ ! -e "$WORKDIR/tgt.restart" ] || exit 1
  [ ! -s "$WORKDIR/curl.stdin" ] || exit 1
}
test_failing_sudo_is_not_treated_as_absent() { _env20
  printf '#!/bin/sh\nexit 1\n' > "$WORKDIR/stub/failsudo"; chmod +x "$WORKDIR/stub/failsudo"
  _l20env TARGET_FILE_SUDO=failsudo
  printf 'hibernate.search.indexing.listeners.enabled=false\n' > "$WORKDIR/openmrs-runtime.properties"
  out=$(printf 'y\ny\ny\n' | ./20-rebuild-index.sh "$WORKDIR/l.env" 2>&1); rc=$?
  assert_eq 2 "$rc" "$out"
  assert_contains "$out" "$WORKDIR/openmrs-runtime.properties"; assert_not_contains "$out" "nothing to remove"
  assert_not_contains "$out" "Next: 21"; [ ! -e "$WORKDIR/tgt.restart" ] || exit 1
  [ ! -s "$WORKDIR/curl.stdin" ] || exit 1
  assert_eq 1 "$(grep -c indexing "$WORKDIR/openmrs-runtime.properties")"
}
test_rebuild_password_not_in_argv() { _env20
  : > "$WORKDIR/openmrs-runtime.properties"
  out=$(printf 'y\ny\n' | ./20-rebuild-index.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  argv=$(cat "$WORKDIR/curl.argv")
  assert_contains "$argv" "searchindexupdate"; assert_contains "$argv" "--config -"; assert_contains "$argv" '{"async": false}'; assert_contains "$argv" "--max-time"; assert_contains "$argv" "--fail"
  assert_not_contains "$argv" "S3cret"; assert_not_contains "$out" "S3cret"
  assert_contains "$(cat "$WORKDIR/curl.stdin")" 'user = "migrator:S3cret\"pw\\x"'
}
test_rebuild_declined_does_not_post() { _env20
  : > "$WORKDIR/openmrs-runtime.properties"
  printf 'n\n' | ./20-rebuild-index.sh "$WORKDIR/l.env" >/dev/null 2>&1; assert_eq 1 $?
  [ ! -s "$WORKDIR/curl.stdin" ] || exit 1
}
test_rebuild_curl_failure_fails() { _env20; export STUB_CURL_FAIL=1
  : > "$WORKDIR/openmrs-runtime.properties"
  out=$(printf 'y\ny\n' | ./20-rebuild-index.sh "$WORKDIR/l.env" 2>&1); rc=$?; unset STUB_CURL_FAIL
  [ "$rc" -ne 0 ] || { echo "expected failure: $out"; exit 1; }
  assert_not_contains "$out" "Next: 21"; assert_not_contains "$out" "puppet can run"
}
test_indexing_line_uses_file_sudo_prefix() { _env20 TARGET_FILE_SUDO=env
  printf 'hibernate.search.indexing.listeners.enabled=false\n' > "$WORKDIR/openmrs-runtime.properties"
  out=$(printf 'y\ny\ny\n' | ./20-rebuild-index.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_contains "$out" "env sed -i"
}

_seed21() {
  local t
  for t in person_attribute person_attribute_type patient person location; do testdb.sh sql tgt_db "delete from $t"; done
  testdb.sh sql tgt_db "insert into location(name,date_created,uuid,creator) values('Other',now(),'33333333-3333-3333-3333-333333333333',1),('Test Clinic',now(),'11111111-1111-1111-1111-111111111111',1);
    insert into person_attribute_type(name,date_created,uuid,creator) values('Health Center',now(),'22222222-2222-2222-2222-222222222222',1);
    insert into person(date_created,uuid,creator) values(now(),'a',1),(now(),'b',1),(now(),'c',1),(now(),'d',1);
    insert into patient(patient_id,date_created,creator,voided) select person_id,now(),1,0 from person;
    update patient set voided=1 where patient_id=(select min(person_id) from person);"
  testdb.sh sql tgt_db "insert into person_attribute(person_id,value,person_attribute_type_id,creator,date_created,voided,uuid)
    select p.person_id,
      case p.uuid when 'a' then (select location_id from location where name='Test Clinic') when 'b' then (select location_id from location where name='Test Clinic') else (select location_id from location where name='Other') end,
      (select person_attribute_type_id from person_attribute_type where uuid='22222222-2222-2222-2222-222222222222'),1,now(),0,uuid() from person p"
}
_run21() { printf '%s' "$1" | ./21-spot-checks.sh "$WORKDIR/l.env" 2>&1; }

test_health_center_counts_by_value() { _l20env; _stub_curl; _PWFILE; _seed21
  out=$(_run21 $'\n'); assert_eq 0 $? "$out"
  # a is voided patient: Test Clinic has 1 (b), Other has 2 (c, d)
  tc=$(testdb.sh sql tgt_db "select location_id from location where name='Test Clinic'")
  assert_contains "$out" "$tc"$'\t'"1"; assert_contains "$out" "source facility"
  assert_contains "$out" "Next: 22-open-target.sh"
  [ ! -e "$WORKDIR/curl.argv" ] || { echo "curl called without dossier numbers"; exit 1; }
}
test_dossier_found_prints_uuid_and_identifier_only() { _l20env; _stub_curl; _PWFILE; _seed21
  echo '{"results":[{"uuid":"aaaa-1111","identifiers":[{"identifier":"TST100"},{"identifier":"OTHER9"}],"display":"TST100 - Jane Doe"}]}' > "$WORKDIR/curl.reply"
  out=$(_run21 $'TST100\nTST404\n\n'); assert_eq 0 $? "$out"
  assert_contains "$out" "TST100: found, patient aaaa-1111"
  assert_not_contains "$out" "Jane"; assert_not_contains "$out" "OTHER9"
  assert_not_contains "$(cat "$WORKDIR/curl.argv")" "S3cret"
  assert_contains "$(cat "$WORKDIR/curl.argv")" "identifier=TST100"
  assert_contains "$(cat "$WORKDIR/curl.stdin")" 'user = "migrator:'
}
test_dossier_not_found() { _l20env; _stub_curl; _PWFILE; _seed21
  echo '{"results":[]}' > "$WORKDIR/curl.reply"
  out=$(_run21 $'TST7\n\n'); assert_eq 0 $? "$out"
  assert_contains "$out" "TST7: NOT found"
}
test_dossier_rejects_odd_characters() { _l20env; _stub_curl; _PWFILE; _seed21
  out=$(_run21 $'a&b=c\n\n'); assert_eq 0 $? "$out"
  assert_contains "$out" "skipped"; [ ! -e "$WORKDIR/curl.argv" ] || exit 1
}
