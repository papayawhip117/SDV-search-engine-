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

  lines.push(`Sell price:  ${item.sellPrice === null ? 'unknown' : `${item.sellPrice}g`}${item.sellPriceNote ? `  (${item.sellPriceNote})` : ''}`);
  if (item.type === 'seed' || item.buyPrices.length) lines.push(`Buy:         ${formatPrices(item.buyPrices)}`);
  lines.push(`Seasons:     ${item.seasons.join(', ') || 'unknown'}`);

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
  if (item.growsInto.length) lines.push(`Grows into:  ${item.growsInto.join(', ')}`);
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
