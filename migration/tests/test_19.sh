# Tests for 19-verify (HAI-1309). Fake docker (private tmux server): "run" records the call and waits for
# $WORKDIR/release; "exec" goes to the real test DB except the object-count SQL (the small test schema can't run it).

_have_tmux() { command -v tmux >/dev/null 2>&1; }
_skip_no_tmux() { _have_tmux || { echo "SKIP (tmux not installed)"; return 0; }; return 1; }
_cleanup19() { tmux -S "$WORKDIR/tmux-$(id -u)/default" kill-server >/dev/null 2>&1 || true; }

_setup19() {
  local realdocker; realdocker=$(command -v docker)
  rm -rf "$WORKDIR/tsrv" "$WORKDIR/counts" "$WORKDIR/release" "$WORKDIR/docker.calls" "$WORKDIR/bin"
  mkdir -p "$WORKDIR/bin" "$WORKDIR/tsrv/logs" "$WORKDIR/counts"
  cat > "$WORKDIR/bin/docker" <<FAKE
#!/bin/bash
if [ "\$1" = run ]; then
  echo "\$@" >> $WORKDIR/docker.calls
  case "\$*" in *verifyComplexObs.js) echo "[t] INFO: Complex obs check: 2 checked, 1 missing" ;; *verifyPatients.js) echo "[t] INFO: ✅ Patient a verified successfully."; echo "[t] WARN: ⚠️  Verification failed for patient b. Differences:" ;; esac
  for i in \$(seq 1 100); do [ -e $WORKDIR/release ] && break; sleep 0.2; done
elif [ "\$1" = exec ]; then
  in=\$(cat)
  case "\$in" in *@allergies*) echo "PATIENTS                  = 7" ;; *) printf '%s\n' "\$in" | $realdocker "\$@" ;; esac
fi
FAKE
  chmod +x "$WORKDIR/bin/docker"
  cp tests/fixtures/test.env "$WORKDIR/l.env"
  { echo "TARGET_SERVER_DIR=$WORKDIR/tsrv"; echo "TARGET_DOCKER=$WORKDIR/bin/docker"; } >> "$WORKDIR/l.env"
  export TMUX_TMPDIR="$WORKDIR"
  trap '_cleanup19' EXIT
}
_run19() { out=$(printf '%s' "$1" | ./19-verify.sh "$WORKDIR/l.env" 2>&1); rc=$?; }
_wait19() { local i; for i in $(seq 1 100); do tmux_running tgt verify || return 0; sleep 0.2; done; echo "session did not end"; exit 1; }

test_verify_runs_all_verifiers_in_order_with_semicolons() { _skip_no_tmux && return 0; _setup19
  touch "$WORKDIR/release"
  _run19 $'y\n'; assert_eq 0 $rc "$out"
  assert_contains "$out" "tmux session 'verify'"
  assert_contains "$out" "node verifyPatients.js; "; assert_contains "$out" "node verifyComplexObs.js"
  _wait19
  assert_eq "verifyPatients.js verifyRelationships.js verifyUsers.js verifyComplexObs.js" "$(sed 's/.* node //' "$WORKDIR/docker.calls" | tr '\n' ' ' | sed 's/ $//')"
  assert_contains "$(cat "$WORKDIR/docker.calls")" "-v $WORKDIR/tsrv:$WORKDIR/tsrv -w $WORKDIR/tsrv/repo/src mysql:5.6 node verifyPatients.js"
  assert_contains "$(cat "$WORKDIR/tsrv/logs/verify-console.log")" "Complex obs check: 2 checked, 1 missing"
  [ -f "$WORKDIR/tsrv/logs/verify.done" ] || { echo "no marker"; exit 1; }
}
test_verify_earlier_imports_rerun_verify_users_with_their_settings() { _skip_no_tmux && return 0; _setup19
  echo "EARLIER_IMPORTS='$WORKDIR/tsrv/old/one|$WORKDIR/tsrv/old/one-users.txt|aaaa;$WORKDIR/tsrv/old/two|$WORKDIR/tsrv/old/two-users.txt|bbbb'" >> "$WORKDIR/l.env"
  touch "$WORKDIR/release"
  _run19 $'y\n'; assert_eq 0 $rc "$out"; _wait19
  assert_eq "verifyPatients.js verifyRelationships.js verifyUsers.js verifyComplexObs.js verifyUsers.js verifyUsers.js" "$(sed 's/.* node //' "$WORKDIR/docker.calls" | tr '\n' ' ' | sed 's/ $//')"
  local calls; calls=$(cat "$WORKDIR/docker.calls")
  assert_contains "$calls" "-e TARGET_DIR=$WORKDIR/tsrv/old/one -e EXPORT_USER_MAPPINGS_FILE=$WORKDIR/tsrv/old/one-users.txt -e OPENMRS_SOURCE_FACILITY_UUID=aaaa --network host"
  assert_contains "$calls" "-e TARGET_DIR=$WORKDIR/tsrv/old/two -e EXPORT_USER_MAPPINGS_FILE=$WORKDIR/tsrv/old/two-users.txt -e OPENMRS_SOURCE_FACILITY_UUID=bbbb --network host"
}
test_verify_earlier_import_outside_server_dir_refused() { _skip_no_tmux && return 0; _setup19
  echo "EARLIER_IMPORTS='$WORKDIR/tsrv/old|/elsewhere/users.txt|aaaa'" >> "$WORKDIR/l.env"
  _run19 $'y\ny\n'; assert_eq 2 $rc "$out"
  assert_contains "$out" "/elsewhere/users.txt"; assert_contains "$out" "not under TARGET_SERVER_DIR"
  assert_not_contains "$(tmux ls 2>&1 || true)" "verify:"; [ ! -s "$WORKDIR/docker.calls" ] || { echo "something started"; exit 1; }
}
test_verify_running_shows_progress_only() { _skip_no_tmux && return 0; _setup19
  tmux new-session -d -s verify "sleep 30"
  echo "[t] INFO: something" > "$WORKDIR/tsrv/logs/verify-console.log"
  _run19 ""; assert_eq 0 $rc "$out"
  assert_contains "$out" "something"; assert_not_contains "$out" "Proceed?"; assert_not_contains "$out" "Next:"
  [ ! -s "$WORKDIR/docker.calls" ] || { echo "something started"; exit 1; }
}
test_verify_not_confirmed_starts_nothing() { _skip_no_tmux && return 0; _setup19
  _run19 $'n\n'; assert_eq 1 $rc "$out"
  assert_not_contains "$(tmux ls 2>&1 || true)" "verify:"
}
test_verify_prints_csv_row_counts() { _skip_no_tmux && return 0; _setup19
  local l="$WORKDIR/tsrv/logs"
  printf 'h\n1\n2\n3\n' > "$l/source-data-fixes.csv"; printf 'h\n1\n' > "$l/source-data-fixes-2.csv"
  printf 'h\n' > "$l/verify-users.csv"; printf 'obs_uuid,http_status\nu1,404\n' > "$l/complex-obs-missing.csv"
  touch "$l/verify.done"; echo "[t] INFO: ✅ Patient a verified successfully." > "$l/verify-console.log"
  printf 'PATIENTS                  = 5\n' > "$WORKDIR/counts/source-before.txt"; printf 'PATIENTS                  = 1\n' > "$WORKDIR/counts/target-before.txt"
  testdb.sh sql tgt_db "select 1" >/dev/null
  printf 'users\t99\n' > "$WORKDIR/counts/target-tables-before.txt"
  _run19 $'y\nn\n'; assert_eq 0 $rc "$out"   # y: add the site name to the CSV names
  assert_contains "$out" "source-data-fixes-TestSource.csv: 3 rows"; assert_contains "$out" "source-data-fixes-2-TestSource.csv: 1 rows"
  assert_contains "$out" "verify-users-TestSource.csv: 0 rows"; assert_contains "$out" "complex-obs-missing-TestSource.csv: 1 rows"
  assert_contains "$out" "source-data-review*.csv: absent"; assert_contains "$out" "visits-before-birthdate*.csv: absent"; assert_contains "$out" "invalid-identifiers*.csv: absent"
  assert_contains "$out" "patients verified OK: 1"
  assert_contains "$out" "PATIENTS"; assert_contains "$out" "7"
  [ -s "$WORKDIR/counts/target-tables-after.txt" ] || { echo "no after snapshot"; exit 1; }
  assert_contains "$out" "users"          # the table-count diff shows users changed from 99
  assert_contains "$out" "Next: 20-rebuild-index.sh"
}

_finished19() { local l="$WORKDIR/tsrv/logs"; touch "$l/verify.done"; echo "[t] INFO: ok" > "$l/verify-console.log"
  printf 'PATIENTS                  = 5\n' > "$WORKDIR/counts/source-before.txt"; printf 'PATIENTS                  = 1\n' > "$WORKDIR/counts/target-before.txt"
  printf 'users\t99\n' > "$WORKDIR/counts/target-tables-before.txt"; }
test_verify_prints_verified_failed_not_verified_counts() { _skip_no_tmux && return 0; _setup19; _finished19
  local e="$WORKDIR/tsrv/exports"; mkdir -p "$e/verified" "$e/failed_verification" "$e/successful"
  touch "$e/verified/a_patient.json" "$e/verified/b_patient.json" "$e/verified/c_patient.json" "$e/verified/notes.txt" "$e/failed_verification/d_patient.json" "$e/successful/e_patient.json" "$e/successful/f_patient.json"
  _run19 $'n\n'; assert_eq 0 $rc "$out"
  assert_contains "$out" "verify: verified 3, failed verification 1, not verified 2"
}
test_verify_counts_zero_when_folders_missing() { _skip_no_tmux && return 0; _setup19; _finished19
  _run19 $'n\n'; assert_eq 0 $rc "$out"
  assert_contains "$out" "verify: verified 0, failed verification 0, not verified 0"
}
test_verify_renames_csvs_with_site_idempotent() { _skip_no_tmux && return 0; _setup19; _finished19
  local l="$WORKDIR/tsrv/logs"
  printf 'h\n1\n2\n' > "$l/source-data-fixes.csv"; printf 'h\n1\n' > "$l/invalid-identifiers-TestSource.csv"; printf 'h\n1\n' > "$l/verify-users.csv"
  _run19 $'y\nn\n'; assert_eq 0 $rc "$out"
  [ -f "$l/source-data-fixes-TestSource.csv" ] && [ -f "$l/verify-users-TestSource.csv" ] && [ ! -e "$l/source-data-fixes.csv" ] || { echo "not renamed: $(ls "$l")"; exit 1; }
  assert_contains "$out" "source-data-fixes-TestSource.csv: 2 rows"; assert_contains "$out" "invalid-identifiers-TestSource.csv: 1 rows"
  assert_eq "" "$(ls "$l" | grep 'TestSource-TestSource' || true)"
  _run19 $'n\n'; assert_eq 0 $rc "$out"   # nothing to rename now: no extra confirmation
  assert_not_contains "$out" "CSV reports without the site name"
  assert_eq "" "$(ls "$l" | grep 'TestSource-TestSource' || true)"
  assert_contains "$out" "source-data-fixes-TestSource.csv: 2 rows"
}
# I3: 19 does not start while an import runs.
test_verify_refuses_while_import_runs() { _skip_no_tmux && return 0
  for s in import-users import-patients; do _setup19
    tmux new-session -d -s "$s" "sleep 30"
    _run19 $'y\n'; assert_eq 1 $rc "$out ($s)"; assert_contains "$out" "'$s'"; assert_not_contains "$out" "Proceed?"
    [ ! -e "$WORKDIR/docker.calls" ] || { echo "started"; exit 1; }
    _cleanup19
  done
}
# m3: a failed complex obs check shows in the summary (and an absent complex-obs-missing CSV means it did not run).
test_verify_shows_failed_complex_obs_check() { _skip_no_tmux && return 0; _setup19; _finished19
  echo "Complex obs check failed: connect ECONNREFUSED" >> "$WORKDIR/tsrv/logs/verify-console.log"
  _run19 $'n\n'; assert_eq 0 $rc "$out"
  assert_contains "$out" "Complex obs check failed: connect ECONNREFUSED"
  assert_contains "$out" "complex-obs-missing*.csv: absent"
}
