
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







## Temporary workarounds

- **Voided drug orders behind medication dispenses (HAI-1305).** Some dispenses point to drug orders that were
  voided later (with their encounter, or by a form edit). The export now includes those voided orders, and their
  encounters if voided, under `voidedRecordsForDispenses`; the import posts them and voids them again on the target
  with the reason "copied from source server due to HAI-1305", so the dispenses import as they are. On by default;
  set `INCLUDE_VOIDED_DISPENSE_ORDERS=false` to turn it off. The code is in `src/services/voidedDispenseOrders.js`.
