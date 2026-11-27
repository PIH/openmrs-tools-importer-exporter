# Tests for 07-prepare-target (dossier sequence, indexing property, restart).

_seed_seq() { # source_value target_value (empty = no row)
  local db v
  for db in src_db tgt_db; do
    testdb.sh sql "$db" "delete from idgen_seq_id_gen"
    [ "$db" = src_db ] && v=$1 || v=$2
    [ -z "$v" ] || testdb.sh sql "$db" "insert into idgen_seq_id_gen(id,next_sequence_value,base_character_set,first_identifier_base,prefix) values(1,$v,'0123456789','0','TST')"
  done
}
_tseq() { testdb.sh sql tgt_db "select next_sequence_value from idgen_seq_id_gen where prefix='TST'"; }
_l7env() { cp tests/fixtures/test.env "$WORKDIR/l.env"; local kv; for kv in "$@"; do echo "$kv" >> "$WORKDIR/l.env"; done; }
_penv() { _l7env; rm -f "$WORKDIR/openmrs-runtime.properties" "$WORKDIR/tgt.restart" "$WORKDIR/up"; : > "$WORKDIR/up"; }

test_dossier_sequence_copied() { _seed_seq 500 100; _penv
  out=$(printf 'y\ny\ny\n' | ./07-prepare-target.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_eq 500 "$(_tseq)"; assert_contains "$out" "500"; assert_contains "$out" "100"
  assert_contains "$out" "Next: 08-check-no-sessions.sh"
}
test_dossier_equal_skips_write() { _seed_seq 500 500; _penv
  out=$(printf 'y\ny\n' | ./07-prepare-target.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_contains "$out" "already equal"; assert_eq 500 "$(_tseq)"
}
test_dossier_missing_row_stops() { _seed_seq 500 ""; _penv
  out=$(printf 'y\ny\ny\n' | ./07-prepare-target.sh "$WORKDIR/l.env" 2>&1); assert_eq 2 $? "$out"
  assert_contains "$out" "TST"; [ ! -e "$WORKDIR/tgt.restart" ] || exit 1
}
test_dossier_lower_source_requires_retype() { _seed_seq 50 100; _penv
  out=$(printf '50\ny\ny\ny\n' | ./07-prepare-target.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_eq 50 "$(_tseq)"
  _seed_seq 50 100; _penv
  out=$(printf '51\ny\ny\ny\n' | ./07-prepare-target.sh "$WORKDIR/l.env" 2>&1); assert_eq 1 $? "$out"
  assert_eq 100 "$(_tseq)"
}
test_indexing_property_added_once() { _seed_seq 500 500; _penv
  printf 'a=b' > "$WORKDIR/openmrs-runtime.properties"
  printf 'y\ny\n' | ./07-prepare-target.sh "$WORKDIR/l.env" >/dev/null 2>&1
  out=$(printf 'y\ny\n' | ./07-prepare-target.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_eq 1 "$(grep -c '^hibernate.search.indexing.listeners.enabled=false$' "$WORKDIR/openmrs-runtime.properties")"
  assert_eq a=b "$(head -n 1 "$WORKDIR/openmrs-runtime.properties")"
  assert_contains "$out" "already"; assert_contains "$out" "puppet"; assert_contains "$out" "nothing is indexed"
}
test_restart_runs_after_confirm() { _seed_seq 500 500; _penv
  out=$(printf 'y\ny\ny\n' | ./07-prepare-target.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_eq restarted "$(cat "$WORKDIR/tgt.restart")"; assert_contains "$out" "is up"
}
test_declined_part_exits_1() { _seed_seq 500 100; _penv
  printf 'n\n' | ./07-prepare-target.sh "$WORKDIR/l.env" >/dev/null 2>&1; assert_eq 1 $?; assert_eq 100 "$(_tseq)"
}
test_wait_url_timeout_fails() { _seed_seq 500 500; _penv; rm -f "$WORKDIR/up"
  _l7env WAIT_TIMEOUT_SECONDS=1
  out=$(printf 'y\ny\ny\n' | ./07-prepare-target.sh "$WORKDIR/l.env" 2>&1); rc=$?
  [ "$rc" -ne 0 ] || { echo "expected failure: $out"; exit 1; }
  assert_contains "$out" "Timed out"; assert_not_contains "$out" "Next: 08"
}
test_runtime_properties_use_file_sudo_prefix() { _seed_seq 500 500; _penv; _l7env TARGET_FILE_SUDO=env
  out=$(printf 'y\ny\ny\n' | ./07-prepare-target.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_contains "$out" "env tee -a"; assert_contains "$out" "env tail -c1"
  assert_eq 1 "$(grep -c '^hibernate.search.indexing.listeners.enabled=false$' "$WORKDIR/openmrs-runtime.properties")"
}
