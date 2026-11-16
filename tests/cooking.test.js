// Real crop, fish, artisan and dish pages → database → cooking queries.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFromRawData } from '../src/db/buildDatabase.js';
import { openDatabase } from '../src/db/database.js';
import { getDishes, getDishesUsing, getDishIngredients, ingredientsValue } from '../src/queries/cookingQueries.js';
import { getItemDetails } from '../src/queries/search.js';
import { parseCookArguments } from '../src/cli/cook.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).query.pages;
const pages = [
  ...load('crop-pages.json'), // Corn (for Tortilla)
  ...load('fish-pages.json'), // Tuna
  ...load('cooking-pages.json'),
];

let db;
let report;
beforeAll(() => {
  db = openDatabase(':memory:');
  report = buildFromRawData(db, { retrievedAt: '2026-11-16T05:27:00.000Z', pages });
});

describe('building dishes', () => {
  it('saves all ten dishes without warnings', () => {
    expect(report.savedDishes).toHaveLength(10);
    expect(report.warnings).toEqual([]);
  });

  it('can be run twice without duplicates', () => {
    buildFromRawData(db, { retrievedAt: '2026-11-17T00:00:00.000Z', pages });
    expect(db.prepare('SELECT COUNT(*) AS n FROM dishes').get().n).toBe(10);
    expect(getDishIngredients(db, 'Pizza')).toHaveLength(3);
  });
});

describe('cooking queries', () => {
  it('lists ingredients and whether we know them', () => {
    const tortilla = getDishIngredients(db, 'Tortilla');
    expect(tortilla).toEqual([
      { name: 'Corn', group: null, quantity: 1, sellPrice: 50, sourceUrl: 'https://stardewvalleywiki.com/Corn', known: true },
    ]);
    expect(getDishIngredients(db, 'Pizza')[0]).toMatchObject({ name: 'Wheat Flour', known: false, sellPrice: null });
  });

  it('adds up raw ingredient value only when every price is known', () => {
    expect(ingredientsValue([{ sellPrice: 50, quantity: 2 }, { sellPrice: 10, quantity: 1 }])).toBe(110);
    expect(ingredientsValue([{ sellPrice: 50, quantity: 1 }, { sellPrice: null, quantity: 1 }])).toBeNull();
  });

  it('finds dishes by ingredient name and through "Any Fish"', () => {
    expect(getDishesUsing(db, 'Tuna').map((dish) => dish.name)).toEqual(['Fish Taco', 'Maki Roll', 'Sashimi']);
    expect(getDishesUsing(db, 'corn').map((dish) => dish.name)).toEqual(['Tortilla']);
  });

  it('filters dishes by buff', () => {
    expect(getDishes(db, { buff: 'fishing' }).map((dish) => dish.name)).toEqual(['Fish Taco', 'Lobster Bisque']);
  });

  it('shows dish details and what an item is cooked into', () => {
    const pizza = getItemDetails(db, 'Pizza');
    expect(pizza.type).toBe('dish');
    expect(pizza.dish.recipeSource).toMatch(/Queen of Sauce/);
    expect(pizza.summary).toMatch(/^Pizza is a cooked dish/);
    expect(getItemDetails(db, 'Tuna').usedInDishes).toEqual(['Fish Taco', 'Maki Roll', 'Sashimi']);
  });
});

describe('parseCookArguments', () => {
  it('reads an ingredient and --buff', () => {
    expect(parseCookArguments(['Wheat', 'Flour'])).toEqual({ ingredient: 'Wheat Flour' });
    expect(parseCookArguments(['--buff', 'luck'])).toEqual({ buff: 'luck' });
    expect(() => parseCookArguments(['--buff'])).toThrow(/needs a value/);
  });
});
