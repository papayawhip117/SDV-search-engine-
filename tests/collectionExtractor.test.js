// The real Foraging, Minerals, Artifacts, Flowers and Books pages → items.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractCollection, isCollectionPage, readEdibility, readFound, readPrice } from '../src/extract/collectionExtractor.js';

const pages = JSON.parse(readFileSync(new URL('./fixtures/collection-pages.json', import.meta.url))).query.pages;
const results = Object.fromEntries(pages.map((page) => [page.title, extractCollection(page)]));
const item = (title, name) => results[title].items.find((entry) => entry.name === name);

describe('cell readers', () => {
  it('reads prices', () => {
    expect(readPrice('{{Price|250}}')).toBe(250);
    expect(readPrice('{{Qualityprice|Daffodil|30}}')).toBe(30);
    expect(readPrice('{{Qualityprice|Sweet Pea|50|pm=1.1}}')).toBe(50);
  });

  it('reads edibility, including negative and inedible', () => {
    expect(readEdibility('{{EdibilityGrid|Common Mushroom|15}}')).toBe(15);
    expect(readEdibility('{{EdibilityGrid|Red Mushroom|-20}}')).toBe(-20);
    expect(readEdibility("''Inedible''")).toBeNull();
  });

  it('reads where an item is found as one line', () => {
    expect(readFound('[[The Mines]] (Floors 1-120){{Name|Garbage Can}}{{Name|Stone Golem|10%}}')).toBe(
      'The Mines (Floors 1-120); Garbage Can; Stone Golem (10%)',
    );
    expect(readFound('{{Name|Emerald Node|link=Mining#Emerald Node{{!}}Emerald Node}}')).toBe('Emerald Node');
    expect(readFound('\n* [[Pelican Town]] (100%)\n* [[Bus Stop]] (45%)')).toBe('Pelican Town (100%); Bus Stop (45%)');
  });
});

describe('the five real overview pages', () => {
  it('only reads the five pages', () => {
    expect(pages.every(isCollectionPage)).toBe(true);
    expect(isCollectionPage({ title: 'Crafting' })).toBe(false);
  });

  it('reads every table without warnings', () => {
    const counts = Object.fromEntries(Object.entries(results).map(([title, result]) => [title, result.items.length]));
    expect(counts).toEqual({ Artifacts: 42, Minerals: 57, Foraging: 38, Flowers: 8, Books: 26 });
    for (const result of Object.values(results)) expect(result.warnings).toEqual([]);
  });

  it('reads a gem with its Gemologist price and group', () => {
    expect(item('Minerals', 'Emerald')).toMatchObject({
      type: 'mineral',
      groups: ['Gems'],
      sellPrice: 250,
      gemologistPrice: 325,
    });
    expect(item('Minerals', 'Omni Geode')).toMatchObject({ type: 'geode', groups: ['Geodes'], sellPrice: 0 });
  });

  it('lists forage found in several tables once, with all its seasons', () => {
    expect(item('Foraging', 'Common Mushroom')).toMatchObject({
      sections: ['Spring', 'Summer', 'Fall'],
      seasons: ['Spring', 'Summer', 'Fall'],
      sellPrice: 40,
      edibility: 15,
      groups: [],
    });
    expect(item('Foraging', 'Clam').seasons).toEqual(['Spring', 'Summer', 'Fall', 'Winter']); // "All"
    expect(item('Foraging', 'Nautilus Shell').seasons).toEqual(['Winter']);
  });

  it('reads the Flowers table with two header rows', () => {
    expect(item('Flowers', 'Fairy Rose')).toMatchObject({ type: 'flower', groups: ['Flowers'], sellPrice: 290, seasons: ['Fall'] });
    expect(item('Flowers', 'Sunflower').seasons).toEqual(['Summer', 'Fall']);
  });

  it('tells apart two artifacts shown with the same name', () => {
    expect(item('Artifacts', 'Strange Doll (green)').sellPrice).toBe(1000);
    expect(item('Artifacts', 'Strange Doll (yellow)').sellPrice).toBe(1000);
  });

  it('reads books, which have no sell price, and the hidden "reading again" column', () => {
    expect(item('Books', 'Price Catalogue')).toMatchObject({ type: 'book', sellPrice: null, details: 'Reading it again: Nothing' });
    expect(item('Books', 'Bait And Bobber').sections).toEqual(['Skill Books']);
  });
});
