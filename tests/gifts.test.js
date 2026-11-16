// Real crop, fish, artisan, dish, crafting and villager pages → database → gift queries.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFromRawData } from '../src/db/buildDatabase.js';
import { openDatabase } from '../src/db/database.js';
import { getBirthdays, getVillager, giftGroupsOf, giftTaste, whoLikes } from '../src/queries/giftQueries.js';
import { getItemDetails } from '../src/queries/search.js';
import { formatVillager, parseGiftArguments } from '../src/cli/gifts.js';
import { formatItemDetails } from '../src/cli/item.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).query.pages;
const pages = [
  ...load('villager-pages.json'), // first, to check the order of pages doesn't matter
  ...load('friendship-page.json'),
  ...load('crop-pages.json'), // Parsnip, Strawberry, Corn
  ...load('fish-pages.json'), // Tuna, Catfish...
  ...load('artisan-pages.json'), // Wine, Juice, Cheese...
  ...load('fruits-page.json'), // Apple, Banana... (the Fruits group)
  ...load('cooking-pages.json'), // Pizza, Sashimi...
  ...load('crafting-page.json'), // Sprinkler, Warp Totem: Beach...
];

let db;
let report;
beforeAll(() => {
  db = openDatabase(':memory:');
  report = buildFromRawData(db, { retrievedAt: '2026-11-16T06:03:00.000Z', pages });
});

describe('building villagers', () => {
  it('saves 34 villagers and their gift tastes without warnings from the villager pages', () => {
    expect(report.villagers).toBe(34);
    expect(report.giftTastes).toBeGreaterThan(1000);
    const villagerTitles = ['List of All Gifts', 'Villagers', 'Friendship'];
    expect(report.warnings.filter(({ title }) => villagerTitles.includes(title))).toEqual([]);
    expect(report.skipped.map(({ title }) => title)).not.toContain('Friendship');
  });

  it('can be run twice without duplicates', () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM gift_tastes').get().n;
    buildFromRawData(db, { retrievedAt: '2026-11-17T00:00:00.000Z', pages });
    expect(db.prepare('SELECT COUNT(*) AS n FROM villagers').get().n).toBe(34);
    expect(db.prepare('SELECT COUNT(*) AS n FROM gift_tastes').get().n).toBe(before);
  });
});

describe('villagers', () => {
  it('gives birthday, marriage and the lists as the wiki writes them', () => {
    const abigail = getVillager(db, 'abigail');
    expect(abigail.birthday).toEqual({ season: 'Fall', day: 13 });
    expect(abigail.marriageable).toBe(true);
    expect(getVillager(db, 'Lewis').marriageable).toBe(false);
    expect(abigail.tastes.hate).toEqual(['Clay', 'Holly']);
    expect(abigail.source.url).toBe('https://stardewvalleywiki.com/List_of_All_Gifts');
    expect(getVillager(db, 'Nobody')).toBeNull();
  });

  it('lists birthdays in a season by day', () => {
    expect(getBirthdays(db, 'summer').slice(0, 3).map((row) => `${row.name} ${row.day}`)).toEqual([
      'Jas 4',
      'Gus 8',
      'Maru 10',
    ]);
  });
});

describe('deciding a gift taste', () => {
  it("uses the villager's own item first", () => {
    expect(giftTaste(db, 'Penny', 'Poppy')).toMatchObject({ taste: 'love', from: 'villager' });
    expect(giftTaste(db, 'Haley', 'Prismatic Shard')).toMatchObject({ taste: 'hate', from: 'villager' });
  });

  it("then the villager's groups, honouring exceptions", () => {
    // Alex: "All Fruit (except Fruit Tree Fruit & Salmonberry)" is neutral
    expect(giftTaste(db, 'Alex', 'Banana')).toMatchObject({ taste: 'neutral', from: 'villager group' });
    // Apple is Fruit Tree Fruit, so it skips Alex's group and is universally liked
    expect(giftTaste(db, 'Alex', 'Apple')).toMatchObject({ taste: 'like', from: 'universal group', because: 'All Fruit Tree Fruit' });
  });

  it('then the universal lists, including the Friendship page', () => {
    expect(giftTaste(db, 'Alex', 'Wine')).toMatchObject({ taste: 'like', from: 'universal group' });
    expect(giftTaste(db, 'Alex', 'Sprinkler')).toMatchObject({ taste: 'dislike', from: 'universal group' });
    const tuna = giftTaste(db, 'Alex', 'Tuna');
    expect(tuna).toMatchObject({ taste: 'dislike', because: 'All Fish (except for Carp and Snails, which are universally hated)' });
    expect(tuna.sourceUrl).toBe('https://stardewvalleywiki.com/Friendship');
  });

  it('matches names that differ only in punctuation ("Warp Totem Beach")', () => {
    expect(giftTaste(db, 'Alex', 'Warp Totem: Beach')).toMatchObject({ taste: 'hate', from: 'universal' });
  });

  it("returns null when the wiki doesn't say, instead of guessing", () => {
    expect(giftTaste(db, 'Alex', 'Nonexistent Thing')).toBeNull();
    expect(() => giftTaste(db, 'Nobody', 'Tuna')).toThrow(/No villager/);
  });

  it('knows which gift groups an item is in', () => {
    expect(giftGroupsOf(db, 'Apple').sort()).toEqual(['Fruit Tree Fruit', 'Fruits']);
    expect(giftGroupsOf(db, 'Pizza')).toContain('Cooking');
    expect(giftGroupsOf(db, 'Wine')).toContain('Artisan Goods');
    expect(giftGroupsOf(db, 'Tuna')).toContain('Fish');
  });
});

describe('who likes an item', () => {
  it('sorts every villager by taste', () => {
    const pizza = whoLikes(db, 'Pizza');
    expect(pizza.love).toEqual(['Sam', 'Shane']);
    expect(pizza.hate).toEqual(['Leah']);
    const total = Object.values(pizza).reduce((sum, names) => sum + names.length, 0);
    expect(total).toBe(34);
  });

  it('shows gift lines on the item page', () => {
    const lines = formatItemDetails(getItemDetails(db, 'Pizza'));
    expect(lines).toContain('Loved by:    Sam, Shane');
    expect(lines).toContain('Hated by:    Leah');
    const pizza = getItemDetails(db, 'Pizza');
    const likedByAll = { ...pizza, giftTastes: { love: [], like: ['A', 'B'], neutral: [], dislike: [], hate: [], unknown: [], total: 2 } };
    expect(formatItemDetails(likedByAll)).toContain('Liked by:    everyone');
  });
});

describe('gifts command', () => {
  it('reads a villager, --item and --birthday', () => {
    expect(parseGiftArguments(['Alex'])).toEqual({ villager: 'Alex' });
    expect(parseGiftArguments(['--item', 'Fish', 'Taco'])).toEqual({ item: 'Fish Taco' });
    expect(parseGiftArguments(['--birthday', 'summer'])).toEqual({ birthday: 'summer' });
    expect(() => parseGiftArguments(['--item'])).toThrow(/needs a value/);
  });

  it('prints a villager', () => {
    const lines = formatVillager(getVillager(db, 'Alex'));
    expect(lines).toContain('Birthday:    Summer 13');
    expect(lines).toContain('Hates:       Holly, Quartz');
  });
});
