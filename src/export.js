import fs from 'fs';
import path from 'path';
import config from './utils/config.js';
import logger from './utils/logger.js';
import { exportPatient } from "./services/exporterService.js";
import { loadPatientUuidsFromFile } from './services/fileService.js'

const UUID_FILE_PATH = path.join(config.EXPORT_LIST_FILE);
const patientsToExport = loadPatientUuidsFromFile(UUID_FILE_PATH);

async function exportAllPatients()  {

  try {
    for (const patientUuid of patientsToExport) {
      let patientRecord = await exportPatient(patientUuid);
      const jsonData = JSON.stringify([patientRecord], null, 4);
      const filename = `${patientUuid}_patient.json`;

      // Save to file
      fs.writeFileSync(path.join(config.TARGET_DIR, filename), jsonData);
      logger.info(`Patient data exported to ${filename}`);
    }
    logger.info('Patient data exported successfully');
  } catch (error) {
    logger.error('Error exporting patient data', error);
  }
}

exportAllPatients();


