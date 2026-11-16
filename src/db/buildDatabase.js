// Step 2 of the data pipeline: raw wiki data → extractor → database.
//
// Run with:  npm run build-db
//
// Reads the newest data/raw/crops-*.json (made by `npm run collect`),
// extracts each page, saves the crops to data/sdv.db, and prints a report
// of skipped pages and warnings so they can be checked by hand.

import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { extractCrop } from '../extract/cropExtractor.js';
import { isRunDirectly } from '../utils/isRunDirectly.js';
import { openDatabase, saveCrop } from './database.js';

export const DATABASE_PATH = path.join('data', 'sdv.db');
const RAW_DATA_FOLDER = path.join('data', 'raw');

/** Extract and save every page in a raw collection. Returns a report. */
export function buildFromRawData(db, rawData) {
  const report = { saved: [], skipped: [], warnings: [], notes: [] };

  for (const page of rawData.pages) {
    const result = extractCrop(page);
    if (!result.ok) {
      report.skipped.push({ title: page.title, reason: result.reason });
      continue;
    }
    saveCrop(db, page, result.crop, rawData.retrievedAt);
    report.saved.push(result.crop.name);
    for (const warning of result.warnings) report.warnings.push({ title: page.title, warning });
    for (const note of result.notes) report.notes.push({ title: page.title, note });
  }
  return report;
}

function findNewestRawFile() {
  let files;
  try {
    files = readdirSync(RAW_DATA_FOLDER).filter((name) => /^crops-.*\.json$/.test(name));
  } catch {
    files = [];
  }
  if (files.length === 0) {
    throw new Error(`No crops-*.json file in ${RAW_DATA_FOLDER}. Run "npm run collect" first.`);
  }
  files.sort(); // names start with the date, so alphabetical order = date order
  return path.join(RAW_DATA_FOLDER, files[files.length - 1]);
}

function main() {
  const rawFile = findNewestRawFile();
  console.log(`Reading ${rawFile}`);
  const rawData = JSON.parse(readFileSync(rawFile, 'utf8'));

  // The database is built entirely from the raw files, so we start from an
  // empty one each time. That way a change to the tables (schema.sql) never
  // clashes with an old database file.
  rmSync(DATABASE_PATH, { force: true });
  const db = openDatabase(DATABASE_PATH);
  const report = buildFromRawData(db, rawData);
  db.close();

  console.log(`\nSaved ${report.saved.length} crops to ${DATABASE_PATH}`);
  if (report.skipped.length) {
    console.log(`\nSkipped ${report.skipped.length} pages (not crops, or unreadable):`);
    for (const { title, reason } of report.skipped) console.log(`  - ${title}: ${reason}`);
  }
  if (report.notes.length) {
    console.log(`\n${report.notes.length} notes (choices the extractor made, worth a look):`);
    for (const { title, note } of report.notes) console.log(`  - ${title}: ${note}`);
  }
  if (report.warnings.length) {
    console.log(`\n${report.warnings.length} warnings (values stored as unknown, please check these pages):`);
    for (const { title, warning } of report.warnings) console.log(`  - ${title}: ${warning}`);
  }
}

if (isRunDirectly(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
