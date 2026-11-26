# Tests for 20-rebuild-index.sh and 21-spot-checks.sh (curl is a stub on PATH recording argv and stdin).
_l20env() { cp tests/fixtures/test.env "$WORKDIR/l.env"; local kv; for kv in "$@"; do echo "$kv" >> "$WORKDIR/l.env"; done; }

_PWFILE() { printf '%s\n' 'S3cret"pw\x' > "$WORKDIR/pw"; export MIGRATION_PROMPT_PW_FILE="$WORKDIR/pw"; }
# Stub curl: appends argv (one line per call) and stdin to files; the rebuild POST sets search.indexVersion
# in tgt_db (like OpenMRS does); the patient search answers from $WORKDIR/curl.reply.
_stub_curl() {
  mkdir -p "$WORKDIR/stub"
  cat > "$WORKDIR/stub/curl" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$WORKDIR/curl.argv"
case "$*" in *"--config -"*) cat >> "$WORKDIR/curl.stdin" ;; esac
case "$*" in
  *searchindexupdate*) [ -z "${STUB_NO_INDEX:-}" ] && testdb.sh sql tgt_db "insert into global_property(property,property_value,uuid) values('search.indexVersion','v-new',uuid())" ;;
  *"/patient?identifier="*) cat "$WORKDIR/curl.reply" 2>/dev/null ;;
esac
exit 0
STUB
  chmod +x "$WORKDIR/stub/curl"
  rm -f "$WORKDIR/curl.argv" "$WORKDIR/curl.stdin" "$WORKDIR/curl.reply"
  export PATH="$WORKDIR/stub:$PATH"
}
_env20() { _l20env "$@"; _stub_curl; _PWFILE
  rm -f "$WORKDIR/openmrs-runtime.properties" "$WORKDIR/tgt.restart" "$WORKDIR/up"; : > "$WORKDIR/up"
  testdb.sh sql tgt_db "delete from global_property where property='search.indexVersion'"; }

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
test_rebuild_password_not_in_argv() { _env20
  : > "$WORKDIR/openmrs-runtime.properties"
  out=$(printf 'y\ny\n' | ./20-rebuild-index.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  argv=$(cat "$WORKDIR/curl.argv")
  assert_contains "$argv" "searchindexupdate"; assert_contains "$argv" "--config -"; assert_contains "$argv" '{"async": true}'
  assert_not_contains "$argv" "S3cret"; assert_not_contains "$out" "S3cret"
  assert_contains "$(cat "$WORKDIR/curl.stdin")" 'user = "migrator:S3cret\"pw\\x"'
}
test_rebuild_declined_does_not_post() { _env20
  : > "$WORKDIR/openmrs-runtime.properties"
  printf 'n\n' | ./20-rebuild-index.sh "$WORKDIR/l.env" >/dev/null 2>&1; assert_eq 1 $?
  [ ! -s "$WORKDIR/curl.stdin" ] || exit 1
}
test_index_wait_times_out() { _env20 WAIT_TIMEOUT_SECONDS=2; export STUB_NO_INDEX=1
  : > "$WORKDIR/openmrs-runtime.properties"
  out=$(printf 'y\ny\n' | ./20-rebuild-index.sh "$WORKDIR/l.env" 2>&1); rc=$?; unset STUB_NO_INDEX
  [ "$rc" -ne 0 ] || { echo "expected failure: $out"; exit 1; }
  assert_contains "$out" "Timed out"; assert_not_contains "$out" "Next: 21"
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
