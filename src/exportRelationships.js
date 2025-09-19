import fs from 'fs';
import path from 'path';
import config from "./utils/config.js";
import logger from "./utils/logger.js";
import {loadUuidsFromFile} from "./services/fileService.js";
import {exportRelationship} from "./services/exporterService.js";

const UUID_FILE_PATH = path.join(config.EXPORT_RELATIONSHIP_LIST_FILE);
const relationshipsToExport = loadUuidsFromFile(UUID_FILE_PATH);

// Define a batch size
const BATCH_SIZE = 20;

async function exportAllRelationships() {
  try {
    // Function to process a single batch of relationship UUIDs
    const processBatch = async (batch) => {
      const exportPromises = batch.map(async (relationshipUuid) => {
        try {
          const relationshipRecord = await exportRelationship(relationshipUuid);
          const jsonData = JSON.stringify(relationshipRecord, null, 4);
          const filename = `${relationshipUuid}_relationship.json`;

          // Save to file
          fs.writeFileSync(path.join(config.TARGET_DIR, filename), jsonData);
          logger.info(`Relationship data exported to ${filename}`);
        } catch (error) {
          logger.error(`Error exporting relationship data for UUID: ${relationshipUuid}`, error);
        }
      });

      // Wait until all promises in the batch are complete
      await Promise.all(exportPromises);
    };

    // Split providers into batches and process each batch
    for (let i = 0; i < relationshipsToExport.length; i += BATCH_SIZE) {
      const batch = relationshipsToExport.slice(i, i + BATCH_SIZE);
      logger.info(`Processing batch: ${i / BATCH_SIZE + 1}`);
      await processBatch(batch); // Wait for the current batch to complete
    }

    logger.info('Relationship data exported successfully');
  } catch (error) {
    logger.error('Error exporting relationship data', error);
  }
}

exportAllRelationships();