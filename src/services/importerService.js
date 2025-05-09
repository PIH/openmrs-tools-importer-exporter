import { postDataIfNotExists } from "./openmrsService.js";
import logger from "../utils/logger.js";
import config from "../utils/config.js";

const URLS = {
  patient: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/patient`,
  visit: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/visit`,
  encounter: `${config.OPENMRS_TARGET_CONTEXT_PATH}/ws/rest/v1/encounter`,
};

export async function importPatient(record) {
  const patient = record.patient;
  logger.info(`Importing patient ${patient.uuid}`);

  try {
    await postDataIfNotExists(URLS.patient, patient, patient.uuid);
  } catch (err) {
    logger.error(`Failed to import patient: ${err.message}`);
    if (err.response?.data?.error?.detail) {
      logger.error(err.response.data.error.detail);
    }
    throw err;
  }

  for (const visit of record.visits) {
    try {
      await postDataIfNotExists(URLS.visit, visit, visit.uuid);
      logger.info(`Imported visit ${visit.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import visit: ${err.message}`);
      if (err.response?.data?.error?.detail) {
        logger.error(err.response.data.error.detail);
      }
      throw err;
    }
  }

  for (const encounter of record.encounters) {
    try {
      await postDataIfNotExists(URLS.encounter, encounter, encounter.uuid);
      logger.info(`Imported encounter ${encounter.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import encounter: ${err.message}`);
      if (err.response?.data?.error?.detail) {
        logger.error(err.response.data.error.detail);
      }
      throw err;
    }
  }

  logger.info(`Finished importing patient ${patient.uuid}`);
}
