// Cooking recipes on the command line.
//
//   npm run cook -- Tomato            dishes you can cook with Tomato
//   npm run cook -- --buff fishing    dishes that give a Fishing buff
//   npm run cook                      every dish
//
// Each dish shows its sell price next to what its ingredients would sell
// for raw (when we know every ingredient's price), and its wiki source.

import { existsSync } from 'node:fs';
import { DATABASE_PATH } from '../db/buildDatabase.js';
import { openDatabase } from '../db/database.js';
import { getDishes, getDishesUsing } from '../queries/cookingQueries.js';
import { formatIngredient } from './item.js';
import { isRunDirectly } from '../utils/isRunDirectly.js';

/** ["--buff", "fishing"] → { buff: 'fishing' }; ["Wheat", "Flour"] → { ingredient: 'Wheat Flour' } */
export function parseCookArguments(args) {
  const options = {};
  const words = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--buff') {
      if (args[i + 1] === undefined) throw new Error('--buff needs a value, e.g. --buff fishing');
      options.buff = args[++i];
    } else if (args[i].startsWith('--')) {
      throw new Error(`Unknown option ${args[i]}`);
    } else {
      words.push(args[i]);
    }
  }
  if (words.length) options.ingredient = words.join(' ');
  return options;
}

function main() {
  let options;
  try {
    options = parseCookArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  if (!existsSync(DATABASE_PATH)) {
    console.error('No database yet. Run "npm run build-db" first.');
    process.exitCode = 1;
    return;
  }

  const db = openDatabase(DATABASE_PATH);
  let dishes = options.ingredient ? getDishesUsing(db, options.ingredient) : getDishes(db, { buff: options.buff });
  if (options.ingredient && options.buff) {
    dishes = dishes.filter((dish) => dish.buffs?.toLowerCase().includes(options.buff.toLowerCase()));
  }
  db.close();

  if (dishes.length === 0) {
    console.log(options.ingredient ? `No dish in the database uses "${options.ingredient}".` : 'No dishes match.');
    return;
  }
  console.table(
    dishes.map((dish) => ({
      Dish: dish.name,
      'Sell price': dish.sellPrice ?? '?',
      Ingredients: dish.ingredients.map(formatIngredient).join(', '),
      'Ingredients raw': dish.ingredientsValue === null ? '?' : dish.ingredientsValue,
      Buffs: dish.buffs ?? '-',
      Source: dish.sourceUrl,
    })),
  );
  console.log('\n"Ingredients raw" is what the ingredients sell for uncooked; "?" means we don\'t have every price yet.');
  console.log('Recipe sources and details: npm run item -- <dish name>');
  console.log('Data from the Stardew Valley Wiki (CC BY-NC-SA).');
}

if (isRunDirectly(import.meta.url)) main();
