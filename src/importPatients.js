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

const USER_MAPPINGS_FILE_PATH = config.EXPORT_USER_MAPPINGS_FILE ? path.join(config.EXPORT_USER_MAPPINGS_FILE) : undefined;
const userMappings = USER_MAPPINGS_FILE_PATH ? loadMappingFile(USER_MAPPINGS_FILE_PATH) : [];

const PATIENT_IDENTIFIERS_MAPPINGS_FILE_PATH = config.EXPORT_PATIENT_IDENTIFIERS_MAPPINGS_FILE ? path.join(config.EXPORT_PATIENT_IDENTIFIERS_MAPPINGS_FILE) : undefined;
const patientIdentifiersMappings = PATIENT_IDENTIFIERS_MAPPINGS_FILE_PATH ? loadMappingFile(PATIENT_IDENTIFIERS_MAPPINGS_FILE_PATH) : [];

const PROVIDER_MAPPINGS_FILE_PATH = config.EXPORT_PROVIDER_MAPPINGS_FILE ? path.join(config.EXPORT_PROVIDER_MAPPINGS_FILE) : undefined;
const providerMappings = PROVIDER_MAPPINGS_FILE_PATH ? loadMappingFile(PROVIDER_MAPPINGS_FILE_PATH) : [];

const WORKFLOW_STATE_MAPPINGS_FILE_PATH = config.EXPORT_PROGRAM_WORKFLOW_STATE_MAPPINGS_FILE ? path.join(config.EXPORT_PROGRAM_WORKFLOW_STATE_MAPPINGS_FILE) : undefined;
const workflowStateMappings = WORKFLOW_STATE_MAPPINGS_FILE_PATH ? loadMappingFile(WORKFLOW_STATE_MAPPINGS_FILE_PATH) : [];
// Define a batch size
const BATCH_SIZE = config.IMPORT_PATIENTS_BATCH_SIZE ? config.IMPORT_PATIENTS_BATCH_SIZE : 1;

async function importAllPatients() {
  try {
    // disable the visit assignment handler so that we don't manipulate encounters when saving
    await setGlobalProperty(Constants.GP_VISIT_ASSIGNMENT_HANDLER_DISABLED, true, 'TARGET');
    const globalPropertyVisitAssignmentHandler = await getGlobalProperty(Constants.GP_VISIT_ASSIGNMENT_HANDLER_DISABLED, 'TARGET');
    if (globalPropertyVisitAssignmentHandler.value !== 'true') {
      throw new Error();
    }
    // allow setting order number and stopping inactive orders
    await setGlobalProperty(Constants.GP_ALLOW_SETTING_ORDER_NUMBER, true, 'TARGET');
    const globalPropertyAllowSettingOrderNumber = await getGlobalProperty(Constants.GP_ALLOW_SETTING_ORDER_NUMBER, 'TARGET');
    if (globalPropertyAllowSettingOrderNumber.value !== 'true') {
      throw new Error();
    }
    await setGlobalProperty(Constants.GP_IGNORE_ATTEMPTS_TO_STOP_INACTIVE_ORDERS, true, 'TARGET');
    const globalPropertyIgnoreAttemptsToStopInactiveOrders = await getGlobalProperty(Constants.GP_IGNORE_ATTEMPTS_TO_STOP_INACTIVE_ORDERS, 'TARGET');
    if (globalPropertyIgnoreAttemptsToStopInactiveOrders.value !== 'true') {
      throw new Error();
    }
  }
  catch (err) {
    throw new Error('Failed to set necessary global properties: ' + err.message);
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
    // set all global properties back to false
    await setGlobalProperty(Constants.GP_VISIT_ASSIGNMENT_HANDLER_DISABLED, false, 'TARGET');
    const globalPropertyVisitAssignmentHandler = await getGlobalProperty(Constants.GP_VISIT_ASSIGNMENT_HANDLER_DISABLED, 'TARGET');
    if (globalPropertyVisitAssignmentHandler.value !== 'false') {
      throw new Error();
    }
    // allow setting order number and stopping inactive orders
    await setGlobalProperty(Constants.GP_ALLOW_SETTING_ORDER_NUMBER, false, 'TARGET');
    const globalPropertyAllowSettingOrderNumber = await getGlobalProperty(Constants.GP_ALLOW_SETTING_ORDER_NUMBER, 'TARGET');
    if (globalPropertyAllowSettingOrderNumber.value !== 'false') {
      throw new Error();
    }
    await setGlobalProperty(Constants.GP_IGNORE_ATTEMPTS_TO_STOP_INACTIVE_ORDERS, false, 'TARGET');
    const globalPropertyIgnoreAttemptsToStopInactiveOrders = await getGlobalProperty(Constants.GP_IGNORE_ATTEMPTS_TO_STOP_INACTIVE_ORDERS, 'TARGET');
    if (globalPropertyIgnoreAttemptsToStopInactiveOrders.value !== 'false') {
      throw new Error();
    }
  }
  catch (err) {
    throw new Error('Failed to set necessary global properties: ' + err.message);
  }
}

// Helper function to process a single file
async function processFile(file) {
  const filePath = path.join(TARGET_DIR, file);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    // replace any user and provider mappings
    const updatedContent = replaceMappings(replaceMappings(replaceMappings(replaceMappings(content, providerMappings),userMappings), patientIdentifiersMappings), workflowStateMappings);
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
