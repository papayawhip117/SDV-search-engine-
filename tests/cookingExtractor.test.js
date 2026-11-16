// Runs the cooking extractor on REAL dish pages (tests/fixtures/cooking-pages.json).
// Expected values were read by hand from each page's {{Infobox cooking}}.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractDish, isCookingPage, parseIngredientList, readBuffs, readRecipeSource } from '../src/extract/cookingExtractor.js';
import { extractSummary } from '../src/extract/wikitext.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/cooking-pages.json', import.meta.url)));
const dishPage = (title) => fixture.query.pages.find((page) => page.title === title);

describe('small readers', () => {
  it('reads ingredient lists, including "Any Fish"', () => {
    expect(parseIngredientList('{{Name|Wheat Flour|1}}{{Name|Tomato|1}}')).toEqual([
      { name: 'Wheat Flour', group: null, quantity: 1, note: null },
      { name: 'Tomato', group: null, quantity: 1, note: null },
    ]);
    expect(parseIngredientList('[[File:Fish.png|24px|link=]] Any [[Fish]] (1){{Name|Seaweed|1}}')).toEqual([
      { name: null, group: 'Fish', quantity: 1, note: 'Any Fish (1)' },
      { name: 'Seaweed', group: null, quantity: 1, note: null },
    ]);
  });

  it('reads where a recipe comes from', () => {
    expect(readRecipeSource("''Starter''")).toBe('Starter');
    expect(readRecipeSource('{{NPC|Caroline|Mail - 7+ [[File:HeartIconLarge.png|16px|link=]]}}')).toBe('Caroline: Mail - 7+ hearts');
    expect(readRecipeSource('[[File:Mining Skill Icon.png|24px|link=]] [[Mining]] Level 3')).toBe('Mining Level 3');
  });

  it('reads buffs', () => {
    expect(readBuffs('{{Name|Farming|+2}}{{Name|Max Energy|+50}}')).toBe('Farming +2, Max Energy +50');
    expect(readBuffs(undefined)).toBeNull();
  });
});

describe('extractDish on real pages', () => {
  it('recognises dish pages, whose infobox is wrapped in {{{1|...}}}', () => {
    expect(fixture.query.pages.every(isCookingPage)).toBe(true);
  });

  it('reads Pizza', () => {
    const { dish, warnings } = extractDish(dishPage('Pizza'));
    expect(dish).toEqual({
      name: 'Pizza',
      sellPrice: 300,
      edibility: 60,
      buffs: null,
      buffDuration: null,
      recipeSource: 'The Queen of Sauce: 7 Spring, Year 2; Stardrop Saloon for 150g',
      ingredients: [
        { name: 'Wheat Flour', group: null, quantity: 1, note: null },
        { name: 'Tomato', group: null, quantity: 1, note: null },
        { name: 'Cheese', group: null, quantity: 1, note: null },
      ],
    });
    expect(warnings).toEqual([]);
  });

  it('reads two recipe sources and buffs (Lobster Bisque)', () => {
    const { dish } = extractDish(dishPage('Lobster Bisque'));
    expect(dish.recipeSource).toBe('The Queen of Sauce: 14 Winter, Year 2; Willy: Mail - 9+ hearts');
    expect(dish.buffs).toBe('Fishing +3, Max Energy +50');
    expect(dish.buffDuration).toBe('16m 47s');
  });

  it('reads a two-part buff duration (Squid Ink Ravioli)', () => {
    expect(extractDish(dishPage('Squid Ink Ravioli')).dish.buffDuration).toBe('4m 39s (Mining); 2m 59s (Squid Ink Ravioli Buff)');
  });

  it('reads a recipe bought with items (Banana Pudding) and a starter recipe (Fried Egg)', () => {
    expect(extractDish(dishPage('Banana Pudding')).dish.recipeSource).toBe('Island Trader for Bone Fragment ×30');
    expect(extractDish(dishPage('Fried Egg')).dish.recipeSource).toBe('Starter');
  });

  it('finds the summary below the wrapped infobox', () => {
    expect(extractSummary(dishPage('Pizza').revisions[0].slots.main.content)).toMatch(/^Pizza is a cooked dish\./);
  });
});
