// Step 1 of the AI assistant: questions → cited facts, on real wiki pages.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFromRawData } from '../src/db/buildDatabase.js';
import { openDatabase } from '../src/db/database.js';
import { MAX_FACTS, findFacts, understandQuestion } from '../src/assistant/findFacts.js';
import { formatFacts } from '../src/cli/ask.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).query.pages;
const pages = [
  'crop-pages.json', // Parsnip, Strawberry, Corn
  'seed-pages.json',
  'fish-pages.json',
  'artisan-pages.json',
  'fruits-page.json',
  'cooking-pages.json',
  'crafting-page.json',
  'villager-pages.json',
  'friendship-page.json',
  'collection-pages.json',
].flatMap(load);

let db;
beforeAll(() => {
  db = openDatabase(':memory:');
  buildFromRawData(db, { retrievedAt: '2026-11-16T06:30:00.000Z', pages });
});

const texts = (result) => result.facts.map((fact) => fact.text);

describe('understanding a question', () => {
  it('finds villagers, items, seasons and topics', () => {
    expect(understandQuestion(db, 'Does Penny like Poppy?')).toEqual({
      villagers: ['Penny'],
      items: ['Poppy'],
      seasons: [],
      topics: ['gift'],
    });
    expect(understandQuestion(db, 'best crops to plant in autumn')).toMatchObject({ seasons: ['Fall'], topics: ['profit'] });
  });

  it('reads plurals and possessives', () => {
    expect(understandQuestion(db, 'Tell me about strawberries').items).toEqual(['Strawberry']);
    expect(understandQuestion(db, "What's Abigail's birthday?").villagers).toEqual(['Abigail']);
  });

  it('prefers the longest name and ignores names inside other words', () => {
    expect(understandQuestion(db, 'How do I make a Quality Sprinkler?').items).toEqual(['Quality Sprinkler']);
    expect(understandQuestion(db, 'What about cornflakes?').items).toEqual([]); // not "Corn"
  });
});

describe('facts', () => {
  it('answers a villager + item gift question first, with its source', () => {
    const result = findFacts(db, 'Does Penny like Poppy?');
    expect(result.facts[0]).toEqual({
      id: 'F1',
      text: "Penny loves Poppy as a gift (Penny's own list: Poppy).",
      sources: [{ title: 'List of All Gifts', url: 'https://stardewvalleywiki.com/List_of_All_Gifts', revision: 195507 }],
    });
  });

  it('gives a villager birthday and gift lists', () => {
    const result = findFacts(db, 'What does Abigail love?');
    expect(texts(result)).toContain('Abigail\'s birthday is Fall 13. They can be married.');
    expect(texts(result).some((text) => text.startsWith('Abigail loves: Amethyst'))).toBe(true);
  });

  it('gives item facts from several pages, each citing its own page', () => {
    const result = findFacts(db, 'Tell me about strawberries');
    const growth = result.facts.find((fact) => fact.text === 'Strawberry takes 8 days to grow. It regrows every 4 days.');
    expect(growth.sources.map((source) => source.title)).toEqual(['Strawberry']);
    const seed = result.facts.find((fact) => fact.text.startsWith('Strawberry grows from Strawberry Seeds'));
    expect(seed.sources.map((source) => source.title)).toEqual(['Strawberry', 'Strawberry Seeds']);
  });

  it('marks numbers the app works out', () => {
    const result = findFacts(db, 'what can I make with strawberries');
    const wine = result.facts.find((fact) => fact.text.startsWith('Strawberry can be made into Wine'));
    expect(wine.text).toBe("Strawberry can be made into Wine in a Keg, worth 360g. (Worked out by the app from the wiki's price formula.)");
  });

  it('works out the most profitable crops for a season', () => {
    const result = findFacts(db, 'What is the most profitable crop in spring?');
    expect(result.facts[0].text).toMatch(/^Planted on Spring 1, one Strawberry plant gives 5 harvest\(s\)/);
    expect(result.facts[0].text).toMatch(/Worked out by the app/);
  });

  it('lists birthdays, fish and forage for a season', () => {
    expect(texts(findFacts(db, 'who has a birthday in fall'))[0]).toMatch(/^Birthdays in Fall: Penny \(Fall 2\), Elliott \(Fall 5\)/);
    expect(texts(findFacts(db, 'fishing in summer')).some((text) => text.startsWith('Tuna can be caught in Summer'))).toBe(true);
    expect(texts(findFacts(db, 'what can I forage in winter'))[0]).toMatch(/^Forage in Winter: .*Crystal Fruit \(150g\)/);
  });

  it('every fact has at least one source with a revision', () => {
    for (const question of ['Does Penny like Poppy?', 'Tell me about Emerald', 'how do I craft a sprinkler', 'best crops in summer']) {
      for (const fact of findFacts(db, question).facts) {
        expect(fact.sources.length).toBeGreaterThan(0);
        for (const source of fact.sources) expect(source).toEqual({ title: expect.any(String), url: expect.stringMatching(/^https:\/\/stardewvalleywiki\.com\//), revision: expect.any(Number) });
      }
    }
  });

  it('falls back to search when no name is recognised, and says so', () => {
    const result = findFacts(db, 'sprinklers');
    expect(result.usedSearch).toBe(false); // "sprinklers" is the plural of Sprinkler
    const searched = findFacts(db, 'iridium');
    expect(searched.usedSearch).toBe(true);
    expect(searched.facts.length).toBeGreaterThan(0);
  });

  it('returns no facts rather than guessing', () => {
    const result = findFacts(db, 'What is the meaning of life?');
    expect(result.facts).toEqual([]);
    expect(formatFacts(result)).toContain('No facts found in the database for this question.');
  });

  it('never returns more than MAX_FACTS facts', () => {
    const result = findFacts(db, 'Abigail Alex Elliott Emily Haley Harvey Leah Maru Penny Sam Sebastian Shane');
    expect(result.facts.length).toBe(MAX_FACTS);
  });
});
