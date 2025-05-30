import { postDataIfNotExists } from "./openmrsService.js";
import logger from "../utils/logger.js";
import CONSTANTS from "../utils/constants.js";
import {generateStrongPassword} from "../utils/utils.js";

const alreadyInUseRegex = /Username \S+ or system id \S+ is already in use/;

export async function importUser(user) {

  if (user.username === 'daemon') {
    logger.info(`Skipping user ${user.uuid} because it is the daemon user`);
    return;
  }

  if (user.username === 'admin') {
    logger.info(`Skipping user ${user.uuid} because it is the admin user`);
    return;
  }

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

    logger.error(`Failed to import user: ${err.message}`);
    if (err.response?.data?.error?.detail) {
      logger.error(err.response.data.error.detail);
    }
    throw err;
  }
}

export async function importProvider(provider) {

  if (provider.identifier === "UNKNOWN") {
    logger.info(`Skipping provider ${provider.uuid} because it is the UNKNOWN provider`);
    return;
  }

  logger.info(`Importing provider ${provider.uuid}`);

  try {
    await postDataIfNotExists(CONSTANTS.TARGET.URLS.PROVIDER, provider, provider.uuid);
  } catch (err) {
    logger.error(`Failed to import provider: ${err.message}`);
    if (err.response?.data?.error?.detail) {
      logger.error(err.response.data.error.detail);
    }
    throw err;
  }
}

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
}
