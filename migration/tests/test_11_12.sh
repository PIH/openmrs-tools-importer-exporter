# Tests for 11-build-lists and 12-setup-servers.

_u11() { printf '%08d-1111-0000-0000-%012d' "$2" "$1"; }
_clear11() { testdb.sh sql src_db "delete from relationship; delete from patient; delete from provider; delete from users; delete from person"; }
# _seed11: 3 users (1 retired), 2 providers, 3 patients (1 voided), 2 relationships (1 voided)
_seed11() { _clear11; trap _clear11 EXIT   # leave the shared test DB clean for other test files
  local n
  for n in 1 2 3; do testdb.sh sql src_db "insert into person(person_id,date_created,uuid,creator) values($n,now(),'$(_u11 2 $n)',1)"; done
  for n in 1 2 3; do testdb.sh sql src_db "insert into users(user_id,system_id,username,person_id,date_created,creator,uuid,retired) values($n,'s$n','u$n',$n,now(),1,'$(_u11 1 $n)',$([ $n = 3 ] && echo 1 || echo 0))"; done
  for n in 1 2; do testdb.sh sql src_db "insert into provider(provider_id,person_id,creator,date_created,uuid) values($n,$n,1,now(),'$(_u11 3 $n)')"; done
  for n in 1 2 3; do testdb.sh sql src_db "insert into patient(patient_id,creator,date_created,voided) values($n,1,now(),$([ $n = 3 ] && echo 1 || echo 0))"; done
  testdb.sh sql src_db "insert into relationship(person_a,relationship,person_b,creator,date_created,uuid,voided) values(1,1,2,1,now(),'$(_u11 4 1)',0),(2,1,1,1,now(),'$(_u11 4 2)',1)"
}
_env11() { cp tests/fixtures/test.env "$WORKDIR/l.env"; }
_run11() { _env11; rm -rf "$WORKDIR/lists"; out=$(./11-build-lists.sh "$WORKDIR/l.env" 2>&1); rc=$?; }
_lines() { wc -l < "$1" | tr -d ' '; }

test_lists_counts_match_db() { _seed11
  _run11; assert_eq 0 $rc "$out"
  assert_eq 3 "$(_lines "$WORKDIR/lists/users.csv")"
  assert_eq 2 "$(_lines "$WORKDIR/lists/providers.csv")"
  assert_eq 2 "$(_lines "$WORKDIR/lists/patients.csv")"
  assert_eq 1 "$(_lines "$WORKDIR/lists/relationships.csv")"
  assert_contains "$out" "users: 3"; assert_contains "$out" "providers: 2"
  assert_contains "$out" "patients: 2"; assert_contains "$out" "relationships: 1"
  assert_contains "$out" "Next: 12-setup-servers.sh"
  assert_eq "$(_u11 1 1)" "$(head -n 1 "$WORKDIR/lists/users.csv")"
}
test_patient_list_excludes_voided() { _seed11
  _run11; assert_eq 0 $rc "$out"
  assert_contains "$(cat "$WORKDIR/lists/patients.csv")" "$(_u11 2 1)"
  assert_not_contains "$(cat "$WORKDIR/lists/patients.csv")" "$(_u11 2 3)"
  assert_not_contains "$(cat "$WORKDIR/lists/relationships.csv")" "$(_u11 4 2)"
}
test_lists_hold_uuids_only_and_are_overwritten() { _seed11
  _run11; _run11; assert_eq 0 $rc "$out"
  assert_eq 3 "$(_lines "$WORKDIR/lists/users.csv")"
  assert_eq 0 "$(cat "$WORKDIR"/lists/*.csv | grep -vcE "^[0-9a-f-]{36}\$" || true)"
  assert_not_contains "$out" "$(_u11 1 1)"
}
test_lists_refuse_nothing_written_to_source() { _seed11
  _run11; assert_not_contains "$out" "Proceed?"
}

# ---- 12-setup-servers ----
# _setup12: local origin repo with a main branch, settings with separate server dirs, answers files.
_setup12() {
  rm -rf "$WORKDIR/origin" "$WORKDIR/srv" "$WORKDIR/tsrv" "$WORKDIR/lists" "$WORKDIR/mappings"
  git init -q -b main "$WORKDIR/origin"
  mkdir -p "$WORKDIR/origin/src"; echo hello > "$WORKDIR/origin/src/a.js"
  git -C "$WORKDIR/origin" add -A; git -C "$WORKDIR/origin" -c user.name=t -c user.email=t@x commit -qm one
  mkdir -p "$WORKDIR/lists" "$WORKDIR/mappings"
  for f in users providers patients relationships; do echo "$f-uuid" > "$WORKDIR/lists/$f.csv"; done
  echo "su sname,tu" > "$WORKDIR/mappings/user_mappings.csv"; echo "sp sname,tp" > "$WORKDIR/mappings/provider_mappings.csv"
  cp tests/fixtures/test.env "$WORKDIR/l.env"
  { echo "SOURCE_SERVER_DIR=$WORKDIR/srv"; echo "TARGET_SERVER_DIR=$WORKDIR/tsrv"
    echo "REPO_URL=$WORKDIR/origin"; echo "REPO_REF=main"
    echo "SOURCE_OPENMRS_URL=http://src.example:8080/openmrs"; echo "TARGET_OPENMRS_URL=http://tgt.example:8080/openmrs"
    echo "IMPORT_PATIENTS_BATCH_SIZE=7"; } >> "$WORKDIR/l.env"
  printf 'y\n' > "$WORKDIR/yes"; printf 'srcSECRET-1\ntgtSECRET-2\n' > "$WORKDIR/pw"
}
_run12() { out=$(MIGRATION_CONFIRM_INPUT="$WORKDIR/yes" MIGRATION_PROMPT_PW_FILE="$WORKDIR/pw" SKIP_NPM_CI=true ./12-setup-servers.sh "$WORKDIR/l.env" 2>&1); rc=$?; }
_mode() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }

test_env_written_mode_600_without_password_in_log() { _setup12
  _run12; assert_eq 0 $rc "$out"
  assert_eq 600 "$(_mode "$WORKDIR/srv/repo/src/.env")"; assert_eq 600 "$(_mode "$WORKDIR/tsrv/repo/src/.env")"
  assert_contains "$(cat "$WORKDIR/srv/repo/src/.env")" "srcSECRET-1"
  assert_contains "$(cat "$WORKDIR/tsrv/repo/src/.env")" "tgtSECRET-2"
  assert_not_contains "$(cat "$WORKDIR/srv/repo/src/.env")" "tgtSECRET-2"
  assert_not_contains "$out" "SECRET"
  assert_not_contains "$(cat "$WORKDIR"/logs/12-setup-servers.sh.*.log)" "SECRET"
  assert_contains "$out" "OPENMRS_SOURCE_PASSWORD=***"; assert_contains "$out" "OPENMRS_TARGET_PASSWORD=***"
  assert_contains "$out" "Next: 13-export.sh"
}
test_env_contains_order_number_prefix_and_facility() { _setup12
  _run12; assert_eq 0 $rc "$out"
  s=$(cat "$WORKDIR/srv/repo/src/.env"); t=$(cat "$WORKDIR/tsrv/repo/src/.env")
  assert_contains "$s" "ORDER_NUMBER_PREFIX=TS"
  assert_contains "$s" "OPENMRS_SOURCE_FACILITY_UUID=11111111-1111-1111-1111-111111111111"
  assert_contains "$s" "OPENMRS_SOURCE_CONTEXT_PATH=http://src.example:8080/openmrs"
  assert_contains "$s" "OPENMRS_SOURCE_USERNAME=migrator"
  assert_contains "$s" "TARGET_DIR=$WORKDIR/srv/exports"; assert_contains "$s" "LOG_HOME=$WORKDIR/srv/logs"
  assert_contains "$s" "EXPORT_PATIENT_LIST_FILE=$WORKDIR/srv/lists/patients.csv"
  assert_contains "$s" "EXPORT_USER_LIST_FILE=$WORKDIR/srv/lists/users.csv"
  assert_contains "$s" "EXPORT_PROVIDER_LIST_FILE=$WORKDIR/srv/lists/providers.csv"
  assert_contains "$s" "EXPORT_RELATIONSHIP_LIST_FILE=$WORKDIR/srv/lists/relationships.csv"
  assert_not_contains "$s" "OPENMRS_TARGET"
  assert_contains "$t" "OPENMRS_TARGET_CONTEXT_PATH=http://tgt.example:8080/openmrs"
  assert_contains "$t" "OPENMRS_TARGET_USERNAME=migrator"
  assert_contains "$t" "OPENMRS_SOURCE_FACILITY_UUID=11111111-1111-1111-1111-111111111111"
  assert_contains "$t" "OPENMRS_HEALTH_CENTER_ATTRIBUTE_UUID=22222222-2222-2222-2222-222222222222"
  assert_contains "$t" "IMPORT_PATIENTS_BATCH_SIZE=7"
  assert_contains "$t" "TARGET_DIR=$WORKDIR/tsrv/exports"; assert_contains "$t" "LOG_HOME=$WORKDIR/tsrv/logs"
  assert_contains "$t" "EXPORT_USER_MAPPINGS_FILE=$WORKDIR/tsrv/mappings/user_mappings.csv"
  assert_contains "$t" "EXPORT_PROVIDER_MAPPINGS_FILE=$WORKDIR/tsrv/mappings/provider_mappings.csv"
  assert_not_contains "$t" "OPENMRS_SOURCE_USERNAME"; assert_not_contains "$t" "FIX_"
}
test_lists_and_mappings_copied_up() { _setup12
  echo "x,y" > "$WORKDIR/roles.csv"; echo "EXPORT_USER_ROLE_MAPPINGS_FILE=$WORKDIR/roles.csv" >> "$WORKDIR/l.env"
  _run12; assert_eq 0 $rc "$out"
  assert_eq "patients-uuid" "$(cat "$WORKDIR/srv/lists/patients.csv")"
  assert_eq "su sname,tu" "$(cat "$WORKDIR/tsrv/mappings/user_mappings.csv")"
  assert_eq "x,y" "$(cat "$WORKDIR/tsrv/mappings/roles.csv")"
  assert_contains "$(cat "$WORKDIR/tsrv/repo/src/.env")" "EXPORT_USER_ROLE_MAPPINGS_FILE=$WORKDIR/tsrv/mappings/roles.csv"
  [ ! -e "$WORKDIR/srv/mappings" ] || { echo "mappings copied to the source"; exit 1; }
}
test_repo_cloned_then_fetched_on_rerun() { _setup12
  _run12; assert_eq 0 $rc "$out"; assert_eq hello "$(cat "$WORKDIR/srv/repo/src/a.js")"
  echo two > "$WORKDIR/origin/src/a.js"; git -C "$WORKDIR/origin" -c user.name=t -c user.email=t@x commit -qam two
  _run12; assert_eq 0 $rc "$out"
  assert_eq two "$(cat "$WORKDIR/srv/repo/src/a.js")"; assert_eq two "$(cat "$WORKDIR/tsrv/repo/src/a.js")"
}
test_ref_can_be_a_tag() { _setup12
  git -C "$WORKDIR/origin" tag v1; echo two > "$WORKDIR/origin/src/a.js"; git -C "$WORKDIR/origin" -c user.name=t -c user.email=t@x commit -qam two
  echo "REPO_REF=v1" >> "$WORKDIR/l.env"
  _run12; assert_eq 0 $rc "$out"; assert_eq hello "$(cat "$WORKDIR/srv/repo/src/a.js")"
}
test_npm_ci_runs_docker_with_node_image() { _setup12
  mkdir -p "$WORKDIR/bin"; printf '#!/bin/sh\necho "$@" >> %s/docker.calls\n' "$WORKDIR" > "$WORKDIR/bin/docker"; chmod +x "$WORKDIR/bin/docker"
  rm -f "$WORKDIR/docker.calls"
  out=$(PATH="$WORKDIR/bin:$PATH" MIGRATION_CONFIRM_INPUT="$WORKDIR/yes" MIGRATION_PROMPT_PW_FILE="$WORKDIR/pw" ./12-setup-servers.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_eq 2 "$(grep -c "run --rm --user $(id -u):$(id -g) -e HOME=/tmp -v $WORKDIR/.*repo:/app -w /app mysql:5.6 npm ci" "$WORKDIR/docker.calls")"
  assert_contains "$out" 'run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v '   # printed command; ids expand on the server
}
test_skip_npm_ci_refused_in_settings() { _setup12
  echo "SKIP_NPM_CI=true" >> "$WORKDIR/l.env"
  out=$(MIGRATION_CONFIRM_INPUT="$WORKDIR/yes" MIGRATION_PROMPT_PW_FILE="$WORKDIR/pw" ./12-setup-servers.sh "$WORKDIR/l.env" 2>&1); assert_eq 2 $? "$out"
}
test_password_with_special_characters() { _setup12
  printf "a'b\"c #d \$e\ntgt\n" > "$WORKDIR/pw"
  _run12; assert_eq 0 $rc "$out"
  assert_contains "$(cat "$WORKDIR/srv/repo/src/.env")" "OPENMRS_SOURCE_PASSWORD=\`a'b\"c #d \$e\`"
}
test_missing_mapping_file_stops() { _setup12
  rm "$WORKDIR/mappings/user_mappings.csv"
  _run12; assert_eq 2 $rc "$out"; assert_contains "$out" "user_mappings.csv"
}
test_unwritable_password_stops_before_any_change() { _setup12
  local bad
  for bad in "a'b\"c\`d" "line$(printf '\r')"; do
    rm -rf "$WORKDIR/srv" "$WORKDIR/tsrv"; printf '%s\ntgt\n' "$bad" > "$WORKDIR/pw"
    _run12; assert_eq 2 $rc "$out"
    [ ! -e "$WORKDIR/srv" ] && [ ! -e "$WORKDIR/tsrv" ] || { echo "something was written before stopping"; exit 1; }
  done
  printf 'src\n%s\n' "a'b\"c\`d" > "$WORKDIR/pw"; rm -rf "$WORKDIR/srv" "$WORKDIR/tsrv"
  _run12; assert_eq 2 $rc "$out"; [ ! -e "$WORKDIR/srv" ] || { echo "source changed before the target password was checked"; exit 1; }
}
test_unwritable_setting_value_stops_before_any_change() { _setup12
  cat >> "$WORKDIR/l.env" <<'ENVEOF'
ORDER_NUMBER_PREFIX="a'b\"c\`d"
ENVEOF
  rm -rf "$WORKDIR/srv" "$WORKDIR/tsrv"
  _run12; assert_eq 2 $rc "$out"; assert_contains "$out" "ORDER_NUMBER_PREFIX"
  [ ! -e "$WORKDIR/srv" ] || { echo "something was written before stopping"; exit 1; }
}
# M2: two mapping files with the same name would overwrite each other in <TARGET_SERVER_DIR>/mappings.
test_duplicate_mapping_basenames_refused_before_any_change() { _setup12
  mkdir -p "$WORKDIR/a" "$WORKDIR/b"; echo x > "$WORKDIR/a/m.csv"; echo y > "$WORKDIR/b/m.csv"; echo z > "$WORKDIR/a/user_mappings.csv"
  for pair in "EXPORT_USER_ROLE_MAPPINGS_FILE=$WORKDIR/a/m.csv EXPORT_CONCEPT_NAME_MAPPINGS_FILE=$WORKDIR/b/m.csv" "EXPORT_CONCEPT_NAME_MAPPINGS_FILE=$WORKDIR/a/user_mappings.csv"; do
    _setup12; for kv in $pair; do echo "$kv" >> "$WORKDIR/l.env"; done
    _run12; assert_eq 2 $rc "$out ($pair)"; assert_contains "$out" "same file name"; assert_not_contains "$out" "Proceed?"
    [ ! -e "$WORKDIR/srv" ] && [ ! -e "$WORKDIR/tsrv" ] || { echo "changed something ($pair)"; exit 1; }
  done
}
# M3: a branch that cannot be fast-forwarded fails the step; the commit that will run is shown on each server.
test_branch_not_fast_forward_fails() { _setup12
  _run12; assert_eq 0 $rc "$out"
  local sha; sha=$(git -C "$WORKDIR/origin" log -1 --format=%h)
  assert_contains "$out" "Commit to run on the source server: $sha"; assert_contains "$out" "Commit to run on the target server: $sha"
  git -C "$WORKDIR/srv/repo" -c user.name=t -c user.email=t@x commit -q --allow-empty -m local
  echo two > "$WORKDIR/origin/src/a.js"; git -C "$WORKDIR/origin" -c user.name=t -c user.email=t@x commit -qam two
  _run12; [ "$rc" -ne 0 ] || { echo "diverged branch not reported: $out"; exit 1; }
  assert_not_contains "$out" "Next:"
}
# m4: dotenv expands \n inside double quotes, not inside backticks: backticks are tried first.
test_dotenv_value_prefers_backticks_over_double_quotes() { _setup12
  printf '%s\ntgt\n' "a'b\\nc" > "$WORKDIR/pw"
  _run12; assert_eq 0 $rc "$out"
  assert_contains "$(cat "$WORKDIR/srv/repo/src/.env")" "OPENMRS_SOURCE_PASSWORD=\`a'b\\nc\`"
}
