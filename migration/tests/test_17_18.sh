# Tests for 17-import-patients and 18-copy-files (HAI-1309). Fake docker for the node runs (private
# tmux server); real python3 with the real tools/*.py for the file copy.

_have_tmux() { command -v tmux >/dev/null 2>&1; }
_skip_no_tmux() { _have_tmux || { echo "SKIP (tmux not installed)"; return 0; }; return 1; }

_cleanup17() { tmux -S "$WORKDIR/tmux-$(id -u)/default" kill-server >/dev/null 2>&1 || true; testdb.sh sql tgt_db "set global innodb_flush_log_at_trx_commit = 1" >/dev/null 2>&1 || true; }

_setup17() {
  rm -rf "$WORKDIR/srv" "$WORKDIR/tsrv" "$WORKDIR/release" "$WORKDIR/docker.calls" "$WORKDIR/bin" "$WORKDIR/sdata" "$WORKDIR/tdata"
  mkdir -p "$WORKDIR/bin" "$WORKDIR/tsrv/logs" "$WORKDIR/srv" "$WORKDIR/sdata" "$WORKDIR/tdata"
  ln -s "$(cd .. && pwd)" "$WORKDIR/srv/repo"; ln -s "$(cd .. && pwd)" "$WORKDIR/tsrv/repo"
  cat > "$WORKDIR/bin/docker" <<FAKE
#!/bin/bash
if [ "\$1" = run ]; then
  echo "\$@" >> $WORKDIR/docker.calls
  case "\$*" in
    *importPatients.js)
      echo "[t] INFO: Starting import of 3 patient files with batch size 5."
      echo "[t] INFO: Successfully processed patient from file a_patient.json"
      echo "[t] INFO: Successfully processed patient from file b_patient.json"
      echo "[t] INFO: File c_patient.json moved to /x/failed due to errors."
      echo "[t] INFO: Progress: 3/3 patients in 1s (3.00 patients/s)."
      printf '%s\n' "[t] error: Error processing file c: DrugOrder.quantity is required" "[t] error: Obs.value bad" "[t] error: Obs.value bad" "[t] error: request failed with status code 400" > $WORKDIR/tsrv/logs/app.log ;;
  esac
  for i in \$(seq 1 100); do [ -e $WORKDIR/release ] && break; sleep 0.2; done
elif [ "\$1" = exec ]; then
  cat | $(command -v docker) "\$@"
fi
FAKE
  chmod +x "$WORKDIR/bin/docker"
  cp tests/fixtures/test.env "$WORKDIR/l.env"
  { echo "SOURCE_SERVER_DIR=$WORKDIR/srv"; echo "TARGET_SERVER_DIR=$WORKDIR/tsrv"
    echo "SOURCE_DOCKER=$WORKDIR/bin/docker"; echo "TARGET_DOCKER=$WORKDIR/bin/docker"
    echo "SOURCE_DATA_DIR=$WORKDIR/sdata"; echo "TARGET_DATA_DIR=$WORKDIR/tdata"
    echo "COPY_DIRS=\"complex_obs storage person_images\""
    echo "TARGET_FILE_OWNER=$(id -un):$(id -gn)"; } >> "$WORKDIR/l.env"
  export TMUX_TMPDIR="$WORKDIR"
  trap '_cleanup17' EXIT
}
_run17() { out=$(printf '%s' "$1" | ./17-import-patients.sh "$WORKDIR/l.env" 2>&1); rc=$?; }
_run18() { out=$(printf '%s' "$1" | ./18-copy-files.sh "$WORKDIR/l.env" 2>&1); rc=$?; }
_wait17() { local i; for i in $(seq 1 100); do tmux_running tgt import-patients || return 0; sleep 0.2; done; echo "session did not end"; exit 1; }

test_failure_classes_extracted() { _skip_no_tmux && return 0; _setup17
  tmux new-session -d -s import-patients "sleep 30"
  cat > "$WORKDIR/tsrv/logs/app.log" <<'LOG'
[t] error: Error processing file x: DrugOrder.quantity is required
[t] error: Error processing file y: DrugOrder.quantity is required
[t] error: Obs.value bad
[t] error: request failed with status code 400
LOG
  _run17 ""; assert_eq 0 $rc "$out"
  assert_contains "$out" "2 DrugOrder.quantity"; assert_contains "$out" "1 Obs.value"; assert_contains "$out" "1 status code 400"
}
test_import_patients_running_shows_progress_only() { _skip_no_tmux && return 0; _setup17
  tmux new-session -d -s import-patients "sleep 30"
  printf '%s\n' "[t] INFO: Starting import of 10 patient files" "[t] INFO: Successfully processed patient from file a" "[t] INFO: Successfully processed patient from file b" "[t] INFO: File c moved to /x/failed due to errors." "[t] INFO: Progress: 3/10 patients in 1s" > "$WORKDIR/tsrv/logs/import-patients-console.log"
  _run17 ""; assert_eq 0 $rc "$out"
  assert_contains "$out" "successful: 2"; assert_contains "$out" "failed: 1"; assert_contains "$out" "left: 7"
  assert_not_contains "$out" "Proceed?"; assert_not_contains "$out" "Next:"
}
test_import_patients_refuses_while_import_users_runs() { _skip_no_tmux && return 0; _setup17
  tmux new-session -d -s import-users "sleep 30"
  _run17 $'y\ny\n'; assert_eq 1 $rc "$out"; assert_contains "$out" "import-users"
  assert_not_contains "$(tmux ls 2>&1 || true)" "import-patients:"
}
test_import_patients_runs_chain_then_finishes() { _skip_no_tmux && return 0; _setup17
  touch "$WORKDIR/release"
  _run17 $'y\n'; assert_eq 0 $rc "$out"
  assert_contains "$out" "tmux session 'import-patients'"
  assert_contains "$out" "node importProviders.js && "; assert_contains "$out" "node importRelationships.js"
  assert_contains "$out" "-v $WORKDIR/tsrv:$WORKDIR/tsrv -w $WORKDIR/tsrv/repo/src mysql:5.6 node importProviders.js"
  assert_contains "$out" "import-patients-console.log"
  _wait17
  assert_eq "importProviders.js importPatients.js importPatients.js importRelationships.js" "$(sed 's/.* node //' "$WORKDIR/docker.calls" | tr '\n' ' ' | sed 's/ $//')"
  testdb.sh sql tgt_db "set global innodb_flush_log_at_trx_commit = 2"
  _run17 $'y\n'; assert_eq 0 $rc "$out"
  assert_contains "$out" "SET GLOBAL innodb_flush_log_at_trx_commit = 1"
  assert_eq 1 "$(testdb.sh sql tgt_db 'select @@global.innodb_flush_log_at_trx_commit')"
  assert_contains "$out" "innodb_flush_log_at_trx_commit is now: 1"
  assert_contains "$out" "1 DrugOrder.quantity"
  assert_contains "$out" "Next: 18-copy-files.sh"
}
test_import_patients_not_confirmed_starts_nothing() { _skip_no_tmux && return 0; _setup17
  _run17 $'n\n'; assert_eq 1 $rc "$out"
  assert_not_contains "$(tmux ls 2>&1 || true)" "import-patients:"
}

# ---- 18 ----
_mk18() { mkdir -p "$WORKDIR/sdata/$1/2024"; echo "$2" > "$WORKDIR/sdata/$1/2024/$3"; }

test_copy_files_merges_into_same_named_dir() { _setup17
  _mk18 complex_obs one a.txt; _mk18 complex_obs two b.txt; _mk18 storage s s.txt
  mkdir -p "$WORKDIR/tdata/complex_obs/2024"; echo old > "$WORKDIR/tdata/complex_obs/2024/z.txt"
  _run18 $'y\ny\ny\ny\ny\ny\ny\ny\n'; assert_eq 0 $rc "$out"
  assert_eq one "$(cat "$WORKDIR/tdata/complex_obs/2024/a.txt")"; assert_eq two "$(cat "$WORKDIR/tdata/complex_obs/2024/b.txt")"
  assert_eq old "$(cat "$WORKDIR/tdata/complex_obs/2024/z.txt")"; assert_eq s "$(cat "$WORKDIR/tdata/storage/2024/s.txt")"
  [ ! -e "$WORKDIR/tdata/2024" ] || { echo "extracted into the parent"; exit 1; }
  assert_contains "$out" "complex_obs: source 2 files, target 3 files"
  assert_contains "$out" "storage: source 1 files, target 1 files"
  assert_contains "$out" "conflicts: 0"; assert_contains "$out" "Next: 19-verify.sh"
  assert_contains "$out" "create_archive.py --source-dir $WORKDIR/sdata/complex_obs --output $WORKDIR/srv/files-complex_obs.zip"
  assert_contains "$out" "merge_extract.py --zip $WORKDIR/tsrv/files-complex_obs.zip --dest-dir $WORKDIR/tdata/complex_obs --conflict-log $WORKDIR/tsrv/logs/conflicts-complex_obs.csv"
  assert_contains "$out" "chown -R $(id -un):$(id -gn) $WORKDIR/tdata/complex_obs"
}
test_copy_files_skips_missing_dir() { _setup17
  _mk18 storage s s.txt
  _run18 $'y\ny\ny\ny\n'; assert_eq 0 $rc "$out"
  assert_contains "$out" "complex_obs: skipped (not in $WORKDIR/sdata)"; assert_contains "$out" "person_images: skipped"
  assert_eq s "$(cat "$WORKDIR/tdata/storage/2024/s.txt")"
}
test_copy_files_conflict_not_overwritten() { _setup17
  _mk18 storage new s.txt; _mk18 storage other t.txt
  mkdir -p "$WORKDIR/tdata/storage/2024"; echo keep > "$WORKDIR/tdata/storage/2024/s.txt"
  _run18 $'y\ny\ny\ny\n'; assert_eq 0 $rc "$out"
  assert_eq keep "$(cat "$WORKDIR/tdata/storage/2024/s.txt")"; assert_eq other "$(cat "$WORKDIR/tdata/storage/2024/t.txt")"
  assert_contains "$out" "storage: conflicts: 1 (existing files were kept; see $WORKDIR/tsrv/logs/conflicts-storage.csv)"
}
test_copy_files_not_confirmed_changes_nothing() { _setup17
  _mk18 storage s s.txt
  _run18 $'y\nn\n'; assert_eq 1 $rc "$out"
  [ ! -e "$WORKDIR/tdata/storage" ] || { echo "target written"; exit 1; }
}
