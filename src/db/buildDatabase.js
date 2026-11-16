// Step 2 of the data pipeline: raw wiki data → extractor → database.
//
// Run with:  npm run build-db
//
// Reads the newest data/raw/crops-*.json (made by `npm run collect` or
// `npm run import`), extracts each page, saves crops, seeds, fish, artisan goods, dishes and crafting recipes to data/sdv.db, and prints a report
// of skipped pages and warnings so they can be checked by hand.

import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { extractCrop } from '../extract/cropExtractor.js';
import {
  combineArtisanData,
  extractArtisanGood,
  extractFruitList,
  extractMachine,
  isArtisanGoodPage,
  isFruitListPage,
  isMachinePage,
} from '../extract/artisanExtractor.js';
import { extractDish, isCookingPage } from '../extract/cookingExtractor.js';
import { extractCraftingRecipes, isCraftingPage } from '../extract/craftingExtractor.js';
import { extractFish, isFishPage } from '../extract/fishExtractor.js';
import { extractSeed, isSeedPage } from '../extract/seedExtractor.js';
import { isRunDirectly } from '../utils/isRunDirectly.js';
import { openDatabase, saveArtisanData, saveCraftingRecipes, saveCrop, saveDish, saveFish, saveSeed } from './database.js';
import { rebuildSearchIndex } from './searchIndex.js';

export const DATABASE_PATH = path.join('data', 'sdv.db');
const RAW_DATA_FOLDER = path.join('data', 'raw');

/** Extract and save every page in a raw collection. Returns a report. */
export function buildFromRawData(db, rawData) {
  const report = {
    saved: [], savedSeeds: [], savedFish: [], savedArtisan: [], savedMachines: [], savedDishes: [], craftingRecipes: 0, recipes: 0, fruits: 0,
    skipped: [], warnings: [], notes: [],
  };
  // Artisan pages are saved together at the end, because recipes on a machine
  // page are checked against the goods pages.
  const artisan = { machines: [], goods: [], fruitPage: null, fruits: [] };
  // The Crafting page is saved last, so items that have their own page
  // (machines, seed packs) are saved from that page first.
  let crafting = null;
  const addMessages = (title, result) => {
    for (const warning of result.warnings ?? []) report.warnings.push({ title, warning });
    for (const note of result.notes ?? []) report.notes.push({ title, note });
  };

  for (const page of rawData.pages) {
    // Seed pages ({{Infobox seed}}) hold shop prices, then come artisan
    // machines and goods, fish pages ({{Infobox fish}}), and everything
    // else is tried as a crop.
    if (isSeedPage(page)) {
      const result = extractSeed(page);
      saveSeed(db, page, result.seed, rawData.retrievedAt);
      report.savedSeeds.push(result.seed.name);
      for (const warning of result.warnings) report.warnings.push({ title: page.title, warning });
      for (const note of result.notes) report.notes.push({ title: page.title, note });
      continue;
    }

    // The Crafting page, with every crafting recipe in its tables.
    if (isCraftingPage(page)) {
      const result = extractCraftingRecipes(page);
      if (!result.ok) {
        report.skipped.push({ title: page.title, reason: result.reason });
        continue;
      }
      addMessages(page.title, result);
      crafting = { page, result };
      continue;
    }

    // Cooking recipes ({{Infobox cooking}}).
    if (isCookingPage(page)) {
      const result = extractDish(page);
      if (!result.ok) {
        report.skipped.push({ title: page.title, reason: result.reason });
        continue;
      }
      saveDish(db, page, result.dish, rawData.retrievedAt);
      report.savedDishes.push(result.dish.name);
      addMessages(page.title, result);
      continue;
    }

    // Artisan machines, goods and the fruit list.
    if (isMachinePage(page) || isArtisanGoodPage(page) || isFruitListPage(page)) {
      if (isFruitListPage(page)) {
        artisan.fruitPage = page;
        artisan.fruits = extractFruitList(page);
        continue;
      }
      const result = isMachinePage(page) ? extractMachine(page) : extractArtisanGood(page);
      if (!result.ok) {
        report.skipped.push({ title: page.title, reason: result.reason });
        continue;
      }
      addMessages(page.title, result);
      if (result.machine) artisan.machines.push({ page, machine: result.machine, products: result.products });
      else artisan.goods.push({ page, good: result.good });
      continue;
    }

    // Fish pages ({{Infobox fish}}).
    if (isFishPage(page)) {
      const result = extractFish(page);
      if (!result.ok) {
        report.skipped.push({ title: page.title, reason: result.reason });
        continue;
      }
      saveFish(db, page, result.fish, rawData.retrievedAt);
      report.savedFish.push(result.fish.name);
      for (const warning of result.warnings) report.warnings.push({ title: page.title, warning });
      for (const note of result.notes) report.notes.push({ title: page.title, note });
      continue;
    }

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
  if (artisan.machines.length || artisan.goods.length || artisan.fruitPage) {
    const combined = combineArtisanData(
      artisan.machines.map(({ products }) => ({ products })),
      artisan.goods.map(({ good }) => ({ good })),
    );
    report.warnings.push(...combined.warnings);
    report.notes.push(...combined.notes);
    saveArtisanData(db, artisan, combined.recipes, rawData.retrievedAt);
    report.savedArtisan = artisan.goods.map(({ good }) => good.name);
    report.savedMachines = artisan.machines.map(({ machine }) => machine.name);
    report.recipes = combined.recipes.length;
    report.fruits = artisan.fruits.length;
  }

  if (crafting) {
    saveCraftingRecipes(db, crafting.page, crafting.result, rawData.retrievedAt);
    report.craftingRecipes = crafting.result.recipes.length;
  }

  // Last step: refresh the search index from everything saved above.
  report.indexed = rebuildSearchIndex(db);
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

  console.log(
    `\nSaved ${report.saved.length} crops, ${report.savedSeeds.length} seeds, ${report.savedFish.length} fish, ` +
      `${report.savedArtisan.length} artisan goods, ${report.savedMachines.length} machines ` +
      `(${report.recipes} recipes), ${report.fruits} fruits from the Fruits page, ${report.savedDishes.length} dishes ` +
      `and ${report.craftingRecipes} crafting recipes to ${DATABASE_PATH}`,
  );
  console.log(`Search index holds ${report.indexed} items`);
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
