# Tests for 09-build-user-mappings (HAI-1304).

# Uuids: users U<n>, persons P<n>, providers R<n>, padded to 36 chars.
# _uid KIND N: a valid 36-char uuid, e.g. _uid 1 7 -> 10000007-0000-0000-0000-000000000001
_uid() { printf '%08d-0000-0000-0000-%012d' "$2" "$1"; }

_clear9() { local db; for db in src_db tgt_db; do testdb.sh sql "$db" "delete from provider; delete from users; delete from person"; done; }
# _add9 db N username email retired [retire_reason]: person N, user N, uuid u/p = _uid 1 N / _uid 2 N
_add9() {
  local db=$1 n=$2 un=$3 em=$4 ret=$5 why=${6:-} unq emq whyq
  [ "$un" = NULL ] && unq=NULL || unq="'$un'"
  [ "$em" = NULL ] && emq=NULL || emq="'$em'"
  [ -z "$why" ] && whyq=NULL || whyq="'$why'"
  testdb.sh sql "$db" "insert into person(person_id,date_created,uuid,creator) values($n,now(),'$(_uid 2 "$n")',1);
    insert into users(user_id,system_id,username,email,person_id,date_created,creator,uuid,retired,retire_reason) values($n,'s$n',$unq,$emq,$n,now(),1,'$(_uid 1 "$n")',$ret,$whyq)"
}
# _prov9 db N personN: provider N for person
_prov9() { testdb.sh sql "$1" "insert into provider(provider_id,person_id,creator,date_created,uuid) values($2,$3,1,now(),'$(_uid 3 "$2")')"; }
_env9() { cp tests/fixtures/test.env "$WORKDIR/l.env"; }
_run9() { _env9; out=$(./09-build-user-mappings.sh "$WORKDIR/l.env" 2>&1); rc=$?; }
_map() { cat "$WORKDIR/mappings/$1"; }

test_username_match() { _clear9
  _add9 src_db 1 alice a@x.org 0; _add9 tgt_db 5 alice zz@x.org 0
  _run9; assert_eq 0 $rc "$out"
  assert_contains "$(_map user_mappings.csv)" "$(_uid 1 1) alice,$(_uid 1 5)"
  assert_contains "$out" "Next: 10-build-concept-name-mappings.sh"
}
test_email_match_when_username_differs() { _clear9
  _add9 src_db 1 alice a@x.org 0; _add9 tgt_db 5 alicia a@x.org 0
  _run9; assert_eq 0 $rc "$out"
  assert_contains "$(_map user_mappings.csv)" "$(_uid 1 1) alice,$(_uid 1 5)"
}
test_email_match_ignores_case_and_spaces() { _clear9
  _add9 src_db 1 alice '  A@X.org' 0; _add9 tgt_db 5 alicia 'a@x.ORG  ' 0
  _run9; assert_eq 0 $rc "$out"
  assert_contains "$(_map user_mappings.csv)" "$(_uid 1 1) alice,$(_uid 1 5)"
}
test_empty_email_never_matches() { _clear9
  _add9 src_db 1 alice '' 0; _add9 tgt_db 5 alicia '' 0; _add9 src_db 2 bob '  ' 0; _add9 tgt_db 6 bobby '  ' 0
  _run9; assert_eq 0 $rc "$out"
  assert_eq 0 "$(wc -l < "$WORKDIR/mappings/user_mappings.csv" | tr -d ' ')"
  assert_contains "$(_map unmatched-users.csv)" "$(_uid 1 1),alice"
}
test_duplicate_target_email_is_conflict_not_mapped() { _clear9
  _add9 src_db 1 alice a@x.org 0; _add9 tgt_db 5 t1 a@x.org 0; _add9 tgt_db 6 t2 ' a@x.org' 0
  _run9; assert_eq 0 $rc "$out"
  assert_eq 0 "$(wc -l < "$WORKDIR/mappings/user_mappings.csv" | tr -d ' ')"
  assert_contains "$(_map review-email-conflicts.csv)" "$(_uid 1 1),alice"
  assert_contains "$(_map review-email-conflicts.csv)" "$(_uid 1 5)"; assert_contains "$(_map review-email-conflicts.csv)" "$(_uid 1 6)"
  assert_not_contains "$(_map unmatched-users.csv)" "$(_uid 1 1)"
}
test_email_target_already_username_matched_is_conflict() { _clear9
  _add9 src_db 1 alice a@x.org 0; _add9 src_db 2 carol c@x.org 0
  _add9 tgt_db 5 alice zz@x.org 0; _add9 tgt_db 6 carolx c@x.org 0; _add9 src_db 3 carolx q@x.org 0
  # src 3 matches tgt 6 by username; src 2 (carol, same email as tgt 6) must conflict
  _run9; assert_eq 0 $rc "$out"
  m=$(_map user_mappings.csv)
  assert_contains "$m" "$(_uid 1 1) alice,$(_uid 1 5)"; assert_contains "$m" "$(_uid 1 3) carolx,$(_uid 1 6)"
  assert_not_contains "$m" "$(_uid 1 2) "
  assert_contains "$(_map review-email-conflicts.csv)" "$(_uid 1 2),carol"
}
test_retired_differs_is_fyi_and_mapped() { _clear9
  _add9 src_db 1 alice a@x.org 1; _add9 tgt_db 5 alice a@x.org 0
  _run9; assert_eq 0 $rc "$out"
  assert_contains "$(_map user_mappings.csv)" "$(_uid 1 1) alice,$(_uid 1 5)"
  assert_contains "$(_map fyi-retired-differs.csv)" "$(_uid 1 1),alice,$(_uid 1 5)"
}
test_temp_migrating_retired_target_not_fyi() { _clear9
  _add9 src_db 1 alice a@x.org 0; _add9 tgt_db 5 alice a@x.org 1 'Temp - migrating data'
  _add9 src_db 2 bob b@x.org 1; _add9 tgt_db 6 bob b@x.org 1 'Temp - migrating data'
  _add9 src_db 3 cy c@x.org 0; _add9 tgt_db 7 cy c@x.org 1 'left the clinic'
  _run9; assert_eq 0 $rc "$out"
  f=$(_map fyi-retired-differs.csv)
  assert_not_contains "$f" "$(_uid 1 1)"
  assert_contains "$f" "$(_uid 1 2),bob"   # source retired, target (temp) counts as not retired
  assert_contains "$f" "$(_uid 1 3),cy"
}
test_provider_mapped_via_user() { _clear9
  _add9 src_db 1 alice a@x.org 0; _add9 tgt_db 5 alice a@x.org 0
  _prov9 src_db 1 1; _prov9 tgt_db 9 5
  _run9; assert_eq 0 $rc "$out"
  assert_contains "$(_map provider_mappings.csv)" "$(_uid 3 1) alice,$(_uid 3 9)"
}
test_provider_with_several_target_providers_is_conflict() { _clear9
  _add9 src_db 1 alice a@x.org 0; _add9 tgt_db 5 alice a@x.org 0
  _prov9 src_db 1 1; _prov9 tgt_db 9 5; _prov9 tgt_db 10 5
  _run9; assert_eq 0 $rc "$out"
  assert_not_contains "$(_map provider_mappings.csv)" "$(_uid 3 1) "
  assert_contains "$(_map review-email-conflicts.csv)" "$(_uid 3 1),alice"
}
test_unknown_provider_line_appended() { _clear9
  _run9; assert_eq 0 $rc "$out"
  assert_eq "f9badd80-ab76-11e2-9e96-0800200c9a66 UnknownProvider,f9badd80-ab76-11e2-9e96-0800200c9a66" "$(_map provider_mappings.csv)"
}
test_mapping_line_format() { _clear9
  _add9 src_db 1 alice a@x.org 0; _add9 tgt_db 5 alice a@x.org 0; _prov9 src_db 1 1; _prov9 tgt_db 9 5
  _run9; assert_eq 0 $rc "$out"
  for f in user_mappings.csv provider_mappings.csv; do
    bad=$(grep -vcE '^[0-9a-f-]{36} [^,]+,[0-9a-f-]{36}$' "$WORKDIR/mappings/$f" || true)
    assert_eq 0 "$bad" "($f)"
  done
  assert_eq "$(_uid 1 1) alice,$(_uid 1 5)" "$(head -n 1 "$WORKDIR/mappings/user_mappings.csv")"
}
test_mappings_rerun_overwrites() { _clear9
  _add9 src_db 1 alice a@x.org 0; _add9 tgt_db 5 alice a@x.org 0; _prov9 src_db 1 1; _prov9 tgt_db 9 5
  _run9; _run9; assert_eq 0 $rc "$out"
  assert_eq 1 "$(wc -l < "$WORKDIR/mappings/user_mappings.csv" | tr -d ' ')"
  assert_eq 2 "$(wc -l < "$WORKDIR/mappings/provider_mappings.csv" | tr -d ' ')"
}
test_review_files_have_headers() { _clear9
  _run9; assert_eq 0 $rc "$out"
  for f in review-email-conflicts.csv fyi-retired-differs.csv unmatched-users.csv; do
    assert_contains "$(head -n 1 "$WORKDIR/mappings/$f")" "source_uuid,source_username"
  done
}
test_counts_and_footer() { _clear9
  _add9 src_db 1 alice a@x.org 0; _add9 tgt_db 5 alice a@x.org 0
  _add9 src_db 2 bob b@x.org 0; _add9 tgt_db 6 bobby b@x.org 0
  _add9 src_db 3 zed z@x.org 0
  _run9; assert_eq 0 $rc "$out"
  assert_contains "$out" "users matched by username: 1"; assert_contains "$out" "users matched by email: 1"
  assert_contains "$out" "user conflicts: 0"; assert_contains "$out" "unmatched users: 1"
  assert_contains "$out" "retired differs (FYI): 0"; assert_contains "$out" "providers matched: 0"
  assert_contains "$out" "day after steps 03 and 05"
}
test_no_hash_columns_cross() { _clear9
  _add9 src_db 1 alice a@x.org 0; testdb.sh sql src_db "update users set password='PWHASH-1',salt='SALT-1'"
  _run9; assert_eq 0 $rc "$out"
  line=$(printf '%s\n' "$out" | grep -F '[source SQL]')
  [ -n "$line" ] || { echo "no source SQL printed"; exit 1; }
  case "$(printf '%s' "$line" | tr 'A-Z' 'a-z')" in *password*|*salt*) echo "source SQL mentions password/salt"; exit 1 ;; esac
  assert_not_contains "$out" "PWHASH-1"; assert_not_contains "$(cat "$WORKDIR"/mappings/*)" "PWHASH-1"
}
test_prompt_auth_both_sides() { _clear9
  _add9 src_db 1 alice a@x.org 0; _add9 tgt_db 5 alice a@x.org 0
  printf 'pw-9f3k\n' > "$WORKDIR/pw"
  _env9; printf 'SOURCE_MYSQL_AUTH=prompt\nTARGET_MYSQL_AUTH=prompt\n' >> "$WORKDIR/l.env"
  out=$(MIGRATION_PROMPT_PW_FILE="$WORKDIR/pw" ./09-build-user-mappings.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_contains "$(_map user_mappings.csv)" "$(_uid 1 1) alice,$(_uid 1 5)"
  assert_not_contains "$out" "pw-9f3k"
}
test_special_characters_in_username() { _clear9
  _add9 src_db 1 "o\\'x" a@x.org 0; _add9 tgt_db 5 "o\\'x" b@x.org 0
  _run9; assert_eq 0 $rc "$out"
  assert_contains "$(_map user_mappings.csv)" "$(_uid 1 1) o'x,$(_uid 1 5)"
}
