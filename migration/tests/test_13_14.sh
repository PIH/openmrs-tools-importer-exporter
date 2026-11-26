# Tests for 13-export and 14-copy-exports. tmux tests use a private tmux server (TMUX_TMPDIR) and a
# fake docker (SOURCE_DOCKER) so no real export runs and no real tmux session is touched.

_have_tmux() { command -v tmux >/dev/null 2>&1; }
_skip_no_tmux() { _have_tmux || { echo "SKIP (tmux not installed)"; return 0; }; return 1; }

# _setup13: settings with separate server dirs, a fake docker. The fake "run" prints Export summary lines,
# writes one json per folder and then waits until $WORKDIR/release exists. "exec" passes through to the
# real docker (the test DB), except the object-count SQL, which the small test schema can't run.
_setup13() {
  local realdocker; realdocker=$(command -v docker)
  rm -rf "$WORKDIR/srv" "$WORKDIR/tsrv" "$WORKDIR/counts" "$WORKDIR/release" "$WORKDIR/docker.calls" "$WORKDIR/bin"
  mkdir -p "$WORKDIR/bin" "$WORKDIR/srv"
  cat > "$WORKDIR/bin/docker" <<FAKE
#!/bin/bash
if [ "\$1" = run ]; then
  echo "\$@" >> $WORKDIR/docker.calls
  mkdir -p $WORKDIR/srv/exports/users $WORKDIR/srv/exports/patients
  echo '{}' > $WORKDIR/srv/exports/users/u_1.json; echo '{}' > $WORKDIR/srv/exports/patients/p_1.json
  echo "Export summary: {\"exported\":1,\"failed\":0} in 1 s"
  for i in \$(seq 1 100); do [ -e $WORKDIR/release ] && break; sleep 0.2; done
elif [ "\$1" = exec ]; then
  in=\$(cat)
  case "\$in" in *@allergies*) echo "PATIENTS                  = 5" ;; *) printf '%s\n' "\$in" | $realdocker "\$@" ;; esac
fi
FAKE
  chmod +x "$WORKDIR/bin/docker"
  cp tests/fixtures/test.env "$WORKDIR/l.env"
  { echo "SOURCE_SERVER_DIR=$WORKDIR/srv"; echo "TARGET_SERVER_DIR=$WORKDIR/tsrv"
    echo "SOURCE_DOCKER=$WORKDIR/bin/docker"; echo "TARGET_DOCKER=$WORKDIR/bin/docker"; } >> "$WORKDIR/l.env"
  export TMUX_TMPDIR="$WORKDIR"
  trap '_cleanup13' EXIT
}
# Only ever the private server under TMUX_TMPDIR, addressed by its socket (never a bare kill-server).
_cleanup13() { tmux -S "$WORKDIR/tmux-$(id -u)/default" kill-server >/dev/null 2>&1 || true; }
_wait_session() { local i; for i in $(seq 1 50); do tmux has-session -t =export 2>/dev/null && return 0; sleep 0.1; done; return 1; }
_wait_gone() { local i; for i in $(seq 1 100); do tmux has-session -t =export 2>/dev/null || return 0; sleep 0.1; done; return 1; }
_run13() { out=$(printf '%s' "$1" | ./13-export.sh "$WORKDIR/l.env" 2>&1); rc=$?; }

test_export_starts_session_with_node_command() { _skip_no_tmux && return 0; _setup13
  _run13 $'y\n'; assert_eq 0 $rc "$out"
  _wait_session || { echo "session did not start: $out"; exit 1; }
  assert_contains "$out" "tmux session 'export'"
  assert_contains "$out" 'run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp --network host -v '
  assert_contains "$out" "-v $WORKDIR/srv:$WORKDIR/srv"
  assert_contains "$out" "-w $WORKDIR/srv/repo/src mysql:5.6 sh -c 'node exportUsers.js && node exportProviders.js && node exportPatients.js && node exportRelationships.js'"
  assert_contains "$out" "export-console.log"
  assert_contains "$out" "Next: 14-copy-exports.sh"
  for _ in $(seq 1 50); do [ -s "$WORKDIR/docker.calls" ] && break; sleep 0.1; done
  assert_contains "$(cat "$WORKDIR/docker.calls")" "run --rm --user $(id -u):$(id -g) -e HOME=/tmp --network host -v $WORKDIR/srv:$WORKDIR/srv -w $WORKDIR/srv/repo/src mysql:5.6 sh -c node exportUsers.js"
  touch "$WORKDIR/release"; _wait_gone
  assert_contains "$(cat "$WORKDIR/srv/logs/export-console.log")" "Export summary"
}
test_export_refuses_when_session_running_shows_progress() { _skip_no_tmux && return 0; _setup13
  _run13 $'y\n'; assert_eq 0 $rc "$out"; _wait_session
  for _ in $(seq 1 50); do grep -q "Export summary" "$WORKDIR/srv/logs/export-console.log" 2>/dev/null && break; sleep 0.1; done
  : > "$WORKDIR/docker.calls"
  _run13 ""; assert_eq 0 $rc "$out"
  assert_contains "$out" "The export is running"
  assert_contains "$out" 'Export summary: {"exported":1,"failed":0}'
  assert_contains "$out" "users: 1"; assert_contains "$out" "patients: 1"
  assert_not_contains "$out" "Proceed?"; assert_not_contains "$out" "Next:"
  assert_eq 0 "$(wc -c < "$WORKDIR/docker.calls" | tr -d ' ')"   # nothing started
  touch "$WORKDIR/release"; _wait_gone
}
test_export_saves_counts_and_keeps_existing() { _skip_no_tmux && return 0; _setup13
  _run13 $'y\n'; assert_eq 0 $rc "$out"; touch "$WORKDIR/release"; _wait_gone
  assert_contains "$(cat "$WORKDIR/counts/source-before.txt")" "PATIENTS"
  assert_contains "$(cat "$WORKDIR/counts/target-before.txt")" "PATIENTS"
  tab=$(printf '\t')
  assert_contains "$(cat "$WORKDIR/counts/target-tables-before.txt")" "${tab}"; grep -qE "^users${tab}[0-9]+\$" "$WORKDIR/counts/target-tables-before.txt" || { echo "no users row"; exit 1; }
  assert_not_contains "$(cat "$WORKDIR/counts/target-tables-before.txt")" "="
  echo keep > "$WORKDIR/counts/source-before.txt"; rm -f "$WORKDIR/release"
  _run13 $'r\ny\n'; assert_eq 0 $rc "$out"; _wait_session
  assert_contains "$out" "Keeping the existing"
  assert_eq keep "$(cat "$WORKDIR/counts/source-before.txt")"
  touch "$WORKDIR/release"; _wait_gone
}
test_export_rerun_after_finish_keeps_exports_clear_removes_them() { _skip_no_tmux && return 0; _setup13
  _run13 $'y\n'; assert_eq 0 $rc "$out"; touch "$WORKDIR/release"; _wait_gone
  rm -f "$WORKDIR/release"; echo '{}' > "$WORKDIR/srv/exports/users/old.json"
  _run13 $'r\ny\n'; assert_eq 0 $rc "$out"; _wait_session
  assert_contains "$out" "Found exports and/or logs"; assert_contains "$out" "Export summary: "
  [ -e "$WORKDIR/srv/exports/users/old.json" ] || { echo "re-run removed exports"; exit 1; }
  touch "$WORKDIR/release"; _wait_gone; rm -f "$WORKDIR/release"
  _run13 $'c\ny\ny\n'; assert_eq 0 $rc "$out"; _wait_session
  assert_contains "$out" "rm -rf"
  [ ! -e "$WORKDIR/srv/exports/users/old.json" ] || { echo "old export not cleared"; exit 1; }
  touch "$WORKDIR/release"; _wait_gone
}
test_export_stop_answer_changes_nothing() { _skip_no_tmux && return 0; _setup13
  mkdir -p "$WORKDIR/srv/exports/users"; echo '{}' > "$WORKDIR/srv/exports/users/a.json"
  _run13 $'n\n'; assert_eq 1 $rc "$out"
  [ -e "$WORKDIR/srv/exports/users/a.json" ] || { echo "cleared without asking"; exit 1; }
  assert_not_contains "$(tmux ls 2>&1 || true)" "export:"
}
test_export_clear_not_confirmed_keeps_files() { _skip_no_tmux && return 0; _setup13
  mkdir -p "$WORKDIR/srv/exports/users"; echo '{}' > "$WORKDIR/srv/exports/users/a.json"
  _run13 $'c\nn\n'; assert_eq 1 $rc "$out"
  [ -e "$WORKDIR/srv/exports/users/a.json" ] || { echo "cleared without confirm"; exit 1; }
}
test_export_runs_in_test_mode_on_source() { _skip_no_tmux && return 0; _setup13
  _run13 $'y\n'; assert_eq 0 $rc "$out"; assert_not_contains "$out" "Refused in test mode"
  touch "$WORKDIR/release"; _wait_gone
}

# Fixture: a finished export with review warnings in app.log and the two report CSVs.
# $1 = warning lines in app.log, then B rows in the review csv, C changed cases (one duplicated row) with a review note.
_seed_review() { local l="$WORKDIR/srv/logs" i; mkdir -p "$l" "$WORKDIR/srv/exports/users"; echo '{}' > "$WORKDIR/srv/exports/users/a.json"
  : > "$l/app.log"
  for i in $(seq 1 "$1"); do echo "[t] WARN: patient p$i dose left as it is (review)" >> "$l/app.log"; done
  echo "[t] INFO: unrelated line left as it is" >> "$l/app.log"   # not a warning: not counted
  printf 'rule,patient,list,uuid,details\n' > "$l/source-data-review.csv"
  for i in $(seq 1 "$2"); do printf 'r1,p%s,drugOrders,u%s,"multi\nline"\n' "$i" "$i" >> "$l/source-data-review.csv"; done
  printf 'rule,patient,list,uuid,field,from,to,review\n' > "$l/source-data-fixes.csv"
  for i in $(seq 1 "$3"); do printf 'r2,p%s,orders,c%s,f,1,2,"check it"\n' "$i" "$i" >> "$l/source-data-fixes.csv"; done
  [ "$3" -gt 0 ] && printf 'r2,p1,orders,c1,g,3,4,"check it"\n' >> "$l/source-data-fixes.csv"   # same case again: counted once
  printf 'r3,p9,orders,z9,f,1,2,\n' >> "$l/source-data-fixes.csv"   # no review note: not counted
  return 0; }
test_export_review_check_adds_up() { _skip_no_tmux && return 0; _setup13; _seed_review 5 2 3
  _run13 $'y\nx\n'; assert_eq 1 $rc "$out"
  assert_contains "$out" "review warnings in export app.log: 5; rows in source-data-review*.csv: 2; changed cases with a review note in source-data-fixes*.csv: 3 (B + C should equal A)"
  assert_not_contains "$out" "DOES NOT ADD UP"
}
test_export_review_check_mismatch_reports_only() { _skip_no_tmux && return 0; _setup13; _seed_review 6 2 3
  _run13 $'y\nx\n'; assert_eq 1 $rc "$out"   # 1 = our "x" stop answer, not a failure of the check
  assert_contains "$out" "review warnings in export app.log: 6; rows in source-data-review*.csv: 2; changed cases with a review note in source-data-fixes*.csv: 3"
  assert_contains "$out" "DOES NOT ADD UP"
}
test_export_review_check_unreadable_csv_skips_comparison() { _skip_no_tmux && return 0; _setup13; _seed_review 2 1 1
  printf 'rule,patient,list,uuid\nr2,p1,orders,c1\n' > "$WORKDIR/srv/logs/source-data-fixes.csv"   # no review column
  _run13 $'y\nx\n'; assert_eq 1 $rc "$out"
  assert_contains "$out" "could not read the report CSVs"; assert_not_contains "$out" "DOES NOT ADD UP"
}
test_export_renames_csvs_with_site_idempotent() { _skip_no_tmux && return 0; _setup13; _seed_review 1 1 0
  _run13 $'y\nx\n'; assert_eq 1 $rc "$out"
  local l="$WORKDIR/srv/logs"
  [ -f "$l/source-data-review-TestSource.csv" ] && [ -f "$l/source-data-fixes-TestSource.csv" ] || { echo "not renamed: $(ls "$l")"; exit 1; }
  [ ! -e "$l/source-data-review.csv" ] || { echo "old name left"; exit 1; }
  assert_contains "$out" "source-data-review.csv"
  _run13 $'x\n'; assert_eq 1 $rc "$out"   # nothing to rename: no confirmation asked, the answer goes to the r/c prompt
  assert_not_contains "$out" "Proceed?"
  assert_eq "" "$(ls "$l" | grep 'TestSource-TestSource' || true)"
  # a re-run wrote a new unsuffixed file: its rows are appended, the file goes away
  printf 'r1,p7,drugOrders,u7,more\n' > "$WORKDIR/x.csv"; { echo 'rule,patient,list,uuid,details'; cat "$WORKDIR/x.csv"; } > "$l/source-data-review.csv"
  _run13 $'y\nx\n'; assert_eq 1 $rc "$out"
  [ ! -e "$l/source-data-review.csv" ] || { echo "old name left"; exit 1; }
  assert_eq 4 "$(wc -l < "$l/source-data-review-TestSource.csv" | tr -d ' ')"   # header + the multi-line row (2 lines) + the appended row
}

# ---- 14-copy-exports ----
_setup14() {
  rm -rf "$WORKDIR/srv" "$WORKDIR/tsrv"
  mkdir -p "$WORKDIR/srv/exports/users" "$WORKDIR/srv/exports/patients" "$WORKDIR/srv/exports/empty dir"
  echo a > "$WORKDIR/srv/exports/users/u1.json"; echo b > "$WORKDIR/srv/exports/users/u2.json"
  echo c > "$WORKDIR/srv/exports/patients/p1.json"
  cp tests/fixtures/test.env "$WORKDIR/l.env"
  { echo "SOURCE_SERVER_DIR=$WORKDIR/srv"; echo "TARGET_SERVER_DIR=$WORKDIR/tsrv"; } >> "$WORKDIR/l.env"
  export TMUX_TMPDIR="$WORKDIR"
  trap '_cleanup13' EXIT
}
_run14() { out=$(printf '%s' "$1" | ./14-copy-exports.sh "$WORKDIR/l.env" 2>&1); rc=$?; }

test_copy_exports_counts_match() { _setup14
  _run14 $'y\n'; assert_eq 0 $rc "$out"
  assert_eq b "$(cat "$WORKDIR/tsrv/exports/users/u2.json")"
  assert_contains "$out" "tar c -C $WORKDIR/srv exports"
  assert_contains "$out" "mkdir -p $WORKDIR/tsrv && tar x -C $WORKDIR/tsrv"
  assert_contains "$out" "File counts match"; assert_contains "$out" "Next: 15-import-users.sh"
}
test_copy_exports_mismatch_fails() { _setup14
  mkdir -p "$WORKDIR/tsrv/exports/users"; echo stale > "$WORKDIR/tsrv/exports/users/leftover.json"
  _run14 $'y\n'; assert_eq 1 $rc "$out"
  assert_contains "$out" "users (source 2, target 3)"; assert_not_contains "$out" "patients ("
  assert_not_contains "$out" "Next:"
}
test_copy_exports_not_confirmed_copies_nothing() { _setup14
  _run14 $'n\n'; assert_eq 1 $rc "$out"; [ ! -e "$WORKDIR/tsrv" ] || { echo "copied without confirm"; exit 1; }
}
test_copy_exports_refuses_while_export_running() { _skip_no_tmux && return 0; _setup14
  tmux new-session -d -s export "sleep 30"
  _run14 $'y\n'; assert_eq 1 $rc "$out"; assert_contains "$out" "still running"
  [ ! -e "$WORKDIR/tsrv" ] || { echo "copied while running"; exit 1; }
}
test_copy_exports_without_exports_fails() { _setup14
  rm -rf "$WORKDIR/srv/exports"
  _run14 $'y\n'; assert_eq 1 $rc "$out"; assert_contains "$out" "run 13-export.sh first"
}
test_copy_exports_works_in_test_mode() { _setup14
  _run14 $'y\n'; assert_eq 0 $rc "$out"; assert_not_contains "$out" "Refused in test mode"
}
