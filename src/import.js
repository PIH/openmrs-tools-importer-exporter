import fs from 'fs';
import path from 'path';
import config from './utils/config.js';
import logger from './utils/logger.js';
import { importPatient } from './services/importerService.js';
import { moveFile } from './services/fileService.js';

const TARGET_DIR = config.TARGET_DIR;
const SUCCESS_DIR = path.join(TARGET_DIR, 'successful');
const FAILED_DIR = path.join(TARGET_DIR, 'failed');

function importAllPatients() {
  // Read the directory asynchronously
  fs.readdir(TARGET_DIR, (err, files) => {
    if (err) {
      logger.error(`Failed to read the directory: ${err.message}`);
      return;
    }

    // Filter only patient JSON files
    const patientFiles = files.filter(file => file.endsWith('_patient.json'));

    patientFiles.forEach(file => {
      const filePath = path.join(TARGET_DIR, file);

      // Read the file asynchronously
      fs.readFile(filePath, 'utf8', (err, content) => {
        if (err) {
          logger.error(`Failed to read file ${file}: ${err.message}`);
          // Move file to "failed" directory
          return moveFile(filePath, FAILED_DIR, moveErr => {
            if (moveErr) {
              logger.error(`Failed to move file ${file} to failed directory: ${moveErr.message}`);
            }
          });
        }

        // Parse JSON content of the file
        let patientRecord;
        try {
          patientRecord = JSON.parse(content)[0];  // TODO: remove the export from nesting everything in an array?
        } catch (parseErr) {
          logger.error(`Failed to parse JSON in file ${file}: ${parseErr.message}`);
          // Move file to "failed" directory
          return moveFile(filePath, FAILED_DIR, moveErr => {
            if (moveErr) {
              logger.error(`Failed to move file ${file} to failed directory: ${moveErr.message}`);
            }
          });
        }

        // Process each patient record
        handlePatientRecord(patientRecord, filePath, file);
      });
    });
  });
}

// Function to handle processing patient records
async function handlePatientRecord(patientRecord, filePath, fileName) {

  importPatient(patientRecord)
  .then(
    () => {
      logger.info(`Successfully imported patient record from file ${fileName}`);
      moveFile(filePath, SUCCESS_DIR);
    }
  )
  .catch(
    err => {
      logger.error(`Failed to import patient record from file ${fileName}: ${err.message}`);
      moveFile(filePath, FAILED_DIR);
    }
  )
}

importAllPatients();
