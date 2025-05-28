import fs from 'fs';
import path from 'path';
import config from './utils/config.js';
import logger from './utils/logger.js';
import { exportPatient } from "./services/exporterService.js";
import { loadUuidsFromFile } from './services/fileService.js'

const UUID_FILE_PATH = path.join(config.EXPORT_PATIENT_LIST_FILE);
const patientsToExport = loadUuidsFromFile(UUID_FILE_PATH);

// Define a batch size
const BATCH_SIZE = 20;

async function exportAllPatients() {
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
}

exportAllPatients();
