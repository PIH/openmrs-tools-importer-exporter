import fs from 'fs/promises';
import path from 'path';
import config from './utils/config.js';
import logger from './utils/logger.js';
import {importProvider} from './services/importerService.js';
import {loadMappingFile, moveFile} from './services/fileService.js';
import {replaceMappings} from "./utils/utils.js";

const TARGET_DIR = config.TARGET_DIR;
const SUCCESS_DIR = path.join(TARGET_DIR, 'successful');
const FAILED_DIR = path.join(TARGET_DIR, 'failed');
const MAPPED_TO_EXISTING_DIR = path.join(TARGET_DIR, 'mapped_to_existing');

const USER_MAPPINGS_FILE_PATH = path.join(config.EXPORT_USER_MAPPINGS_FILE);
const userMappings = USER_MAPPINGS_FILE_PATH ? loadMappingFile(USER_MAPPINGS_FILE_PATH) : [];

const PROVIDER_MAPPINGS_FILE_PATH = path.join(config.EXPORT_PROVIDER_MAPPINGS_FILE);
const providerMappings = PROVIDER_MAPPINGS_FILE_PATH ? loadMappingFile(PROVIDER_MAPPINGS_FILE_PATH) : [];

// Define a batch size
// set to 1, see: https://pihemr.atlassian.net/browse/UHM-8661
const BATCH_SIZE = 1;

/**
 * This script works as follows:
 *    - it loads any "provider mapping" file that may exist
 *    - it loads all files in the target directory in the format ${uuid}_provider.json and processes each file:
 *      - if the uuid is in the provider mapping files, it skips that file and moves it to the "mapped_to_existing" directory
 *      - otherwise, it searches for an existing provider with the same uuid in the target system
 *        - if an existing provider is found, it does not import, and the moves file to "successful" directory
 *      - otherwise, it attempts to post the providers to the target system
 *        - if successful, it moves the file to "successful" directory
 *        - if failed, moves it to the "failed" directory
 *

 *  Future features?
 *    - duplicate provider identifiers -- this script does not do any checking/handling of duplicate provider identifiers;
 *      from a quick look at the ProviderValidator it *looks* like there is no checking for duplicate identifier, but
 *      we should confirm, and also confirm what we use provider identifiers for (I *think* it is only for interaction with the PACS system)
 *    - verify - do we want/need to create a verify script for providers?
 *
 */
async function importAllProviders() {

  try {
    // Read all files in the target directory
    const files = (await fs.readdir(TARGET_DIR)).filter(f => f.endsWith('_provider.json'));

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

}

// Helper function to process a single file
async function processFile(file) {
  const filePath = path.join(TARGET_DIR, file);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const uuid = JSON.parse(content).uuid; // just grab the uuid, inefficient, but we parse this file twice because we need to check the uuid against the mapping list before substituting


    if (uuid in providerMappings) {
      logger.info(`Provider ${uuid} in mapping file, skipping`)
      await moveFile(filePath, MAPPED_TO_EXISTING_DIR);
      logger.info(`File ${file} successfully moved to ${MAPPED_TO_EXISTING_DIR}`);
      return;
    }

    // replace any user mappings before import
    const updatedContent = replaceMappings(content,userMappings);
    const provider = JSON.parse(updatedContent);

    // Import record
    await importProvider(provider)
    logger.info(`Successfully processed provider from file ${file}`);
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

importAllProviders().catch(err => logger.error(`Fatal error: ${err.message}`));
