// Runs the seed extractor on REAL seed pages (tests/fixtures/seed-pages.json).
// Expected prices were read by hand from each page's {{Infobox seed}}.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractSeed, isSeedPage, parseOtherPrices, parseSellPrice, parseShopPrice } from '../src/extract/seedExtractor.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/seed-pages.json', import.meta.url)));
const seedPage = (title) => fixture.query.pages.find((page) => page.title === title);

describe('parseShopPrice', () => {
  it('reads plain prices, notes and "Not Sold"', () => {
    expect(parseShopPrice('{{Price|20}}')).toEqual({ price: 20, note: null });
    expect(parseShopPrice('{{Price|40}} (Year 2+)')).toEqual({ price: 40, note: '(Year 2+)' });
    expect(parseShopPrice('Not Sold')).toBeNull();
    expect(parseShopPrice(undefined)).toBeNull();
  });

  it('reports values it does not understand instead of guessing', () => {
    expect(parseShopPrice('varies').error).toMatch(/unreadable/);
    expect(parseShopPrice('{{Price|1}}<br />{{Price|2}}').error).toMatch(/several/);
  });
});

describe('parseSellPrice', () => {
  it('reads one price, several labelled prices, or reports a problem', () => {
    expect(parseSellPrice('{{Price|10}}')).toEqual({ sellPrice: 10, sellPriceNote: null });
    expect(parseSellPrice('{{Price|30}} (a)<br />{{Price|5}} (b)')).toEqual({ sellPrice: 5, sellPriceNote: '30g (a) / 5g (b)' });
    expect(parseSellPrice('varies').problem).toMatch(/could not read/);
    expect(parseSellPrice(undefined).sellPrice).toBeNull();
  });
});

describe('parseOtherPrices', () => {
  it('reads festival prices', () => {
    expect(parseOtherPrices('[[Egg Festival]]: {{Price|100}}')).toEqual({
      prices: [{ shop: 'Egg Festival', price: 100, note: null }],
      errors: [],
    });
  });
});

describe('extractSeed on real wiki pages', () => {
  it('Parsnip Seeds: Pierre and JojaMart, Traveling Cart skipped', () => {
    expect(extractSeed(seedPage('Parsnip Seeds'))).toEqual({
      ok: true,
      seed: {
        name: 'Parsnip Seeds',
        cropName: 'Parsnip',
        sellPrice: 10,
        sellPriceNote: null,
        prices: [
          { shop: "Pierre's General Store", price: 20, note: null },
          { shop: 'JojaMart', price: 25, note: null },
        ],
      },
      warnings: [],
      notes: [],
    });
  });

  it('Garlic Seeds: only at Pierre, from year 2', () => {
    expect(extractSeed(seedPage('Garlic Seeds')).seed.prices).toEqual([
      { shop: "Pierre's General Store", price: 40, note: '(Year 2+)' },
    ]);
  });

  it('Rhubarb Seeds: only at the Oasis', () => {
    expect(extractSeed(seedPage('Rhubarb Seeds')).seed.prices).toEqual([{ shop: 'Oasis', price: 100, note: null }]);
  });

  it('Strawberry Seeds: only at the Egg Festival', () => {
    expect(extractSeed(seedPage('Strawberry Seeds')).seed.prices).toEqual([
      { shop: 'Egg Festival', price: 100, note: null },
    ]);
  });

  it('Sunflower Seeds: JojaMart is cheaper than Pierre, and of two sell prices the lower is stored', () => {
    const result = extractSeed(seedPage('Sunflower Seeds'));
    expect(result.seed.prices).toEqual([
      { shop: "Pierre's General Store", price: 200, note: null },
      { shop: 'JojaMart', price: 125, note: null },
    ]);
    expect(result.seed.sellPrice).toBe(20);
    expect(result.seed.sellPriceNote).toBe('20g (harvested) / 100g (purchased from JojaMart)');
    expect(result.warnings).toEqual([]);
    expect(result.notes[0]).toMatch(/stored the lowest, 20g/);
  });

  it('Carrot Seeds: no shop sells them', () => {
    expect(extractSeed(seedPage('Carrot Seeds')).seed.prices).toEqual([]);
  });

  it('only treats {{Infobox seed}} pages as seed pages', () => {
    expect(isSeedPage(seedPage('Corn Seeds'))).toBe(true);
    const cropPage = { title: 'Corn', revisions: [{ slots: { main: { content: '{{Infobox\n|eng = Corn\n}}' } } }] };
    expect(isSeedPage(cropPage)).toBe(false);
  });
});
