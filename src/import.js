import fs from 'fs/promises';
import path from 'path';
import config from './utils/config.js';
import logger from './utils/logger.js';
import { importPatient } from './services/importerService.js';
import { moveFile } from './services/fileService.js';

const TARGET_DIR = config.TARGET_DIR;
const SUCCESS_DIR = path.join(TARGET_DIR, 'successful');
const FAILED_DIR = path.join(TARGET_DIR, 'failed');

// Define a batch size
const BATCH_SIZE = 100;

async function importAllPatients() {
  try {
    // Read all files in the target directory
    const files = (await fs.readdir(TARGET_DIR)).filter(f => f.endsWith('_patient.json'));

    // Divide files into chunks/batches
    const fileBatches = chunkArray(files, BATCH_SIZE);

    // Process each batch sequentially
    for (const batch of fileBatches) {
      logger.info(`Processing a batch of ${batch.length} files.`);
      await Promise.all(batch.map(async file => processFile(file)));
    }

    logger.info(`All files processed successfully.`);
  } catch (err) {
    logger.error(`Error during processing: ${err.message}`);
  }
}

// Helper function to process a single file
async function processFile(file) {
  const filePath = path.join(TARGET_DIR, file);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const patientRecords = JSON.parse(content);

    // Import all patient records in the file
    const importPromises = patientRecords.map(record =>
      importPatient(record)
        .then(() => logger.info(`Successfully imported patient from file ${file}`))
        .catch(err => {
          logger.error(`Failed to import patient from file ${file}: ${err.message}`);
          throw err; // If one record fails, it will be caught in the outer `try` block
        })
    );

    // Wait for all patient imports to complete
    await Promise.all(importPromises);

    // Move the file to the "successful" directory
    await moveFile(filePath, SUCCESS_DIR);
    logger.info(`File ${file} successfully processed and moved to ${SUCCESS_DIR}`);
  } catch (err) {
    // Handle file-level errors (e.g., JSON parse failures or import failures)
    logger.error(`Error processing file ${file}: ${err.message}`);
    await moveFile(filePath, FAILED_DIR);
    logger.info(`File ${file} moved to ${FAILED_DIR} due to errors.`);
  }
}

// Helper function to chunk an array into smaller batches
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

importAllPatients().catch(err => logger.error(`Fatal error: ${err.message}`));
