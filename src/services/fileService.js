import fs from 'fs';
import path from "path";
import logger from "../utils/logger.js";

const fsPromises = fs.promises;

export function loadUuidsFromFile(filePath) {
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

// Function to convert CSV file to key-value pairs
export function loadMappingFile(filePath) {
  try {
    // Read the file content
    const content = fs.readFileSync(filePath, 'utf8');

    const keyValuePairs = {};
    if (!content) {
      return keyValuePairs;
    }
    // Split content by lines and remove any extraneous whitespace or empty lines
    const lines = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    // Process each line into key-value pairs (assume first column is key, second is value)
    lines.forEach((line) => {
      const [rawKey, rawValue] = line.split(',').map(part => part.trim());

      if (rawKey && rawValue !== undefined) {
        // Discard anything after the first space in the key and value
        const key = rawKey.split(' ')[0];
        const value = rawValue.split(' ')[0];
        keyValuePairs[key] = value;
      }
    });

    return keyValuePairs;
  } catch (err) {
    console.error(`Error processing CSV file: ${err.message}`);
    return null;
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

export function loadRelationshipUuidsFromDir(directory) {
  const files = fs.readdirSync(directory);
  const uuids = [];

  files.forEach((file) => {
    const match = file.match(/^(.+)_relationship.json$/);
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
  } catch (err) {
    logger.error(`Failed to move file: ${err.message}`);
  }
}