import path from "path";
import fs from "fs/promises"; // Use the promise-based fs API
import { loadPatientUuidsFromDir } from "./services/fileService.js";
import { exportPatient } from "./services/exporterService.js";
import logger from './utils/logger.js';
import config from './utils/config.js';
import _ from "lodash"; // Import Lodash for deep object comparison
import { diffString } from "json-diff"; // A library to show differences between two JSON objects

// Define a batch size
const BATCH_SIZE = 20;

// Directories
const SUCCESS_DIR = path.join(config.TARGET_DIR, 'successful');
const VERIFIED_DIR = path.join(config.TARGET_DIR, 'verified');
const FAILED_VERIFICATION_DIR = path.join(config.TARGET_DIR, 'failed_verification');

// Ensure directories exist
async function ensureDirectories() {
  try {
    await fs.mkdir(VERIFIED_DIR, { recursive: true });
    await fs.mkdir(FAILED_VERIFICATION_DIR, { recursive: true });
  } catch (error) {
    logger.error('Failed to create necessary directories:', error);
  }
}

// Utility to recursively sanitize JSON objects
// - Removes unnecessary whitespace from strings
// - Provides consistent structure for comparison purposes
const sanitizeObject = (obj) => {
  if (Array.isArray(obj)) {
    return obj
      .sort((a, b) => {
        if (a.uuid && b.uuid) {
          return a.uuid.localeCompare(b.uuid); // Sort by "uuid" if both objects have it
        }
        return 0; // No sorting if "uuid" property is missing
      })
      .map(sanitizeObject); // Recursively sanitize elements in arrays
  } else if (typeof obj === "object" && obj !== null) {
    return Object.entries(obj).reduce((acc, [key, value]) => {
      acc[key] = sanitizeObject(value); // Recursively sanitize each field in the object
      return acc;
    }, {});
  } else if (typeof obj === "string") {
    // Trim strings and collapse whitespace
    return obj.trim().replace(/\s+/g, " ");
  }
  return obj; // Return non-object, non-string values as-is
};

// Load UUIDs from the "successful" directory
const uuids = loadPatientUuidsFromDir(SUCCESS_DIR);

async function verifyPatients() {
  try {
    await ensureDirectories(); // Ensure the output directories exist

    // Function to process a single batch of UUIDs
    const processBatch = async (batch) => {
      const verifyPromises = batch.map(async (uuid) => {
        try {
          // Fetch remote patient record
          const patientRecord = await exportPatient(uuid, 'TARGET');

          // Compare with file contents
          const patientFilePath = path.join(SUCCESS_DIR, `${uuid}_patient.json`);
          const fileExists = await fs
            .access(patientFilePath)
            .then(() => true)
            .catch(() => false);

          if (!fileExists) {
            logger.error(`❌ File ${patientFilePath} not found for UUID ${uuid}`);
            return;
          }

          const fileContents = await fs.readFile(patientFilePath, 'utf-8');
          const parsedFileContents = JSON.parse(fileContents);

          // Sanitize both objects (remove whitespace and normalize structure)
          const sanitizedPatientRecord = sanitizeObject(patientRecord);
          const sanitizedFileContents = sanitizeObject(parsedFileContents);

          // Compare the sanitized objects using Lodash isEqual
          if (_.isEqual(sanitizedPatientRecord, sanitizedFileContents)) {
            // Files match; move to verified
            const targetPath = path.join(VERIFIED_DIR, `${uuid}_patient.json`);
            await fs.rename(patientFilePath, targetPath);
            logger.info(`✅ Patient ${uuid} verified successfully.`);
          } else {
            // Files differ; log differences and move to failed_verification
            const targetPath = path.join(FAILED_VERIFICATION_DIR, `${uuid}_patient.json`);
            await fs.rename(patientFilePath, targetPath);

            // Log the differences in sanitized objects
            const differences = diffString(sanitizedFileContents, sanitizedPatientRecord);
            logger.warn(
              `⚠️  Verification failed for patient ${uuid}. Differences:\n${differences}`
            );
          }
        } catch (error) {
          logger.error(`❌ Failed to verify or process patient ${uuid}:`, error);
        }
      });

      // Wait for all promises in the batch to complete
      await Promise.all(verifyPromises);
    };

    // Process UUIDs in batches
    for (let i = 0; i < uuids.length; i += BATCH_SIZE) {
      const batch = uuids.slice(i, i + BATCH_SIZE);
      logger.info(`🚀 Starting batch ${Math.floor(i / BATCH_SIZE) + 1}...`);
      await processBatch(batch); // Process the current batch and wait for completion
    }

    // All batches completed
    logger.info('🎉 All patients processed for verification.');
  } catch (error) {
    // Catch unexpected errors
    logger.error('⚠️ Unexpected error occurred while verifying patients:', error);
  }
}

// Start the verification process
verifyPatients();