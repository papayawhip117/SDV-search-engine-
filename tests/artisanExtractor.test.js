// Runs the artisan extractor on REAL machine, goods and Fruits pages.
// Expected values were read by hand from the products tables and infoboxes.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  combineArtisanData,
  extractArtisanGood,
  extractFruitList,
  extractMachine,
  parseDuration,
  parseInputs,
  parsePrice,
  parseProductName,
} from '../src/extract/artisanExtractor.js';
import { parseTableWithSpans } from '../src/extract/wikitext.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/artisan-pages.json', import.meta.url)));
const fruitsPage = JSON.parse(readFileSync(new URL('./fixtures/fruits-page.json', import.meta.url))).query.pages[0];
const page = (title) => fixture.query.pages.find((p) => p.title === title);

describe('parseTableWithSpans', () => {
  it('repeats rowspan cells, fills colspan cells and keeps list lines', () => {
    const table = [
      '{|',
      '!Name !! colspan="2" | Price',
      '|-',
      '|rowspan="2"|Oil',
      '|Corn',
      '|100',
      '|-',
      '|Sunflower',
      '|One of:',
      '* a',
      '|}',
    ].join('\n');
    expect(parseTableWithSpans(table)).toEqual([
      ['Name', 'Price', 'Price'],
      ['Oil', 'Corn', '100'],
      ['Oil', 'Sunflower', 'One of:\n* a'],
    ]);
  });
});

describe('small readers', () => {
  it('reads processing times', () => {
    expect(parseDuration('{{Duration|1750 mins|class=inline}} (&#8776;1.1 Days)')).toEqual({ minutes: 1750, timeNote: '≈1.1 Days' });
    expect(parseDuration('{{duration|3 Hours}}')).toEqual({ minutes: 180, timeNote: null });
    expect(parseDuration('10,000m (&#8776;7d)')).toEqual({ minutes: 10000, timeNote: null });
    expect(parseDuration('{{Duration|4 Nights}}')).toEqual({ minutes: null, timeNote: '4 Nights' });
    expect(parseDuration('9 or 4 days')).toEqual({ minutes: null, timeNote: '9 or 4 days' });
  });

  it('reads fixed prices and price formulas', () => {
    expect(parsePrice('{{Price|200}}').sellPrice).toBe(200);
    expect(parsePrice('{{Qualityprice|Cheese|230|hide=silver,iridium|dsv=false}}').sellPrice).toBe(230);
    expect(parsePrice('3 &times; [[Fruits|Fruit]] Base Price')).toMatchObject({ multiplier: 3, bonus: 0 });
    expect(parsePrice('2 × Base Ingredient Price + 50')).toMatchObject({ multiplier: 2, bonus: 50 });
    expect(parsePrice('7.5 &times; [[Fruits|Fruit]] Base Price + {{Price|25}} (1.5 &times; Base + {{Price|5}} per [[Fruits|Fruit]])'))
      .toMatchObject({ multiplier: 7.5, bonus: 25 });
    expect(parsePrice('(7.5 × mushroom Base Price) + 25')).toMatchObject({ multiplier: 7.5, bonus: 25 });
    expect(parsePrice('Cannot be sold')).toMatchObject({ sellPrice: null, multiplier: null, priceNote: 'Cannot be sold' });
  });

  it('reads product names and how many come out', () => {
    expect(parseProductName('[[Vinegar]] (2)')).toEqual({ name: 'Vinegar', quantity: 2 });
    expect(parseProductName('[[Jellies and Pickles|Jelly]]')).toEqual({ name: 'Jelly', quantity: 1 });
  });

  it('splits ingredients into alternatives', () => {
    expect(parseInputs("{{Name|Milk|1|class=inline}} ''or''{{Name|Large Milk|1}}").map((i) => [i.name, i.quantity]))
      .toEqual([['Milk', 1], ['Large Milk', 1]]);
    expect(parseInputs('5 of Any [[Fruits|Fruit]] (except [[Grape]]s)')).toEqual([
      { name: null, group: 'Fruits', quantity: 5, exclusions: ['Grape'], note: '5 of Any Fruit (except Grapes)' },
    ]);
    expect(parseInputs('5 [[Grape]]s')[0]).toMatchObject({ name: 'Grape', quantity: 5 });
  });
});

describe('extractMachine on real pages', () => {
  it('reads the Keg: machine recipe and all 8 products', () => {
    const { machine, products, warnings } = extractMachine(page('Keg'));
    expect(machine).toEqual({
      name: 'Keg',
      recipeSource: 'Farming Level 8',
      ingredients: 'Wood ×30, Copper Bar ×1, Iron Bar ×1, Oak Resin ×1',
      sellPriceNote: 'Cannot be sold',
    });
    expect(products.map((p) => p.product)).toEqual(['Beer', 'Vinegar', 'Coffee', 'Green Tea', 'Mead', 'Pale Ale', 'Juice', 'Juice', 'Wine']);
    const wine = products.find((p) => p.product === 'Wine');
    expect(wine).toMatchObject({ minutes: 10000, sellPrice: null, multiplier: 3, bonus: 0, input: { group: 'Fruits', quantity: 1 } });
    expect(products.find((p) => p.product === 'Vinegar')).toMatchObject({ outputQuantity: 2, sellPrice: 100, input: { name: 'Rice' } });
    expect(warnings).toEqual([]);
  });

  it('gives each Oil ingredient its own time (rowspan table)', () => {
    const oil = extractMachine(page('Oil Maker')).products.filter((p) => p.product === 'Oil');
    expect(oil.map((p) => [p.input.name, p.minutes, p.sellPrice])).toEqual([
      ['Corn', 1000, 100],
      ['Sunflower Seeds', 3200, 100],
      ['Sunflower', 60, 100],
    ]);
  });

  it('reads Bee House honey: wild, and one price per flower that is not used up', () => {
    const honey = extractMachine(page('Bee House')).products;
    expect(honey).toHaveLength(8);
    expect(honey[0]).toMatchObject({ sellPrice: 100, input: { name: null } });
    expect(honey.find((p) => p.input.name === 'Fairy Rose')).toMatchObject({ sellPrice: 680, input: { quantity: null } });
  });

  it('reads the Preserves Jar list of pickle ingredients', () => {
    const pickles = extractMachine(page('Preserves Jar')).products.filter((p) => p.product === 'Pickles');
    expect(pickles.map((p) => p.input.group)).toEqual(['Vegetables', 'Mushrooms', 'Forage']);
    expect(pickles[1].input.exclusions).toEqual(['Red Mushroom']);
  });

  it('notes what it does not store yet (Cask aging) and handles the Tapper', () => {
    expect(extractMachine(page('Cask')).notes[0]).toMatch(/aging is not stored yet/);
    expect(extractMachine(page('Tapper'))).toMatchObject({ products: [], warnings: [] });
  });
});

describe('extractArtisanGood and combineArtisanData', () => {
  const goods = ['Wine', 'Juice', 'Cheese', 'Maple Syrup', 'Raisins'].map((title) => extractArtisanGood(page(title)));
  // The Cheese Press page isn't in the fixture, so Cheese falls back to its own page.
  const machines = ['Keg', 'Preserves Jar', 'Dehydrator', 'Tapper'].map((title) => extractMachine(page(title)));

  it('reads a good whose price is a formula', () => {
    expect(goods[0].good).toMatchObject({ name: 'Wine', sellPrice: null, sellPriceNote: '3 × Base Fruit Price', machines: ['Keg'] });
  });

  it('skips the Jellies and Pickles page, which has no infobox', () => {
    expect(extractArtisanGood(page('Jellies and Pickles')).ok).toBe(false);
  });

  it('adds exceptions from the goods page and takes Tapper recipes from the goods page', () => {
    const { recipes, warnings, notes } = combineArtisanData(machines, goods);
    const juice = recipes.find((r) => r.product === 'Juice' && r.input.group === 'Vegetables');
    expect(juice.input.exclusions).toEqual(['Wheat', 'Hops', 'Tea Leaves']);
    expect(recipes.filter((r) => r.product === 'Maple Syrup').map((r) => [r.machine, r.timeNote, r.sellPrice])).toEqual([
      ['Tapper', '9 or 4 days', 200],
      ['Heavy Tapper', '9 or 4 days', 200],
    ]);
    expect(warnings).toEqual([]);
    expect(notes.map((n) => n.title)).toEqual(['Juice', 'Cheese', 'Maple Syrup']);
    expect(recipes.filter((r) => r.product === 'Cheese').map((r) => [r.machine, r.input.name, r.minutes])).toEqual([
      ['Cheese Press', 'Milk', 200],
      ['Cheese Press', 'Large Milk', 200],
    ]);
  });

  it('warns when the machine table and the goods page disagree on a price', () => {
    const raisins = structuredClone(goods.find((g) => g.good.name === 'Raisins'));
    raisins.good.sellPrice = 999;
    const { warnings } = combineArtisanData(machines, [raisins]);
    expect(warnings[0].warning).toMatch(/Dehydrator page says 600g but the Raisins page says 999g/);
  });
});

describe('extractFruitList', () => {
  it('reads every fruit with its base price from the Fruits page', () => {
    const fruits = extractFruitList(fruitsPage);
    expect(fruits).toHaveLength(27);
    expect(fruits.slice(0, 3)).toEqual([
      { name: 'Ancient Fruit', basePrice: 550 },
      { name: 'Apple', basePrice: 100 },
      { name: 'Apricot', basePrice: 50 },
    ]);
    expect(fruits.find((f) => f.name === 'Starfruit')).toEqual({ name: 'Starfruit', basePrice: 750 });
  });
});
