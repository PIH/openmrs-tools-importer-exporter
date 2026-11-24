import {postDataIfNotExists} from "./openmrsService.js";
import * as voidedDispenseOrders from "./voidedDispenseOrders.js";
import * as visitsBeforeBirthdate from "./visitsBeforeBirthdate.js";
import logger from "../utils/logger.js";
import { appendCsvRows } from "../utils/csvLog.js";
import CONSTANTS from "../utils/constants.js";
import {generateStrongPassword} from "../utils/utils.js";
import config from "../utils/config.js";

const alreadyInUseRegex = /Username \S+ or system id \S+ is already in use/;
const duplicateIdentifierRegex = /^Identifier (\S+) already in use by another patient$/;
const invalidIdentifierRegex = /^Identifier "([^"]+)" does not match\s*:\s*"([^"]+)"$/;

// Scans an OpenMRS "identifier already in use" error for the offending identifier value, or returns null
function extractDuplicateIdentifier(err) {
  const globalErrors = err.response?.data?.error?.globalErrors;
  if (!globalErrors) {
    return null;
  }
  for (const globalError of globalErrors) {
    const match = duplicateIdentifierRegex.exec(globalError.message ?? globalError.code ?? "");
    if (match) {
      return match[1];
    }
  }
  return null;
}

// Scans an OpenMRS "identifier does not match" error for the offending identifier value, or returns null
function extractInvalidIdentifier(err) {
  const globalErrors = err.response?.data?.error?.globalErrors;
  if (!globalErrors) {
    return null;
  }
  for (const globalError of globalErrors) {
    const match = invalidIdentifierRegex.exec(globalError.message ?? globalError.code ?? "");
    if (match) {
      return match[1];
    }
  }
  return null;
}

// Identifiers the import had to change, one row each, for the site team to clean up: LOG_HOME/invalid-identifiers.csv
const IDENTIFIER_LOG_FILE = 'invalid-identifiers.csv';
const IDENTIFIER_LOG_HEADER = ['change', 'patient', 'zlEmrId', 'dossierNumber', 'identifierType', 'identifier',
  'newIdentifierType', 'newIdentifier'];

function identifierOfType(patient, typeUuid) {
  return patient.identifiers?.find((i) => i.identifierType?.uuid === typeUuid)?.identifier ?? '';
}

function identifierTypeName(identifierType) {
  return identifierType?.display ?? identifierType?.uuid ?? '';
}

// Call before the identifier is changed, so the ZL EMR ID and dossier number columns show the values as exported
function logIdentifierChange(change, patient, identifierEntry, newIdentifierType, newIdentifier) {
  const row = [change, patient.uuid,
    identifierOfType(patient, config.EMR_PATIENT_IDENTIFIER_TYPE_UUID),
    identifierOfType(patient, config.DOSSIER_NUMBER_IDENTIFIER_TYPE_UUID),
    identifierTypeName(identifierEntry.identifierType), identifierEntry.identifier, newIdentifierType, newIdentifier];
  logger.warn(`Patient ${patient.uuid}: ${change} ${identifierEntry.identifier} (${identifierTypeName(identifierEntry.identifierType)})` +
    ` changed to ${newIdentifier} (${newIdentifierType}), listed in ${IDENTIFIER_LOG_FILE}`);
  return appendCsvRows(IDENTIFIER_LOG_FILE, IDENTIFIER_LOG_HEADER, [row]);
}

function logDuplicateIdentifier(patient, identifierEntry) {
  return logIdentifierChange('duplicateIdentifier', patient, identifierEntry,
    identifierTypeName(identifierEntry.identifierType), `DPL-${identifierEntry.identifier}`);
}

function logInvalidIdentifier(patient, identifierEntry) {
  return logIdentifierChange('invalidZlEmrId', patient, identifierEntry,
    `invalid identifier type (${config.INVALID_IDENTIFIER_TYPE_UUID})`, identifierEntry.identifier);
}

export async function importUser(user) {

  logger.info(`Importing user ${user.uuid}`);

  // add a random password to the user (we are not copying over passwords, but users require passwords)
  user.password = generateStrongPassword(32);

  try {
    await postDataIfNotExists(CONSTANTS.TARGET.URLS.USER, user, user.uuid);
  } catch (err) {
    if (err.response?.data?.error?.message && alreadyInUseRegex.test(err.response?.data?.error?.message)) {
      logger.info(`Skipping user ${user.username} because username already in use`);
      return;
    }

    logger.error(`Failed to import user ${user.uuid}: ${err.message}`);
    if (err.response?.data?.error?.detail) {
      logger.error(err.response.data.error.detail);
    }
    throw err;
  }
}

export async function importProvider(provider) {

  logger.info(`Importing provider ${provider.uuid}`);

  try {
    await postDataIfNotExists(CONSTANTS.TARGET.URLS.PROVIDER, provider, provider.uuid);
  } catch (err) {
    logger.error(`Failed to import provider ${provider.uuid}: ${err.message}`);
    if (err.response?.data?.error?.detail) {
      logger.error(err.response.data.error.detail);
    }
    throw err;
  }
}

export async function importRelationship(relationship) {

  logger.info(`Importing relationship ${relationship.uuid}`);

  try {
    await postDataIfNotExists(CONSTANTS.TARGET.URLS.RELATIONSHIP, relationship, relationship.uuid);
  } catch (err) {
    logger.error(`Failed to import relationship ${relationship.uuid}: ${err.message}`);
    if (err.response?.data?.error?.detail) {
      logger.error(err.response.data.error.detail);
    }
    throw err;
  }
}

export async function importPerson(person) {
    logger.info(`Importing person ${person.uuid}`);

    try {
        await postDataIfNotExists(CONSTANTS.TARGET.URLS.PERSON, person, person.uuid);
    } catch (err) {
        logger.error(`Failed to import person ${person.uuid}: ${err.message}`);
        if (err.response?.data?.error?.detail) {
            logger.error(err.response.data.error.detail);
        }
        if (err.response?.data?.error?.globalErrors) {
            logger.error(JSON.stringify(err.response.data.error.globalErrors));
        }
        throw err;
    }
}

export async function importPatient(record) {
  const patient = record.patient;
  logger.info(`Importing patient ${patient.uuid}`);

  // include the person date created and person creator on the patient as that is the way the REST module processes it
  patient.personDateCreated = patient.person?.dateCreated;
  patient.personCreator = patient.person?.creator;
  patient.personDateChanged = patient.person?.dateChanged;
  patient.personChangedBy = patient.person?.changedBy;

  // add Health Center person attribute if configured and not already present
  if (config.OPENMRS_HEALTH_CENTER_ATTRIBUTE_UUID && config.OPENMRS_SOURCE_FACILITY_UUID) {
    if (!patient.person.attributes) {
      patient.person.attributes = [];
    }
    const hasHealthCenterAttribute = patient.person.attributes.some(
      (attribute) => attribute.attributeType?.uuid === config.OPENMRS_HEALTH_CENTER_ATTRIBUTE_UUID
    );
    if (!hasHealthCenterAttribute) {
      patient.person.attributes.push({
        attributeType: { uuid: config.OPENMRS_HEALTH_CENTER_ATTRIBUTE_UUID },
        value: config.OPENMRS_SOURCE_FACILITY_UUID,
      });
    }
  }

  let retriedDuplicateIdentifier = false;
  let retriedInvalidIdentifier = false;
  let patientResult;
  while (true) {
    try {
      patientResult = await postDataIfNotExists(CONSTANTS.TARGET.URLS.PATIENT, patient, patient.uuid);
      break;
    } catch (err) {
      // if this is a "duplicate identifier" error, append the identifier with "DPL-" and try again
      const duplicateIdentifier = !retriedDuplicateIdentifier && extractDuplicateIdentifier(err);
      const duplicateIdentifierEntry = duplicateIdentifier && patient.identifiers?.find((i) => i.identifier === duplicateIdentifier);
      if (duplicateIdentifierEntry) {
        retriedDuplicateIdentifier = true;
        await logDuplicateIdentifier(patient, duplicateIdentifierEntry);
        duplicateIdentifierEntry.identifier = `DPL-${duplicateIdentifierEntry.identifier}`;
        continue;
      }

      // if this is an "identifier does not match" error, reclassify the ZL EMR ID identifier
      // as a User Generated Reference Number and try again
      const invalidIdentifier = !retriedInvalidIdentifier && extractInvalidIdentifier(err);
      const invalidIdentifierEntry = invalidIdentifier && patient.identifiers?.find(
        (i) => i.identifier === invalidIdentifier && i.identifierType?.uuid === config.EMR_PATIENT_IDENTIFIER_TYPE_UUID
      );
      if (invalidIdentifierEntry) {
        retriedInvalidIdentifier = true;
        await logInvalidIdentifier(patient, invalidIdentifierEntry);
        invalidIdentifierEntry.identifierType = { uuid: config.INVALID_IDENTIFIER_TYPE_UUID };
        continue;
      }

      logger.error(`Failed to import patient ${patient.uuid}: ${err.message}`);
      logRestError(err);
      throw err;
    }
  }

  // A patient created just now can't have any visits, encounters, etc. yet, so skip their existence checks.
  // If the patient already existed (a resumed run or a retry), check each one as before.
  const childOptions = { skipExistenceCheck: patientResult === 'created' };

  // TEMPORARY (HAI-1311): a birthdate after the patient's first visit would make its visits fail
  await visitsBeforeBirthdate.setTemporaryBirthdate(record);

  for (const visit of record.visits) {
    try {
      await postDataIfNotExists(CONSTANTS.TARGET.URLS.VISIT, visit, visit.uuid, childOptions);
      logger.debug(`Imported visit ${visit.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import visit ${visit.uuid}: ${err.message}`);
      logRestError(err);
      throw err;
    }
  }

  for (const encounter of record.encounters) {
    try {
      await postDataIfNotExists(CONSTANTS.TARGET.URLS.ENCOUNTER, encounter, encounter.uuid, childOptions);
      logger.debug(`Imported encounter ${encounter.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import encounter ${encounter.uuid}: ${err.message}`);
      logRestError(err);
      throw err;
    }
  }

  for (const obs of record.obs) {
    try {
      await postDataIfNotExists(CONSTANTS.TARGET.URLS.OBS, obs, obs.uuid, childOptions);
      logger.debug(`Imported obs ${obs.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import obs ${obs.uuid}: ${err.message}`);
      logRestError(err);
      throw err;
    }
  }

  for (const testOrder of record.testOrders) {
    try {
      await postDataIfNotExists(CONSTANTS.TARGET.URLS.ORDER, testOrder, testOrder.uuid, childOptions);
      logger.debug(`Imported test order ${testOrder.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import test order ${testOrder.uuid}: ${err.message}`);
      logRestError(err);
      throw err;
    }
  }

  // TEMPORARY (HAI-1305)
  await voidedDispenseOrders.importVoidedRecordsBeforeDrugOrders(record);

  for (const drugOrder of record.drugOrders) {
    try {
      await voidedDispenseOrders.importVoidedPreviousOrderFor(record, drugOrder);   // TEMPORARY (HAI-1306)
      await postDataIfNotExists(CONSTANTS.TARGET.URLS.ORDER, drugOrder, drugOrder.uuid, childOptions);
      logger.debug(`Imported drug order ${drugOrder.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import drug order ${drugOrder.uuid}: ${err.message}`);
      logRestError(err);
      throw err;
    }
  }

  // TEMPORARY (HAI-1305)
  await voidedDispenseOrders.importVoidedRecordsAfterDrugOrders(record);

  for (const medicationDispense of record.medicationDispenses) {
    try {
      await postDataIfNotExists(CONSTANTS.TARGET.URLS.MEDICATION_DISPENSE, medicationDispense, medicationDispense.uuid, childOptions);
      logger.debug(`Imported medication dispense ${medicationDispense.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import medication dispense ${medicationDispense.uuid}: ${err.message}`);
      logRestError(err);
      throw err;
    }
  }


  for (const programEnrollment of record.programEnrollments) {
    // we need to submit any states associated with the program separately to avoid the automatic state transition logic baked into REST web services
    const states = programEnrollment.states;
    delete programEnrollment.states;

    try {
      await postDataIfNotExists(CONSTANTS.TARGET.URLS.PROGRAM_ENROLLMENT, programEnrollment, programEnrollment.uuid, childOptions);
      logger.debug(`Imported program enrollment ${programEnrollment.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import program enrollment ${programEnrollment.uuid}: ${err.message}`);
      logRestError(err);
      throw err;
    }

    if (states) {
      for (const state of states) {
        try {
          await postDataIfNotExists(`${CONSTANTS.TARGET.URLS.PROGRAM_ENROLLMENT}/${programEnrollment.uuid}/state`, state, state.uuid, childOptions);
          logger.debug(`Imported patient state ${state.uuid} for program ${programEnrollment.uuid}`);
        } catch (err) {
          logger.error(`Failed to import patient state ${state.uuid}: ${err.message}`);
          logRestError(err);
          throw err;
        }
      }
    }
  }

  for (const allergy of record.allergies) {
    try {
      await postDataIfNotExists(`${CONSTANTS.TARGET.URLS.PATIENT}/${patient.uuid}/allergy`, allergy, allergy.uuid, childOptions);
      logger.debug(`Imported allergy ${allergy.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import allergy ${allergy.uuid}: ${err.message}`);
      logRestError(err);
      throw err;
    }
  }

  // TEMPORARY (HAI-1311)
  await visitsBeforeBirthdate.restoreBirthdate(record);
}

// Logs the reason OpenMRS gave for rejecting a request: the message and Java detail, and for validation
// errors (HTTP 400) the global and per-field errors, which otherwise go unreported
function logRestError(err) {
  const error = err.response?.data?.error;
  if (!error) {
    return;
  }
  if (error.message) {
    logger.error(error.message);
  }
  if (error.detail) {
    logger.error(error.detail);
  }
  if (error.globalErrors?.length) {
    logger.error(`globalErrors: ${JSON.stringify(error.globalErrors)}`);
  }
  if (error.fieldErrors && Object.keys(error.fieldErrors).length) {
    logger.error(`fieldErrors: ${JSON.stringify(error.fieldErrors)}`);
  }
}
