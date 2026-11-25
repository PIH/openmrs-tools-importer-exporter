// CSV report files in LOG_HOME (source-data-fixes.csv, source-data-review.csv, visits-before-birthdate.csv, invalid-identifiers.csv)
import fs from "fs/promises";
import path from "path";
import config from "./config.js";

/** Quotes a CSV value that has a comma, quote or line break; null and undefined become empty. */
export function csvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Patients are exported and imported concurrently: each file's writes go through one chain, so the
// header is written once and rows don't interleave
const queues = new Map();

/**
 * Appends rows (arrays of values) to LOG_HOME/<fileName>, writing the header first if the file doesn't exist yet.
 * Returns a promise that settles once the rows are written.
 */
export function appendCsvRows(fileName, header, rows) {
  if (!rows.length) {
    return Promise.resolve();
  }
  const lines = rows.map(row => row.map(csvField).join(',')).join('\n');
  const previous = queues.get(fileName) ?? Promise.resolve();
  const write = previous.then(async () => {
    const file = path.join(config.LOG_HOME, fileName);
    await fs.mkdir(config.LOG_HOME, { recursive: true });
    let headerLine = '';
    try {
      await fs.access(file);
    } catch {
      headerLine = `${header.join(',')}\n`;
    }
    await fs.appendFile(file, `${headerLine}${lines}\n`);
  });
  queues.set(fileName, write.catch(() => {}));
  return write;
}
