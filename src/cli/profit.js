// Command-line profit table for one season.
//
// Run with:  npm run profit -- Spring
//       or:  npm run profit -- Spring 10     (planting on Spring 10)

import { existsSync } from 'node:fs';
import { DAYS_PER_SEASON, PROFIT_ASSUMPTIONS, SEASON_ORDER, rankCropsByProfit } from '../calc/profit.js';
import { DATABASE_PATH } from '../db/buildDatabase.js';
import { openDatabase } from '../db/database.js';
import { getProfitInputs } from '../queries/cropQueries.js';
import { isRunDirectly } from '../utils/isRunDirectly.js';

function main() {
  const [seasonArgument, dayArgument] = process.argv.slice(2);
  const season = SEASON_ORDER.find((name) => name.toLowerCase() === seasonArgument?.toLowerCase());
  const plantDay = dayArgument === undefined ? 1 : Number(dayArgument);
  if (!season || !Number.isInteger(plantDay) || plantDay < 1 || plantDay > DAYS_PER_SEASON) {
    console.error(`Usage: npm run profit -- <season> [planting day 1-${DAYS_PER_SEASON}]`);
    console.error('Example: npm run profit -- Spring 10');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(DATABASE_PATH)) {
    console.error('No database yet. Run "npm run import -- data/browser/*.json" and "npm run build-db" first.');
    process.exitCode = 1;
    return;
  }

  const db = openDatabase(DATABASE_PATH);
  const inputs = getProfitInputs(db, season);
  db.close();

  const { ranked: calculated, notCalculated, footnotes } = rankCropsByProfit(inputs, { season, plantDay });

  console.log(`Profit per plant, planted on ${season} ${plantDay}:\n`);
  console.table(
    calculated.map(({ crop, result }) => ({
      Crop: crop.name,
      'Profit/day': Number(result.profitPerDay.toFixed(2)),
      Profit: result.profit,
      Harvests: result.harvests,
      'Seed cost': `${result.seedsNeeded} × ${crop.seedPrice}g (${crop.seedShop}${crop.seedPriceNote ? ` ${crop.seedPriceNote}` : ''})`,
      Source: crop.cropSourceUrl,
    })),
  );

  if (footnotes.length) {
    console.log('\nCheck these:');
    for (const line of footnotes) console.log(`  - ${line}`);
  }

  if (notCalculated.length) {
    console.log('\nNot calculated:');
    for (const { crop, reason } of notCalculated) console.log(`  - ${crop.name}: ${reason}`);
  }
  console.log('\nAssumptions:');
  for (const line of PROFIT_ASSUMPTIONS) console.log(`  - ${line}`);
  console.log('\nData from the Stardew Valley Wiki (CC BY-NC-SA). Seed prices come from each seed\'s wiki page.');
}

if (isRunDirectly(import.meta.url)) main();
