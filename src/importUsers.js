import fs from 'fs/promises';
import path from 'path';
import config from './utils/config.js';
import logger from './utils/logger.js';
import { importUser } from './services/importerService.js';
import { moveFile } from './services/fileService.js';

const TARGET_DIR = config.TARGET_DIR;
const SUCCESS_DIR = path.join(TARGET_DIR, 'successful');
const FAILED_DIR = path.join(TARGET_DIR, 'failed');

// Define a batch size
const BATCH_SIZE = 20;

/**
 * This script (currently) work as follows:
 *    - it loads all files in the target direct in the format ${uuid}_user.json and processes each file:
 *      - if the username is "admin" or "daemon", it skips that file and moves it to the "successful" directory
 *      - otherwise, it searches for an existing user with the same uuid in the target system
 *        - if an existing user is found, it does not import, and the moves file to "successful" directory
 *      - otherwise, it a creates new, random password for this user, and attempts to post the user to the target system
 *        - if successful, it moves the file to "successful" directory (note that a new system-id will be generated)
 *        - if failed, and error message contains "Username admin or system id admin is already in use", it skips and moves the user to "successful"
 *
 *  Future features
 *    - retire users -- we likely want to retire all migrated users, which we can either do as part of the export generation, or here
 *    - duplicate usernames -- instead of skipping duplicate usernames, we can come up with a protocol for modifying the username (ie, "${username}-${siteName}" and import the user; this becomes critical if we start to import audit information
 *    - providers - we need to import the provider associated with the user and coordinate that
 *    - verify - do we want/need to create a verify script for users?
 *
 *  Intended use case
 *    - Administrator unretires (assuming we start retiring users) and either resets password manually or (ideally) allows user to reset password via email
 *
 */
async function importAllUsers() {

  try {
    // Read all files in the target directory
    const files = (await fs.readdir(TARGET_DIR)).filter(f => f.endsWith('_user.json'));

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
    const user = JSON.parse(content);

    // Import record
    await importUser(user)
    logger.info(`Successfully processed user from file ${file}`);
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

importAllUsers().catch(err => logger.error(`Fatal error: ${err.message}`));
