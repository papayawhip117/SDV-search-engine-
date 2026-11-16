// Overview pages together with crops, villagers and the rest → database → queries.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFromRawData } from '../src/db/buildDatabase.js';
import { openDatabase } from '../src/db/database.js';
import { giftTaste, whoLikes } from '../src/queries/giftQueries.js';
import { getItemDetails, searchItems } from '../src/queries/search.js';
import { formatItemDetails } from '../src/cli/item.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).query.pages;
const pages = [
  ...load('collection-pages.json'), // first, to check crops still keep their own pages
  ...load('crop-pages.json'),
  ...load('edge-case-pages.json'), // Grape (a crop, also on the Foraging page)
  ...load('villager-pages.json'),
  ...load('friendship-page.json'),
  ...load('artisan-pages.json'),
];

let db;
let report;
beforeAll(() => {
  db = openDatabase(':memory:');
  report = buildFromRawData(db, { retrievedAt: '2026-11-16T06:17:00.000Z', pages });
});

describe('building from the overview pages', () => {
  it('saves every page without warnings', () => {
    expect(report.collectionItems).toEqual({ Minerals: 57, Artifacts: 42, Books: 26, Flowers: 8, Foraging: 38 });
    const titles = ['Foraging', 'Minerals', 'Artifacts', 'Flowers', 'Books'];
    expect(report.warnings.filter(({ title }) => titles.includes(title))).toEqual([]);
  });

  it('can be run twice without duplicates', () => {
    buildFromRawData(db, { retrievedAt: '2026-11-17T00:00:00.000Z', pages });
    expect(db.prepare('SELECT COUNT(*) AS n FROM collection_items').get().n).toBe(57 + 42 + 26 + 8 + 38);
    expect(db.prepare("SELECT COUNT(*) AS n FROM item_groups WHERE group_name = 'Gems'").get().n).toBe(8);
  });

  it('keeps a crop as a crop, citing its own page, and adds what Foraging says', () => {
    const grape = getItemDetails(db, 'Grape');
    expect(grape.type).toBe('crop');
    expect(grape.source.url).toBe('https://stardewvalleywiki.com/Grape');
    expect(grape.collections).toEqual([
      expect.objectContaining({ page: 'Foraging', sections: 'Summer', sellPrice: 80, edibility: 15 }),
    ]);
  });

  it('saves Sweet Pea as a flower, also listed on Foraging', () => {
    const sweetPea = getItemDetails(db, 'Sweet Pea');
    expect(sweetPea.type).toBe('flower');
    expect(sweetPea.collections.map((entry) => entry.page)).toEqual(['Flowers', 'Foraging']);
    expect(sweetPea.seasons).toEqual(['Summer']);
  });
});

describe('search and item details', () => {
  it('filters by the new types and by forage seasons', () => {
    const { results } = searchItems(db, { type: 'forage', season: 'Winter', sortBy: 'name' });
    expect(results.map((result) => result.name)).toEqual([
      'Clam', 'Cockle', 'Coral', 'Crystal Fruit', 'Holly', 'Mussel', 'Nautilus Shell', 'Oyster', 'Sea Urchin', 'Seaweed',
      'Snow Yam', 'Winter Root',
    ]);
  });

  it('finds items through their table ("gems")', () => {
    const { results } = searchItems(db, { text: 'gems', type: 'mineral' });
    expect(results.map((result) => result.name)).toContain('Jade');
  });

  it('prints a mineral', () => {
    const lines = formatItemDetails(getItemDetails(db, 'Emerald'));
    expect(lines).toContain('Minerals:    Gems');
    expect(lines).toContain('Gemologist:  325g (with the Gemologist profession)');
    expect(lines).toContain('Source:      https://stardewvalleywiki.com/Minerals');
  });
});

describe('gift groups that now match', () => {
  it('"All Gems" is universally liked, unless a villager says otherwise', () => {
    expect(giftTaste(db, 'Alex', 'Diamond')).toMatchObject({ taste: 'like', from: 'universal group' });
    expect(giftTaste(db, 'Leah', 'Emerald')).toMatchObject({ taste: 'dislike', from: 'villager group' });
    expect(giftTaste(db, 'Clint', 'Emerald')).toMatchObject({ taste: 'love' });
  });

  it('Artifacts, Books, Flowers and Geode Minerals match too', () => {
    expect(giftTaste(db, 'Penny', 'Arrowhead')).toMatchObject({ taste: 'like', because: 'All Artifacts' });
    expect(giftTaste(db, 'Elliott', 'Book Of Stars')).toMatchObject({ taste: 'like', because: 'All Books' });
    expect(giftTaste(db, 'Alex', 'Fairy Rose')).toMatchObject({ taste: 'like', because: 'All Flowers (except Poppy)' });
    expect(giftTaste(db, 'Alex', 'Opal')).toMatchObject({ taste: 'dislike', because: 'All Geode Minerals' });
  });

  it('every villager has an answer for a gem now', () => {
    expect(whoLikes(db, 'Diamond').unknown).toEqual([]);
  });
});

