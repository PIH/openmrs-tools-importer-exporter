# Tests for 01-preflight.sh and 02-check-source-data.sh. Run with tests/run.sh (needs tests/testdb.sh up).

_both() { testdb.sh sql src_db "$1"; testdb.sh sql tgt_db "$1"; }
# Known state on both DBs: the facility location, idgen prefix (target), health-center type, no data rows.
_seed12() {
  local t
  for t in location idgen_seq_id_gen person_attribute person_attribute_type patient person provider users conditions encounter_diagnosis note paperrecord_paper_record patient_appointment appointmentscheduling_appointment; do
    _both "create table if not exists $t like src_db.$t" 2>/dev/null || true
    _both "delete from $t" 2>/dev/null || true
  done
  _both "insert into location(name,date_created,uuid,creator) values('Test Clinic',now(),'11111111-1111-1111-1111-111111111111',1)"
  _both "insert into person_attribute_type(name,date_created,uuid,creator) values('Health Center',now(),'22222222-2222-2222-2222-222222222222',1)"
  testdb.sh sql tgt_db "insert into idgen_seq_id_gen(id,next_sequence_value,prefix) values(1,1,'TST')"
}
_env12() { cp tests/fixtures/test.env "$WORKDIR/t.env"; local kv; for kv in "$@"; do echo "$kv" >> "$WORKDIR/t.env"; done; }
_pf() { ./01-preflight.sh "$WORKDIR/t.env" </dev/null 2>&1; }
_chk() { printf '%s' "${1:-}" | ./02-check-source-data.sh "$WORKDIR/t.env" 2>&1; }

test_preflight_reports_missing_facility() { _seed12; _env12 SOURCE_FACILITY_UUID=00000000-0000-0000-0000-000000000000
  out=$(_pf); assert_eq 1 $?; assert_contains "$out" "PROBLEM"; assert_contains "$out" "SOURCE_FACILITY_UUID"
  # it did not stop at the first problem: later checks still ran
  assert_contains "$out" "OK       DOSSIER_PREFIX"
}
test_preflight_all_ok_on_testdb() { _seed12; _env12
  out=$(_pf); assert_eq 0 $? "$out"; assert_not_contains "$out" "PROBLEM"
  assert_contains "$out" "OK       SOURCE_FACILITY_UUID"; assert_contains "$out" "OK       node image"
  assert_contains "$out" "OK       tmux"; assert_contains "$out" "free disk"
}
test_preflight_runs_all_checks_with_several_problems() { _seed12; _env12 DOSSIER_PREFIX=NOPE ORDER_NUMBER_PREFIX= EXPORT_CONCEPT_NAME_MAPPINGS_FILE=/nonexistent/x
  out=$(_pf); assert_eq 1 $?
  assert_contains "$out" "PROBLEM  DOSSIER_PREFIX"; assert_contains "$out" "PROBLEM  ORDER_NUMBER_PREFIX"
  assert_contains "$out" "PROBLEM  EXPORT_CONCEPT_NAME_MAPPINGS_FILE"; assert_contains "$out" "OK       tmux"
}
test_preflight_missing_image_declined_is_problem() { _seed12; _env12 NODE_IMAGE=hai1309/no-such-image:0
  out=$(printf 'n\nn\n' | ./01-preflight.sh "$WORKDIR/t.env" 2>&1); assert_eq 1 $?; assert_contains "$out" "PROBLEM  node image"
}
test_preflight_prints_pih_versions_without_failing() { _seed12
  testdb.sh sql src_db "delete from global_property where property like '%pih%version%'; insert into global_property(property,property_value,uuid) values('pihcore.version','1.2.3',uuid())"
  _env12; out=$(_pf); assert_eq 0 $?; assert_contains "$out" "pihcore.version"; assert_contains "$out" "1.2.3"
  testdb.sh sql src_db "delete from global_property where property='pihcore.version'"
}

test_unsupported_zero_no_prompt() { _seed12; _env12
  out=$(_chk); assert_eq 0 $? "$out"; assert_not_contains "$out" "continue although"; assert_contains "$out" "conditions 0"
  assert_contains "$out" "Next: "
}
test_unsupported_counts_require_confirm() { _seed12; _env12
  testdb.sh sql src_db "insert into conditions(uuid,date_created,voided,creator) values(uuid(),now(),0,1),(uuid(),now(),0,1),(uuid(),now(),1,1)"
  out=$(_chk); assert_eq 1 $?; assert_contains "$out" "conditions 2"; assert_contains "$out" "continue although unsupported data exists"
  out=$(_chk y); assert_eq 0 $? "$out"
}
test_unsupported_missing_table_reported() { _seed12; _env12
  testdb.sh sql src_db "drop table note"
  out=$(_chk); local rc=$?
  testdb.sh sql src_db "create table note like tgt_db.note"
  assert_eq 0 $rc "$out"; assert_contains "$out" "notes: table not present"
}
test_unsupported_notes_and_paper_records_counted() { _seed12; _env12
  testdb.sh sql src_db "insert into note(note_type,text,date_created,creator,uuid) values('x','t',now(),1,uuid())"
  out=$(_chk); assert_eq 1 $?; assert_contains "$out" "notes 1"
}
test_health_center_missing_count() { _seed12; _env12
  testdb.sh sql src_db "insert into person(date_created,uuid,creator) values(now(),'p1',1),(now(),'p2',1),(now(),'p3',1); insert into patient(patient_id,date_created,creator,voided) select person_id,now(),1,0 from person; update patient set voided=1 where patient_id=(select min(person_id) from person); insert into person_attribute(person_id,value,person_attribute_type_id,creator,date_created,voided,uuid) select max(person_id),'7',(select person_attribute_type_id from person_attribute_type where uuid='22222222-2222-2222-2222-222222222222'),1,now(),0,uuid() from person"
  out=$(_chk); assert_eq 0 $? "$out"
  assert_contains "$out" "patients without Health Center on source: 1"
  assert_contains "$out" "patients without Health Center on target: 0"
}
test_providers_without_user_and_reminders() { _seed12; _env12
  testdb.sh sql src_db "insert into person(date_created,uuid,creator) values(now(),'q1',1),(now(),'q2',1); insert into users(system_id,person_id,date_created,creator,uuid) select 'u',min(person_id),now(),1,uuid() from person; insert into provider(person_id,creator,date_created,retired,uuid) select person_id,1,now(),0,uuid() from person"
  out=$(_chk); assert_eq 0 $? "$out"
  assert_contains "$out" "providers whose person has no user: 1"
  assert_contains "$out" "ID/card printing"; assert_contains "$out" "CommCare"; assert_contains "$out" "ETL"
}
