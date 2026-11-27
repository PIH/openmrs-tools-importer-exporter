# Tests for 10-build-concept-name-mappings (HAI-1307).
# Uuids: concept C<n>, names N<n>; _cu/_nu N -> 36-char uuids.
_cu() { printf '%08d-c000-0000-0000-000000000000' "$1"; }
_nu() { printf '%08d-d000-0000-0000-000000000000' "$1"; }
_clear10() { local db; for db in src_db tgt_db; do testdb.sh sql "$db" "delete from obs; delete from concept_name; delete from concept"; done; }
# _concept10 db N: concept N with uuid _cu N
_concept10() { testdb.sh sql "$1" "insert into concept(concept_id,datatype_id,class_id,creator,date_created,uuid) values($2,1,1,1,now(),'$(_cu "$2")')"; }
# _name10 db NAMEID CONCEPTID text locale type voided   (type NULL allowed)
_name10() {
  local t=$6 v=${7:-0}; [ "$t" = NULL ] || t="'$t'"
  testdb.sh sql "$1" "insert into concept_name(concept_name_id,concept_id,name,locale,creator,date_created,concept_name_type,voided,uuid) values($2,$3,'$4','$5',1,now(),$t,$v,'$(_nu "$2")')"
}
# _obs10 db NAMEID [voided]: obs with that coded name
_obs10() { testdb.sh sql "$1" "insert into obs(person_id,concept_id,obs_datetime,creator,date_created,uuid,value_coded_name_id,voided) values(1,1,now(),1,now(),uuid(),$2,${3:-0})"; }
_env10() { cp tests/fixtures/test.env "$WORKDIR/l.env"; }
_run10() { _env10; out=$(./10-build-concept-name-mappings.sh "$WORKDIR/l.env" 2>&1); rc=$?; }
_m10() { cat "$WORKDIR/mappings/$1"; }
_pair10() { # one concept on both sides
  _concept10 src_db 1; _concept10 tgt_db 1
}

test_missing_name_with_same_text_gets_draft() { _clear10; _pair10
  _name10 src_db 11 1 Trichomonas en FULLY_SPECIFIED; _obs10 src_db 11
  _name10 tgt_db 21 1 Trichomonas en FULLY_SPECIFIED
  _run10; assert_eq 0 $rc "$out"
  assert_eq "$(_nu 11) Trichomonas,$(_nu 21)" "$(_m10 concept_name_mappings.draft.csv)"
  assert_contains "$out" "Next: 11-build-lists.sh"
}
test_null_type_matches_null_type() { _clear10; _pair10
  _name10 src_db 11 1 Foo en NULL; _obs10 src_db 11; _name10 tgt_db 21 1 Foo en NULL
  _run10; assert_eq 0 $rc "$out"
  assert_eq "$(_nu 11) Foo,$(_nu 21)" "$(_m10 concept_name_mappings.draft.csv)"
}
test_name_present_by_uuid_not_listed() { _clear10; _pair10
  _name10 src_db 11 1 Same en FULLY_SPECIFIED; _obs10 src_db 11
  testdb.sh sql tgt_db "insert into concept_name(concept_name_id,concept_id,name,locale,creator,date_created,voided,uuid) values(30,1,'Other','en',1,now(),0,'$(_nu 11)')"
  _run10; assert_eq 0 $rc "$out"
  assert_eq 0 "$(wc -l < "$WORKDIR/mappings/concept_name_mappings.draft.csv" | tr -d ' ')"
  assert_not_contains "$(_m10 concept-names-no-candidate.csv)" "$(_nu 11)"
}
test_no_candidate_listed() { _clear10; _pair10
  _name10 src_db 11 1 Gone en FULLY_SPECIFIED; _obs10 src_db 11
  _name10 tgt_db 21 1 Different en FULLY_SPECIFIED
  _name10 tgt_db 22 1 Gone fr FULLY_SPECIFIED          # other locale
  _name10 tgt_db 23 1 Gone en SHORT                    # other type
  _name10 tgt_db 24 1 Gone en FULLY_SPECIFIED 1        # voided
  _run10; assert_eq 0 $rc "$out"
  assert_eq 0 "$(wc -l < "$WORKDIR/mappings/concept_name_mappings.draft.csv" | tr -d ' ')"
  assert_contains "$(_m10 concept-names-no-candidate.csv)" "$(_nu 11),$(_cu 1),Gone,en,FULLY_SPECIFIED,0"
}
test_two_candidates_listed_not_drafted() { _clear10; _pair10
  _name10 src_db 11 1 Dup en FULLY_SPECIFIED; _obs10 src_db 11
  _name10 tgt_db 21 1 Dup en FULLY_SPECIFIED; _name10 tgt_db 22 1 Dup en FULLY_SPECIFIED
  _run10; assert_eq 0 $rc "$out"
  assert_eq 0 "$(wc -l < "$WORKDIR/mappings/concept_name_mappings.draft.csv" | tr -d ' ')"
  assert_contains "$(_m10 concept-names-no-candidate.csv)" "$(_nu 11),$(_cu 1),Dup,en,FULLY_SPECIFIED,0,2"
}
test_candidate_must_be_on_same_concept() { _clear10; _pair10; _concept10 tgt_db 2; _concept10 src_db 2
  _name10 src_db 11 1 Same en FULLY_SPECIFIED; _obs10 src_db 11
  _name10 tgt_db 21 2 Same en FULLY_SPECIFIED
  _run10; assert_eq 0 $rc "$out"
  assert_eq 0 "$(wc -l < "$WORKDIR/mappings/concept_name_mappings.draft.csv" | tr -d ' ')"
  assert_contains "$(_m10 concept-names-no-candidate.csv)" "$(_nu 11),"
}
test_only_names_of_nonvoided_obs() { _clear10; _pair10
  _name10 src_db 11 1 Unused en FULLY_SPECIFIED; _obs10 src_db 11 1
  _name10 src_db 12 1 Never en FULLY_SPECIFIED
  _run10; assert_eq 0 $rc "$out"
  assert_not_contains "$(_m10 concept-names-no-candidate.csv)" "$(_nu 11)"
  assert_not_contains "$(_m10 concept-names-no-candidate.csv)" "$(_nu 12)"
}
test_label_commas_replaced_and_special_chars() { _clear10; _pair10
  _name10 src_db 11 1 "A, b\\'c" en FULLY_SPECIFIED; _obs10 src_db 11
  _name10 tgt_db 21 1 "A, b\\'c" en FULLY_SPECIFIED
  _run10; assert_eq 0 $rc "$out"
  assert_eq "$(_nu 11) A  b'c,$(_nu 21)" "$(_m10 concept_name_mappings.draft.csv)"
}
test_existing_mapping_to_voided_name_flagged() { _clear10; _pair10
  _name10 tgt_db 21 1 Gone en FULLY_SPECIFIED 1
  printf '%s\n' "$(_nu 11) Gone,$(_nu 21)" "$(_nu 12) Missing,$(_nu 99)" "$(_nu 13) Fine,$(_nu 22)" > "$WORKDIR/existing.csv"
  _name10 tgt_db 22 1 Fine en FULLY_SPECIFIED
  _env10; echo "EXPORT_CONCEPT_NAME_MAPPINGS_FILE=$WORKDIR/existing.csv" >> "$WORKDIR/l.env"
  out=$(./10-build-concept-name-mappings.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  v=$(_m10 concept-mappings-voided-target.csv)
  assert_contains "$v" "$(_nu 11),$(_nu 21),voided"
  assert_contains "$v" "$(_nu 12),$(_nu 99),missing"
  assert_not_contains "$v" "$(_nu 13)"
  assert_contains "$out" "awk 1 $WORKDIR/existing.csv $WORKDIR/mappings/concept_name_mappings.draft.csv > $WORKDIR/existing.csv.merged"
  assert_not_contains "$out" "sort -u"
}
test_mappings_file_not_modified() { _clear10; _pair10
  _name10 src_db 11 1 Tri en FULLY_SPECIFIED; _obs10 src_db 11; _name10 tgt_db 21 1 Tri en FULLY_SPECIFIED
  printf '%s\n' "$(_nu 50) Old,$(_nu 51)" > "$WORKDIR/existing.csv"
  before=$(cksum < "$WORKDIR/existing.csv")
  _env10; echo "EXPORT_CONCEPT_NAME_MAPPINGS_FILE=$WORKDIR/existing.csv" >> "$WORKDIR/l.env"
  out=$(./10-build-concept-name-mappings.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_eq "$before" "$(cksum < "$WORKDIR/existing.csv")"
}
test_unset_or_missing_mappings_file_skips_check() { _clear10; _pair10
  _env10; echo "EXPORT_CONCEPT_NAME_MAPPINGS_FILE=$WORKDIR/nope.csv" >> "$WORKDIR/l.env"
  out=$(./10-build-concept-name-mappings.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_eq 1 "$(wc -l < "$WORKDIR/mappings/concept-mappings-voided-target.csv" | tr -d ' ')"
}
test_review_files_have_headers() { _clear10
  _run10; assert_eq 0 $rc "$out"
  assert_contains "$(head -n 1 "$WORKDIR/mappings/concept-names-no-candidate.csv")" "source_name_uuid,concept_uuid"
  assert_contains "$(head -n 1 "$WORKDIR/mappings/concept-mappings-voided-target.csv")" "source_name_uuid,target_name_uuid"
}
test_prompt_auth_both_sides() { _clear10; _pair10
  _name10 src_db 11 1 Tri en FULLY_SPECIFIED; _obs10 src_db 11; _name10 tgt_db 21 1 Tri en FULLY_SPECIFIED
  printf 'pw-9f3k\n' > "$WORKDIR/pw"
  _env10; printf 'SOURCE_MYSQL_AUTH=prompt\nTARGET_MYSQL_AUTH=prompt\n' >> "$WORKDIR/l.env"
  out=$(MIGRATION_PROMPT_PW_FILE="$WORKDIR/pw" ./10-build-concept-name-mappings.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_contains "$(_m10 concept_name_mappings.draft.csv)" "$(_nu 11) Tri,$(_nu 21)"
  assert_not_contains "$out" "pw-9f3k"
}
# M1: names the existing mappings file already maps are left out of the draft and the no-candidate list.
test_names_already_mapped_left_out() { _clear10; _pair10
  _name10 src_db 11 1 Tri en FULLY_SPECIFIED; _obs10 src_db 11; _name10 tgt_db 21 1 Tri en FULLY_SPECIFIED
  _name10 src_db 12 1 Lone en FULLY_SPECIFIED; _obs10 src_db 12
  _name10 src_db 13 1 New en FULLY_SPECIFIED; _obs10 src_db 13; _name10 tgt_db 23 1 New en FULLY_SPECIFIED
  printf '%s\n' "$(_nu 11) Tri,$(_nu 21)" "$(_nu 12) Lone,$(_nu 21)" > "$WORKDIR/existing.csv"
  _env10; echo "EXPORT_CONCEPT_NAME_MAPPINGS_FILE=$WORKDIR/existing.csv" >> "$WORKDIR/l.env"
  out=$(./10-build-concept-name-mappings.sh "$WORKDIR/l.env" 2>&1); assert_eq 0 $? "$out"
  assert_eq "$(_nu 13) New,$(_nu 23)" "$(_m10 concept_name_mappings.draft.csv)"
  assert_not_contains "$(_m10 concept-names-no-candidate.csv)" "$(_nu 12)"
  assert_contains "$out" "names already in the existing mappings file (left out): 2"
  # the printed merge appends and checks for duplicate keys
  merge=$(printf '%s\n' "$out" | grep -F "> $WORKDIR/existing.csv.merged")
  ( cd "$WORKDIR" && eval "$merge" ) >"$WORKDIR/merge.out" 2>&1; assert_eq 0 $? "$(cat "$WORKDIR/merge.out")"
  dupcheck=$(printf '%s\n' "$out" | grep -F "uniq -d"); assert_eq "" "$(eval "${dupcheck%%#*}")"
  assert_eq 3 "$(wc -l < "$WORKDIR/existing.csv.merged" | tr -d ' ')"
  assert_eq "$(_nu 11) Tri,$(_nu 21)" "$(head -n 1 "$WORKDIR/existing.csv.merged")"
}
