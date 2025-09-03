import fs from 'fs/promises';
import path from 'path';
import config from './utils/config.js';
import logger from './utils/logger.js';
import { importPatient } from './services/importerService.js';
import {loadMappingFile, moveFile} from './services/fileService.js';
import { getGlobalProperty, setGlobalProperty } from "./services/openmrsService.js";
import Constants from "./utils/constants.js";
import {replaceMappings} from "./utils/utils.js";

const TARGET_DIR = config.TARGET_DIR;
const SUCCESS_DIR = path.join(TARGET_DIR, 'successful');
const FAILED_DIR = path.join(TARGET_DIR, 'failed');

const USER_MAPPINGS_FILE_PATH = path.join(config.EXPORT_USER_MAPPINGS_FILE);
const userMappings = USER_MAPPINGS_FILE_PATH ? loadMappingFile(USER_MAPPINGS_FILE_PATH) : [];

const PROVIDER_MAPPINGS_FILE_PATH = path.join(config.EXPORT_PROVIDER_MAPPINGS_FILE);
const providerMappings = PROVIDER_MAPPINGS_FILE_PATH ? loadMappingFile(PROVIDER_MAPPINGS_FILE_PATH) : [];

// Define a batch size
const BATCH_SIZE = 20;

async function importAllPatients() {
  try {
    // disable the visit assignment handler so that we don't manipulate encounters when saving
    await setGlobalProperty(Constants.GP_VISIT_ASSIGNMENT_HANDLER_DISABLED, true, 'TARGET');
    const globalProperty = await getGlobalProperty(Constants.GP_VISIT_ASSIGNMENT_HANDLER_DISABLED, 'TARGET');
    if (globalProperty.value !== 'true') {
      throw new Error();
    }
  }
  catch (err) {
    throw new Error('Failed to disable the visit assignment handler: ' + err.message);
  }

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

    logger.info(`All files processed.`);
  } catch (err) {
    logger.error(`Error during processing: ${err.message}`);
  }

  try {
    // re-enable the visit assignment handler
    await setGlobalProperty(Constants.GP_VISIT_ASSIGNMENT_HANDLER_DISABLED, false, 'TARGET');
    const globalProperty = await getGlobalProperty(Constants.GP_VISIT_ASSIGNMENT_HANDLER_DISABLED, 'TARGET');
    if (globalProperty.value !== 'false') {
      throw new Error();
    }
  }
  catch (err) {
    throw new Error('Failed to re-enable the visit assignment handler: ' + err.message);
  }
}

// Helper function to process a single file
async function processFile(file) {
  const filePath = path.join(TARGET_DIR, file);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    // replace any user and provider mappings
    const updatedContent = replaceMappings(replaceMappings(content, providerMappings),userMappings);
    const patientRecord = JSON.parse(updatedContent);

    // Import record
    await importPatient(patientRecord)
    logger.info(`Successfully processed patient from file ${file}`);
    // Move the file to the "successful" directory
    await moveFile(filePath, SUCCESS_DIR);
    logger.info(`File ${file} successfully moved to ${SUCCESS_DIR}`);
  } catch (err) {
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
