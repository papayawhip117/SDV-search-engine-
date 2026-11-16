// The real Villagers, List of All Gifts and Friendship pages → villagers and gift tastes.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  extractGiftList,
  extractUniversalDislikes,
  extractVillagerList,
  parseBirthday,
  parseGiftEntries,
} from '../src/extract/villagerExtractor.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).query.pages;
const villagerPages = load('villager-pages.json');
const giftPage = villagerPages.find((page) => page.title === 'List of All Gifts');
const villagersPage = villagerPages.find((page) => page.title === 'Villagers');
const [friendshipPage] = load('friendship-page.json');

describe('parseGiftEntries', () => {
  it('reads one item, with a note when there is one', () => {
    expect(parseGiftEntries('*{{Name|Pearl}}')).toEqual([{ itemName: 'Pearl', groupName: null, exceptions: [], note: null }]);
    expect(parseGiftEntries("*{{Name|Stardrop Tea|'''+250'''}}")[0].note).toBe('+250');
    expect(parseGiftEntries('*{{Name|Journal Scrap|link=Journal Scraps{{!}}Journal Scrap}}')[0]).toMatchObject({
      itemName: 'Journal Scrap',
      note: null,
    });
  });

  it('reads a group with exceptions, keeping both the page title and the shown text', () => {
    expect(parseGiftEntries("*All [[Fruits|Fruit]] ''(except [[Fruit Trees|Fruit Tree Fruit]] &amp; [[Salmonberry]])''")).toEqual([
      {
        itemName: null,
        groupName: 'Fruits',
        exceptions: ['Fruit Trees', 'Fruit Tree Fruit', 'Salmonberry'],
        note: 'All Fruit (except Fruit Tree Fruit & Salmonberry)',
      },
    ]);
    expect(parseGiftEntries("*All Mushrooms ''(except [[Red Mushroom|Red]])''")[0]).toMatchObject({
      groupName: 'Mushrooms',
      exceptions: ['Red Mushroom', 'Red'],
    });
  });

  it('reads the Friendship page style: bold groups and named lists', () => {
    expect(parseGiftEntries("*'''[[Fish#Fish Types|All Fish]]''' (except for [[Carp]] and [[Snail]]s, which are universally hated)")[0]).toMatchObject({
      groupName: 'Fish',
      exceptions: ['Carp', 'Snail'],
    });
    expect(parseGiftEntries("*'''Fireworks''' -- [[Fireworks (Red)|Red]], [[Fireworks (Green)|Green]]")).toEqual([
      { itemName: 'Fireworks (Red)', groupName: null, exceptions: [], note: 'Fireworks' },
      { itemName: 'Fireworks (Green)', groupName: null, exceptions: [], note: 'Fireworks' },
    ]);
  });

  it('returns nothing for a line that is not a gift', () => {
    expect(parseGiftEntries('*Some other text')).toEqual([]);
  });
});

describe('parseBirthday', () => {
  it('reads season and day', () => {
    expect(parseBirthday('[[Summer]] 13')).toEqual({ season: 'Summer', day: 13 });
    expect(parseBirthday('[[Fall]] 05')).toEqual({ season: 'Fall', day: 5 });
    expect(parseBirthday('N/A')).toBeNull();
  });
});

describe('the real List of All Gifts page', () => {
  const result = extractGiftList(giftPage);

  it('reads all 34 villagers without warnings', () => {
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.villagers).toHaveLength(34);
  });

  it("reads Alex's birthday and lists", () => {
    const alex = result.villagers.find((villager) => villager.name === 'Alex');
    expect(alex.birthday).toEqual({ season: 'Summer', day: 13 });
    expect(alex.tastes.love.map((entry) => entry.itemName)).toEqual([
      'Complete Breakfast',
      'Jack Be Nimble, Jack Be Thick',
      'Salmon Dinner',
    ]);
    expect(alex.tastes.hate.map((entry) => entry.itemName)).toEqual(['Holly', 'Quartz']);
  });

  it('reads the universal row (loves, likes, neutrals)', () => {
    expect(result.universal.love.map((entry) => entry.itemName)).toContain('Prismatic Shard');
    expect(result.universal.like.map((entry) => entry.groupName)).toContain('Artisan Goods');
    expect(result.universal.dislike).toEqual([]); // the page links to the Friendship page instead
  });

  it('reads the group lists at the top of the page', () => {
    expect(result.groups['Fruit Tree Fruit']).toEqual(['Apple', 'Apricot', 'Cherry', 'Orange', 'Peach', 'Pomegranate']);
    expect(result.groups.Eggs).toHaveLength(8);
    expect(result.groups.Mushrooms).toContain('Magma Cap');
  });
});

describe('the real Villagers page', () => {
  it('reads who can be married and who takes gifts', () => {
    const result = extractVillagerList(villagersPage);
    expect(result.marriageable).toHaveLength(12);
    expect(result.marriageable).toContain('Abigail');
    expect(result.giftable).toHaveLength(34);
    expect(result.nonGiftable).toContain('Mr. Qi');
  });
});

describe('the real Friendship page', () => {
  const result = extractUniversalDislikes(friendshipPage);

  it('reads the universal dislikes and hates without warnings, and not the exceptions below them', () => {
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.tastes.dislike.map((entry) => entry.itemName ?? `[${entry.groupName}]`)).toContain('Wood');
    expect(result.tastes.dislike.map((entry) => entry.groupName)).toContain('Sprinklers');
    expect(result.tastes.hate.map((entry) => entry.itemName)).toContain('Carp');
    // "Abigail loves Pufferfish" is in the exceptions part, not a universal dislike
    expect(result.tastes.dislike.map((entry) => entry.itemName)).not.toContain('Pufferfish');
  });
});
