require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('./logger');
const fsPromises = fs.promises;

const OPENMRS_CONTEXT_PATH = process.env.OPENMRS_TARGET_CONTEXT_PATH;
const AUTH = {
  username: process.env.OPENMRS_TARGET_USERNAME,
  password: process.env.OPENMRS_TARGET_PASSWORD,
};
const TARGET_DIR = process.env.TARGET_DIRECTORY;
const SUCCESS_DIR = path.join(TARGET_DIR, 'successful');
const FAILED_DIR = path.join(TARGET_DIR, 'failed');

const URLS = {
  patient: `${OPENMRS_CONTEXT_PATH}/ws/rest/v1/patient`,
  visit: `${OPENMRS_CONTEXT_PATH}/ws/rest/v1/visit`,
  encounter: `${OPENMRS_CONTEXT_PATH}/ws/rest/v1/encounter`,
};

// Try to GET a resource by UUID; if 404, POST it instead
async function postIfNotExists(resourceUrl, data, uuid) {
  try {
    const getUrl = `${resourceUrl}/${uuid}`;
    const response = await axios.get(getUrl, {auth: AUTH});
    if (response.data?.uuid === uuid) {
      logger.info(`Resource already exists: ${getUrl}`);
    }
    if (typeof response.data === 'string') {
      throw new Error('Bad Response - Unauthenticated?');
    }
  } catch (err) {
    if (err.response && err.response.status === 404) {
      await axios.post(resourceUrl, data, { auth: AUTH });
      logger.info(`Created new resource at ${resourceUrl}`);
    } else {
      throw err;
    }
  }
}

async function importPatientRecord(record) {
  const patient = record.patient;
  logger.info(`Importing patient ${patient.uuid}`);

  await postIfNotExists(URLS.patient, patient, patient.uuid);

  for (const visit of record.visits) {
    try {
      const response = await axios.post(URLS.visit, visit, { auth: AUTH });
      if (typeof response.data === 'string') {
        throw new Error('Bad Response - Unauthenticated?');
      }
      logger.info(`Imported visit for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import visit: ${err.message}`);
      throw err;
    }
  }

  for (const encounter of record.encounters) {
    try {
      await postIfNotExists(URLS.encounter, encounter, encounter.uuid);
      logger.info(`Imported encounter ${encounter.uuid} for patient ${patient.uuid}`);
    } catch (err) {
      logger.error(`Failed to import encounter: ${err.message}`);
      throw err;
    }
  }

  logger.info(`Finished importing patient ${patient.uuid}`);
}

async function moveFile(filePath, destinationDir) {
  try {
    const fileName = path.basename(filePath);
    const destinationPath = path.join(destinationDir, fileName);

    // Ensure the destination directory exists
    await fsPromises.mkdir(destinationDir, { recursive: true });

    await fsPromises.rename(filePath, destinationPath);
    logger.info(`Moved file to ${destinationDir}: ${filePath}`);
  } catch (err) {
    logger.error(`Failed to move file: ${err.message}`);
  }
}

async function importAllPatients() {
  const files = fs.readdirSync(TARGET_DIR).filter(f => f.endsWith('_patient.json'));

  for (const file of files) {
    const filePath = path.join(TARGET_DIR, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const patientRecords = JSON.parse(content);
      for (const record of patientRecords) {
        await importPatientRecord(record);
      }

      // If import was successful, move the file to "successful"
      await moveFile(filePath, SUCCESS_DIR);
    } catch (err) {
      logger.error(`Failed to import from file ${file}: ${err.message}`);

      // If error occurs, move the file to "failed"
      await moveFile(filePath, FAILED_DIR);
    }
  }
}

importAllPatients().catch(err => logger.error(`Fatal error: ${err.message}`));