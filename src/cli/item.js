// Show one item and everything connected to it.
//
//   npm run item -- Blueberry
//   npm run item -- "Parsnip Seeds"

import { existsSync } from 'node:fs';
import { DATABASE_PATH } from '../db/buildDatabase.js';
import { openDatabase } from '../db/database.js';
import { getItemDetails, searchItems } from '../queries/search.js';
import { isRunDirectly } from '../utils/isRunDirectly.js';

function formatPrices(prices) {
  if (prices.length === 0) return 'not sold in any shop (by the wiki infobox)';
  return prices.map(({ shop, price, note }) => `${price}g at ${shop}${note ? ` ${note}` : ''}`).join('; ');
}

/** "Tomato ×1" or "any Fish ×1" */
export function formatIngredient(ingredient) {
  return `${ingredient.name ?? `any ${ingredient.group ?? '?'}`} ×${ingredient.quantity}`;
}

/** "Keg: Any Fruit (1) → 1, 10000 min (6.25 days), 3 × Base Fruit Price" */
export function formatRecipe(recipe) {
  const output = recipe.outputQuantity > 1 ? ` → ${recipe.outputQuantity}` : '';
  const time = recipe.minutes !== null ? `${recipe.minutes} min (${recipe.days} days)` : recipe.timeNote ?? 'time unknown';
  const price = recipe.sellPrice !== null ? `${recipe.sellPrice}g` : recipe.priceNote ?? 'price unknown';
  const except = recipe.inputExclusions.length ? ` (not ${recipe.inputExclusions.join(', ')})` : '';
  return `${recipe.machine}: ${recipe.inputNote ?? '?'}${except}${output}, ${time}, ${price}`;
}

/**
 * Suggest names for a misspelt item: search for the name, then for shorter
 * and shorter beginnings of it ("strawbery" → "strawber" finds Strawberry).
 */
export function suggestNames(db, name) {
  for (let length = name.length; length >= 3; length--) {
    const results = searchItems(db, { text: name.slice(0, length), limit: 5 }).results;
    if (results.length) return results.map((result) => result.name);
  }
  return [];
}

/** Turn the details object into printable lines. Exported for tests. */
export function formatItemDetails(item) {
  const lines = [`${item.name}  (${item.type})`, ''];
  if (item.summary) lines.push(item.summary, '');

  if (item.sellPrice !== null) {
    lines.push(`Sell price:  ${item.sellPrice}g${item.sellPriceNote ? `  (${item.sellPriceNote})` : ''}`);
  } else if (item.sellPriceNote) {
    lines.push(`Sell price:  ${item.madeBy.some((r) => r.multiplier !== null) ? 'depends on the ingredient: ' : ''}${item.sellPriceNote}`);
  } else if (item.madeBy.length) {
    lines.push('Sell price:  see "How it is made" below');
  } else {
    lines.push('Sell price:  unknown');
  }
  if (item.type === 'seed' || item.buyPrices.length) lines.push(`Buy:         ${formatPrices(item.buyPrices)}`);
  if (['crop', 'seed', 'fish'].includes(item.type) || item.seasons.length) {
    lines.push(`Seasons:     ${item.seasons.join(', ') || 'unknown'}`);
  }

  if (item.crop) {
    const { crop } = item;
    const growth = crop.growthDays === null ? 'unknown' : `${crop.growthDays} days${crop.growthNote ? ` ${crop.growthNote}` : ''}`;
    lines.push(`Growth:      ${growth}${crop.stageDays.length ? `  (stages: ${crop.stageDays.join(', ')})` : ''}`);
    const regrowth = crop.regrows === null ? 'unknown' : crop.regrows ? `every ${crop.regrowthDays} days` : 'no';
    lines.push(`Regrows:     ${regrowth}`);
    if (crop.isTrellis) lines.push('Trellis:     yes (in Category:Trellis Crops)');
    if (crop.seed) {
      lines.push(`Seed:        ${crop.seed.name === item.name ? 'itself' : crop.seed.name}`);
      if (crop.seed.name !== item.name) lines.push(`             ${formatPrices(crop.seed.prices)}`);
    }
  }
  if (item.fish) {
    const { fish } = item;
    if (fish.seasonNote) lines.push(`             wiki says: ${fish.seasonNote}`);
    lines.push(`Caught with: ${fish.catchMethod}${fish.isLegendary ? '  (legendary)' : ''}`);
    lines.push(`Where:       ${fish.location ?? 'unknown'}${fish.areas.length ? `  [${fish.areas.join(', ')}]` : ''}`);
    if (fish.time) lines.push(`Time:        ${fish.time}`);
    if (fish.weather || fish.weatherNote) lines.push(`Weather:     ${fish.weather ?? fish.weatherNote}`);
    if (fish.difficulty !== null) lines.push(`Difficulty:  ${fish.difficulty}${fish.behavior ? ` (${fish.behavior})` : ''}`);
    if (fish.sizeMin !== null) lines.push(`Size:        ${fish.sizeMin}–${fish.sizeMax} inches`);
    if (fish.fishingLevel !== null) {
      lines.push(`Needs:       fishing level ${fish.fishingLevel}${fish.fishingLevelNote ? ` ${fish.fishingLevelNote}` : ''}`);
    }
  }
  if (item.machine) {
    // A machine's crafting recipe is shown under "Crafting" below when we have it.
    if (!item.crafting) {
      lines.push(`Recipe:      ${item.machine.recipeSource ?? 'unknown'}`);
      lines.push(`Made from:   ${item.machine.ingredients ?? 'unknown'}`);
    }
    if (item.machine.products.length) lines.push(`Makes:       ${item.machine.products.join(', ')}`);
  }
  if (item.madeBy.length) {
    lines.push('How it is made:');
    for (const recipe of item.madeBy) lines.push(`  - ${formatRecipe(recipe)}`);
  }
  if (item.dish) {
    const { dish } = item;
    lines.push(`Ingredients: ${dish.ingredients.map(formatIngredient).join(', ')}`);
    if (dish.buffs) lines.push(`Buffs:       ${dish.buffs}${dish.buffDuration ? ` (${dish.buffDuration})` : ''}`);
    if (dish.edibility !== null) lines.push(`Edibility:   ${dish.edibility}`);
    lines.push(`Recipe from: ${dish.recipeSource ?? 'unknown'}`);
  }
  if (item.usedInDishes.length) lines.push(`Cooked into: ${item.usedInDishes.join(', ')}`);
  if (item.crafting) {
    const { crafting } = item;
    const makes = crafting.outputQuantity > 1 ? `  (one craft makes ${crafting.outputQuantity})` : '';
    lines.push(`Crafting:    ${crafting.ingredients.map(formatIngredient).join(', ')}${makes}`);
    if (crafting.ingredientsNote) lines.push(`             ${crafting.ingredientsNote}`);
    if (crafting.details) lines.push(`Details:     ${crafting.details}`);
    lines.push(`Recipe from: ${crafting.recipeSource ?? 'unknown'}`);
    if (crafting.nameNote) lines.push(`Also called: ${crafting.nameNote}`);
    if (crafting.sourceUrl !== item.source.url) {
      lines.push(`             (crafting recipe from ${crafting.sourceUrl}, revision ${crafting.revisionId})`);
    }
  }
  if (item.usedInCrafting.length) lines.push(`Crafted into: ${item.usedInCrafting.join(', ')}`);
  if (item.growsInto.length) lines.push(`Grows into:  ${item.growsInto.join(', ')}`);
  for (const [taste, label] of [['love', 'Loved by:'], ['like', 'Liked by:'], ['dislike', 'Disliked by:'], ['hate', 'Hated by:']]) {
    const names = item.giftTastes[taste];
    if (names.length) lines.push(`${label.padEnd(13)}${names.length === item.giftTastes.total ? 'everyone' : names.join(', ')}`);
  }
  if (item.categories.length) lines.push(`Categories:  ${item.categories.join(', ')}`);

  lines.push(
    '',
    `Source:      ${item.source.url}`,
    `             revision ${item.source.revision}${item.source.revisionTime ? ` (edited ${item.source.revisionTime.slice(0, 10)})` : ''}, downloaded ${item.source.retrievedAt.slice(0, 10)}`,
    'Data from the Stardew Valley Wiki (CC BY-NC-SA).',
  );
  return lines;
}

function main() {
  const name = process.argv.slice(2).join(' ').trim();
  if (!name) {
    console.error('Usage: npm run item -- <item name>     e.g. npm run item -- "Parsnip Seeds"');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(DATABASE_PATH)) {
    console.error('No database yet. Run "npm run build-db" first.');
    process.exitCode = 1;
    return;
  }

  const db = openDatabase(DATABASE_PATH);
  const item = getItemDetails(db, name);
  if (!item) {
    const suggestions = suggestNames(db, name);
    console.log(`No item called "${name}".${suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ''}`);
    db.close();
    return;
  }
  db.close();
  console.log(formatItemDetails(item).join('\n'));
}

if (isRunDirectly(import.meta.url)) main();
