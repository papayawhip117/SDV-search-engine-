// Crafting recipes on the command line.
//
//   npm run craft -- Iron Bar           recipes that use Iron Bar
//   npm run craft -- --section rings    every recipe in one section of the Crafting page
//   npm run craft                       the list of sections
//
// Every recipe comes from the wiki's Crafting page, which is cited below the table.

import { existsSync } from 'node:fs';
import { DATABASE_PATH } from '../db/buildDatabase.js';
import { openDatabase } from '../db/database.js';
import { getCraftedUsing, getCraftingRecipes, getCraftingSections } from '../queries/craftingQueries.js';
import { formatIngredient } from './item.js';
import { isRunDirectly } from '../utils/isRunDirectly.js';

/** ["--section", "rings"] → { section: 'rings' }; ["Iron", "Bar"] → { ingredient: 'Iron Bar' } */
export function parseCraftArguments(args) {
  const options = {};
  const words = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--section') {
      if (args[i + 1] === undefined) throw new Error('--section needs a value, e.g. --section rings');
      options.section = args[++i];
    } else if (args[i].startsWith('--')) {
      throw new Error(`Unknown option ${args[i]}`);
    } else {
      words.push(args[i]);
    }
  }
  if (words.length) options.ingredient = words.join(' ');
  return options;
}

/** One table row for a recipe. Exported for tests. */
export function recipeRow(recipe) {
  return {
    Item: recipe.outputQuantity > 1 ? `${recipe.name} (×${recipe.outputQuantity})` : recipe.name,
    Section: recipe.section,
    Ingredients: recipe.ingredients.map(formatIngredient).join(', '),
    'Recipe from': recipe.recipeSource ?? '?',
  };
}

function main() {
  let options;
  try {
    options = parseCraftArguments(process.argv.slice(2));
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
  if (!options.ingredient && !options.section) {
    const sections = getCraftingSections(db);
    db.close();
    if (sections.length === 0) {
      console.log('No crafting recipes in the database yet. Import the Crafting page and run "npm run build-db".');
      return;
    }
    console.log('Crafting sections (use one with --section, or give an ingredient):');
    for (const section of sections) console.log(`  ${section}`);
    return;
  }

  let recipes = options.ingredient ? getCraftedUsing(db, options.ingredient) : getCraftingRecipes(db, { section: options.section });
  if (options.ingredient && options.section) {
    recipes = recipes.filter((recipe) => recipe.section.toLowerCase() === options.section.toLowerCase());
  }
  db.close();

  if (recipes.length === 0) {
    console.log(options.ingredient ? `No crafting recipe in the database uses "${options.ingredient}".` : 'No recipes match.');
    return;
  }
  console.table(recipes.map(recipeRow));
  console.log('\n"(×5)" means one craft makes 5. More details: npm run item -- <item name>');
  console.log(`Source: ${recipes[0].sourceUrl} (revision ${recipes[0].revisionId})`);
  console.log('Data from the Stardew Valley Wiki (CC BY-NC-SA).');
}

if (isRunDirectly(import.meta.url)) main();
