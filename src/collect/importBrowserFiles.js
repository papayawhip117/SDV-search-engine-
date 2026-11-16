// Alternative to `npm run collect`: build the raw data file from API
// responses you saved in your web browser.
//
// Why this exists: the wiki's firewall refuses requests from Node.js
// (HTTP 403) while it allows browsers and curl. We don't disguise our
// program to get past a rule like that, so instead a person downloads
// the data with a browser, and this script takes it from there.
//
// Run with no arguments to see the URLs to save:
//   npm run import
// Then, after saving them into data/browser/:
//   npm run import -- data/browser/*.json

import { readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { API_URL, buildApiUrl } from '../wiki/apiClient.js';
import { isRunDirectly } from '../utils/isRunDirectly.js';
import { CROP_CATEGORIES } from './collectCrops.js';

const RAW_DATA_FOLDER = path.join('data', 'raw');

/**
 * One URL per category. A "generator" turns the category's member list
 * straight into page content, so each URL returns every crop page in
 * that category, with wikitext, revision ids and categories.
 */
export function browserUrlForCategory(categoryName) {
  const url = buildApiUrl({
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: `Category:${categoryName}`,
    gcmnamespace: 0,
    gcmlimit: 50, // the most pages whose content one request may return
    prop: 'revisions|categories',
    rvprop: 'ids|timestamp|content',
    rvslots: 'main',
    cllimit: 'max',
    clshow: '!hidden',
  });
  url.searchParams.delete('maxlag'); // only matters for automated tools
  return url.toString();
}

/**
 * Merge several saved API responses into the same format `npm run collect`
 * produces. Returns { rawData, problems }.
 *
 * @param files  [{ name, json, savedAt }]
 */
export function combineSavedResponses(files) {
  const pagesById = new Map();
  const problems = [];

  for (const { name, json } of files) {
    if (json.error) {
      problems.push(`${name}: the wiki returned an error: ${json.error.info ?? json.error.code}`);
      continue;
    }
    const pages = json.query?.pages;
    if (!Array.isArray(pages)) {
      problems.push(`${name}: no "query.pages" list. Is this one of the URLs from "npm run import"?`);
      continue;
    }
    if (json.continue) {
      problems.push(`${name}: the response says there is more ("continue"), so some pages are missing from it`);
    }

    for (const page of pages) {
      if (page.missing || !page.revisions) continue;
      if (pagesById.has(page.pageid)) continue; // e.g. Corn is in Summer and Fall
      const categoryTitles = (page.categories ?? []).map((c) => c.title.replace(/^Category:/, ''));
      pagesById.set(page.pageid, {
        pageid: page.pageid,
        title: page.title,
        revisions: page.revisions,
        categories: page.categories ?? [],
        foundInCategory: CROP_CATEGORIES.find((name) => categoryTitles.includes(name)) ?? null,
      });
    }
  }

  // The data is as old as the oldest file it came from.
  const savedTimes = files.map((file) => file.savedAt).filter(Boolean).sort();
  const retrievedAt = savedTimes[0] ?? new Date().toISOString();

  return {
    rawData: { source: `${API_URL} (saved from a web browser)`, retrievedAt, categories: CROP_CATEGORIES, pages: [...pagesById.values()] },
    problems,
  };
}

function printInstructions() {
  console.log('Open each URL below in your web browser and save the page as a .json file');
  console.log('in the data/browser/ folder (for example spring.json, summer.json, fall.json).\n');
  for (const categoryName of CROP_CATEGORIES) {
    console.log(`${categoryName}:\n  ${browserUrlForCategory(categoryName)}\n`);
  }
  console.log('Then run:  npm run import -- data/browser/*.json');
}

async function main() {
  const filePaths = process.argv.slice(2);
  if (filePaths.length === 0) {
    printInstructions();
    return;
  }

  const files = filePaths.map((filePath) => ({
    name: filePath,
    json: JSON.parse(readFileSync(filePath, 'utf8')),
    // when the file was saved, which is when the data was downloaded
    savedAt: statSync(filePath).mtime.toISOString(),
  }));

  const { rawData, problems } = combineSavedResponses(files);
  for (const problem of problems) console.warn(`Warning: ${problem}`);

  await mkdir(RAW_DATA_FOLDER, { recursive: true });
  const outputPath = path.join(RAW_DATA_FOLDER, `crops-${rawData.retrievedAt.slice(0, 10)}.json`);
  await writeFile(outputPath, JSON.stringify(rawData, null, 2));
  console.log(`Combined ${rawData.pages.length} unique pages from ${files.length} files into ${outputPath}`);
  console.log('Next: npm run build-db');
}

if (isRunDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
