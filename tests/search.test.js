// Search engine tests, on a database built from the real wiki fixtures:
// crops Parsnip, Strawberry, Corn, Grape, Unmilled Rice, Coffee Bean, Ancient Fruit
// and seeds Carrot, Corn, Garlic, Parsnip, Rhubarb, Strawberry, Sunflower.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFromRawData } from '../src/db/buildDatabase.js';
import { openDatabase } from '../src/db/database.js';
import { getItemDetails, searchItems, toFtsQuery } from '../src/queries/search.js';
import { parseSearchArguments } from '../src/cli/search.js';
import { suggestNames } from '../src/cli/item.js';
import { extractSummary, toPlainText } from '../src/extract/wikitext.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).query.pages;
let db;

beforeAll(() => {
  db = openDatabase(':memory:');
  const pages = [...load('crop-pages.json'), ...load('edge-case-pages.json'), ...load('seed-pages.json')];
  buildFromRawData(db, { retrievedAt: '2026-11-16T00:00:00.000Z', pages });
});

const names = (options) => searchItems(db, options).results.map((item) => item.name);

describe('toFtsQuery', () => {
  it('quotes each word so it is searched as text, never as a command', () => {
    expect(toFtsQuery('blue berry')).toEqual({ query: '"blue" "berry"', ignoredWords: [] });
    expect(toFtsQuery('"; DROP TABLE items; --')).toEqual({ query: '"DROP" "TABLE" "items"', ignoredWords: [] });
    expect(toFtsQuery("Pierre's")).toEqual({ query: '"Pierre\'s"', ignoredWords: [] });
  });

  it('skips words under 3 letters and reports them', () => {
    expect(toFtsQuery('xx corn')).toEqual({ query: '"corn"', ignoredWords: ['xx'] });
    expect(toFtsQuery('')).toEqual({ query: null, ignoredWords: [] });
  });
});

describe('searchItems: text', () => {
  it('finds names by any part of a word', () => {
    expect(names({ text: 'berry' })).toEqual(expect.arrayContaining(['Strawberry', 'Strawberry Seeds']));
    expect(names({ text: 'strawb' })).toEqual(expect.arrayContaining(['Strawberry', 'Strawberry Seeds']));
  });

  it('ranks a name match above a mention in another field', () => {
    expect(names({ text: 'corn' })[0]).toMatch(/^Corn/);
  });

  it('finds related items through wiki categories and shops', () => {
    // Category:Trellis Crops. Not Grape Starter: it has no page of its own in
    // these fixtures, and the Grape page's categories describe the Grape.
    expect(names({ text: 'trellis' })).toEqual(['Grape']);
    expect(names({ text: 'oasis' })).toEqual(['Rhubarb Seeds']); // only seed sold at the Oasis in the fixtures
    expect(names({ text: 'egg festival' })).toEqual(['Strawberry Seeds']);
  });

  it('needs every word to match', () => {
    // Corn Seeds matches by name; Corn because its page says it "grows from Corn Seeds".
    expect(names({ text: 'corn seeds' })).toEqual(['Corn Seeds', 'Corn']);
    expect(names({ text: 'parsnip garlic' })).toEqual([]);
  });

  it('returns nothing (and does not crash) for unknown or hostile text', () => {
    expect(names({ text: 'dragonfruit' })).toEqual([]);
    expect(names({ text: '"; DROP TABLE items; --' })).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM items').get().n).toBeGreaterThan(0); // still there
  });
});

describe('searchItems: filters and sorting', () => {
  it('filters by season, including seeds through the crop they grow into', () => {
    expect(names({ season: 'fall', type: 'crop' })).toEqual(['Ancient Fruit', 'Corn', 'Grape']);
    // Ancient Seeds and Grape Starter are known only from their crop pages here
    expect(names({ season: 'Fall', type: 'seed' })).toEqual(['Ancient Seeds', 'Corn Seeds', 'Grape Starter']);
  });

  it('sorts seeds by cheapest buy price, and puts unknown prices last', () => {
    const results = searchItems(db, { type: 'seed', sortBy: 'buy' }).results;
    expect(results.map((r) => [r.name, r.buyPrice])).toEqual([
      ['Parsnip Seeds', 20],
      ['Garlic Seeds', 40],
      ['Rhubarb Seeds', 100], // equal prices are sorted by name
      ['Strawberry Seeds', 100],
      ['Sunflower Seeds', 125], // JojaMart's 125 is cheaper than Pierre's 200
      ['Corn Seeds', 150],
      // unknown prices last, by name. Carrot Seeds: no shop sells them.
      // The others have no seed page in these fixtures, so no price yet.
      ['Ancient Seeds', null],
      ['Carrot Seeds', null],
      ['Grape Starter', null],
      ['Rice Shoot', null],
    ]);
  });

  it('sorts by sell price high to low, or reversed', () => {
    expect(names({ type: 'crop', sortBy: 'sell', limit: 2 })).toEqual(['Ancient Fruit', 'Strawberry']);
    expect(names({ type: 'crop', sortBy: 'sell', descending: false, limit: 2 })).toEqual(['Coffee Bean', 'Unmilled Rice']);
  });

  it('gives every result its season list and wiki source', () => {
    for (const item of searchItems(db, {}).results) {
      expect(item.sourceUrl).toMatch(/^https:\/\/stardewvalleywiki\.com\//);
      expect(Array.isArray(item.seasons)).toBe(true);
    }
    expect(searchItems(db, { text: 'corn seeds' }).results[0].seasons).toEqual(['Summer', 'Fall']);
  });

  it('rejects unknown options with a clear message', () => {
    expect(() => searchItems(db, { season: 'Autumn' })).toThrow(/Unknown season/);
    expect(() => searchItems(db, { type: 'furniture' })).toThrow(/Unknown type/);
    expect(() => searchItems(db, { sortBy: 'price; DROP TABLE items' })).toThrow(/Can't sort/);
  });
});

describe('getItemDetails: related records', () => {
  it('a crop shows its seed and where to buy it', () => {
    const parsnip = getItemDetails(db, 'parsnip'); // any letter case
    expect(parsnip).toMatchObject({
      name: 'Parsnip',
      type: 'crop',
      seasons: ['Spring'],
      crop: {
        growthDays: 4,
        regrows: false,
        stageDays: [1, 1, 1, 1],
        seed: {
          name: 'Parsnip Seeds',
          prices: [
            { shop: "Pierre's General Store", price: 20, note: null, sourceUrl: 'https://stardewvalleywiki.com/Parsnip_Seeds' },
            { shop: 'JojaMart', price: 25, note: null, sourceUrl: 'https://stardewvalleywiki.com/Parsnip_Seeds' },
          ],
        },
      },
      source: { title: 'Parsnip', url: 'https://stardewvalleywiki.com/Parsnip', revision: 191123 },
    });
    expect(parsnip.summary).toBe('The Parsnip is a vegetable crop that grows from Parsnip Seeds after 4 days.');
  });

  it('a seed shows what it grows into', () => {
    expect(getItemDetails(db, 'Corn Seeds')).toMatchObject({ type: 'seed', growsInto: ['Corn'], seasons: ['Summer', 'Fall'] });
  });

  it('returns null for an unknown item, and suggests names for typos', () => {
    expect(getItemDetails(db, 'Dragonfruit')).toBeNull();
    expect(suggestNames(db, 'strawbery')).toEqual(expect.arrayContaining(['Strawberry']));
  });
});

describe('summaries', () => {
  it('turns wiki markup into plain text', () => {
    expect(toPlainText("'''Parsnip Seeds''' are a type of [[seed]]. Costs {{Price|20}} from {{Name|Pierre}}.")).toBe(
      'Parsnip Seeds are a type of seed. Costs 20g from Pierre.',
    );
  });

  it('skips the infobox and indented notes at the top of a page', () => {
    const text = '{{Infobox seed\n|crop = {{Name|X}}\n}}\n:This article is about the seed.\n\'\'\'X Seeds\'\'\' grow into X.';
    expect(extractSummary(text)).toBe('X Seeds grow into X.');
  });
});

describe('parseSearchArguments', () => {
  it('splits words from options', () => {
    expect(parseSearchArguments(['blue', 'berry', '--season', 'summer', '--sort', 'sell', '--reverse'])).toEqual({
      text: 'blue berry',
      season: 'summer',
      sort: 'sell',
      reverse: true,
    });
    expect(() => parseSearchArguments(['--colour', 'red'])).toThrow(/Unknown option/);
    expect(() => parseSearchArguments(['--season'])).toThrow(/needs a value/);
  });
});
