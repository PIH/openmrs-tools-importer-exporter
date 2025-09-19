import fs from 'fs';
import path from 'path';
import config from "./utils/config.js";
import logger from "./utils/logger.js";
import {loadUuidsFromFile} from "./services/fileService.js";
import {exportProvider} from "./services/exporterService.js";

const UUID_FILE_PATH = path.join(config.EXPORT_PROVIDER_LIST_FILE);
const providersToExport = loadUuidsFromFile(UUID_FILE_PATH);

// Define a batch size
const BATCH_SIZE = 20;


/**
 * This script (currently) work as follows:
 *    - it loads a list of UUIDS that refer to providers in an existing OpenMRS system
 *    - it requests a REST representation of each provider and stores in a file called ${uuid}_provider.json
 *    - this REST rep does not (currently) include any audit data, or the "speciality" or "role" fields
 *    - the rep *does* include "providerRole", and uses the (new) providermanagemnet REST endpoints to fetch the providers
 *
 *  Future features
 *    - retire providers -- we likely want to retire all migrated providers, which we can either do by setting the retired flag on export, or doing it on import
 *    - potentially include audit data
 *
 */
async function exportAllProviders() {
  try {
    // Function to process a single batch of provider UUIDs
    const processBatch = async (batch) => {
      const exportPromises = batch.map(async (providerUuid) => {
        try {
          const providerRecord = await exportProvider(providerUuid);
          const jsonData = JSON.stringify(providerRecord, null, 4);
          const filename = `${providerUuid}_provider.json`;

          // Save to file
          fs.writeFileSync(path.join(config.TARGET_DIR, filename), jsonData);
          logger.info(`Provider data exported to ${filename}`);
        } catch (error) {
          logger.error(`Error exporting provider data for UUID: ${providerUuid}`, error);
        }
      });

      // Wait until all promises in the batch are complete
      await Promise.all(exportPromises);
    };

    // Split providers into batches and process each batch
    for (let i = 0; i < providersToExport.length; i += BATCH_SIZE) {
      const batch = providersToExport.slice(i, i + BATCH_SIZE);
      logger.info(`Processing batch: ${i / BATCH_SIZE + 1}`);
      await processBatch(batch); // Wait for the current batch to complete
    }

    logger.info('Provider data exported successfully');
  } catch (error) {
    logger.error('Error exporting provider data', error);
  }
}

exportAllProviders();