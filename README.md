
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
- **Voided previous orders (HAI-1306).** Some orders revise, renew or discontinue an order that was voided afterwards
  (its encounter deleted, or removed from its form). The export includes those voided previous orders, and their
  encounters if voided, under `voidedRecordsForDispenses.voidedPreviousOrders`; the import posts each one just before
  the order that refers to it, so that order stops it as on the source, and voids it again afterwards with the reason
  "copied from source server due to HAI-1306". On by default; set `INCLUDE_VOIDED_PREVIOUS_ORDERS=false` to turn it
  off. Same module as above.
- **Source data the target's validation rejects (HAI-1306).** The export corrects a few patterns that SSPE and HSN
  accepted but today's core rejects, one rule at a time. Each change is listed in the patient file under
  `sourceDataFixesHAI1306` and in `LOG_HOME/source-data-fixes.csv` (rule, patient, order, field, old and new
  value); verification takes the changes into account. The code is in `src/services/sourceDataFixes.js`.
  - *Encounters after their visit's stop* (`FIX_VISIT_STOP_FOR_ENCOUNTERS`, on by default; `false` turns it off): a
    visit's stop is extended to an encounter dated after it, if the encounter is on the same day as the visit's stop
    and the extended visit wouldn't reach a later visit; other cases are logged for review and left as they are.
  - *Orders before their encounter* (`FIX_ORDER_BEFORE_ENCOUNTER`, on by default; `false` turns it off): an order
    activated before its encounter (the encounter was moved later to fit its visit, without its orders) is activated
    at the encounter's time.
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
  - *Stopped before it started, with no stopping order* (`FIX_STOP_WITHOUT_STOPPER`, on by default; `false` turns it
    off): an order whose renewal was voided but which stayed stopped (before it started) has its stop date cleared,
    as core does when a discontinuation or revision is voided.
  - *Auto-expire one second before the start* (`FIX_AUTO_EXPIRE_BEFORE_START`, on by default; `false` turns it off): a
    drug order with a duration of 0 (core sets its auto-expire one second before its start) expires at its start.
  - *Overlapping drug orders for the same drug* (`FIX_OVERLAPPING_DRUG_ORDERS`, on by default; `false` turns it off):
    when a drug order starts while an earlier order for the same drug is still active, the earlier one is stopped one
    second before it. Left as it is (and logged) when another order stops the earlier one.
