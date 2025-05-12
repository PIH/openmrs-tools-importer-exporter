import { postDataIfNotExists } from "./openmrsService.js";
import logger from "../utils/logger.js";
import CONSTANTS from "../utils/constants.js";

export async function importPatient(record) {
  const patient = record.patient;
  logger.info(`Importing patient ${patient.uuid}`);

  try {
    await postDataIfNotExists(CONSTANTS.TARGET.URLS.PATIENT, patient, patient.uuid);
  } catch (err) {
    logger.error(`Failed to import patient: ${err.message}`);
    if (err.response?.data?.error?.detail) {
      logger.error(err.response.data.error.detail);
    }
    throw err;
  }

  for (const visit of record.visits) {
    try {
      await postDataIfNotExists(CONSTANTS.TARGET.URLS.VISIT, visit, visit.uuid);
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
      await postDataIfNotExists(CONSTANTS.TARGET.URLS.ENCOUNTER, encounter, encounter.uuid);
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
