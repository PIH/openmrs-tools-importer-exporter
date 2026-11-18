
# PIH OpenMRS Importer - Exporter App

## Quick start

### Prerequisites

- Node v.20

Create a ".env" file from ".sample-env" and include the proper credentials, etc

### Install and Run

`npm install`

`node exportUsers.js`
`node importUsers.js`

`node exportProviders.js`
`node importProviders.js`

`node exportPatients.js
`node importPatients.js
`







## Temporary fallbacks

### Skipping medication dispenses whose drug order isn't in the export (HAI-1305)

**Temporary, to let migration testing move forward. Remove it once HAI-1305 is done.**

Some medication dispenses point to a drug order that was voided after the medication was dispensed (UHM-9678).
The export leaves out voided orders, so such a dispense can't be imported, and by default the whole patient fails.

With `IMPORT_SKIP_MEDICATION_DISPENSES_WITHOUT_ORDER=true`, `importPatients.js` instead imports the patient
without that dispense. It logs a warning and adds a line to `LOG_HOME/skipped-medication-dispenses.txt`
(patient uuid, dispense uuid, drug order uuid). Those dispenses are then missing from the target, so use this
only for testing, or as a last-resort safety net after the source data cleanup in HAI-1305.
