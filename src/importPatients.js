import fs from 'fs/promises';
import path from 'path';
import config from './utils/config.js';
import logger from './utils/logger.js';
import { importPatient } from './services/importerService.js';
import {loadMappingFile, moveFile} from './services/fileService.js';
import { getGlobalProperty, setGlobalProperty } from "./services/openmrsService.js";
import Constants from "./utils/constants.js";
import {replaceMappings, decodeHtmlEntitiesInObject} from "./utils/utils.js";
import { increment, writeMetrics } from "./utils/metrics.js";

const TARGET_DIR = config.TARGET_DIR;
const SUCCESS_DIR = path.join(TARGET_DIR, 'successful');
const FAILED_DIR = path.join(TARGET_DIR, 'failed');

const USER_MAPPINGS_FILE_PATH = config.EXPORT_USER_MAPPINGS_FILE ? path.join(config.EXPORT_USER_MAPPINGS_FILE) : undefined;
const userMappings = USER_MAPPINGS_FILE_PATH ? loadMappingFile(USER_MAPPINGS_FILE_PATH) : [];

const PATIENT_IDENTIFIERS_MAPPINGS_FILE_PATH = config.EXPORT_PATIENT_IDENTIFIERS_MAPPINGS_FILE ? path.join(config.EXPORT_PATIENT_IDENTIFIERS_MAPPINGS_FILE) : undefined;
const patientIdentifiersMappings = PATIENT_IDENTIFIERS_MAPPINGS_FILE_PATH ? loadMappingFile(PATIENT_IDENTIFIERS_MAPPINGS_FILE_PATH) : [];

const PROVIDER_MAPPINGS_FILE_PATH = config.EXPORT_PROVIDER_MAPPINGS_FILE ? path.join(config.EXPORT_PROVIDER_MAPPINGS_FILE) : undefined;
const providerMappings = PROVIDER_MAPPINGS_FILE_PATH ? loadMappingFile(PROVIDER_MAPPINGS_FILE_PATH) : [];

const CONCEPT_NAME_MAPPINGS_FILE_PATH = config.EXPORT_CONCEPT_NAME_MAPPINGS_FILE ? path.join(config.EXPORT_CONCEPT_NAME_MAPPINGS_FILE) : undefined;
const conceptNameMappings = CONCEPT_NAME_MAPPINGS_FILE_PATH ? loadMappingFile(CONCEPT_NAME_MAPPINGS_FILE_PATH) : [];

const WORKFLOW_STATE_MAPPINGS_FILE_PATH = config.EXPORT_PROGRAM_WORKFLOW_STATE_MAPPINGS_FILE ? path.join(config.EXPORT_PROGRAM_WORKFLOW_STATE_MAPPINGS_FILE) : undefined;
const workflowStateMappings = WORKFLOW_STATE_MAPPINGS_FILE_PATH ? loadMappingFile(WORKFLOW_STATE_MAPPINGS_FILE_PATH) : [];
const BATCH_SIZE = config.IMPORT_PATIENTS_BATCH_SIZE ? parseInt(config.IMPORT_PATIENTS_BATCH_SIZE, 10) : 1;
const RETRY_MAX = config.IMPORT_PATIENTS_RETRY_MAX ? parseInt(config.IMPORT_PATIENTS_RETRY_MAX, 10) : 3;
const RETRY_DELAY_MS = config.IMPORT_PATIENTS_RETRY_DELAY_MS ? parseInt(config.IMPORT_PATIENTS_RETRY_DELAY_MS, 10) : 2000;

// Built once: replaceMappings prepares a mappings object the first time it sees it
const allMappings = Object.assign({}, providerMappings, userMappings, patientIdentifiersMappings, workflowStateMappings, conceptNameMappings);

const PROGRESS_EVERY = 100;

let restoreDrugOrderRequireOutpatientQuantity = false;

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
    // if outpatient quantity is currently required on drug orders, disable it for the import so as not to block previous orders placed when it could be null
    const globalPropertyDrugOrderRequireOutpatientQuantity = await getGlobalProperty(Constants.GP_DRUG_ORDER_REQUIRE_OUTPATIENT_QUANTITY, 'TARGET');
    if (globalPropertyDrugOrderRequireOutpatientQuantity.value === 'true') {
      await setGlobalProperty(Constants.GP_DRUG_ORDER_REQUIRE_OUTPATIENT_QUANTITY, false, 'TARGET');
      const updatedGlobalPropertyDrugOrderRequireOutpatientQuantity = await getGlobalProperty(Constants.GP_DRUG_ORDER_REQUIRE_OUTPATIENT_QUANTITY, 'TARGET');
      if (updatedGlobalPropertyDrugOrderRequireOutpatientQuantity.value !== 'false') {
        throw new Error();
      }
      restoreDrugOrderRequireOutpatientQuantity = true;
    }
  }
  catch (err) {
    throw new Error('Failed to set necessary global properties: ' + err.message);
  }

  const overallStart = Date.now();

  try {
    // Read all files in the target directory
    const files = (await fs.readdir(TARGET_DIR)).filter(f => f.endsWith('_patient.json'));
    const totalFiles = files.length;

    logger.info(`Starting import of ${totalFiles} patient files with batch size ${BATCH_SIZE}.`);

    // A pool of BATCH_SIZE workers, each taking the next file as soon as it finishes, so a slow (or
    // retrying) patient doesn't hold up a whole batch
    let next = 0;
    let processedCount = 0;
    const worker = async () => {
      while (next < files.length) {
        await processFile(files[next++]);
        if (++processedCount % PROGRESS_EVERY === 0) {
          const elapsed = (Date.now() - overallStart) / 1000;
          logger.info(`Progress: ${processedCount}/${totalFiles} patients in ${elapsed.toFixed(0)}s (${(processedCount / elapsed).toFixed(2)} patients/s).`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(BATCH_SIZE, files.length) }, worker));

    const totalElapsed = ((Date.now() - overallStart) / 1000).toFixed(2);
    const overallThroughput = (totalFiles / (totalElapsed || 1)).toFixed(2);
    logger.info(`All ${totalFiles} files processed in ${totalElapsed}s (${overallThroughput} patients/s avg) with batch size ${BATCH_SIZE}.`);
    const { summary, file } = await writeMetrics(config.LOG_HOME, 'import-metrics', { files: totalFiles, batchSize: BATCH_SIZE });
    logger.info(`Import summary: ${JSON.stringify(summary.counters)} in ${summary.wallSeconds} s; metrics written to ${file}`);
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
    // restore outpatient quantity requirement on drug orders if it was enabled before the import
    if (restoreDrugOrderRequireOutpatientQuantity) {
      await setGlobalProperty(Constants.GP_DRUG_ORDER_REQUIRE_OUTPATIENT_QUANTITY, true, 'TARGET');
      const globalPropertyDrugOrderRequireOutpatientQuantity = await getGlobalProperty(Constants.GP_DRUG_ORDER_REQUIRE_OUTPATIENT_QUANTITY, 'TARGET');
      if (globalPropertyDrugOrderRequireOutpatientQuantity.value !== 'true') {
        throw new Error();
      }
    }
  }
  catch (err) {
    throw new Error('Failed to set necessary global properties: ' + err.message);
  }
}

// Helper function to process a single file
async function processFile(file, retryCount = 0) {
  const filePath = path.join(TARGET_DIR, file);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    // replace any mappings
    const updatedContent = replaceMappings(content, allMappings);
    const patientRecord = decodeHtmlEntitiesInObject(JSON.parse(updatedContent));

    // Import record
    await importPatient(patientRecord)
    logger.info(`Successfully processed patient from file ${file}`);
    // Move the file to the "successful" directory
    await moveFile(filePath, SUCCESS_DIR);
    logger.debug(`File ${file} successfully moved to ${SUCCESS_DIR}`);
    increment('patients imported');
    if (retryCount > 0) {
      increment('patients imported after a retry');
    }
  } catch (err) {
    if (isTransientError(err) && retryCount < RETRY_MAX) {
      const retryDelay = RETRY_DELAY_MS * 2 ** retryCount;
      logger.warn(`TransientPropertyValueException for ${file}, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${RETRY_MAX})...`);
      increment(`retries: ${errorClass(err)}`);
      // On a retry the patient already exists, so only its missing children are posted (each existing one
      // costs one small GET)
      await delay(retryDelay);
      return processFile(file, retryCount + 1);
    }
    logger.error(`Error processing file ${file}: ${err.message}`);
    increment('patients failed');
    increment(`failures: ${errorClass(err)}`);
    await moveFile(filePath, FAILED_DIR);
    logger.info(`File ${file} moved to ${FAILED_DIR} due to errors.`);
  }
}

// A label for an error with no identifiers in it: the Java exception class(es) in the OpenMRS error, or
// the HTTP status, for counting failures by type
function errorClass(err) {
  const text = `${err.response?.data?.error?.detail ?? ''} ${err.response?.data?.error?.message ?? ''} ${err.message ?? ''}`;
  const classes = [...new Set(text.match(/\b[A-Z][A-Za-z]*(Exception|Error)\b/g) ?? [])];
  const status = err.response?.status ? `HTTP ${err.response.status}` : 'no HTTP response';
  // Validation errors (HTTP 400) have no exception class; their error codes (message keys such as
  // Order.error.xyz, with field names for field errors) say what was wrong without any data
  const error = err.response?.data?.error;
  const codes = [...new Set([
    ...(error?.globalErrors ?? []).map(e => e.code),
    ...Object.entries(error?.fieldErrors ?? {}).flatMap(([field, errors]) => errors.map(e => `${field}: ${e.code}`)),
  ].filter(Boolean))];
  const labels = [...classes, ...codes];
  return labels.length > 0 ? `${status} ${labels.join(', ')}` : status;
}

// Only the "newly created patient not found yet" failure is worth retrying. ConstraintViolationException
// isn't: on the SSPE data every one was a missing creator (a mapping problem) and failed again each time.
function isTransientError(err) {
  const detail = err.response?.data?.error?.detail ?? '';
  const message = err.message ?? '';
  return detail.includes('TransientPropertyValueException') || message.includes('TransientPropertyValueException');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

importAllPatients().catch(err => logger.error(`Fatal error: ${err.message}`));
