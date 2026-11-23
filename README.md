
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
- **Source data the target's validation rejects (HAI-1306).** The export corrects a few patterns that SSPE and HSN
  accepted but today's core rejects, one rule at a time. Each change is listed in the patient file under
  `sourceDataFixesHAI1306` and in `LOG_HOME/source-data-fixes.csv` (rule, patient, order, field, old and new
  value); verification takes the changes into account. The code is in `src/services/sourceDataFixes.js`.
  - *Same-second renewals* (`FIX_SAME_SECOND_RENEWALS`, on by default; `false` turns it off): a RENEW order
    activated in the same second as the order it renews is moved one second later, and the previous order is
    stopped at its own activation time instead of one second before it.
  - *Renewal stop dates on the day before* (`FIX_RENEWAL_STOP_DAY_BEFORE`, on by default; `false` turns it off): an
    order renewed later the same day but stopped at 23:59:59 the day before is stopped one second before its
    renewal instead.
  - *Lab cancellation times* (`FIX_LAB_CANCEL_TIMES`, on by default; `false` turns it off): a lab order cancellation
    dated before the order it cancels (the lab orders page sent the browser's time, 3 hours behind) is moved, with its
    own encounter, to the time it was entered (or the visit's stop, if the visit had ended), and the cancelled order is
    stopped one second before it.
  - *Renewals before the order they renew* (`FIX_RENEWALS_BEFORE_ORIGINAL`, on by default; `false` turns it off): a
    renewal entered later in a form dated at the visit's start, before the order it renews, is moved to one second
    after that order, which is stopped at its own activation time.
