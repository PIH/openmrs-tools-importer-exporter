# Patient export performance notes

Analysis done 2026-10-28, based on the code as of commit `a2e18aa` and de-identified aggregates from
`src/logs/app.log`. **All suggestions were implemented on 2026-11-17; see [Results](#results-2026-11-17) at the end.** The export is already much faster than the import (see
[import-performance-notes.md](import-performance-notes.md)), so the main value of these changes is making the
import faster and more robust, not the export itself.

## Current behaviour

`exportPatients.js` processes patients in hardcoded batches of 20 with `Promise.all`. For each patient,
`exportPatient` (`services/exporterService.js`) sends 9 GETs in parallel: patient, visits, encounters (with obs
nested two levels deep), obs, test orders, drug orders, medication dispenses, program enrollments and allergies.
It writes the result to `<uuid>_patient.json` with 4-space indentation and skips patients whose file already exists.
`verifyPatients.js` reuses the same `exportPatient` against the target server.

## What the logs showed

| Run | Patients | Throughput |
|---|---|---|
| 2026-08-28 (latest) | 14,521 in 5.4 min | **45 patients/s** |
| CANGE runs, 2026-04 to 2026-05 | 13,112 each | 22–27 patients/s |
| Earlier, smaller datasets | 750–1,700 | 12–38 patients/s |

- **Batches are very even.** In the latest run a batch of 20 took 0.42 s at the median, 0.55 s at p90 and 1.25 s at
  most. The 10 slowest batches add up to only 8 s of 323 s, so waiting on the slowest patient isn't a real cost
  here (unlike the import).
- **There are no retries or partial failures.** Errors show up only as whole failed runs (60, 417 or 1,498 errors in
  a row), which look like connectivity or authentication problems.

## Suggestions, in priority order

### 1. Stop fetching every obs twice (biggest win on the server)
`exportPatient` calls `obs?patient=…` with the full obs representation (two levels of nested group members), then
`parseObsList` throws away everything except encounter-less obs. The encounter call already returns all encounter
obs nested inside each encounter, so the heaviest data per patient is serialized and transferred twice, and most of
the second copy is discarded.
- Fix: fetch `obs?patient=…&v=custom:(uuid,encounter:(uuid))` first, then fetch the full representation only for
  the obs with no encounter.
- This probably helps `verifyPatients.js` even more, since it calls the same `exportPatient` against the target.

### 2. Write compact JSON (mainly speeds up the import)
`JSON.stringify(patientRecord, null, 4)` makes the files noticeably bigger. The import's cost per file grows with
file size: `replaceMappings` rescans the whole file once per mapping, plus reading and parsing. Write without
indentation, or with 2 spaces if people read the files when debugging.

### 3. Make concurrency configurable and use a worker pool
`BATCH_SIZE = 20` is hardcoded in `exportPatients.js`, unlike the import. Expose it via an
`EXPORT_PATIENTS_BATCH_SIZE`-style environment variable and try higher values. Each patient already sends 9
requests in parallel, so 20 patients means about 180 requests in flight against the source server. Watch the source
server's load, since it may be a production system. A worker pool helps only a little here because batches are so
even.

### 4. Turn on HTTP keep-alive
Same fix as for the import: it's the same `openmrsService.js` client, whose cookie-jar agent is created without
`keepAlive`. With 9 short GETs per patient, setting up a new connection for every request is a relatively bigger
share of the time here.

### 5. Retry failures and make them visible
A failed patient is only logged; nothing is retried. Whole runs failed several times, apparently from session
expiry or connectivity. Re-running works because existing files are skipped, but:
- add a retry with backoff for each patient,
- write failed UUIDs to a file,
- and log a summary at the end (exported, skipped, failed).

This is about robustness more than speed.

### 6. Small items
- `fs.existsSync` / `fs.writeFileSync` block the event loop while other requests are in flight. Use `fs.promises`.
  This is minor at current file sizes.
- `parseDrugOrderList` checks `processedUuids.includes` (quadratic time), and recurses forever if a previous order
  isn't in the export (the existing TODO). That's a hang risk, not a speed problem, but worth fixing in the same pass.
- The source server's max-results setting is raised to 99999 so nothing has to be paged. That's fine, but a patient
  with a very long history becomes one huge response. Nothing in the logs suggests it's a problem yet.

## Where to start
Do #1 (fetch obs once) and #2 (compact JSON) first: #1 removes the largest wasted work on both the source and
target servers, and #2 helps the import, which is where the time actually goes. #3–#5 are quick to do in the same
pass.

Log aggregation must stay de-identified: counts only, with UUIDs stripped. The logs contain patient identifiers, and
company policy forbids processing patient data in cloud-based AI.

## Results (2026-11-17)

All six suggestions were implemented, one commit each, and measured against the SSPE data on a local copy
of the SSPE production database (source server on the same machine). Each step was checked with
`tools/compare-exports.js`, which compares parsed JSON by hash and reports only counts and key paths.

Sample of 3,000 patients (fixed random sample), `tools/export-bench.sh`:

| Step | Patients/s | Output vs baseline |
|---|---|---|
| Baseline | 50.2 | 1 patient failed (drug order recursion) |
| Keep-alive (#4): one cookie agent per client; `axios-cookiejar-support` made a new connection per request | 53.1 | identical |
| `fs.promises` (#6) | 53.2 | identical |
| Compact JSON (#2), `EXPORT_JSON_INDENT` to indent | 58.9 | identical, files 48% of the size |
| Fetch obs once (#1) | 66.2 | identical |
| Worker pool, `EXPORT_PATIENTS_CONCURRENCY` (#3) | 69.9 | identical |
| Retries, failed list, request timeout (#5) | ~70–75 | identical |
| Drug order fix (#6): previousOrder not in the export is removed with a warning (now a separate PR, see below) | 70.6 | all 3,000 export |
| Warn when a search hits max results (#6) | 75.0 | identical |

Concurrency 10, 20, 40 and 80 all ran at ~70 patients/s: the source server is now the bottleneck.

Full SSPE export (54,268 patients):

| | Before | After |
|---|---|---|
| Time | 18 min 2 s (50.2 patients/s) | 12 min 11 s (74.2 patients/s) |
| Patients exported | 54,266 (2 failed: drug order recursion) | 54,268 |
| Size | 8.4 GB | 4.1 GB |

All 54,266 patients exported by both runs were identical after parsing.

The drug order recursion fix, which let the last 2 patients export, was measured as part of this work but is in a
separate PR with the other order fixes (HAI-1284), so the performance changes stay separate from data fixes.
Without it, those 2 patients still fail, now after retries, and are listed in `export-failed-patients.txt`.

Retry tests: pausing the source server for 25 s mid-run (10 s request timeout) led to 20 patients each
retrying twice and succeeding, with identical output; nonexistent patients fail on a 404 without retries
and are listed in `LOG_HOME/export-failed-patients.txt`; existing files are skipped.
