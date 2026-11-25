// TEMPORARY (HAI-1311): imports patients whose visits start before their birthdate. Some SSPE and HSN patients have
// visits that start before the birthdate (HAI-1311 lists them for the sites to correct). Core's VisitValidator
// rejects such a visit when it is saved (Visit.startDateCannotFallBeforeTheBirthDateOfTheSamePatient), so the whole
// patient failed to import. It is the only check that compares anything with the birthdate: Person/PatientValidator
// don't look at visits, and encounters, obs and orders aren't checked against it. That is how the source got this
// way: the birthdate was changed after the visits were entered.
//
// Import: for such a patient (using the same estimated-birthdate margin as the validator), after the patient is created (or found, on a rerun), set the target's birthdate to the
// day of the earliest visit, import everything as usual, then put the source's birthdate (and whether it is
// estimated) back. If the import fails part way, the patient keeps the temporary birthdate until a rerun puts it
// back. Each patient is counted and listed (patient uuid, ZL EMR ID and number of visits before the birthdate) in
// LOG_HOME/visits-before-birthdate.csv, so the sites can still correct them in ZL Central (HAI-1311). Note that
// anyone who edits one of these visits later in ZL Central will get the validation error until the data is corrected.
// The two birthdate updates record the import as a change of the patient (dateChanged and changedBy of the patient and
// its person), which REST doesn't allow setting; verification doesn't compare those fields for these patients.
//
// On by default; IMPORT_VISITS_BEFORE_BIRTHDATE=false turns it off. To remove: delete this file and its calls in
// importerService.js.
import CONSTANTS from "../utils/constants.js";
import config from "../utils/config.js";
import { appendCsvRows } from "../utils/csvLog.js";
import logger from "../utils/logger.js";
import { increment } from "../utils/metrics.js";
import { postData } from "./openmrsService.js";

const LOG_FILE = 'visits-before-birthdate.csv';

export function isEnabled() {
  return config.IMPORT_VISITS_BEFORE_BIRTHDATE !== 'false';
}

// The birthdate core's VisitValidator compares with, as in getPatientBirthdateAdjustedIfEstimated: an estimated
// birthdate is moved back by the larger of 1 year and half the patient's age (age now, or at death)
function birthdateAsValidated(person) {
  const birthdate = new Date(Date.parse(person?.birthdate ?? ''));
  if (Number.isNaN(birthdate.getTime()) || !person.birthdateEstimated) {
    return birthdate;
  }
  const end = person.deathDate ? new Date(Date.parse(person.deathDate)) : new Date();
  let age = end.getFullYear() - birthdate.getFullYear();
  if (end.getMonth() < birthdate.getMonth() || (end.getMonth() === birthdate.getMonth() && end.getDate() < birthdate.getDate())) {
    age--;
  }
  const grace = Math.min(-1, Math.ceil(age * -0.5));
  const adjusted = new Date(birthdate);
  adjusted.setFullYear(adjusted.getFullYear() + grace);
  return adjusted;
}

// The visits that core would reject for starting before the birthdate in the file, or [] if none (or turned off)
function visitsBeforeBirthdate(record) {
  const birthdate = birthdateAsValidated(record.patient?.person).getTime();
  if (!isEnabled() || Number.isNaN(birthdate)) {
    return [];
  }
  return (record.visits ?? []).filter(v => Date.parse(v.startDatetime) < birthdate);
}

/** Call after the patient is created (or found) and before its visits are posted. */
export async function setTemporaryBirthdate(record) {
  const visits = visitsBeforeBirthdate(record);
  if (visits.length === 0) {
    return;
  }
  const earliest = [...visits].sort((a, b) => Date.parse(a.startDatetime) - Date.parse(b.startDatetime))[0];
  const temporary = `${earliest.startDatetime.slice(0, 10)}T00:00:00`;   // the day of the earliest visit, local time
  await postData(`${CONSTANTS.TARGET.URLS.PERSON}/${record.patient.uuid}`, { birthdate: temporary, birthdateEstimated: false });
  logger.warn(`Patient ${record.patient.uuid}: ${visits.length} visit(s) start before the birthdate; birthdate set to the earliest visit's day until the import is done (HAI-1311)`);
}

/** Call after everything else for the patient is imported: puts the source's birthdate back and lists the patient. */
export async function restoreBirthdate(record) {
  const visits = visitsBeforeBirthdate(record);
  if (visits.length === 0) {
    return;
  }
  const person = record.patient.person;
  await postData(`${CONSTANTS.TARGET.URLS.PERSON}/${record.patient.uuid}`,
    { birthdate: person.birthdate, birthdateEstimated: !!person.birthdateEstimated });
  increment('patients imported with visits before their birthdate (HAI-1311)');
  await appendCsvRows(LOG_FILE, ['patient', 'zlEmrId', 'visitsBeforeBirthdate'],
    [[record.patient.uuid, zlEmrId(record.patient), visits.length]]);
}

// The patient's ZL EMR ID as exported. If the import moved an invalid one to the invalid identifier type, that one.
function zlEmrId(patient) {
  const ofType = (typeUuid) => patient.identifiers?.find((i) => i.identifierType?.uuid === typeUuid)?.identifier;
  return ofType(config.EMR_PATIENT_IDENTIFIER_TYPE_UUID) ?? ofType(config.INVALID_IDENTIFIER_TYPE_UUID) ?? '';
}

let normalized = 0;

/** How many patients normalizeForVerification has matched so far. */
export function normalizedCount() {
  return normalized;
}

/**
 * Call on the target record and the file contents before verification compares them. The two birthdate updates
 * above record the import as a change of the patient (dateChanged, changedBy on the patient and its person), and REST
 * doesn't allow setting those, so for these patients the file's values are put on the target record.
 */
export function normalizeForVerification(targetRecord, fileRecord) {
  if (visitsBeforeBirthdate(fileRecord).length === 0 || !targetRecord?.patient) {
    return;
  }
  for (const [target, file] of [[targetRecord.patient, fileRecord.patient], [targetRecord.patient.person, fileRecord.patient.person]]) {
    if (!target || !file) {
      continue;
    }
    for (const field of ['dateChanged', 'changedBy']) {
      if (field in file) {
        target[field] = file[field];
      } else {
        delete target[field];
      }
    }
  }
  normalized++;
}
