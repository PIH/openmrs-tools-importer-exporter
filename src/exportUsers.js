import fs from 'fs';
import path from 'path';
import config from './utils/config.js';
import logger from './utils/logger.js';
import { exportUser } from "./services/exporterService.js";
import { loadUuidsFromFile } from './services/fileService.js'

const UUID_FILE_PATH = path.join(config.EXPORT_USER_LIST_FILE);
const usersToExport = loadUuidsFromFile(UUID_FILE_PATH);

// Define a batch size
const BATCH_SIZE = 20;

/**
 * This script (currently) work as follows:
 *    - it loads a list of UUIDS that refer to users in an existing OpenMRS system
 *    - it requests a REST representation of each user and stores in a file called ${uuid}_user.json
 *    - this REST rep does not (currently) include any audit data or system-id (which needs to be unique, and I'm not sure if we really use it as-is at all)
 *
 *  Future features
 *    - retire users -- we likely want to retire all migrated users, which we can either do by setting the retired flag on export, or doing it on import
 *    - potentially include audit data (though since this will be self-referential we will have to add some likely non-trivial logic to make sure we import users in a specific order)
 *
 */
async function exportAllUsers() {
  try {
    // Function to process a single batch of user UUIDs
    const processBatch = async (batch) => {
      const exportPromises = batch.map(async (userUuid) => {
        try {
          const userRecord = await exportUser(userUuid);
          const jsonData = JSON.stringify(userRecord, null, 4);
          const filename = `${userUuid}_user.json`;

          // Save to file
          fs.writeFileSync(path.join(config.TARGET_DIR, filename), jsonData);
          logger.info(`User data exported to ${filename}`);
        } catch (error) {
          logger.error(`Error exporting user data for UUID: ${userUuid}`, error);
        }
      });

      // Wait until all promises in the batch are complete
      await Promise.all(exportPromises);
    };

    // Split users into batches and process each batch
    for (let i = 0; i < usersToExport.length; i += BATCH_SIZE) {
      const batch = usersToExport.slice(i, i + BATCH_SIZE);
      logger.info(`Processing batch: ${i / BATCH_SIZE + 1}`);
      await processBatch(batch); // Wait for the current batch to complete
    }

    logger.info('User data exported successfully');
  } catch (error) {
    logger.error('Error exporting user data', error);
  }
}

exportAllUsers();
