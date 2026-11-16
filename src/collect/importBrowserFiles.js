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

import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { API_URL, buildApiUrl } from '../wiki/apiClient.js';
import { isRunDirectly } from '../utils/isRunDirectly.js';
import { CROP_CATEGORIES } from './collectCrops.js';
import { FISH_PAGE_GROUPS } from './fishPages.js';
import { ARTISAN_PAGES, FRUIT_LIST_PAGE } from './artisanPages.js';
import { COOKING_PAGE_GROUPS } from './cookingPages.js';
import { FISH_CATEGORIES } from '../extract/fishExtractor.js';
import { CRAFTING_PAGE } from '../extract/craftingExtractor.js';
import { FRIENDSHIP_PAGE, GIFT_LIST_PAGE, VILLAGERS_PAGE } from '../extract/villagerExtractor.js';

// The categories that say which collection a page belongs to, in order of preference.
const COLLECTION_CATEGORIES = [...CROP_CATEGORIES, ...FISH_CATEGORIES, 'Artisan Goods', 'Craftable items', 'Crops', 'Cooking'];
import { openDatabase } from '../db/database.js';

const DATABASE_PATH = path.join('data', 'sdv.db');

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
 * One URL that returns several named pages at once (up to 50), e.g. all seed pages.
 */
export function browserUrlForPages(titles) {
  if (titles.length > 50) throw new Error(`The API returns at most 50 pages per request, not ${titles.length}`);
  const url = buildApiUrl({
    action: 'query',
    titles: titles.join('|'),
    prop: 'revisions|categories',
    rvprop: 'ids|timestamp|content',
    rvslots: 'main',
    cllimit: 'max',
    clshow: '!hidden',
    redirects: 1, // follow a page that was renamed to its new title
  });
  url.searchParams.delete('maxlag');
  return url.toString();
}

/** Names of all seeds the crops in the database grow from. */
function seedNamesInDatabase() {
  if (!existsSync(DATABASE_PATH)) return [];
  const db = openDatabase(DATABASE_PATH);
  const names = db
    .prepare('SELECT DISTINCT seed.name FROM crops c JOIN items seed ON seed.id = c.seed_item_id ORDER BY seed.name')
    .all()
    .map((row) => row.name);
  db.close();
  return names;
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
        foundInCategory: COLLECTION_CATEGORIES.find((name) => categoryTitles.includes(name)) ?? null,
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
  const seedNames = seedNamesInDatabase();
  if (seedNames.length) {
    console.log(`Seed pages (the ${seedNames.length} seeds of the crops already in your database), save as seeds.json:`);
    console.log(`  ${browserUrlForPages(seedNames)}\n`);
  } else {
    console.log('(After your first build-db, this also prints a URL for the seed pages.)\n');
  }
  FISH_PAGE_GROUPS.forEach((titles, index) => {
    console.log(`Fish pages, part ${index + 1} of ${FISH_PAGE_GROUPS.length} (${titles.length} fish), save as fish-${index + 1}.json:`);
    console.log(`  ${browserUrlForPages(titles)}\n`);
  });
  console.log(`Artisan goods and machines (${ARTISAN_PAGES.length} pages), save as artisan.json:`);
  console.log(`  ${browserUrlForPages(ARTISAN_PAGES)}\n`);
  console.log('The Fruits page (which fruits make Wine, Jelly...), save as fruits.json:');
  console.log(`  ${browserUrlForPages([FRUIT_LIST_PAGE])}\n`);
  COOKING_PAGE_GROUPS.forEach((titles, index) => {
    console.log(`Cooking recipes, part ${index + 1} of ${COOKING_PAGE_GROUPS.length} (${titles.length} dishes), save as cooking-${index + 1}.json:`);
    console.log(`  ${browserUrlForPages(titles)}\n`);
  });
  console.log('The Crafting page (every crafting recipe is in its tables), save as crafting.json:');
  console.log(`  ${browserUrlForPages([CRAFTING_PAGE])}\n`);
  console.log('Villagers and gift tastes (the Villagers page and the List of All Gifts), save as villagers.json:');
  console.log(`  ${browserUrlForPages([VILLAGERS_PAGE, GIFT_LIST_PAGE])}\n`);
  console.log('The Friendship page (universal gift dislikes and hates), save as friendship.json:');
  console.log(`  ${browserUrlForPages([FRIENDSHIP_PAGE])}\n`);
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
