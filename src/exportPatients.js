import fs from 'fs';
import path from 'path';
import config from './utils/config.js';
import logger from './utils/logger.js';
import { exportPatient } from "./services/exporterService.js";
import { loadUuidsFromFile } from './services/fileService.js'
import {getGlobalProperty, setGlobalProperty} from "./services/openmrsService.js";
import Constants from "./utils/constants.js";

const UUID_FILE_PATH = path.join(config.EXPORT_PATIENT_LIST_FILE);
const patientsToExport = loadUuidsFromFile(UUID_FILE_PATH);

// Define a batch size
const BATCH_SIZE = 20;

async function exportAllPatients() {

  try {
    // set the max results to very help results so we don't have to fetch in batches
    await setGlobalProperty(Constants.GP_MAX_RESULTS_ABSOLUTE, "99999", 'SOURCE');
    const globalPropertyAbsolute = await getGlobalProperty(Constants.GP_MAX_RESULTS_ABSOLUTE, 'SOURCE');
    if (globalPropertyAbsolute.value !== "99999") {
      throw new Error();
    }
    await setGlobalProperty(Constants.GP_MAX_RESULTS_DEFAULT, "99999", 'SOURCE');
    const globalPropertyDefault = await getGlobalProperty(Constants.GP_MAX_RESULTS_DEFAULT, 'SOURCE');
    if (globalPropertyDefault.value !== "99999") {
      throw new Error();
    }
  }
  catch (err) {
    throw new Error('Failed to set global properties for max results: ' + err.message);
  }

  try {
    // Function to process a single batch of patient UUIDs
    const processBatch = async (batch) => {
      const exportPromises = batch.map(async (patientUuid) => {
        try {
          const patientRecord = await exportPatient(patientUuid);
          const jsonData = JSON.stringify(patientRecord, null, 4);
          const filename = `${patientUuid}_patient.json`;

          // Save to file
          fs.writeFileSync(path.join(config.TARGET_DIR, filename), jsonData);
          logger.info(`Patient data exported to ${filename}`);
        } catch (error) {
          logger.error(`Error exporting patient data for UUID: ${patientUuid}`, error);
        }
      });

      // Wait until all promises in the batch are complete
      await Promise.all(exportPromises);
    };

    // Split patients into batches and process each batch
    for (let i = 0; i < patientsToExport.length; i += BATCH_SIZE) {
      const batch = patientsToExport.slice(i, i + BATCH_SIZE);
      logger.info(`Processing batch: ${i / BATCH_SIZE + 1}`);
      await processBatch(batch); // Wait for the current batch to complete
    }

    logger.info('Patient data exported successfully');
  } catch (error) {
    logger.error('Error exporting patient data', error);
  }

  try {
    await setGlobalProperty(Constants.GP_MAX_RESULTS_ABSOLUTE, Constants.MAX_RESULTS_ABSOLUTE, 'SOURCE');
    const globalPropertyAbsolute = await getGlobalProperty(Constants.GP_MAX_RESULTS_ABSOLUTE, 'SOURCE');
    if (globalPropertyAbsolute.value !== Constants.MAX_RESULTS_ABSOLUTE) {
      throw new Error();
    }
    await setGlobalProperty(Constants.GP_MAX_RESULTS_DEFAULT, Constants.MAX_RESULTS_DEFAULT, 'SOURCE');
    const globalPropertyDefault = await getGlobalProperty(Constants.GP_MAX_RESULTS_DEFAULT, 'SOURCE');
    if (globalPropertyDefault.value !== Constants.MAX_RESULTS_DEFAULT) {
      throw new Error();
    }
  }
  catch (err) {
    throw new Error('Failed to re-set global properties for max results: ' + err.message);
  }
}

exportAllPatients();
