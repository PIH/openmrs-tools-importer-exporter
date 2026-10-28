# Patient export performance notes

Analysis done 2026-10-28, based on the code as of commit `a2e18aa` and de-identified aggregates from
`src/logs/app.log`. Nothing here has been implemented yet. The export is already much faster than the import (see
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
