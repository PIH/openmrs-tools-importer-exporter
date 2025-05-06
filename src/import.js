import fs from 'fs';
import path from 'path';
import config from './utils/config.js';
import logger from './utils/logger.js';
import { importPatient } from './services/importerService.js';
import { moveFile } from './services/fileService.js';

const TARGET_DIR = config.TARGET_DIR;
const SUCCESS_DIR = path.join(TARGET_DIR, 'successful');
const FAILED_DIR = path.join(TARGET_DIR, 'failed');

async function importAllPatients() {
  const files = fs.readdirSync(TARGET_DIR).filter(f => f.endsWith('_patient.json'));

  for (const file of files) {
    const filePath = path.join(TARGET_DIR, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const patientRecords = JSON.parse(content);
      for (const record of patientRecords) {
        await importPatient(record);
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