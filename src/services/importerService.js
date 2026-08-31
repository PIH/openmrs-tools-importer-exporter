import {postDataIfNotExists} from "./openmrsService.js";
import logger, {duplicateIdentifierLogger} from "../utils/logger.js";
import CONSTANTS from "../utils/constants.js";
import {generateStrongPassword} from "../utils/utils.js";
import config from "../utils/config.js";

const alreadyInUseRegex = /Username \S+ or system id \S+ is already in use/;
const duplicateIdentifierRegex = /^Identifier (\S+) already in use by another patient$/;

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

function logDuplicateIdentifier(patient, identifierEntry) {
  const zlEmrIdEntry = patient.identifiers?.find(
    (i) => i.identifierType?.uuid === CONSTANTS.ZL_EMR_PATIENT_IDENTIFIER_TYPE_UUID
  );
  const zlEmrId = zlEmrIdEntry?.identifier ?? patient.uuid;
  const identifierType = identifierEntry.identifierType?.display ?? identifierEntry.identifierType?.uuid;
  const message = `Patient ${zlEmrId} has duplicate identifier ${identifierEntry.identifier} of type ${identifierType}. Converting to DPL-${identifierEntry.identifier} and importing`;
  duplicateIdentifierLogger.info(message);
  logger.warn(message);
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
  while (true) {
    try {
      await postDataIfNotExists(CONSTANTS.TARGET.URLS.PATIENT, patient, patient.uuid);
      break;
    } catch (err) {
      // if this is a "duplicate identifier" error, append the identifier with "DPL-" and try again
      const duplicateIdentifier = !retriedDuplicateIdentifier && extractDuplicateIdentifier(err);
      const identifierEntry = duplicateIdentifier && patient.identifiers?.find((i) => i.identifier === duplicateIdentifier);
      if (identifierEntry) {
        retriedDuplicateIdentifier = true;
        logDuplicateIdentifier(patient, identifierEntry);
        identifierEntry.identifier = `DPL-${identifierEntry.identifier}`;
        continue;
      }

      logger.error(`Failed to import patient ${patient.uuid}: ${err.message}`);
      if (err.response?.data?.error?.detail) {
        logger.error(err.response.data.error.detail);
      }
      if(err.response?.data?.error?.globalErrors) {
          logger.error(JSON.stringify(err.response.data.error.globalErrors));
      }
      throw err;
    }
  }

  for (const visit of record.visits) {
    try {
      await postDataIfNotExists(CONSTANTS.TARGET.URLS.VISIT, visit, visit.uuid);
      logger.info(`Imported visit ${visit.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import visit ${visit.uuid}: ${err.message}`);
      if (err.response?.data?.error?.detail) {
        logger.error(err.response.data.error.detail);
      }
        if(err.response?.data?.error?.globalErrors) {
            logger.error(JSON.stringify(err.response.data.error.globalErrors));
        }
      throw err;
    }
  }

  for (const encounter of record.encounters) {
    try {
      await postDataIfNotExists(CONSTANTS.TARGET.URLS.ENCOUNTER, encounter, encounter.uuid);
      logger.info(`Imported encounter ${encounter.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import encounter ${encounter.uuid}: ${err.message}`);
      if (err.response?.data?.error?.detail) {
        logger.error(err.response.data.error.detail);
      }
      if(err.response?.data?.error?.globalErrors) {
         logger.error(JSON.stringify(err.response.data.error.globalErrors));
      }
      throw err;
    }
  }

  for (const obs of record.obs) {
    try {
      await postDataIfNotExists(CONSTANTS.TARGET.URLS.OBS, obs, obs.uuid);
      logger.info(`Imported obs ${obs.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import obs ${obs.uuid}: ${err.message}`);
      if (err.response?.data?.error?.detail) {
        logger.error(err.response.data.error.detail);
      }
      if(err.response?.data?.error?.globalErrors) {
        logger.error(JSON.stringify(err.response.data.error.globalErrors));
      }
      throw err;
    }
  }

  for (const testOrder of record.testOrders) {
    try {
      await postDataIfNotExists(CONSTANTS.TARGET.URLS.ORDER, testOrder, testOrder.uuid);
      logger.info(`Imported test order ${testOrder.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import test order ${testOrder.uuid}: ${err.message}`);
      if (err.response?.data?.error?.detail) {
        logger.error(err.response.data.error.detail);
      }
      throw err;
    }
  }

  for (const drugOrder of record.drugOrders) {
    try {
      await postDataIfNotExists(CONSTANTS.TARGET.URLS.ORDER, drugOrder, drugOrder.uuid);
      logger.info(`Imported drug order ${drugOrder.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import drug order ${drugOrder.uuid}: ${err.message}`);
      if (err.response?.data?.error?.detail) {
        logger.error(err.response.data.error.detail);
      }
      throw err;
    }
  }

  for (const medicationDispense of record.medicationDispenses) {
    try {
      await postDataIfNotExists(CONSTANTS.TARGET.URLS.MEDICATION_DISPENSE, medicationDispense, medicationDispense.uuid);
      logger.info(`Imported medication dispense ${medicationDispense.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import medication dispense ${medicationDispense.uuid}: ${err.message}`);
      if (err.response?.data?.error?.detail) {
        logger.error(err.response.data.error.detail);
      }
      throw err;
    }
  }


  for (const programEnrollment of record.programEnrollments) {
    // we need to submit any states associated with the program separately to avoid the automatic state transition logic baked into REST web services
    const states = programEnrollment.states;
    delete programEnrollment.states;

    try {
      await postDataIfNotExists(CONSTANTS.TARGET.URLS.PROGRAM_ENROLLMENT, programEnrollment, programEnrollment.uuid);
      logger.info(`Imported program enrollment ${programEnrollment.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import program enrollment ${programEnrollment.uuid}: ${err.message}`);
      if (err.response?.data?.error?.detail) {
        logger.error(err.response.data.error.detail);
      }
      throw err;
    }

    if (states) {
      for (const state of states) {
        try {
          await postDataIfNotExists(`${CONSTANTS.TARGET.URLS.PROGRAM_ENROLLMENT}/${programEnrollment.uuid}/state`, state, state.uuid);
          logger.info(`Imported patient state ${state.uuid} for program ${programEnrollment.uuid}`);
        } catch (err) {
          logger.error(`Failed to import patient state ${state.uuid}: ${err.message}`);
          if (err.response?.data?.error?.detail) {
            logger.error(err.response.data.error.detail);
          }
          throw err;
        }
      }
    }
  }

  for (const allergy of record.allergies) {
    try {
      await postDataIfNotExists(`${CONSTANTS.TARGET.URLS.PATIENT}/${patient.uuid}/allergy`, allergy, allergy.uuid);
      logger.info(`Imported allergy ${allergy.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import allergy ${allergy.uuid}: ${err.message}`);
      if (err.response?.data?.error?.detail) {
        logger.error(err.response.data.error.detail);
      }
      throw err;
    }
  }
}
