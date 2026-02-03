import fs from 'fs/promises';
import path from 'path';
import config from './utils/config.js';
import logger from './utils/logger.js';
import {importPerson} from './services/importerService.js';
import {loadMappingFile, moveFile} from './services/fileService.js';
import {replaceMappings} from "./utils/utils.js";

const TARGET_DIR = config.TARGET_DIR;
const SUCCESS_DIR = path.join(TARGET_DIR, 'successful');
const FAILED_DIR = path.join(TARGET_DIR, 'failed');

const USER_MAPPINGS_FILE_PATH = config.EXPORT_USER_MAPPINGS_FILE ? path.join(config.EXPORT_USER_MAPPINGS_FILE) : undefined;
const userMappings = USER_MAPPINGS_FILE_PATH ? loadMappingFile(USER_MAPPINGS_FILE_PATH) : [];

// Define a batch size
const BATCH_SIZE = config.IMPORT_PERSONS_BATCH_SIZE ? config.IMPORT_PERSONS_BATCH_SIZE : 1;

async function importAllPersons() {
    try {
        // Read all files in the target directory
        const files = (await fs.readdir(TARGET_DIR)).filter(f => f.endsWith('_person.json'));

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
        // replace any user mappings
        const updatedContent = replaceMappings(content, userMappings);
        const personRecord = JSON.parse(updatedContent);

        // Import record
        await importPerson(personRecord)
        logger.info(`Successfully processed person from file ${file}`);
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

importAllPersons().catch(err => logger.error(`Fatal error: ${err.message}`));
