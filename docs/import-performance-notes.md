# Patient import performance notes

Analysis done 2026-10-28, based on the code as of commit `a2e18aa` and de-identified aggregates from
`src/logs/app.log` (CANGE import runs, April–August 2026). **Client-side suggestions #2–#7 were implemented
and server settings from #9 measured on 2026-11-17; see [Results](#results-2026-11-17) at the end.**

## Current behaviour

For each `*_patient.json` file, `importPatients.js` / `services/importerService.js`:

1. Rebuilds the merged mappings object and runs one regex replace over the whole file per mapping entry.
2. Parses the JSON and recursively decodes HTML entities.
3. Calls `postDataIfNotExists` for every patient, visit, encounter (obs are nested in the encounter), encounterless
   obs, order, medication dispense, program enrollment, program state and allergy. Each call is a GET-by-uuid,
   then a POST on 404, strictly sequentially.
4. Patients are processed in fixed batches via `Promise.all` (in practice `IMPORT_PATIENTS_BATCH_SIZE=30`).

## What the logs showed

Latest full run (2026-08-28, 14,521 patients, batch size 30):

| Metric | Value |
|---|---|
| Wall time / throughput | 6,841 s → **2.12 patients/s** (485 batches, ~14 s each) |
| Patient import attempts | **24,154** for 14,521 patients (9,633 retries, ~66%) |
| Patients needing 1 / 2 / 3 / 4 attempts | 5,296 / 8,819 / 404 / 2 |
| Visit POST failures | 8,896 × `TransientPropertyValueException … org.openmrs.Visit.patient -> org.openmrs.Patient` |
| Encounter POST failures | 737 × `ConstraintViolationException: could not execute statement` |
| Objects created | ~91k encounters, 43k visits, 9.7k enrollments, 6.5k orders, 1.6k states |
| Files moved to `failed/` | 20 (15 duplicate identifiers) |
| Batch time trend | Flat at 11–13 s/batch across the run (first decile ~33 s warmup), so no degradation as the DB grows |

Key observations:

- **Every** retry failed on the patient's **first** visit, before any visit was saved.
- On retry, the existence GET **never** found the patient ("Resource already exists" for a patient: 0 times), and
  the patient POST ran and succeeded again (24,138 patient creations for 14,521 patients). So the first patient POST
  returns 201, but the patient is not in the DB when the visit is posted, and is still missing 2+ seconds later on
  retry. This is not a commit-visibility lag: the patient save appears to be rolled back or otherwise lost.
  This is a data-integrity concern as well as a performance one.
- Runs on the **same dataset** (`cange/exports`) on 2026-04-30 before ~14:46Z were clean and much faster:

  | Run (UTC) | Batch size | Retries | Throughput |
  |---|---|---|---|
  | 04-30 14:00 | 20 | 0 | 6.9 patients/s |
  | 04-30 14:15 | 10 | 0 | 5.7 patients/s |
  | 04-30 14:39 | 30 | 0 | 8.3 patients/s (~3.6 s/batch) |
  | 04-30 16:01 onward | 30 | 45–80% of patients | 2.1–2.5 patients/s (11–15 s/batch) |

  Concurrency was the same in clean and failing runs, and nothing in the importer's git history between those times
  looks related. Best guess: **something changed on the target server or DB between 04-30 14:46Z and 16:01Z**
  (module set or config, restart, DB restore/reset). Caveat: the clean runs may have covered an easier subset of
  patients, so the speed comparison isn't exact, but the error rate going from 0 to ~66% isn't explained by that.

## Suggestions, in priority order

### 1. Find out why newly created patients disappear (biggest win, about 3×)
- Check the OpenMRS server log (`openmrs.log` / `catalina.out`) around a failing visit for an exception or rollback
  right after the patient save.
- Work out what changed on the target server around 2026-04-30 10:46–12:01 EDT.
- Quick experiment: give each concurrent patient its own axios client and cookie jar (its own OpenMRS session).
  Today all concurrent requests share one cookie jar, and therefore one HTTP session/`UserContext`. See whether the
  failure rate changes.
- Also check whether the error occurs with batch size 1 on the current server.

### 2. Make retries cheaper (until #1 is fixed)
- Retry only the failed step, not the whole file, with a shorter or backoff delay.
- Drop `ConstraintViolationException` from `isTransientError` unless it's shown to be transient.

### 3. Replace fixed batches with a worker pool
`Promise.all` on chunks of 30 means every batch waits for its slowest (or retrying) patient. Use N workers that each
pull the next file as soon as they finish. If concurrency issues can't be solved in-process, an alternative is to
shard the file list across several importer processes.

### 4. Turn on HTTP keep-alive
`axios-cookiejar-support` 6.x builds `new HttpCookieAgent({ cookies: { jar } })` without `keepAlive`, and Node agents
default to `keepAlive: false`, so every request most likely opens a new TCP (and TLS, if https) connection. Pass
`keepAlive: true` (and `maxSockets`), e.g. by using `http-cookie-agent` directly.

### 5. Cut out most of the existence GETs (roughly halves the request count)
- If the patient GET returned 404 and we created it, its children can't exist yet, so POST them directly. Only use
  GET-then-POST when the patient already existed (a resumed run). The retry path stays safe.
- When a GET is needed, add `?v=custom:(uuid)`. Today it fetches the default representation (for an encounter that
  serializes obs, orders and providers) just to check existence.

### 6. Apply mappings in a single pass (`utils/utils.js` `replaceMappings`)
It builds a new `RegExp` per mapping per file and rescans the whole file each time: O(number of mappings × file
size), which blocks the event loop. To fix:
- Build `allMappings` once at startup, not per file (`importPatients.js`).
- Replace in one pass with a UUID regex plus a map lookup.
- This also fixes two latent bugs: keys aren't regex-escaped, and the result can depend on mapping order.

### 7. Smaller Node-side items
- Reduce logging. That run wrote ~2 info lines per created object to both console and file, and `app.log` is now
  2.4 GB / 30M lines. Move per-object lines to `debug`.
- `decodeHtmlEntitiesInObject`: skip strings without `&`, and decode in one regex pass.
- `moveFile`: create the `successful/` and `failed/` directories once at startup.

### 8. Parallelize within a patient (only if there's headroom after #3)
Patient → visits → encounters → orders must stay ordered, as must drug orders along their `previousOrder` chain and
program states. Visits, encounters, encounterless obs, test orders, dispenses and allergies could each run in
parallel within their step, but this risks lock contention on the same patient.

### 9. Target server/DB tuning for the duration of the import
- Turn off search indexing during the import, then rebuild the search index afterwards. Tested; see "Server settings
  for the migration window" below for the property that works on this OpenMRS version.
- Disable modules that react to every save (event/ActiveMQ, atomfeed, dbevent/Debezium, name phonetics, sync/HL7).
- MySQL: `innodb_flush_log_at_trx_commit=2`, `sync_binlog=0` (or turn off the binlog), a large
  `innodb_buffer_pool_size`. Put these back afterwards.
- Size Tomcat threads, the Hibernate/C3P0 pool and the JVM heap for the chosen concurrency.
- Run the importer on the same host or network as the target server.

### 10. Bigger changes (only if needed)
- A custom OpenMRS module endpoint that accepts a whole patient record and saves it in one transaction.
- Direct DB-level migration (fastest by far, but bypasses OpenMRS validation).

## Measuring

Add per-request timing by resource type (count, total ms, p50/p95), logged once per batch, before and after each
change. Benchmark to beat: ~6–8 patients/s at batch size 30 (the clean 2026-04-30 runs).

Log aggregation must stay de-identified: counts only, with UUIDs stripped. The logs contain patient identifiers, and
company policy forbids processing patient data in cloud-based AI.

## Results (2026-11-17)

Measured importing SSPE patients into `zl-central-import-test`, a copy of the Mirebalais production database
(made with `prod-restore/copy-db.sh`), on an SDK server running zl-distro 1.83.0, on the same machine as the
importer. 300-patient fixed random sample (2,807 encounters, 600 visits, 23,840 obs, 1,505 orders). Between
runs, `tools/cleanup-import.sh` removed the sample and `tools/table-counts.sh` confirmed the database was back
to its exact row counts. Every run created exactly the same rows (41,665 in 17 tables) and verified the same
way (`verifyPatients.js`: 283 verified, 17 failed verification, in the baseline too).

**Disappearing patients (#1): not reproduced.** No `TransientPropertyValueException ... Visit.patient` retries in
any run, at concurrency 10, 30 or 60.

**User and provider mappings must cover the data first.** With the real SSPE mapping files, 299 of 300 patients
failed: the sample references 79 SSPE users and 75 providers, of which the mappings cover 11 and 9, and the rest
don't exist on the target (`Column 'creator' cannot be null`, `Visit.creator -> User`). The runs below used
test-only mappings sending every unmapped user/provider to one existing account.

| Change | Time (300 patients) | Patients/s |
|---|---|---|
| Baseline | ~94 s (89–99) | 3.2 |
| Worker pool (#3) | 82.2 s | 3.6 |
| Single-pass mappings, built once (#6) | 80.1 s | 3.7 |
| Skip existence GETs for a new patient's children, `v=custom:(uuid)` (#5) | 76.9 s | 3.9 |
| Per-record logs to debug, cheaper entity decoding, dirs once (#7) | 72.0 s | 4.2 |
| No retries on ConstraintViolationException, exponential backoff (#2) | 72.8 s | 4.1 |
| Server: OpenMRS connects to MySQL directly instead of via Docker's userland proxy | 55.9 s | 5.4 |
| Server: `innodb_flush_log_at_trx_commit=2` | 48.7 s | 6.2 |
| Server: `hibernate.search.indexing.listeners.enabled=false` (rebuild the index afterwards) | 44.0 s | 6.8 |

Keep-alive (#4) was already in the baseline: the import shares the export's HTTP client. Concurrency 10, 30
and 60 all took 42–44 s with the server settings, so the server is the limit and #8 wasn't pursued.

**Where the server time goes** (thread dumps every 2 s during an import, method names only): about 80% of busy
request-thread time was waiting on MySQL, mostly not inserts (~3%) but REST resolving each referenced UUID
(`*Resource.getByUniqueId` → `HibernateUtil.getUniqueEntityByUUID`: concepts, encounters, locations, persons,
users) one query at a time, each in its own transaction: connection checkout, begin, commit and close made up
about half of the MySQL waiting. Encounter POSTs were 76% of request time, patient POSTs 16%. Round-trip
latency therefore dominates, which is why bypassing Docker's proxy (147 → 72 µs per round trip) helped so much.
Bigger gains would need fewer round trips per request (caching or batching UUID lookups in REST/core, or a
custom bulk endpoint, #10).

Resumed runs work: importing the sample twice took 3.4 s the second time, with no POSTs and no rows added.

### Full SSPE import (2026-11-17)

All 54,268 SSPE patients into `zl-central-import-test`, with every change above (test-only mappings,
concurrency 30): **2 h 9 min (7.0 patients/s, steady throughout)**, 8.58 million rows created. 54,134 imported
and 134 failed (0.25%); there were no retries at all, so no disappearing patients.

| Failures | Step | Cause (from exception classes and messages, no data) |
|---|---|---|
| 56 | medication dispense | `TransientObjectException`: refers to a `DrugOrder` that isn't on the target |
| 29 | encounter | `TransientObjectException`: an obs refers to a `ConceptName` that isn't on the target (more concept name mappings needed) |
| 31 | drug order, test order, visit | HTTP 400 validation errors; no reason logged by the importer or the server |
| 16 | drug order, test order | `AmbiguousOrderException` |
| 2 | drug order | `MissingRequiredPropertyException: Previous Order is required for a revised order` (REVISE orders whose previous order wasn't in the export, so the exporter dropped the reference) |

Verification (`verifyPatients.js`, 15 min): 51,320 verified, 2,814 failed. The differing key paths (no
values): `testOrders[].accessionNumber` missing on the target (2,678 patients), `testOrders[].dateStopped` set on
the target but not in the file (141) or different (9), and about 10 others (`patient.dateCreated`, address
`preferred`, an obs location, one encounter's visit). So test orders lose their accession number on import,
and the target stops some test orders itself.

The causes of these failures and verification differences, and the fixes for them, are tracked on HAI-1284 and
in separate PRs: the accession number differences are empty strings in the source, and the stopped test orders
come from test orders being exported without their `previousOrder`.

## Server settings for the migration window (manual runbook)

The server-side results above came from three changes on the target server. They are made by hand, not by the
importer. Here is what applies to the production Haiti servers and how to do each one. Puppet: the Haiti EMR
servers run Tomcat and MySQL in Docker under `openmrs::pihemr_docker`.

**1. OpenMRS connects to MySQL directly, not through a published Docker port: not needed on production.** The
production containers use `network_mode: host`, so OpenMRS already reaches MySQL on `localhost:3306` with no Docker
proxy in between. This gain (72 → 56 s on the sample) only applied to the local test setup. It does mean the local
timings are closer to what production can do than the "default settings" estimate.

**2. `innodb_flush_log_at_trx_commit=2` (about 13% faster on the sample).**
- Before the import, as MySQL root in the MySQL container: `SET GLOBAL innodb_flush_log_at_trx_commit = 2;`. Check
  it with `SELECT @@innodb_flush_log_at_trx_commit;`. It takes effect at once, with no restart.
- After the import: `SET GLOBAL innodb_flush_log_at_trx_commit = 1;`. A MySQL restart also puts back the configured
  value, because `SET GLOBAL` isn't saved.
- Risk: a crash of the OS or the machine (not just MySQL) can lose about the last second of commits. Take a backup
  right before the import, and don't leave this setting on for normal operation.

**3. Search indexing off during the import, then a full rebuild (about 10% faster on the sample).**
- Before the import: add `hibernate.search.indexing.listeners.enabled=false` to
  `~tomcat/.OpenMRS/openmrs-runtime.properties` and restart OpenMRS. (`hibernate.search.indexing_strategy=manual`
  is the older Hibernate Search property and doesn't apply to this version.)
- **Puppet manages `openmrs-runtime.properties`**
  (`mirebalais-modules/openmrs/templates/openmrs-runtime.properties.erb`), so a puppet run during the window puts
  the file back. Don't run puppet until the import is done.
- While indexing is off, nothing saved is added to the search index. That includes anything users enter during the
  window. For example, a patient registered then won't be found by name search until the rebuild. The imported data
  isn't searchable until the rebuild either.
- After the import: remove the line, restart OpenMRS, then rebuild the whole index. Either:
  - `POST /openmrs/ws/rest/v1/searchindexupdate` as an admin, with body `{"async": true}` to run it in the
    background; or
  - delete the `search.indexVersion` global property and restart. Core rebuilds the index at startup when that
    property doesn't match its version. This is the method used when restoring production databases locally.
- Rebuild time: **about 12 minutes** (727 s for the synchronous REST call) on the local copy of ZL Central after
  the full SSPE test import: 654,974 patients and a 592 MB index. Measured on a developer machine, so production
  may differ. Patient search is incomplete until the rebuild finishes.

**Also:**
- Run the importer on the same host or local network as the target server. Each patient takes hundreds of requests,
  and every request makes many database round trips, so latency adds up fast. In the tests, the importer ran on
  the same machine as the server.
- The tests used 30 workers (`IMPORT_PATIENTS_BATCH_SIZE=30`). 10, 30 and 60 all took the same time. Production's
  C3P0 pool (`hibernate.c3p0.max_size=50`) is big enough for that.
- Put everything back afterwards: `innodb_flush_log_at_trx_commit=1`, the indexing property removed, the index
  rebuilt, and puppet runs resumed.
