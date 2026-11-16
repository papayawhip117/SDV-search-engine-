// Command-line search: crops for a season, sorted by sell price.
//
// Run with:  npm run crops -- Summer
// (the "--" tells npm that "Summer" is for our script, not for npm itself)

import { existsSync } from 'node:fs';
import { DATABASE_PATH } from '../db/buildDatabase.js';
import { openDatabase } from '../db/database.js';
import { SEASONS } from '../extract/cropExtractor.js';
import { getCropsBySeason } from '../queries/cropQueries.js';
import { isRunDirectly } from '../utils/isRunDirectly.js';

function describeGrowth(crop) {
  if (crop.growthDays === null) return 'unknown';
  return crop.growthNote ? `${crop.growthDays} ${crop.growthNote}` : crop.growthDays;
}

function describeRegrowth(crop) {
  if (crop.regrows === null) return 'unknown';
  if (!crop.regrows) return 'no';
  return crop.regrowthDays === 1 ? 'every day' : `every ${crop.regrowthDays} days`;
}

function main() {
  const season = process.argv[2];
  const knownSeason = SEASONS.find((name) => name.toLowerCase() === season?.toLowerCase());
  if (!knownSeason) {
    console.error(`Usage: npm run crops -- <season>   (one of: ${SEASONS.join(', ')})`);
    process.exitCode = 1;
    return;
  }
  if (!existsSync(DATABASE_PATH)) {
    console.error('No database yet. Run "npm run collect" and then "npm run build-db" first.');
    process.exitCode = 1;
    return;
  }

  const db = openDatabase(DATABASE_PATH);
  const crops = getCropsBySeason(db, knownSeason, { sortBy: 'sell_price' });
  db.close();

  if (crops.length === 0) {
    console.log(`No ${knownSeason} crops in the database.`);
    return;
  }

  console.log(`${knownSeason} crops by sell price (base quality):\n`);
  console.table(
    crops.map((crop) => ({
      Crop: crop.name,
      'Sell price': crop.sellPrice ?? 'unknown',
      'Growth days': describeGrowth(crop),
      Regrows: describeRegrowth(crop),
      Source: crop.sourceUrl,
    })),
  );
  console.log('\nData from the Stardew Valley Wiki (CC BY-NC-SA). Each row links to its source page.');
}

if (isRunDirectly(import.meta.url)) main();
