// Command-line profit table for one season.
//
// Run with:  npm run profit -- Spring
//       or:  npm run profit -- Spring 10     (planting on Spring 10)

import { existsSync } from 'node:fs';
import { calculateProfit, DAYS_PER_SEASON, SEASON_ORDER } from '../calc/profit.js';
import { DATABASE_PATH } from '../db/buildDatabase.js';
import { openDatabase } from '../db/database.js';
import { getProfitInputs } from '../queries/cropQueries.js';
import { SHOP_FIELDS } from '../extract/seedExtractor.js';
import { isRunDirectly } from '../utils/isRunDirectly.js';

const ASSUMPTIONS = [
  'One plant, planted on the day shown. Each season has 28 days.',
  'One-time crops are replanted on harvest day; regrowing crops are planted once.',
  'Crops that also grow in the next season (e.g. Corn) keep producing into it.',
  'One item per harvest, base quality, no fertilizer, no profession bonuses.',
  'Seed price = cheapest shop on the wiki (Traveling Cart prices are random, so not used).',
  'Profit per day = profit / days from planting to the end of the growing period.',
];

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

  const calculated = [];
  const notCalculated = [];
  for (const crop of inputs) {
    const result = calculateProfit(crop, crop.seedPrice, { season, plantDay });
    if (result.ok) calculated.push({ crop, result });
    else notCalculated.push({ crop, reason: result.reason });
  }
  calculated.sort((a, b) => b.result.profitPerDay - a.result.profitPerDay);

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

  // Things the numbers above don't account for, straight from the data.
  const regularShops = Object.values(SHOP_FIELDS);
  const footnotes = [];
  for (const { crop } of calculated) {
    if (crop.growthNote) footnotes.push(`${crop.name}: growth time also says "${crop.growthNote}", which isn't used here.`);
    if (!regularShops.includes(crop.seedShop)) {
      footnotes.push(`${crop.name}: its seed is only sold at ${crop.seedShop}, so check you can buy it by the planting day.`);
    }
  }
  if (footnotes.length) {
    console.log('\nCheck these:');
    for (const line of footnotes) console.log(`  - ${line}`);
  }

  if (notCalculated.length) {
    console.log('\nNot calculated:');
    for (const { crop, reason } of notCalculated) console.log(`  - ${crop.name}: ${reason}`);
  }
  console.log('\nAssumptions:');
  for (const line of ASSUMPTIONS) console.log(`  - ${line}`);
  console.log('\nData from the Stardew Valley Wiki (CC BY-NC-SA). Seed prices come from each seed\'s wiki page.');
}

if (isRunDirectly(import.meta.url)) main();
