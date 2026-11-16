// Step 1 of the data pipeline: download every crop page from the wiki.
//
// Run with:  npm run collect
//
// What it does:
//   1. Asks the wiki for the pages in "Category:Spring crops", "Summer crops"
//      and "Fall crops". (Category:Crops itself only holds overview pages,
//      see docs/phase-1-research.md section 3b.)
//   2. Merges the lists and removes duplicates (Corn is in Summer AND Fall).
//   3. Downloads the wikitext, revision id and categories of those pages,
//      50 pages per request.
//   4. Saves everything, unchanged, to data/raw/crops-<date>.json.
//
// It does not try to understand the pages. That's the extractor's job
// (src/extract/), which can then be re-run as often as we like without
// contacting the wiki again.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { API_URL, callWikiApiWithContinue } from '../wiki/apiClient.js';
import { isRunDirectly } from '../utils/isRunDirectly.js';

export const CROP_CATEGORIES = ['Spring crops', 'Summer crops', 'Fall crops'];
const PAGES_PER_REQUEST = 50; // the API's limit for normal users
const RAW_DATA_FOLDER = path.join('data', 'raw');

/** Return [{ pageid, title }] for the articles in one category. */
export async function listCategoryMembers(categoryName) {
  const members = [];
  await callWikiApiWithContinue(
    {
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:${categoryName}`,
      cmnamespace: 0, // 0 = normal articles, so subcategories and files are left out
      cmlimit: 500,
    },
    (data) => members.push(...data.query.categorymembers),
  );
  return members;
}

/**
 * Merge several category lists into one list without duplicates.
 * Each page remembers the first category it was found in.
 */
export function mergeCategoryLists(listsByCategory) {
  const pagesById = new Map();
  for (const [categoryName, members] of Object.entries(listsByCategory)) {
    for (const member of members) {
      if (!pagesById.has(member.pageid)) {
        pagesById.set(member.pageid, { ...member, foundInCategory: categoryName });
      }
    }
  }
  return [...pagesById.values()];
}

/** Download wikitext, revision info and categories for a list of titles. */
export async function fetchPages(titles) {
  const pagesById = new Map();

  for (let start = 0; start < titles.length; start += PAGES_PER_REQUEST) {
    const batch = titles.slice(start, start + PAGES_PER_REQUEST);
    console.log(`Downloading pages ${start + 1}-${start + batch.length} of ${titles.length}...`);

    await callWikiApiWithContinue(
      {
        action: 'query',
        titles: batch.join('|'),
        prop: 'revisions|categories',
        rvprop: 'ids|timestamp|content',
        rvslots: 'main',
        cllimit: 'max',
        clshow: '!hidden', // skip maintenance categories like "Pages with broken links"
      },
      (data) => {
        // A long answer can be split across several responses, so we merge
        // what each response tells us about each page.
        for (const page of data.query.pages) {
          if (page.missing) continue;
          const existing = pagesById.get(page.pageid) ?? { pageid: page.pageid, title: page.title, categories: [] };
          if (page.revisions && !existing.revisions) existing.revisions = page.revisions;
          if (page.categories) existing.categories.push(...page.categories);
          pagesById.set(page.pageid, existing);
        }
      },
    );
  }
  return [...pagesById.values()];
}

async function main() {
  const retrievedAt = new Date().toISOString();

  const listsByCategory = {};
  for (const categoryName of CROP_CATEGORIES) {
    listsByCategory[categoryName] = await listCategoryMembers(categoryName);
    console.log(`Category:${categoryName} has ${listsByCategory[categoryName].length} pages`);
  }
  const uniquePages = mergeCategoryLists(listsByCategory);
  console.log(`${uniquePages.length} unique pages after removing duplicates`);

  const downloaded = await fetchPages(uniquePages.map((page) => page.title));
  const foundIn = new Map(uniquePages.map((page) => [page.pageid, page.foundInCategory]));
  for (const page of downloaded) page.foundInCategory = foundIn.get(page.pageid) ?? null;

  const output = { source: API_URL, retrievedAt, categories: CROP_CATEGORIES, pages: downloaded };
  await mkdir(RAW_DATA_FOLDER, { recursive: true });
  const fileName = path.join(RAW_DATA_FOLDER, `crops-${retrievedAt.slice(0, 10)}.json`);
  await writeFile(fileName, JSON.stringify(output, null, 2));
  console.log(`Saved ${downloaded.length} pages to ${fileName}`);
}

// Only run main() when this file is started directly (npm run collect),
// not when a test imports its functions.
if (isRunDirectly(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
