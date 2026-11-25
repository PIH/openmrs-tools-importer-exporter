# Migration Scripts (HAI-1309) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Numbered bash scripts (`migration/00-…` to `migration/24-…`) plus a README that walk a person through merging a source OpenMRS server into ZL Central, step by step, each printing its commands and asking before every write.

**Architecture:** Every script runs on the operator's laptop and acts on the servers over SSH (or directly when a host is `local`). A shared `migration/lib.sh` holds settings loading, the SQL/command runners, the confirm prompt, the test-mode write guard and logging. Long node runs (export, import, verify) are started in `tmux` on the server inside a `node:22` container against a git checkout of this repo. Data crossing servers is piped through the laptop.

**Tech Stack:** bash (GNU + macOS compatible), ssh, docker, MySQL 5.6 client in the server containers, tmux, existing node scripts in `src/`, python3 for `tools/create_archive.py` / `tools/merge_extract.py`, 7z.

**Spec:** `docs/superpowers/specs/2026-11-25-migration-scripts-design.md` — read it first; this plan does not repeat its reasoning.

## Global Constraints

- Scripts numbered without gaps: `00-create-settings.sh` … `24-archive-and-clean.sh`, names exactly as in the File Structure below.
- Every write to a server or database: print the exact command/SQL, then `confirm`; there is **no** `--yes` / non-interactive bypass.
- `MIGRATION_MODE=test`: any write to the source (SQL or service command) is refused inside `lib.sh`; source-only scripts (03, 04, 08, 23) print "skipped in test mode" and exit 0.
- Never print, log or write to a file: password hashes/salts, OpenMRS or MySQL passwords, user or patient rows. Scripts print counts and uuids only (uuids of failures are OK; usernames only in the mapping files the importer needs and the review lists the operator must read, which stay in the laptop work dir).
- Nothing tied to one machine: no hardcoded paths, hostnames, usernames, container names; everything from the settings file. Default values copied from wiki v126 are allowed as defaults.
- Settings file lives outside the repo; path from `MIGRATION_ENV` or the first argument.
- Retire reasons exactly: source `Migrating from <SOURCE_NAME>`; target `Temp - migrating data`. Target lock keeps the migrating user and `ccIntegrationUser`.
- UnknownProvider line, always appended to provider mappings: `f9badd80-ab76-11e2-9e96-0800200c9a66 UnknownProvider,f9badd80-ab76-11e2-9e96-0800200c9a66`.
- Mapping file line format: `<source-uuid> <label>,<target-uuid>`.
- The comment that servers can't SSH to each other *at the moment*, that this may change and is to be researched with IT, sits on `pipe_src_to_tgt` in `lib.sh` and in the README.
- No changes to existing export/import/verify logic in `src/`; only the new `src/verifyComplexObs.js` (Task 12).
- Tests never touch `mysql-openmrs` or any SDK server while a migration test run may be running; DB tests use their own throwaway container `hai1309-test-mysql` (image `mysql:5.6`).

## Review Focus

1. **Settings file with a missing or empty value** → the script stops before doing anything, naming the setting (test in Task 1: `test_require_settings_names_missing`).
2. **A remote command fails halfway (ssh drops, SQL error)** → the script stops with a non-zero exit and says which step failed; it never prints the "next step" footer (Task 1: `test_failed_sql_stops_script`).
3. **Re-running a script** (operator re-runs after a fix) → safe: lock scripts report "0 users to retire", mapping scripts overwrite their output files, export re-run only retries failures (Tasks 4, 6, 9: `test_lock_source_rerun_is_noop`, `test_mappings_rerun_overwrites`).
4. **Usernames/emails with different case or surrounding spaces** → email matching is trimmed and case-insensitive; usernames follow MySQL's column collation (Task 6: `test_email_match_ignores_case_and_spaces`).
5. **Source users whose uuid already exists on the target before the import (e.g. `daemon`)** → never get their hash overwritten (Task 10: `test_hash_copy_skips_preexisting_target_users`).

---

## File Structure

```
migration/
  README.md                         source of truth for the steps (Task 15)
  lib.sh                            shared helpers (Task 1)
  migration.env.example             all settings, commented (Task 2)
  sql/unsupported-data.sql          counts for the unsupported-data check (Task 3)
  sql/object-counts.sql             copy of tools/omrs_object_count.sql use, or call it directly (Task 9)
  00-create-settings.sh             Task 2
  01-preflight.sh                   Task 3
  02-check-source-data.sh           Task 3
  03-lock-source.sh                 Task 4
  04-backup-source.sh               Task 4
  05-lock-target.sh                 Task 4
  06-backup-target.sh               Task 4
  07-prepare-target.sh              Task 5
  08-check-no-sessions.sh           Task 4
  09-build-user-mappings.sh         Task 6
  10-build-concept-name-mappings.sh Task 7
  11-build-lists.sh                 Task 8
  12-setup-servers.sh               Task 8
  13-export.sh                      Task 9
  14-copy-exports.sh                Task 9
  15-import-users.sh                Task 10
  16-copy-password-hashes.sh        Task 10
  17-import-patients.sh             Task 11
  18-copy-files.sh                  Task 11
  19-verify.sh                      Task 12
  20-rebuild-index.sh               Task 13
  21-spot-checks.sh                 Task 13
  22-open-target.sh                 Task 14
  23-shutdown-source.sh             Task 14
  24-archive-and-clean.sh           Task 14
  tests/run.sh                      test runner + assert helpers (Task 1)
  tests/testdb.sh                   start/seed/stop hai1309-test-mysql (Task 1)
  tests/fixtures/schema.sql         OpenMRS schema subset, no data (Task 1)
  tests/test_*.sh                   one file per task
src/verifyComplexObs.js             Task 12
README.md                           one paragraph pointing to migration/README.md (Task 15)
```

## Shared interfaces (defined in Task 1, used everywhere)

```
load_settings [file]            # sources the settings file; exports all; sets WORKDIR/logs; starts log tee
require_settings NAME...        # exits 2 naming the first unset/empty one
run_on src|tgt CMD              # runs CMD via `ssh $SOURCE_HOST` / `ssh $TARGET_HOST`, or `bash -c` when host is "local"
src_sql SQL / tgt_sql SQL       # read-only query, prints SQL first (dimmed), returns -N -B tab output on stdout
src_sql_write SQL / tgt_sql_write SQL   # prints SQL, confirm, runs; src_* refuses in test mode (exit 3)
src_cmd_write CMD / tgt_cmd_write CMD   # same for shell commands (restarts, rm, docker compose)
confirm "what this changes"     # prints, reads y/N from /dev/tty; anything but y/yes exits 1
pipe_src_to_tgt SRC_CMD TGT_CMD # run_on src SRC_CMD | run_on tgt TGT_CMD; laptop never stores it
start_in_tmux src|tgt SESSION CMD   # starts CMD detached in tmux on that host; refuses if SESSION already running
tmux_running src|tgt SESSION    # exit 0 if the session exists
step_header "NN" "title"        # prints title, MIGRATION_MODE, source → target
next_step "NN-name.sh" "check first"   # footer; only printed on success
skip_in_test_mode "reason"      # prints "skipped in test mode: reason", exit 0
```

MySQL access: `docker exec -i <container> sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B "$0"' <db>` — the password comes from the container's own environment and never crosses the network or appears in `ps`. Setting `SOURCE_MYSQL_AUTH` / `TARGET_MYSQL_AUTH` = `container-env` (default) or `prompt` (read once with `read -s`, passed with `docker exec -e MYSQL_PWD`). Docker prefix per host: `SOURCE_DOCKER` / `TARGET_DOCKER` (default `sudo docker`; tests and laptop use `docker`).

---

### Task 1: Test harness and `lib.sh`

**Files:**
- Create: `migration/lib.sh`, `migration/tests/run.sh`, `migration/tests/testdb.sh`, `migration/tests/fixtures/schema.sql`, `migration/tests/test_lib.sh`

**Interfaces:**
- Produces: everything in "Shared interfaces" above; `tests/run.sh [test_file...]` runs every `test_*` function in `tests/test_*.sh`, each in a subshell, prints PASS/FAIL per test and exits non-zero on any failure; helpers `assert_eq EXPECTED ACTUAL [msg]`, `assert_contains HAYSTACK NEEDLE`, `assert_not_contains`, `assert_exit CODE CMD...`. `tests/testdb.sh up|seed FILE DB|sql DB SQL|down`; `up` creates container `hai1309-test-mysql` (`mysql:5.6`, `MYSQL_ROOT_PASSWORD=test`) and databases `src_db`, `tgt_db` from `schema.sql`; tests get a settings file `tests/fixtures/test.env` (both hosts `local`, both containers `hai1309-test-mysql`, `*_DOCKER=docker`).

- [ ] **Step 1: Generate `tests/fixtures/schema.sql`** with `mysqldump --no-data --skip-add-drop-table` of these tables from a local OpenMRS 2.8 DB (only when no import test is running): `users, user_property, user_role, person, person_name, person_attribute, person_attribute_type, patient, provider, location, concept, concept_name, obs, encounter, relationship, idgen_seq_id_gen, idgen_identifier_source, global_property, appointmentscheduling_appointment, patient_appointment, conditions, encounter_diagnosis, note, paperrecord_paper_record, users_session_log`-equivalent tables that exist. Strip `AUTO_INCREMENT=` values and foreign keys (fixtures stay small). Record in a header comment which tables didn't exist (see Task 3 note).

- [ ] **Step 2: Write failing tests in `tests/test_lib.sh`**

```bash
test_require_settings_names_missing() { out=$( (FOO=; require_settings FOO) 2>&1 ); assert_eq 2 $?; assert_contains "$out" "FOO"; }
test_run_on_local_runs_directly()    { assert_eq "hi" "$(run_on src 'echo hi')"; }
test_src_sql_prints_sql_and_returns_rows() { out=$(src_sql "select 1+1" 2>&1); assert_contains "$out" "select 1+1"; assert_contains "$out" "2"; }
test_confirm_no_exits_1()            { assert_exit 1 bash -c 'source lib.sh; confirm x </dev/null'; }   # no tty → treated as "no"
test_test_mode_blocks_source_writes() { MIGRATION_MODE=test; assert_exit 3 src_sql_write "update users set retired=1"; assert_eq 0 "$(testdb.sh sql src_db 'select count(*) from users where retired=1')"; }
test_test_mode_allows_target_writes() { MIGRATION_MODE=test; yes | tgt_sql_write "insert into global_property(property,property_value,uuid) values('t','v',uuid())"; assert_eq 1 "$(testdb.sh sql tgt_db "select count(*) from global_property where property='t'")"; }
test_failed_sql_stops_script()       { out=$(bash -c 'source lib.sh; load_settings tests/fixtures/test.env; src_sql "select * from nope"; next_step 99-x.sh ok' 2>&1); assert_not_contains "$out" "99-x.sh"; }
test_log_never_contains_mysql_password() { load_settings tests/fixtures/test.env; src_sql "select 1" >/dev/null; assert_not_contains "$(cat "$WORKDIR"/logs/*.log)" "test"; }   # root pw is "test"
test_pipe_src_to_tgt_streams()       { assert_eq "abc" "$(pipe_src_to_tgt 'echo abc' 'cat')"; }
```

`confirm` reads from `/dev/tty`; for tests it honours `MIGRATION_CONFIRM_INPUT=/dev/stdin` (test-only variable, documented as such, never in the example settings file). Rename the password-leak check's needle if `test` collides with other log text (use a distinctive password like `pw-9f3k`).

- [ ] **Step 3: Run `migration/tests/run.sh tests/test_lib.sh`** — expected: FAIL (lib.sh missing).

- [ ] **Step 4: Implement `tests/run.sh`, `tests/testdb.sh`, `lib.sh`** per the interfaces. `set -euo pipefail` in every script that sources lib; `lib.sh` installs an `ERR` trap that prints `FAILED in <script> at line N` and exits non-zero. Logging: `exec > >(tee -a "$WORKDIR/logs/<script>.<timestamp>.log") 2>&1` after settings load. The `pipe_src_to_tgt` comment text: "Source and target servers can't SSH to each other at the moment, so cross-server data goes through this laptop. This may change (to research with IT); if it does, this can become a direct ssh/scp between the servers."

- [ ] **Step 5: Run tests** — expected: all PASS. Also `bash -n migration/*.sh`.

- [ ] **Step 6: Commit** `git add migration/lib.sh migration/tests && git commit -m "HAI-1309: migration lib.sh and test harness"`

---

### Task 2: Settings — `migration.env.example`, `00-create-settings.sh`

**Files:** Create `migration/migration.env.example`, `migration/00-create-settings.sh`, `migration/tests/test_00_settings.sh`

**Interfaces:**
- Produces settings names used by all later tasks (exact names): `MIGRATION_MODE` (test|real), `SOURCE_NAME` (e.g. `hsn`), `SOURCE_HOST`, `TARGET_HOST` (ssh alias or `local`), `SOURCE_DOCKER`, `TARGET_DOCKER`, `SOURCE_MYSQL_CONTAINER` (default `mysql56`), `TARGET_MYSQL_CONTAINER`, `SOURCE_DB`, `TARGET_DB` (default `openmrs`), `SOURCE_MYSQL_AUTH`, `TARGET_MYSQL_AUTH`, `MIGRATING_USERNAME`, `DOSSIER_PREFIX`, `ORDER_NUMBER_PREFIX`, `SOURCE_FACILITY_UUID`, `WORKDIR` (laptop), `SOURCE_SERVER_DIR`, `TARGET_SERVER_DIR` (checkout+work folder on each server), `SOURCE_OPENMRS_URL`, `TARGET_OPENMRS_URL` (as seen from that server, default `http://localhost:8080/openmrs`), `TARGET_RESTART_CMD`, `TARGET_WAIT_URL`, `SOURCE_RESTART_CMD`, `SOURCE_COMPOSE_DIR` (default `/home/tomcat/docker`), `SOURCE_BACKUP_CMDS`, `TARGET_BACKUP_CMDS` (default the two wiki commands, `;`-separated), `SOURCE_DATA_DIR`, `TARGET_DATA_DIR` (default `/home/tomcat/.OpenMRS`), `TARGET_RUNTIME_PROPERTIES` (default `$TARGET_DATA_DIR/openmrs-runtime.properties`), `COPY_DIRS` (default `complex_obs storage person_images`), `NODE_IMAGE` (default `node:22.18.0`), `REPO_URL` (default `https://github.com/PIH/openmrs-tools-importer-exporter.git`), `REPO_REF` (default `main`), `IMPORT_PATIENTS_BATCH_SIZE` (default 30), optional `EXPORT_USER_ROLE_MAPPINGS_FILE`, `EXPORT_PATIENT_IDENTIFIERS_MAPPINGS_FILE`, `EXPORT_PROGRAM_WORKFLOW_STATE_MAPPINGS_FILE`, `EXPORT_CONCEPT_NAME_MAPPINGS_FILE` (laptop paths), `SKIP_HASH_COPY_IN_TEST` (default `false`), `EARLIER_IMPORTS` (optional, `;`-separated `exportsdir|usermappings|facilityuuid` for verifyUsers re-runs), `HEALTH_CENTER_ATTRIBUTE_TYPE_UUID`, `WAIT_TIMEOUT_SECONDS` (default 1800), `TARGET_FILE_OWNER` (default `tomcat:tomcat`).

- [ ] **Step 1: Failing tests** — `test_example_has_every_setting_used` (every `${NAME}` referenced in `migration/*.sh` that isn't lib-internal appears in the example, grep-based); `test_create_settings_writes_answers` (feed answers on stdin with `MIGRATION_CONFIRM_INPUT`, file contains `TARGET_HOST=local`); `test_create_settings_rerun_keeps_values` (second run with empty answers keeps previous values); `test_create_settings_file_mode_600`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** For each setting: show comment + current/default, read answer. Lookups offered when hosts are reachable (skip quietly if not): `docker ps --format '{{.Names}}'` for containers, `show databases`, facility uuid by `select uuid,name from location where name like ?` (operator types part of the name), dossier prefixes from target `select prefix from idgen_seq_id_gen`. Never asks for passwords. `chmod 600`.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `HAI-1309: settings file and 00-create-settings`

---

### Task 3: `01-preflight.sh`, `02-check-source-data.sh`

**Files:** Create `migration/01-preflight.sh`, `migration/02-check-source-data.sh`, `migration/sql/unsupported-data.sql`, `migration/tests/test_01_02.sh`

**Interfaces:** Consumes lib + settings. Produces nothing later tasks call.

Preflight checks (each prints OK/PROBLEM with the value, all run, exit 1 if any PROBLEM): ssh + `sudo -n true` on non-local hosts; containers exist; MySQL reachable; DBs exist; `SOURCE_FACILITY_UUID` is a location on both; `DOSSIER_PREFIX` row in target `idgen_seq_id_gen`; `ORDER_NUMBER_PREFIX` non-empty; each optional mapping file that is set exists; on each host: `tmux` present, `$NODE_IMAGE` present or pullable (`docker image inspect || docker pull` — pull is a write → confirm), free disk in `*_SERVER_DIR`; PIH EMR version both sides side by side (`select property_value from global_property where property like '%pihcore%version%'` or the module version global property; print whatever matches, it's informational).

Unsupported data (`sql/unsupported-data.sql`): one `select '<label>', count(*)` per item, only for tables that exist (build the union from `information_schema.tables`): appointments `appointmentscheduling_appointment` (non-voided), `patient_appointment` (non-voided), conditions `conditions` (non-voided), diagnoses `encounter_diagnosis` (non-voided), notes `note`, paper records `paperrecord_paper_record`. A table that doesn't exist prints `<label>: table not present`. **Confirm the table names for "Notes" and "Paper Records" against a local prod copy in Step 1 of Task 1; if a name differs, use the real one and say so in the README.** Any count > 0: print the counts and `confirm "continue although unsupported data exists"`.

Also in 02: patients without the health-center attribute on source and target (count, non-voided, attribute type `HEALTH_CENTER_ATTRIBUTE_TYPE_UUID`), providers whose person has no user (count). Reminders printed: ID/card printing [5], CommCare [44], ETL [45].

- [ ] **Step 1: Failing tests** — `test_preflight_reports_missing_facility` (bad uuid → exit 1, output names `SOURCE_FACILITY_UUID`); `test_preflight_all_ok_on_testdb`; `test_unsupported_zero_no_prompt`; `test_unsupported_counts_require_confirm` (seed 2 conditions → output `conditions 2`, exits 1 without "y"); `test_unsupported_missing_table_reported` (drop `note` → `notes: table not present`); `test_health_center_missing_count`.
- [ ] **Step 2–4:** run (FAIL) → implement → run (PASS). **Step 5: Commit** `HAI-1309: preflight and source data checks`

---

### Task 4: Lock, backup and session scripts — 03, 04, 05, 06, 08

**Files:** Create `migration/03-lock-source.sh`, `04-backup-source.sh`, `05-lock-target.sh`, `06-backup-target.sh`, `08-check-no-sessions.sh`, `migration/tests/test_lock_backup.sh`

- 03: test mode → `skip_in_test_mode`. Print count of active users to retire; `src_sql_write "update users set retired=1, retire_reason='Migrating from $SOURCE_NAME', retired_by=<migrating user id>, date_retired=now() where retired=0 and username <> '$MIGRATING_USERNAME'"` (escape values with a `sql_quote` helper added to lib); print count after. Reminders: disable 2FA for the migrating user [6.1]; disable backups in cron on source **and** target [7, 11].
- 04/06: run each of `*_BACKUP_CMDS` with `*_cmd_write`. 04 skipped in test mode.
- 05: same as 03 on target with reason `Temp - migrating data`, keeping `$MIGRATING_USERNAME` and `ccIntegrationUser`. Allowed in test mode.
- 08: test mode → skip. Otherwise remind that source users are retired now and can't log back in, print the source restart command (setting `SOURCE_RESTART_CMD`, default `cd $SOURCE_COMPOSE_DIR && sudo docker compose restart`) and offer to run it with `src_cmd_write` to drop existing sessions [17]. No session detection (OpenMRS keeps sessions in memory).

- [ ] **Step 1: Failing tests** — `test_check_sessions_skipped_in_test_mode`; `test_lock_source_retires_all_but_migrating_user`; `test_lock_source_reason_exact` (`Migrating from hsn`); `test_lock_source_rerun_is_noop` (second run: "0 users to retire", no confirm needed); `test_lock_source_skipped_in_test_mode` (exit 0, nothing changed); `test_lock_target_keeps_ccIntegrationUser`; `test_backup_source_skipped_in_test_mode`; `test_sql_quote_escapes_quote` (`O'Brien`).
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `HAI-1309: lock and backup scripts`

---

### Task 5: `07-prepare-target.sh`

**Files:** Create `migration/07-prepare-target.sh`, `migration/tests/test_07.sh`

Steps in the script, each with its own confirm: (1) read `next_sequence_value` for `DOSSIER_PREFIX` on source and target, print both, `tgt_sql_write` set target to source's value [13–15] — refuse if source value < target value unless the operator types the value again; (2) add `hibernate.search.indexing.listeners.enabled=false` to `TARGET_RUNTIME_PROPERTIES` if absent (idempotent; print puppet warning [16.2] and the "nothing indexed while off" note [16.3]); (3) `tgt_cmd_write "$TARGET_RESTART_CMD"`, then poll `TARGET_WAIT_URL` (via `run_on tgt curl`) every 10 s up to 30 min, printing progress.

- [ ] **Step 1: Failing tests** — `test_dossier_sequence_copied`; `test_dossier_lower_source_requires_retype`; `test_indexing_property_added_once` (run twice → one line); `test_wait_url_timeout_fails` (unreachable URL with `WAIT_TIMEOUT_SECONDS=1`).
- [ ] **Step 2–4.** **Step 5: Commit** `HAI-1309: prepare target (dossier sequence, indexing, restart)`

---


### Task 6: `09-build-user-mappings.sh` (HAI-1304)

**Files:** Create `migration/09-build-user-mappings.sh`, `migration/tests/test_09_mappings.sh`

**Interfaces:**
- Produces in `$WORKDIR/mappings/`: `user_mappings.csv`, `provider_mappings.csv` (importer format), `review-email-conflicts.csv`, `fyi-retired-differs.csv`, `unmatched-users.csv` (header rows; `source_uuid,source_username,...`). Task 8 copies the two mapping files to the servers and Task 10 reads `user_mappings.csv`.

Mechanics: one target `mysql` session receives, through `pipe_src_to_tgt`, (a) `create temporary table src_users(uuid char(38), username varchar(50), email varchar(255), retired tinyint, person_uuid char(38))` and `src_providers(uuid char(38), person_uuid char(38))`, (b) insert statements generated on the source by a `select concat('insert … values (', quote(…), …, ');')` query, (c) the match queries, whose output (tab-separated, with a leading kind column `USER`, `PROVIDER`, `CONFLICT`, `FYI`, `UNMATCHED`) the laptop splits into the files. Only uuid, username, email, retired cross.

Rules (all from the spec):
1. Username match: `s.username = t.username` (non-empty).
2. For source users without a username match and with non-empty email: `lower(trim(s.email)) = lower(trim(t.email))`. Exactly one target user → mapped. More than one target user, or the target user is already the username match of another source user → `CONFLICT`, not mapped.
3. `FYI` when mapped and `s.retired <> t.retired`, treating target `retired_reason = 'Temp - migrating data'` as not retired.
4. Providers: source provider → its person → that person's source user → mapped target user → target provider(s) of that target person. Exactly one → mapped; several → `CONFLICT`. Append the UnknownProvider line.
5. Counts printed: users matched by username / by email / conflicts / FYI / unmatched; providers matched / conflicts.
6. Footer reminder: run on the day after 03 and 05; for a 2nd+ site the earlier import is already in, so its users match too.

- [ ] **Step 1: Failing tests** (seed src_db/tgt_db per test) — `test_username_match`; `test_email_match_when_username_differs`; `test_email_match_ignores_case_and_spaces`; `test_duplicate_target_email_is_conflict_not_mapped`; `test_email_target_already_username_matched_is_conflict`; `test_retired_differs_is_fyi_and_mapped`; `test_temp_migrating_retired_target_not_fyi`; `test_provider_mapped_via_user`; `test_unknown_provider_line_appended` (exact line from Global Constraints); `test_mapping_line_format` (`^[0-9a-f-]{36} [^,]+,[0-9a-f-]{36}$`); `test_mappings_rerun_overwrites` (no duplicate lines); `test_no_hash_columns_cross` (the generated source SQL contains no `password`/`salt`).
- [ ] **Step 2–4.** **Step 5: Commit** `HAI-1309: user and provider mappings (HAI-1304)`

---

### Task 7: `10-build-concept-name-mappings.sh` (HAI-1307)

**Files:** Create `migration/10-build-concept-name-mappings.sh`, `migration/tests/test_10_concepts.sh`

Produces `$WORKDIR/mappings/concept_name_mappings.draft.csv` (importer format, label = name text), `concept-names-no-candidate.csv`, `concept-mappings-voided-target.csv`. Does **not** modify `EXPORT_CONCEPT_NAME_MAPPINGS_FILE`; prints the command to merge (`sort -u existing draft > new`) for the operator.

Mechanics like Task 6: the source sends the distinct coded-value names used by non-voided obs (`obs.value_coded_name_id` → `concept_name`: name uuid, concept uuid, name, locale, concept_name_type, voided) into a target temp table. On the target: names whose uuid doesn't exist → candidate = non-voided target name with same concept uuid, `name`, `locale`, `concept_name_type`; one candidate → draft line; zero or several → no-candidate file (with the count). Existing mapping file lines (if the setting is set) whose target uuid is voided or missing on the target → voided-target file.

- [ ] **Step 1: Failing tests** — `test_missing_name_with_same_text_gets_draft` (the Trichomonas case: same text/locale/type, different uuid); `test_name_present_by_uuid_not_listed`; `test_no_candidate_listed`; `test_two_candidates_listed_not_drafted`; `test_existing_mapping_to_voided_name_flagged`; `test_mappings_file_not_modified`.
- [ ] **Step 2–4.** **Step 5: Commit** `HAI-1309: concept-name mapping draft (HAI-1307)`

---

### Task 8: `11-build-lists.sh`, `12-setup-servers.sh`

**Files:** Create both scripts, `migration/tests/test_11_12.sh`

- 11 writes `$WORKDIR/lists/{users,providers,patients,relationships}.csv` with the wiki queries [20] (patients non-voided, relationships non-voided), prints counts. These hold uuids only.
- 12 on each host (src then tgt): `git clone`/`git fetch && git checkout $REPO_REF` into `*_SERVER_DIR/repo` (write → confirm), `docker run --rm -v …/repo:/app -w /app $NODE_IMAGE npm ci` (confirm), write `*_SERVER_DIR/repo/src/.env` (mode 600) from settings + prompted OpenMRS password for `MIGRATING_USERNAME` (read -s, never logged; source `.env` gets only source values, target `.env` gets target values plus `OPENMRS_SOURCE_*` only if a verify script needs them — check `src/verify*.js`), `TARGET_DIR=…/exports`, `LOG_HOME=…/logs`, list/mapping file paths on the server; copy lists and mapping files up with `run_on X "cat > file" < localfile`. Print the `.env` with passwords replaced by `***`.

- [ ] **Step 1: Failing tests** — `test_lists_counts_match_db`; `test_patient_list_excludes_voided`; `test_env_written_mode_600_without_password_in_log` (local hosts, fake `NODE_IMAGE` run skipped via `SKIP_NPM_CI=true` test-only var); `test_env_contains_order_number_prefix_and_facility`.
- [ ] **Step 2–4.** **Step 5: Commit** `HAI-1309: uuid lists and server setup`

---

### Task 9: `13-export.sh`, `14-copy-exports.sh`

**Files:** Create both, `migration/tests/test_13_14.sh`

- 13: if tmux session `export` running → show progress (last `Export summary` lines from `*/logs`, counts of `*_*.json` per type) and exit. Otherwise: confirm clearing old `exports/` and `logs/` if non-empty [21]; save object counts on source and target to `$WORKDIR/counts/` (`tools/omrs_object_count.sql` piped through `src_sql`/`tgt_sql`, and `tools/table-counts.sh`-style per-table counts for the target) [26]; `start_in_tmux src export "docker run --rm --network host -v …/repo:/app -w /app/src $NODE_IMAGE sh -c 'node exportUsers.js && node exportProviders.js && node exportPatients.js && node exportRelationships.js'"`. Re-running after it finishes with failures restarts it (the export only retries failures) after a confirm.
- 14: `pipe_src_to_tgt "tar c -C $SOURCE_SERVER_DIR exports" "mkdir -p $TARGET_SERVER_DIR && tar x -C $TARGET_SERVER_DIR"` (confirm), then compare file counts per sub-folder both sides; mismatch → exit 1.

- [ ] **Step 1: Failing tests** — `test_export_refuses_when_session_running` (fake tmux session); `test_copy_exports_counts_match` (local→local with two temp dirs); `test_copy_exports_mismatch_fails`. Skip tmux tests with a printed SKIP when `tmux` isn't installed.
- [ ] **Step 2–4.** **Step 5: Commit** `HAI-1309: export and copy exports`

---

### Task 10: `15-import-users.sh`, `16-copy-password-hashes.sh` (HAI-1314)

**Files:** Create both, `migration/tests/test_15_16.sh`

- 15: save target user uuids before import to `$WORKDIR/target-users-before-import.txt` (uuids only) — skip if the file exists (re-run safety, say so); per-table count snapshot of target; `tgt_sql_write "SET GLOBAL innodb_flush_log_at_trx_commit = 2"` and print the check query [27]; run `importUsers.js` in tmux on the target; when done, print the summary and say "run again until no new users are created" [28]; footer points to 16 **immediately**.
- 16: test mode + `SKIP_HASH_COPY_IN_TEST=true` → skip. Otherwise: one target session receives from the source `create temporary table tmp_hashes(uuid char(38) primary key, password varchar(128), salt varchar(128))` + inserts generated by `select concat('insert into tmp_hashes values (', quote(uuid), ',', quote(password), ',', quote(salt), ');') from users where password is not null`, followed by the update `update users u join tmp_hashes h on u.uuid = h.uuid set u.password = h.password, u.salt = h.salt where u.uuid not in (<uuids from target-users-before-import.txt, sent as a second temp table>)` and `select row_count()`. Prints only the count. Nothing is written to disk on the laptop: the stream goes straight from `ssh src` to `ssh tgt`; the confirm happens **before** the pipe starts, showing the SQL with `<hashes streamed from source>` in place of the inserts.

- [ ] **Step 1: Failing tests** — `test_hash_copy_updates_imported_users_only`; `test_hash_copy_skips_mapped_users` (mapped target user keeps its own hash); `test_hash_copy_skips_preexisting_target_users` (same uuid existed before import, e.g. daemon); `test_hash_copy_output_has_no_hashes` (captured stdout+log don't contain the seeded hash string); `test_hash_copy_nothing_written_to_workdir` (file list of `$WORKDIR` before/after equal except the log, and the log has no hash); `test_flush_set_to_2_then_shown`.
- [ ] **Step 2–4.** **Step 5: Commit** `HAI-1309: user import and password-hash copy (HAI-1314)`

---

### Task 11: `17-import-patients.sh`, `18-copy-files.sh`

**Files:** Create both, `migration/tests/test_17_18.sh`

- 17: tmux session `import` on target running `importProviders.js && importPatients.js && importPatients.js && importRelationships.js` (second `importPatients` = pass 2 retry, as in the rerun script); progress mode when running: successful/failed/left from the import log, plus failure classes (port the `grep -ohE 'DrugOrder\.[A-Za-z.]+|Obs\.…|status code [0-9]+'` from `~/exports/rerun-2026-11-25.sh` line 77 — copy the regex into the script, don't reference the file); when finished: `tgt_sql_write "SET GLOBAL innodb_flush_log_at_trx_commit = 1"` and show the check [32].
- 18: for each dir in `COPY_DIRS` that exists under `SOURCE_DATA_DIR` on the source: `pipe_src_to_tgt "python3 - --source-dir … --output /dev/stdout < create_archive.py"`-equivalent — simplest: run `create_archive.py` on the source into `SOURCE_SERVER_DIR/files-<dir>.zip` (src disk write, allowed in test mode since it's not the DB/services; say so), stream the zip to the target with `pipe_src_to_tgt "cat …zip" "cat > …zip"`, run `merge_extract.py --zip … --dest-dir $TARGET_DATA_DIR/<dir> --conflict-log $TARGET_SERVER_DIR/logs/conflicts-<dir>.csv` on the target (confirm), then `chown -R tomcat:tomcat` (`TARGET_FILE_OWNER`) [33]. Print file counts per dir both sides and the conflict count. Python scripts are copied up from the laptop's repo (they're in the server checkout from Task 8 too; use that).

- [ ] **Step 1: Failing tests** — `test_copy_files_merges_into_same_named_dir` (complex_obs→complex_obs, storage→storage); `test_copy_files_skips_missing_dir`; `test_copy_files_conflict_not_overwritten`; `test_failure_classes_extracted` (fixture app.log lines).
- [ ] **Step 2–4.** **Step 5: Commit** `HAI-1309: patient import and file copy`

---

### Task 12: `19-verify.sh` and `src/verifyComplexObs.js`

**Files:** Create `migration/19-verify.sh`, `src/verifyComplexObs.js`, `migration/tests/test_19.sh`

- `src/verifyComplexObs.js`: reads exported patient JSON in `TARGET_DIR`, collects obs uuids with `valueComplex`, for each `GET {OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/obs/{uuid}/value` using the existing REST client/auth in `src/services` (follow how `verifyPatients.js` gets its client), concurrency 10; writes `LOG_HOME/complex-obs-missing.csv` (`obs_uuid,http_status`) and prints `Complex obs check: <n> checked, <m> missing`. Exit 0 either way (operator decides).
- 19: in tmux on target: `verifyPatients.js`, `verifyRelationships.js`, `verifyUsers.js`, `verifyComplexObs.js` [34, 37]; for each entry in `EARLIER_IMPORTS` run `verifyUsers.js` again with that import's settings [37.2]; then on the laptop: per-table count diff of the target against Task 14's snapshot (same output as `tools/table-counts.sh diff`) and object counts before/after [35]; row counts of `source-data-fixes*.csv`, `source-data-review*.csv`, `visits-before-birthdate*.csv`, `invalid-identifiers*.csv`, `verify-users.csv`, `complex-obs-missing.csv` in the target logs. Prints, doesn't judge.

- [ ] **Step 1: Failing tests** — `test_verify_complex_obs_counts_missing` (node test with a stub HTTP server on localhost returning 200/404; run with `node --test` if added as `src/verifyComplexObs.test.js`); `test_verify_prints_csv_row_counts` (fixture logs dir).
- [ ] **Step 2–4.** **Step 5: Commit** `HAI-1309: verify step incl. complex obs files`

---

### Task 13: `20-rebuild-index.sh`, `21-spot-checks.sh`

**Files:** Create both, `migration/tests/test_20_21.sh`

- 20: remove the indexing line from `TARGET_RUNTIME_PROPERTIES` (confirm), restart + wait (reuse Task 5's wait function — move it into lib as `wait_for_target`), `POST {TARGET_OPENMRS_URL}/ws/rest/v1/searchindexupdate` with `{"async": true}` as `MIGRATING_USERNAME` (password prompted, sent with `curl --data-binary @-`/`-u` via stdin config, not argv), then poll `search.indexVersion` global property until set (as `waitindex()` in the rerun script), printing elapsed time; note "puppet can run again now" [36].
- 21: health-center attribute counts by value on target for patients from this source [38]; asks the operator for a few dossier numbers and runs patient search for each through REST, printing found/not found (no names printed — print patient uuid and identifier only) [39].

- [ ] **Step 1: Failing tests** — `test_indexing_line_removed`; `test_rebuild_password_not_in_argv` (run with a stub `curl` on PATH that records its argv; argv has no password).
- [ ] **Step 2–4.** **Step 5: Commit** `HAI-1309: index rebuild and spot checks`

---

### Task 14: `22-open-target.sh`, `23-shutdown-source.sh`, `24-archive-and-clean.sh`

**Files:** Create the three scripts, `migration/tests/test_22_24.sh`

- 22: asks three yes/no questions (verify output reviewed? index rebuild finished? spot checks done?) — any "no" exits 1. Then `tgt_sql_write` un-retire `Temp - migrating data` [40.2], then `Migrating from $SOURCE_NAME` with `retired_by=null` [40.3] (each prints its count; in test mode the second says 0 is expected); check flush = 1 (warn if not); reminders: re-enable backups and run one [42], re-enable 2FA for the migrating user [43].
- 23: test mode → skip. `src_cmd_write "cd $SOURCE_COMPOSE_DIR && sudo docker compose down"`; reminder backups off on source [41].
- 24: on target, `7z a -p -mhe=on` of `exports/` (7z prompts for the password itself on the server's tty: run via `ssh -t`; when local, run directly) [46.2]; print where the archive is and the reminder to copy it to the Azure backup and use the default backup password [46.3]; then confirm deleting `exports/`, `logs/` and `repo/src/.env` on target, `exports/`, `logs/`, `files-*.zip` and `repo/src/.env` on source (test mode: allowed — files, not DB), and `$WORKDIR/lists`; reminder to share `invalid-identifiers.csv` through the usual channel, not Jira [47] — **before** deleting logs, print its path and ask whether it has been copied.

- [ ] **Step 1: Failing tests** — `test_open_target_refuses_on_no`; `test_open_target_unretires_both_reasons_only` (a user retired for another reason stays retired); `test_shutdown_skipped_in_test_mode`; `test_clean_asks_about_invalid_identifiers_first`.
- [ ] **Step 2–4.** **Step 5: Commit** `HAI-1309: open target, shutdown source, archive and clean`

---

### Task 15: `migration/README.md` (source of truth) and root README pointer

**Files:** Create `migration/README.md`; Modify `README.md` (one paragraph + link at the top of the migration section)

Contents: setup (laptop needs bash/ssh/git; servers need docker, tmux; ssh aliases), test mode vs real mode, the server-to-server SSH note (may change, research with IT), then the steps in order 00–24: for each, one line on what it does, the wiki step numbers it replaces, what to check before going on, and the manual reminders (ID/card printing, cron, 2FA, CommCare, ETL). Then the "Wiki TODOs and stale items" table from the spec with outcomes, plus the open item about voided-for-dispense count differences. A "Files written" section listing every file each script writes on the laptop and the servers, and which contain user/patient data.

- [ ] **Step 1:** write it. **Step 2:** check every script name in the README exists (`grep -o '[0-9][0-9]-[a-z-]*\.sh' migration/README.md | sort -u` vs `ls migration/[0-9]*.sh`), and every script's `next_step` points to the next existing script (`grep -h next_step migration/[0-9]*.sh`). **Step 3: Commit** `HAI-1309: migration README as source of truth`

---

### After the branch (not code; needs the user's go-ahead each time)

- Open the PR. After merge: add the "outdated — see `migration/README.md`" note at the top of wiki page 3785490446 (content otherwise unchanged).
- Test ccIntegrationUser on a local ZL Central copy (wiki step 10 TODO) during the user's first test run.
- First real test (user, after the break): `MIGRATION_MODE=test`, production source, laptop target.
