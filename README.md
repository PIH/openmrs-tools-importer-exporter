
# PIH OpenMRS Importer - Exporter App

To migrate a site's OpenMRS server into ZL Central, follow [migration/README.md](migration/README.md). It describes the numbered scripts in `migration/` (settings, test mode, every step in order, and the files they write). The rest of this file describes the importer and exporter themselves.

## Quick start

### Prerequisites

- Node v.20

Create a ".env" file from ".sample-env" and include the proper credentials, etc

### Install and Run

`npm install`

`node exportUsers.js`
`node importUsers.js`
`node verifyUsers.js` (checks that each imported user has access to `OPENMRS_SOURCE_FACILITY_UUID`, through the
`allowedVisitLocations` user property; problems go to `LOG_HOME/verify-users.csv`)

`node exportProviders.js`
`node importProviders.js`

`node exportPatients.js
`node importPatients.js
`

## Order numbers

`exportPatients.js` requires `ORDER_NUMBER_PREFIX`, set to the source site's dossier prefix (e.g. `SSPE`, `HSN`;
letters and digits only), and stops without exporting anything if it is missing. Every server numbers its orders
`ORD-1`, `ORD-2`, ..., so the export adds the prefix to each order number and to each "Test order number" obs
(`ORD-123` becomes `SSPE-ORD-123`), which keeps them unique on the target (UHM-8864). Accession numbers are copied as
they are (HAI-1316).

## Reports in LOG_HOME

The scripts write these files to `LOG_HOME`. They hold patient identifiers, so share them only through the site's
usual channels (not Jira).

- `app.log` (every script): the log. Besides errors and warnings it has one line for each voided order or encounter
  the import voids again on the target (HAI-1305, HAI-1306, see below).
- `invalid-identifiers.csv` (import): every patient identifier the import had to change for the target to accept
  the patient, for the site team to clean up. One row per change: `change`, `patient` (uuid), `zlEmrId`,
  `dossierNumber`, `identifierType`, `identifier`, `newIdentifierType`, `newIdentifier`. The changes are
  `invalidZlEmrId` (a ZL EMR ID that doesn't match the target's format is kept, but moved to the invalid identifier
  type, `INVALID_IDENTIFIER_TYPE_UUID`) and `duplicateIdentifier` (an identifier already used by another patient on
  the target gets the prefix `DPL-`). The ZL EMR ID and dossier number columns show the patient's values at the
  time of the change, so a duplicate row after an invalid ZL EMR ID move has an empty `zlEmrId`. This replaces the
  free-text `invalid-identifiers.log`.
- `source-data-fixes.csv` (export): every HAI-1306 source data fix (see below), one row per changed field: `rule`,
  `patient` (uuid), `list`, `uuid` (of the visit, encounter, order or obs), `field`, `from`, `to` and `review`. The
  `review` column holds the warning for a change that should still be checked (the warnings in `app.log` ending in
  "(review)"), and is empty otherwise.
- `source-data-review.csv` (export): the HAI-1306 cases left as they are for review, nothing changed (the warnings
  in `app.log` ending in "left as it is" or "left as they are"). One row per case: `rule`, `patient` (uuid), `list`,
  `uuid` and `details` (the warning). A case is in one of the two files, never both.
- `visits-before-birthdate.csv` (import): the HAI-1311 patients, see below.
- `verify-users.csv` (`verifyUsers.js`): the imported users that are missing on the target or whose
  `allowedVisitLocations` don't give them the source facility (or list a location twice, or one that isn't a visit
  location).
- `export-failed-patients.txt` (export, only if any patient failed).
- `export-metrics-<time>.json` and `import-metrics-<time>.json`: counts and request timings, no identifiers.







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
- **Visits that start before the patient's birthdate (HAI-1311).** Core rejects a visit that starts before the
  patient's birthdate, so these patients failed to import (9 SSPE, 12 HSN; HAI-1311 lists them for the sites to
  correct). Only the visit is checked against the birthdate, not a later change of the birthdate, so the import sets
  such a patient's birthdate to the day of their earliest visit, imports everything, then puts the source's birthdate
  (and whether it is estimated) back. The patient arrives as on the source, still with visits before the birthdate,
  and editing one of those visits in ZL Central will fail until the data is corrected. Each patient is counted in the
  import summary and listed in `LOG_HOME/visits-before-birthdate.csv` (patient uuid, ZL EMR ID, number of visits
  before the birthdate). Verification doesn't compare the patient's
  `dateChanged`/`changedBy` for these patients, since the birthdate updates set them and REST can't set them back.
  On by default; `IMPORT_VISITS_BEFORE_BIRTHDATE=false` turns it off. The code is in
  `src/services/visitsBeforeBirthdate.js`.
- **Source data the target's validation rejects (HAI-1306).** The export corrects a few patterns that SSPE and HSN
  accepted but today's core rejects, one rule at a time. Each change is listed in the patient file under
  `sourceDataFixesHAI1306` and in `LOG_HOME/source-data-fixes.csv` (rule, patient, order, field, old and new
  value, and a review note for a change that should still be checked); verification takes the changes into account.
  The cases left as they are for review are listed in `LOG_HOME/source-data-review.csv`. The code is in
  `src/services/sourceDataFixes.js`.
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
    when a drug order starts while an earlier order for the same drug (same concept, drug and care setting, neither
    replacing the other) is still active, the earlier one is stopped one second before it. When other orders refer to
    the earlier one as their previous order:
    - if they are all renewals (RENEW) that start after the later order has ended, the earlier order is **still
      stopped** before the later one. Its renewal then follows a gap: for example, an order that ran from day 0 to
      day 78 (when it was renewed), overlapped by another order from day 38 to day 73, now shows as stopped at day 38,
      with the renewal at day 78. Core accepts a renewal of an order that has already stopped. These are counted
      separately in the export summary ("...stopped before the next one (renewed later)") and logged with "(review)";
    - otherwise (a revision or discontinuation refers to it, which core would try to stop again, or a renewal that
      starts while the later order is still active, which would clash in its turn), it is left as it is and logged.
  - *Zero-dose Mixtard orders* (`FIX_ZERO_DOSE_MIXTARD`, on by default; `false` turns it off): HSN Mixtard 70/30
    insulin orders saved with a dose of 0 before core checked for it become free-text orders, with the dose cleared and
    instructions saying it wasn't recorded (no dose is made up). Only for that drug and only for orders that are voided
    or already expired; other zero-dose orders are logged and left as they are. The Outpatient Followup form shows
    these orders with a blank dose and without the free-text instructions.
  - *Return visit date saved as an admission location* (`FIX_RETURN_DATE_IN_ADMISSION_LOCATION`, on by default;
    `false` turns it off): the form bug UHM-3407 voids the "Return visit date" obs and stores its date as text in the
    disposition construct's "Admission location in hospital" obs, which then can't be saved. That obs becomes a
    top-level "Return visit date" with the date (what the manual cleanups did); a disposition construct left with no
    members is left out.
  - *Orders replaced by a revision in their own encounter* (`FIX_FORM_EDIT_VOIDED_TWINS`, on by default; `false` turns
    it off): revising an order in its own encounter makes htmlformentry void it and create a replacement, without
    moving dispenses or renewals that point to the voided order. When such a voided order would be carried over (for
    a dispense or as a previous order) it is left out instead, and what pointed to it points to the replacement.
  - *Drug's concept changed after it was ordered* (`FIX_DRUG_CONCEPT_CHANGED`, on by default; `false` turns it off):
    a drug order whose concept isn't its drug's current concept (the drug was re-mapped in the configuration later,
    e.g. UHM-9103) gets its drug's concept, since core rejects the mismatch on save. The drug list is read from the
    source once per export.
  - *Encounter and visit at different facilities* (`FIX_VISIT_LOCATION_OTHER_FACILITY`, on by default when
    `OPENMRS_SOURCE_FACILITY_UUID` is set; `false` turns it off): an encounter whose visit's location is neither the
    encounter's location nor one of its ancestors. pihcore's encounter validator removes such a visit on save, so the
    target would import the encounter without its visit (no error). Only when the visit holds just this encounter,
    the side at the other facility is moved to the source server's facility (`OPENMRS_SOURCE_FACILITY_UUID`):
    - an encounter outside the facility, in a visit at the facility, gets the visit's location;
    - a visit at another facility, holding an encounter within the facility, gets the facility as its location.

    Otherwise it is left as it is. Every case is logged with "(review)". HSN had 4 (2016 Mental Health Consults at
    Saint-Marc HSN / SSPE); the evidence pointed to HSN in all 4 (HAI-1312).
  - *Verification: text encoded twice* (always on; UHM-9691): free text has been stored HTML-encoded since mid-2025,
    and a note saved again gets encoded twice (`&lt;` becomes `&amp;lt;`). The target stores such a value with one
    level of encoding removed. Verification treats the two as equal only when the target's text is exactly the
    source's with that one level removed, logs each one, and prints the total at the end ("Obs text with one level
    of HTML encoding removed on the target"). Any other difference in the text still fails.
