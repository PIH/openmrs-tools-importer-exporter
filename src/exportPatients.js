import fs from 'fs/promises';
import path from 'path';
import config from './utils/config.js';
import logger from './utils/logger.js';
import { exportPatient } from "./services/exporterService.js";
import { logSourceDataFixes } from "./services/sourceDataFixes.js";
import { loadUuidsFromFile } from './services/fileService.js'
import {getGlobalProperty, setGlobalProperty} from "./services/openmrsService.js";
import Constants from "./utils/constants.js";
import { increment, writeMetrics } from "./utils/metrics.js";

const UUID_FILE_PATH = path.join(config.EXPORT_PATIENT_LIST_FILE);
const patientsToExport = loadUuidsFromFile(UUID_FILE_PATH);

// Non-blocking check, so other exports in flight aren't held up
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Compact JSON by default: much smaller files, and the import's cost per file grows with file size.
// Set EXPORT_JSON_INDENT (e.g. 2) for readable files when debugging.
const JSON_INDENT = config.EXPORT_JSON_INDENT ? Number(config.EXPORT_JSON_INDENT) : undefined;

// How many patients to export at a time. Each patient sends 9 requests in parallel, so 20 means about
// 180 requests in flight against the source server: mind its load if it's a production system.
const CONCURRENCY = Number(config.EXPORT_PATIENTS_CONCURRENCY) || 20;
const PROGRESS_EVERY = 500;

// Retries for a failed patient, with exponential backoff starting at RETRY_DELAY_MS
const RETRY_MAX = config.EXPORT_PATIENTS_RETRY_MAX !== undefined ? Number(config.EXPORT_PATIENTS_RETRY_MAX) : 3;
const RETRY_DELAY_MS = Number(config.EXPORT_PATIENTS_RETRY_DELAY_MS) || 2000;
const failedUuids = [];

// Worth retrying: no response (connection problem or timeout), server errors, an expired session or
// throttling. Other errors (e.g. 404, a bug while parsing, or a file-system error such as a full disk)
// would fail the same way again.
function isRetryable(error) {
  const status = error.response?.status;
  if (status === undefined) {
    return Boolean(error.isAxiosError) || error.message?.startsWith('Bad Response - Unauthenticated?');
  }
  return status >= 500 || [401, 408, 429].includes(status);
}

async function exportAllPatients() {
  // Create the output directory if needed; otherwise every file write fails with ENOENT
  await fs.mkdir(config.TARGET_DIR, { recursive: true });


  try {
    // set the max results to very high results so we don't have to fetch in batches
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
    // Exports one patient (or skips it if its file already exists)
    const exportOne = async (patientUuid) => {
      const filename = `${patientUuid}_patient.json`;
      const filePath = path.join(config.TARGET_DIR, filename);
      if (await fileExists(filePath)) {
        logger.info(`Skipping ${filename}, file already exists`);
        increment('patients skipped');
        return;
      }

      for (let attempt = 1; ; attempt++) {
        try {
          const patientRecord = await exportPatient(patientUuid);
          await fs.writeFile(filePath, JSON.stringify(patientRecord, null, JSON_INDENT));
          await logSourceDataFixes(patientRecord);   // TEMPORARY (HAI-1306)
          logger.info(`Patient data exported to ${filename}`);
          increment('patients exported');
          if (attempt > 1) {
            increment('patients exported after a retry');
          }
          return;
        } catch (error) {
          if (attempt <= RETRY_MAX && isRetryable(error)) {
            const delay = RETRY_DELAY_MS * 2 ** (attempt - 1);
            logger.warn(`Error exporting patient ${patientUuid} (attempt ${attempt}), retrying in ${delay} ms: ${error.message}`);
            increment('retries');
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          logger.error(`Error exporting patient data for UUID: ${patientUuid} (attempt ${attempt}, not retrying)`, error);
          increment('patients failed');
          failedUuids.push(patientUuid);
          return;
        }
      }
    };

    // A pool of CONCURRENCY workers, each taking the next patient as soon as it finishes, so a slow
    // patient doesn't hold up a whole batch
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < patientsToExport.length) {
        await exportOne(patientsToExport[next++]);
        if (++done % PROGRESS_EVERY === 0) {
          logger.info(`Progress: ${done} of ${patientsToExport.length} patients`);
        }
      }
    };
    logger.info(`Exporting ${patientsToExport.length} patients with ${CONCURRENCY} at a time`);
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, patientsToExport.length) }, worker));

    logger.info('Patient data exported successfully');
    if (failedUuids.length > 0) {
      const failedFile = path.join(config.LOG_HOME, 'export-failed-patients.txt');
      await fs.mkdir(config.LOG_HOME, { recursive: true });
      await fs.writeFile(failedFile, failedUuids.join('\n') + '\n');
      logger.warn(`${failedUuids.length} patients failed; their UUIDs are in ${failedFile} (usable as EXPORT_PATIENT_LIST_FILE to retry them)`);
    }
    const { summary, file } = await writeMetrics(config.LOG_HOME, 'export-metrics', { patientsInList: patientsToExport.length });
    const exported = summary.counters['patients exported'] ?? 0;
    logger.info(`Export summary: ${JSON.stringify(summary.counters)} in ${summary.wallSeconds} s` +
      ` (${(exported / summary.wallSeconds).toFixed(1)} exported patients/s); metrics written to ${file}`);
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
