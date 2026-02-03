import fs from 'fs';
import path from 'path';
import config from './utils/config.js';
import logger from './utils/logger.js';
import { exportPerson } from "./services/exporterService.js";
import { loadUuidsFromFile } from './services/fileService.js'
import {getGlobalProperty, setGlobalProperty} from "./services/openmrsService.js";
import Constants from "./utils/constants.js";

const UUID_FILE_PATH = path.join(config.EXPORT_PERSON_LIST_FILE);
const personsToExport = loadUuidsFromFile(UUID_FILE_PATH);

// Define a batch size
const BATCH_SIZE = 20;

async function exportAllPersons() {

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
        // Function to process a single batch of person UUIDs
        const processBatch = async (batch) => {
            const exportPromises = batch.map(async (personUuid) => {
                try {
                    const personRecord = await exportPerson(personUuid);
                    const jsonData = JSON.stringify(personRecord, null, 4);
                    const filename = `${personUuid}_person.json`;

                    // Save to file
                    fs.writeFileSync(path.join(config.TARGET_DIR, filename), jsonData);
                    logger.info(`Person data exported to ${filename}`);
                } catch (error) {
                    logger.error(`Error exporting person data for UUID: ${personUuid}`, error);
                }
            });

            // Wait until all promises in the batch are complete
            await Promise.all(exportPromises);
        };

        // Split persons into batches and process each batch
        for (let i = 0; i < personsToExport.length; i += BATCH_SIZE) {
            const batch = personsToExport.slice(i, i + BATCH_SIZE);
            logger.info(`Processing batch: ${i / BATCH_SIZE + 1}`);
            await processBatch(batch); // Wait for the current batch to complete
        }

        logger.info('Person data exported successfully');
    } catch (error) {
        logger.error('Error exporting person data', error);
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

exportAllPersons();
