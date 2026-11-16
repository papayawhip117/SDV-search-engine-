// Real crop, fish, artisan and Crafting pages → database → crafting queries.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFromRawData } from '../src/db/buildDatabase.js';
import { openDatabase } from '../src/db/database.js';
import {
  getCraftedUsing,
  getCraftingIngredients,
  getCraftingRecipe,
  getCraftingRecipes,
  getCraftingSections,
} from '../src/queries/craftingQueries.js';
import { getItemDetails, searchItems } from '../src/queries/search.js';
import { parseCraftArguments, recipeRow } from '../src/cli/craft.js';
import { formatItemDetails } from '../src/cli/item.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).query.pages;
const pages = [
  ...load('crafting-page.json'), // first, to check that pages with their own item still win
  ...load('crop-pages.json'), // Corn
  ...load('fish-pages.json'), // Tuna
  ...load('artisan-pages.json'), // Keg, Tapper, Maple Syrup...
];

let db;
let report;
beforeAll(() => {
  db = openDatabase(':memory:');
  report = buildFromRawData(db, { retrievedAt: '2026-11-16T05:48:00.000Z', pages });
});

const names = (recipes) => recipes.map((recipe) => recipe.name);

describe('building crafting recipes', () => {
  it('saves all 150 recipes without crafting warnings', () => {
    expect(report.craftingRecipes).toBe(150);
    expect(report.warnings.filter(({ title }) => title === 'Crafting')).toEqual([]);
    expect(report.skipped.map(({ title }) => title)).not.toContain('Crafting');
  });

  it('can be run twice without duplicates', () => {
    buildFromRawData(db, { retrievedAt: '2026-11-17T00:00:00.000Z', pages });
    expect(db.prepare('SELECT COUNT(*) AS n FROM crafting_recipes').get().n).toBe(150);
    expect(getCraftingIngredients(db, 'Sprinkler')).toHaveLength(2);
  });

  it('keeps machines as machines, citing their own page, with the recipe citing the Crafting page', () => {
    const keg = getItemDetails(db, 'Keg');
    expect(keg.type).toBe('machine');
    expect(keg.source.url).toBe('https://stardewvalleywiki.com/Keg');
    expect(keg.crafting.sourceUrl).toBe('https://stardewvalleywiki.com/Crafting');
    expect(keg.crafting.revisionId).toBe(195392);
    expect(keg.crafting.recipeSource).toBe('Farming Level 8');
  });

  it('makes new items of type "crafted" that cite the Crafting page', () => {
    const sprinkler = getItemDetails(db, 'Sprinkler');
    expect(sprinkler.type).toBe('crafted');
    expect(sprinkler.source.url).toBe('https://stardewvalleywiki.com/Crafting');
    expect(sprinkler.summary).toBeNull(); // the Crafting page's opening isn't about sprinklers
    expect(getItemDetails(db, 'Cherry Bomb').sellPrice).toBe(50);
  });
});

describe('crafting queries', () => {
  it('lists ingredients and whether we know them', () => {
    expect(getCraftingIngredients(db, 'Bee House').map((i) => [i.name, i.quantity, i.known])).toEqual([
      ['Wood', 40, false],
      ['Coal', 8, false],
      ['Iron Bar', 1, false],
      ['Maple Syrup', 1, true],
    ]);
  });

  it('finds recipes by ingredient name, in page order', () => {
    expect(names(getCraftedUsing(db, 'maple syrup'))).toEqual(['Bee House']);
    expect(names(getCraftedUsing(db, 'Iron Bar')).slice(0, 3)).toEqual(['Iron Fence', 'Sprinkler', 'Quality Sprinkler']);
  });

  it('finds recipes through groups: "Any Fish" and "Wild Seeds (Any)"', () => {
    expect(names(getCraftedUsing(db, 'Tuna'))).toEqual(['Quality Fertilizer']);
    expect(names(getCraftedUsing(db, 'Spring Seeds'))).toEqual(['Tea Sapling']);
  });

  it('lists a section in page order', () => {
    expect(getCraftingSections(db)).toHaveLength(17);
    expect(getCraftingSections(db)[0]).toBe('Bombs');
    expect(names(getCraftingRecipes(db, { section: 'sprinklers' }))).toEqual([
      'Sprinkler',
      'Quality Sprinkler',
      'Iridium Sprinkler',
    ]);
  });

  it('returns one recipe with its output quantity, or null', () => {
    expect(getCraftingRecipe(db, 'Speed-Gro')).toMatchObject({ section: 'Fertilizer', outputQuantity: 5 });
    expect(getCraftingRecipe(db, 'Parsnip')).toBeNull();
  });
});

describe('crafted items in search and item details', () => {
  it('filters search by type "crafted"', () => {
    const { results } = searchItems(db, { text: 'sprinkler', type: 'crafted' });
    expect(names(results).sort()).toEqual(['Iridium Sprinkler', 'Quality Sprinkler', 'Sprinkler']);
  });

  it('finds a recipe through its Crafting page section', () => {
    const { results } = searchItems(db, { text: 'consumables' });
    expect(names(results)).toContain('Rain Totem');
  });

  it('shows what an item is crafted into', () => {
    expect(getItemDetails(db, 'Corn').usedInCrafting).toEqual([]);
    expect(getItemDetails(db, 'Maple Syrup').usedInCrafting).toEqual(['Bee House']);
  });

  it('prints the crafting lines', () => {
    const lines = formatItemDetails(getItemDetails(db, 'Quality Fertilizer'));
    expect(lines).toContain('Crafting:    Sap ×4, any Fish ×1  (one craft makes 2)');
    expect(lines).toContain('Recipe from: Farming Level 9');
    const keg = formatItemDetails(getItemDetails(db, 'Keg'));
    expect(keg).toContain('             (crafting recipe from https://stardewvalleywiki.com/Crafting, revision 195392)');
  });
});

describe('craft command', () => {
  it('reads an ingredient and --section', () => {
    expect(parseCraftArguments(['Iron', 'Bar'])).toEqual({ ingredient: 'Iron Bar' });
    expect(parseCraftArguments(['--section', 'rings'])).toEqual({ section: 'rings' });
    expect(() => parseCraftArguments(['--section'])).toThrow(/needs a value/);
    expect(() => parseCraftArguments(['--buff', 'x'])).toThrow(/Unknown option/);
  });

  it('shows how many one craft makes', () => {
    expect(recipeRow(getCraftingRecipe(db, 'Magnet')).Item).toBe('Magnet (×3)');
  });
});
