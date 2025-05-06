import fs from 'fs';
import path from "path";
import logger from "../utils/logger.js";

const fsPromises = fs.promises;

export function loadPatientUuidsFromFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#')); // remove empty lines or comments
  } catch (err) {
    console.error(`Failed to read UUIDs from file: ${err.message}`);
    process.exit(1);
  }
}

export function loadPatientUuidsFromDir(directory) {
  const files = fs.readdirSync(directory);
  const uuids = [];

  files.forEach((file) => {
    const match = file.match(/^(.+)_patient.json$/);
    if (match && match[1]) {
      uuids.push(match[1]);
    }
  });

  return uuids;
}

export async function moveFile(filePath, destinationDir) {
  try {
    const fileName = path.basename(filePath);
    const destinationPath = path.join(destinationDir, fileName);

    // Ensure the destination directory exists
    await fsPromises.mkdir(destinationDir, { recursive: true });

    await fsPromises.rename(filePath, destinationPath);
    logger.info(`Moved file to ${destinationDir}: ${filePath}`);
  } catch (err) {
    logger.error(`Failed to move file: ${err.message}`);
  }
}