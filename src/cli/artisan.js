// What can I make from this item, and is it worth it?
//
//   npm run artisan -- Starfruit
//   npm run artisan -- Corn
//
// Lists every machine that takes the item, what it makes, how long it takes,
// and how much the product is worth, best value per item first.

import { existsSync } from 'node:fs';
import { DATABASE_PATH } from '../db/buildDatabase.js';
import { openDatabase } from '../db/database.js';
import { getProcessingOptions } from '../queries/artisanQueries.js';
import { suggestNames } from './item.js';
import { isRunDirectly } from '../utils/isRunDirectly.js';

const money = (value) => (value === null ? '?' : `${Math.round(value * 100) / 100}g`);

function main() {
  const name = process.argv.slice(2).join(' ').trim();
  if (!name) {
    console.error('Usage: npm run artisan -- <item name>     e.g. npm run artisan -- Starfruit');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(DATABASE_PATH)) {
    console.error('No database yet. Run "npm run build-db" first.');
    process.exitCode = 1;
    return;
  }

  const db = openDatabase(DATABASE_PATH);
  const found = getProcessingOptions(db, name);
  if (!found) {
    const suggestions = suggestNames(db, name);
    console.log(`No item called "${name}".${suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''}`);
    db.close();
    return;
  }
  db.close();

  console.log(`${found.name}: sells for ${money(found.basePrice)} as it is${found.basePriceSource ? ` (${found.basePriceSource})` : ''}`);
  if (found.groups.length) console.log(`Counts as: ${found.groups.join(', ')}`);
  if (found.options.length === 0) {
    console.log('\nNo machine in the database takes this item.');
    return;
  }

  console.log('');
  console.table(
    found.options.map((option) => ({
      Machine: option.machine,
      Makes: option.outputQuantity > 1 ? `${option.product} ×${option.outputQuantity}` : option.product,
      Uses: option.nearby ? 'nothing (grows nearby)' : `${option.inputQuantity} ${found.name}`,
      Time: option.minutes !== null ? `${option.days} days` : option.timeNote ?? '?',
      'Worth (each)': money(option.value),
      'Per item used': option.nearby ? '-' : money(option.valuePerInput),
      Source: option.sourceUrl,
    })),
  );
  console.log('\nBase quality, no professions. Prices that depend on the ingredient use the wiki\'s formula,');
  console.log('e.g. Wine = 3 × the fruit\'s base price. Days use the game clock (1600 minutes a day).');
  console.log('Data from the Stardew Valley Wiki (CC BY-NC-SA).');
}

if (isRunDirectly(import.meta.url)) main();
