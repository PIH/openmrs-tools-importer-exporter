# Patient import performance notes

Analysis done 2026-10-28, based on the code as of commit `a2e18aa` and de-identified aggregates from
`src/logs/app.log` (CANGE import runs, April–August 2026). Nothing here has been implemented yet; this is a
to-do list for the next site migration.

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
- `hibernate.search.indexing_strategy=manual` during the import, then rebuild the search index afterwards (test first).
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
