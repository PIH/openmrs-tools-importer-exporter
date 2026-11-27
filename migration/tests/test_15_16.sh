# Tests for 15-import-users and 16-copy-password-hashes (HAI-1314). Fake docker for the node run
# (private tmux server); the real test DB for everything else. Seeded fake hashes must never show up
# in output, logs or files.

_have_tmux() { command -v tmux >/dev/null 2>&1; }
_skip_no_tmux() { _have_tmux || { echo "SKIP (tmux not installed)"; return 0; }; return 1; }

# Uuids: _h KIND N -> 38-char-compatible uuid-like string (36 chars).
_h() { printf '%08d-1616-0000-0000-%012d' "$2" "$1"; }

_clear16() { local db; for db in src_db tgt_db; do testdb.sh sql "$db" "delete from users; delete from person"; done; }
# _user16 db N username password(or NULL) uuid
_user16() {
  local pw=$4; [ "$pw" = NULL ] || pw="'$4'"
  testdb.sh sql "$1" "insert into person(person_id,date_created,uuid,creator) values($2,now(),'p16-$2',1);
    insert into users(user_id,system_id,username,password,salt,person_id,date_created,creator,uuid,retired) values($2,'s$2','$3',$pw,'SALT-$2',$2,now(),1,'$5',0)"
}
_pwof() { testdb.sh sql tgt_db "select concat(ifnull(password,'NULL'),'/',ifnull(salt,'NULL')) from users where uuid='$1'"; }

_setup15() {
  local realdocker; realdocker=$(command -v docker)
  rm -rf "$WORKDIR/srv" "$WORKDIR/tsrv" "$WORKDIR/counts" "$WORKDIR/release" "$WORKDIR/docker.calls" "$WORKDIR/bin" "$WORKDIR/target-users-before-import.txt"
  mkdir -p "$WORKDIR/bin" "$WORKDIR/tsrv/exports" "$WORKDIR/counts"
  echo x > "$WORKDIR/counts/source-before.txt"; echo x > "$WORKDIR/counts/target-before.txt"; echo x > "$WORKDIR/counts/target-tables-before.txt"
  cat > "$WORKDIR/bin/docker" <<FAKE
#!/bin/bash
if [ "\$1" = run ]; then
  echo "\$@" >> $WORKDIR/docker.calls
  mkdir -p $WORKDIR/tsrv/exports/successful $WORKDIR/tsrv/exports/failed
  echo '{}' > $WORKDIR/tsrv/exports/successful/a_user.json; echo '{}' > $WORKDIR/tsrv/exports/failed/b_user.json
  echo "INFO All files processed."
  for i in \$(seq 1 100); do [ -e $WORKDIR/release ] && break; sleep 0.2; done
elif [ "\$1" = exec ]; then
  cat | $realdocker "\$@"
fi
FAKE
  chmod +x "$WORKDIR/bin/docker"
  cp tests/fixtures/test.env "$WORKDIR/l.env"
  { echo "SOURCE_SERVER_DIR=$WORKDIR/srv"; echo "TARGET_SERVER_DIR=$WORKDIR/tsrv"
    echo "SOURCE_DOCKER=$WORKDIR/bin/docker"; echo "TARGET_DOCKER=$WORKDIR/bin/docker"; } >> "$WORKDIR/l.env"
  export TMUX_TMPDIR="$WORKDIR"
  trap '_cleanup15' EXIT
  _clear16; _user16 tgt_db 1 daemon NULL "$(_h 1 1)"; _user16 tgt_db 2 alice NULL "$(_h 1 2)"
}
_cleanup15() { tmux -S "$WORKDIR/tmux-$(id -u)/default" kill-server >/dev/null 2>&1 || true; testdb.sh sql tgt_db "set global innodb_flush_log_at_trx_commit = 1" >/dev/null 2>&1 || true; _clear16; }
_run15() { out=$(printf '%s' "$1" | ./15-import-users.sh "$WORKDIR/l.env" 2>&1); rc=$?; }

test_import_users_saves_uuid_list_and_runs_node() { _skip_no_tmux && return 0; _setup15
  touch "$WORKDIR/release"
  _run15 $'y\ny\n'; assert_eq 0 $rc "$out"
  assert_eq "# target=local db=tgt_db source=TestSource" "$(head -n 1 "$WORKDIR/target-users-before-import.txt")"
  assert_eq "$(printf '%s\n%s' "$(_h 1 1)" "$(_h 1 2)")" "$(tail -n +2 "$WORKDIR/target-users-before-import.txt" | sort)"
  assert_eq 3 "$(wc -l < "$WORKDIR/target-users-before-import.txt" | tr -d ' ')"
  assert_contains "$out" "tmux session 'import-users'"
  assert_contains "$out" "-v $WORKDIR/tsrv:$WORKDIR/tsrv -w $WORKDIR/tsrv/repo/src mysql:5.6 node importUsers.js"
  assert_contains "$out" 'run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp --network host'
  assert_contains "$out" "import-users-console.log"
  assert_contains "$(cat "$WORKDIR/docker.calls")" "run --rm --user $(id -u):$(id -g) -e HOME=/tmp --network host"
  assert_contains "$(cat "$WORKDIR/tsrv/logs/import-users-console.log")" "All files processed"
  assert_contains "$out" "run again until no new users are created"
  assert_contains "$out" "Next: 16-copy-password-hashes.sh"; assert_contains "$out" "before anyone can log in"
}
test_import_users_keeps_existing_uuid_list() { _skip_no_tmux && return 0; _setup15
  printf '# target=local db=tgt_db source=TestSource\nkeepme\n' > "$WORKDIR/target-users-before-import.txt"; touch "$WORKDIR/release"
  _run15 $'y\ny\n'; assert_eq 0 $rc "$out"
  assert_eq keepme "$(tail -n 1 "$WORKDIR/target-users-before-import.txt")"
  assert_contains "$out" "Keeping the existing $WORKDIR/target-users-before-import.txt"
}
test_import_users_needs_counts_from_13() { _skip_no_tmux && return 0; _setup15
  rm -f "$WORKDIR/counts/target-tables-before.txt"
  _run15 $'y\ny\n'; assert_eq 2 $rc "$out"; assert_contains "$out" "run 13-export.sh first"
  [ ! -e "$WORKDIR/target-users-before-import.txt" ] || { echo "list written before the check"; exit 1; }
  _setup15; touch "$WORKDIR/release"
  _run15 $'y\ny\n'; assert_eq 0 $rc "$out"
  assert_contains "$out" "already saved by step 13 in $WORKDIR/counts"
}
test_import_users_refuses_list_from_other_target() { _skip_no_tmux && return 0; _setup15
  printf '# target=otherhost db=tgt_db\nxx\n' > "$WORKDIR/target-users-before-import.txt"
  _run15 $'y\ny\n'; assert_eq 2 $rc "$out"; assert_contains "$out" "is from another target"
  assert_eq xx "$(tail -n 1 "$WORKDIR/target-users-before-import.txt")"
  printf 'xx\n' > "$WORKDIR/target-users-before-import.txt"   # no header at all
  _run15 $'y\ny\n'; assert_eq 2 $rc "$out"
  assert_not_contains "$(tmux ls 2>&1 || true)" "import-users:"
}
test_cleanup_with_TMUX_set_leaves_other_servers_alone() { _skip_no_tmux && return 0
  local sock="$WORKDIR/sentinel.sock"
  tmux -S "$sock" new-session -d -s sentinel "sleep 60" || { echo "cannot start sentinel"; exit 1; }
  export TMUX_TMPDIR="$WORKDIR"
  ( export TMUX="$sock,1,0"; _cleanup15; _cleanup13 )
  tmux -S "$sock" has-session -t =sentinel || { echo "cleanup killed a tmux server it does not own"; tmux -S "$sock" kill-server; exit 1; }
  tmux -S "$sock" kill-server
}
test_flush_set_to_2_then_shown() { _skip_no_tmux && return 0; _setup15
  touch "$WORKDIR/release"
  _run15 $'y\ny\n'; assert_eq 0 $rc "$out"
  assert_contains "$out" "SET GLOBAL innodb_flush_log_at_trx_commit = 2"
  assert_contains "$out" "SELECT @@innodb_flush_log_at_trx_commit"
  assert_eq 2 "$(testdb.sh sql tgt_db 'select @@global.innodb_flush_log_at_trx_commit')"
  assert_contains "$out" "innodb_flush_log_at_trx_commit is now: 2"
  case "$out" in *"SET GLOBAL"*"SELECT @@innodb"*) ;; *) echo "flush shown before set"; exit 1 ;; esac
}
test_import_users_not_confirmed_changes_nothing() { _skip_no_tmux && return 0; _setup15
  _run15 $'n\n'; assert_eq 1 $rc "$out"
  assert_eq 1 "$(testdb.sh sql tgt_db 'select @@global.innodb_flush_log_at_trx_commit')"
  assert_not_contains "$(tmux ls 2>&1 || true)" "import-users:"
}
test_import_users_running_shows_progress_only() { _skip_no_tmux && return 0; _setup15
  tmux new-session -d -s import-users "sleep 30"
  mkdir -p "$WORKDIR/tsrv/exports/successful"; echo '{}' > "$WORKDIR/tsrv/exports/successful/a_user.json"
  _run15 ""; assert_eq 0 $rc "$out"
  assert_contains "$out" "The user import is running"; assert_contains "$out" "successful: 1"
  assert_not_contains "$out" "Proceed?"; assert_not_contains "$out" "Next:"
}
test_import_users_works_in_test_mode() { _skip_no_tmux && return 0; _setup15
  touch "$WORKDIR/release"
  _run15 $'y\ny\n'; assert_eq 0 $rc "$out"; assert_not_contains "$out" "Refused in test mode"
}

# ---- 16-copy-password-hashes ----
# src users: A(imported), D(imported), S-B (mapped to target T-B), C (daemon, exists in both).
_seed16() { _clear16
  _user16 src_db 1 ann HASHSEED-1 "$(_h 1 11)"; _user16 src_db 2 dan HASHSEED-2 "$(_h 1 12)"
  _user16 src_db 3 bob HASHSEED-3 "$(_h 1 13)"; _user16 src_db 4 daemon HASHSEED-4 "$(_h 1 14)"
  _user16 src_db 5 nopw NULL "$(_h 1 15)"
  _user16 tgt_db 1 ann RANDOM-1 "$(_h 1 11)"; _user16 tgt_db 2 dan RANDOM-2 "$(_h 1 12)"
  _user16 tgt_db 3 bobt TARGETHASH-B "$(_h 1 23)"; _user16 tgt_db 4 daemon TARGETHASH-C "$(_h 1 14)"
  _user16 tgt_db 5 nopw RANDOM-5 "$(_h 1 15)"
  printf '# target=local db=tgt_db source=TestSource\n%s\n\n%s\n' "$(_h 1 23)" "$(_h 1 14)" > "$WORKDIR/target-users-before-import.txt"
  cp tests/fixtures/test.env "$WORKDIR/l.env"
  trap '_clear16' EXIT
}
_run16() { out=$(printf '%s' "$1" | ./16-copy-password-hashes.sh "$WORKDIR/l.env" 2>&1); rc=$?; }

test_hash_copy_updates_imported_users_only() { _seed16
  _run16 $'y\n'; assert_eq 0 $rc "$out"
  assert_eq "HASHSEED-1/SALT-1" "$(_pwof "$(_h 1 11)")"
  assert_eq "HASHSEED-2/SALT-2" "$(_pwof "$(_h 1 12)")"
  assert_eq "RANDOM-5/SALT-5" "$(_pwof "$(_h 1 15)")"   # no hash on source: unchanged
  assert_contains "$out" "<hashes streamed from source>"
  assert_contains "$out" "Next:"
}
test_hash_copy_skips_mapped_users() { _seed16
  _run16 $'y\n'; assert_eq 0 $rc "$out"
  assert_eq "TARGETHASH-B/SALT-3" "$(_pwof "$(_h 1 23)")"
}
test_hash_copy_skips_preexisting_target_users() { _seed16
  _run16 $'y\n'; assert_eq 0 $rc "$out"
  assert_eq "TARGETHASH-C/SALT-4" "$(_pwof "$(_h 1 14)")"
}
test_hash_copy_output_has_no_hashes() { _seed16
  _run16 $'y\n'; assert_eq 0 $rc "$out"
  assert_not_contains "$out" "HASHSEED"; assert_not_contains "$out" "SALT-"
  assert_contains "$out" "Password hashes copied for 2 users"
  assert_eq 0 "$(grep -rl "HASHSEED\|SALT-\|TARGETHASH" "$WORKDIR/logs" 2>/dev/null | wc -l | tr -d ' ')"
}
test_hash_copy_nothing_written_to_workdir() { _seed16
  find "$WORKDIR" -type f ! -path "$WORKDIR/logs/*" | sort > "$WORKDIR/.before"
  _run16 $'y\n'; assert_eq 0 $rc "$out"
  find "$WORKDIR" -type f ! -path "$WORKDIR/logs/*" ! -name .before ! -name .after | sort > "$WORKDIR/.after"
  assert_eq "$(grep -v '\.before$' "$WORKDIR/.before")" "$(cat "$WORKDIR/.after")"
  assert_eq 0 "$(grep -rl "HASHSEED\|SALT-" "$WORKDIR" 2>/dev/null | grep -v '/\.\(before\|after\)$' | wc -l | tr -d ' ')"
}
test_hash_copy_refuses_without_before_list() { _seed16
  rm -f "$WORKDIR/target-users-before-import.txt"
  _run16 $'y\n'; assert_eq 1 $rc "$out"; assert_contains "$out" "run 15-import-users.sh first"
  assert_eq "RANDOM-1/SALT-1" "$(_pwof "$(_h 1 11)")"
}
test_hash_copy_refuses_list_without_or_with_wrong_header() { _seed16
  printf '%s\n' "$(_h 1 23)" > "$WORKDIR/target-users-before-import.txt"
  _run16 $'y\n'; assert_eq 2 $rc "$out"; assert_contains "$out" "belongs to another target"
  printf '# target=elsewhere db=tgt_db\n%s\n' "$(_h 1 23)" > "$WORKDIR/target-users-before-import.txt"
  _run16 $'y\n'; assert_eq 2 $rc "$out"
  assert_eq "RANDOM-1/SALT-1" "$(_pwof "$(_h 1 11)")"
}
test_hash_copy_not_confirmed_changes_nothing() { _seed16
  _run16 $'n\n'; assert_eq 1 $rc "$out"
  assert_eq "RANDOM-1/SALT-1" "$(_pwof "$(_h 1 11)")"
}
test_hash_copy_skippable_in_test_mode() { _seed16
  echo "SKIP_HASH_COPY_IN_TEST=true" >> "$WORKDIR/l.env"
  _run16 $'y\n'; assert_eq 0 $rc "$out"; assert_contains "$out" "skipped in test mode"
  assert_eq "RANDOM-1/SALT-1" "$(_pwof "$(_h 1 11)")"
}
test_hash_copy_runs_in_real_mode_even_with_skip_setting() { _seed16
  { echo MIGRATION_MODE=real; echo SKIP_HASH_COPY_IN_TEST=true; } >> "$WORKDIR/l.env"
  _run16 $'y\n'; assert_eq 0 $rc "$out"
  assert_eq "HASHSEED-1/SALT-1" "$(_pwof "$(_h 1 11)")"
}
# m6: the before-import list belongs to one target AND one source: a list from another site is refused by 15 and 16.
test_before_list_from_other_source_refused() { _seed16
  printf '# target=local db=tgt_db source=OtherSite\n%s\n' "$(_h 1 23)" > "$WORKDIR/target-users-before-import.txt"
  out=$(printf 'y\n' | ./16-copy-password-hashes.sh "$WORKDIR/l.env" 2>&1); assert_eq 2 $? "$out"; assert_contains "$out" "source=TestSource"
  _skip_no_tmux && return 0; _setup15
  printf '# target=local db=tgt_db source=OtherSite\nxx\n' > "$WORKDIR/target-users-before-import.txt"
  _run15 $'y\ny\n'; assert_eq 2 $rc "$out"; assert_contains "$out" "source=OtherSite"; assert_not_contains "$out" "Proceed?"
}
# m5: importUsers writes the target database: started as kind "cmd".
test_import_users_started_as_cmd_kind() { grep -q 'start_in_tmux tgt import-users cmd ' 15-import-users.sh || { echo "15 does not start importUsers as kind cmd"; exit 1; }
  grep -q 'start_in_tmux tgt import-patients cmd ' 17-import-patients.sh || { echo "17 does not start the imports as kind cmd"; exit 1; }; }
