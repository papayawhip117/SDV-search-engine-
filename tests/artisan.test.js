// Real crop, fish, artisan and Fruits pages → database → "what can I make?"

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFromRawData } from '../src/db/buildDatabase.js';
import { openDatabase } from '../src/db/database.js';
import { getProcessingOptions, getRecipesFor, minutesToDays, productValue } from '../src/queries/artisanQueries.js';
import { getItemDetails, searchItems } from '../src/queries/search.js';
import { formatRecipe } from '../src/cli/item.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).query.pages;
const pages = [
  ...load('crop-pages.json'), // Parsnip, Strawberry, Corn (saved without their categories)
  ...load('edge-case-pages.json'), // Unmilled Rice is in Category:Vegetables, Grape is a fruit
  ...load('fish-pages.json'), // Tuna, ...
  ...load('artisan-pages.json'),
  ...load('fruits-page.json'),
];

let db;
let report;
beforeAll(() => {
  db = openDatabase(':memory:');
  report = buildFromRawData(db, { retrievedAt: '2026-11-16T05:12:00.000Z', pages });
});

describe('building artisan data', () => {
  it('saves goods, machines, recipes and the fruit list without warnings', () => {
    expect(report.savedArtisan).toEqual(['Wine', 'Juice', 'Cheese', 'Maple Syrup', 'Raisins']);
    expect(report.savedMachines).toEqual(['Keg', 'Preserves Jar', 'Oil Maker', 'Bee House', 'Dehydrator', 'Fish Smoker', 'Cask', 'Tapper']);
    expect(report.fruits).toBe(27);
    expect(report.warnings).toEqual([]);
    expect(report.skipped).toEqual([{ title: 'Jellies and Pickles', reason: expect.stringMatching(/no \{\{Infobox\}\}/) }]);
  });

  it('gives products without their own page an item that cites the machine page', () => {
    const jelly = getItemDetails(db, 'Jelly');
    expect(jelly.type).toBe('artisan');
    expect(jelly.source.url).toBe('https://stardewvalleywiki.com/Preserves_Jar');
    expect(jelly.categories).toEqual([]); // the Preserves Jar's categories aren't Jelly's
  });
});

describe('calculations', () => {
  it('works out formula prices and game days', () => {
    expect(productValue({ sellPrice: null, multiplier: 3, bonus: 0 }, 750)).toBe(2250);
    expect(productValue({ sellPrice: null, multiplier: 2, bonus: 50 }, 120)).toBe(290);
    expect(productValue({ sellPrice: 200, multiplier: null, bonus: null }, 25)).toBe(200);
    expect(productValue({ sellPrice: null, multiplier: 3, bonus: 0 }, null)).toBeNull();
    expect(minutesToDays(10000)).toBe(6.25);
    expect(minutesToDays(null)).toBeNull();
  });
});

describe('getProcessingOptions', () => {
  it('ranks what a fruit can become (Strawberry: Wine, Jelly, Dried Fruit)', () => {
    const { basePrice, groups, options } = getProcessingOptions(db, 'strawberry');
    expect(basePrice).toBe(120);
    expect(groups).toEqual(['Fruits']);
    expect(options.map((o) => [o.product, o.value, o.valuePerInput, o.days])).toEqual([
      ['Wine', 360, 360, 6.25],
      ['Jelly', 290, 290, 2.5],
      ['Dried Fruit', 925, 185, null],
    ]);
    expect(options[0].sourceUrl).toBe('https://stardewvalleywiki.com/Keg');
  });

  it('uses the Fruits page price for a fruit that is not an item yet (Apple)', () => {
    const apple = getProcessingOptions(db, 'Apple');
    expect(apple.basePrice).toBe(100);
    expect(apple.basePriceSource).toBe('https://stardewvalleywiki.com/Fruits');
    expect(apple.options[0]).toMatchObject({ product: 'Wine', value: 300 });
  });

  it('finds vegetable recipes through Category:Vegetables (Unmilled Rice)', () => {
    const rice = getProcessingOptions(db, 'Unmilled Rice');
    expect(rice.groups).toEqual(['Vegetables']);
    expect(rice.options.map((o) => [o.machine, o.product, o.value])).toEqual([
      ['Preserves Jar', 'Pickles', 2 * rice.basePrice + 50],
      ['Keg', 'Juice', 2.25 * rice.basePrice],
    ]);
  });

  it('finds recipes that name the item (Corn → Oil)', () => {
    expect(getProcessingOptions(db, 'Corn').options.map((o) => [o.machine, o.product, o.value])).toContainEqual(['Oil Maker', 'Oil', 100]);
  });

  it('leaves out recipes that exclude the item (no Dried Fruit from Grapes, Raisins instead)', () => {
    const products = getProcessingOptions(db, 'Grape').options.map((o) => o.product);
    expect(products).toEqual(['Wine', 'Jelly', 'Raisins']);
  });

  it('smokes fish', () => {
    expect(getProcessingOptions(db, 'Tuna').options.map((o) => [o.product, o.value])).toEqual([['Smoked Fish', 200]]);
  });

  it('returns null for unknown items', () => {
    expect(getProcessingOptions(db, 'Moon Rock')).toBeNull();
  });
});

describe('how an item is made', () => {
  it('lists recipes with their source and formats them', () => {
    const [wine] = getRecipesFor(db, 'Wine');
    expect(wine).toMatchObject({ machine: 'Keg', inputGroup: 'Fruits', minutes: 10000, days: 6.25, multiplier: 3 });
    expect(formatRecipe(wine)).toBe('Keg: Any Fruit (1), 10000 min (6.25 days), 3 × Fruit Base Price');
  });

  it('shows a machine with what it makes', () => {
    const keg = getItemDetails(db, 'Keg');
    expect(keg.type).toBe('machine');
    expect(keg.sellPriceNote).toBe('Cannot be sold');
    expect(keg.machine.products).toEqual(['Beer', 'Coffee', 'Green Tea', 'Juice', 'Mead', 'Pale Ale', 'Vinegar', 'Wine']);
  });

  it('finds artisan goods and machines in the search', () => {
    expect(searchItems(db, { type: 'machine', sortBy: 'name' }).results.map((r) => r.name)).toContain('Preserves Jar');
    expect(searchItems(db, { text: 'keg', type: 'artisan' }).results.map((r) => r.name)).toContain('Wine');
  });
});
