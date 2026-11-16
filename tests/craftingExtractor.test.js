// The real Crafting page (revision 195392) → crafting recipes.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  extractCraftingRecipes,
  isCraftingPage,
  parseCraftedName,
  parseCraftingIngredients,
  readCraftingSource,
} from '../src/extract/craftingExtractor.js';

const [craftingPage] = JSON.parse(readFileSync(new URL('./fixtures/crafting-page.json', import.meta.url))).query.pages;
const result = extractCraftingRecipes(craftingPage);
const recipe = (name) => result.recipes.find((r) => r.name === name);

describe('parseCraftedName', () => {
  it('reads the name and how many one craft makes', () => {
    expect(parseCraftedName('[[Sprinkler]]')).toEqual({ name: 'Sprinkler', outputQuantity: 1, nameNote: null });
    expect(parseCraftedName('[[Iron Fence]] (10)')).toEqual({ name: 'Iron Fence', outputQuantity: 10, nameNote: null });
  });

  it('uses the text shown, not the page title', () => {
    expect(parseCraftedName('[[Bait (item)|Bait]] (5)')).toEqual({ name: 'Bait', outputQuantity: 5, nameNote: null });
  });

  it('keeps a second name as a note', () => {
    expect(parseCraftedName('Wild Seeds (Sp)<br />([[Spring Seeds]])')).toEqual({
      name: 'Spring Seeds',
      outputQuantity: 1,
      nameNote: 'Wild Seeds (Sp)',
    });
  });

  it('reads a name without a link', () => {
    expect(parseCraftedName('Transmute (Fe)')).toEqual({ name: 'Transmute (Fe)', outputQuantity: 1, nameNote: null });
  });
});

describe('parseCraftingIngredients', () => {
  it('reads items and "Any Fish"', () => {
    expect(parseCraftingIngredients('{{Name|Sap|4}}[[File:Fish.png|24px|link=]] Any [[Fish]] (1)').ingredients).toEqual([
      { name: 'Sap', group: null, quantity: 4, note: null },
      { name: null, group: 'Fish', quantity: 1, note: 'Any Fish (1)' },
    ]);
  });

  it('reads "Wild Seeds (Any)" as a group', () => {
    const { ingredients } = parseCraftingIngredients('Wild Seeds (Any) (2){{Name|Fiber|5}}{{Name|Wood|5}}');
    expect(ingredients.map((i) => [i.name ?? `any ${i.group}`, i.quantity])).toEqual([
      ['any Wild Seeds', 2],
      ['Fiber', 5],
      ['Wood', 5],
    ]);
  });

  it("keeps the Crab Pot's second recipe as a note, not as more ingredients", () => {
    const cell =
      '{{Name|Wood|40}}{{Name|Iron Bar|3}}\n' +
      '<span class="no-wrap">With [[Fishing#Fishing Skill|Trapper]] profession:</span> {{Name|Wood|25}}{{Name|Copper Bar|2}}';
    const { ingredients, ingredientsNote } = parseCraftingIngredients(cell);
    expect(ingredients.map((i) => `${i.name} ×${i.quantity}`)).toEqual(['Wood ×40', 'Iron Bar ×3']);
    expect(ingredientsNote).toBe('With Trapper profession: Wood ×25, Copper Bar ×2');
    expect(recipe('Crab Pot').ingredientsNote).toBe('With Trapper profession: Wood ×25, Copper Bar ×2');
  });
});

describe('readCraftingSource', () => {
  it('turns the wiki markup into readable text', () => {
    expect(readCraftingSource('[[File:Mining Skill Icon.png|24px|link=]] [[Mining]] Level 1')).toBe('Mining Level 1');
    expect(readCraftingSource("''Starter''")).toBe('Known from the start');
    expect(readCraftingSource("Purchase from [[Qi's Walnut Room|Mr Qi]] for {{Price|20|Gem}}")).toBe(
      'Purchase from Mr Qi for 20 Qi Gems',
    );
    expect(readCraftingSource('{{NPC|Dwarf|{{Price|500}}}}')).toBe('Dwarf: 500g');
    expect(readCraftingSource('{{NPC|Linus|[[Quests#Community Cleanup|Special Order]]}}')).toBe('Linus: Special Order');
    expect(readCraftingSource('{{Name|Foraging Skill Icon|link=Foraging|Level 4}}')).toBe('Foraging Level 4');
    expect(readCraftingSource('[[Island Trader]] for {{Name|Cinder Shard|50|class=inline}}')).toBe(
      'Island Trader for Cinder Shard ×50',
    );
  });
});

describe('extractCraftingRecipes on the real Crafting page', () => {
  it('only reads the Crafting page', () => {
    expect(isCraftingPage(craftingPage)).toBe(true);
    expect(isCraftingPage({ title: 'Cooking' })).toBe(false);
  });

  it('reads all 150 recipes in 17 sections without warnings', () => {
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.recipes).toHaveLength(150);
    expect(new Set(result.recipes.map((r) => r.section)).size).toBe(17);
    expect(result.recipes[0].name).toBe('Cherry Bomb');
  });

  it('reads a bomb with its sell price and radius', () => {
    expect(recipe('Cherry Bomb')).toEqual({
      name: 'Cherry Bomb',
      section: 'Bombs',
      outputQuantity: 1,
      nameNote: null,
      sellPrice: 50,
      details: 'Radius: 3',
      recipeSource: 'Mining Level 1',
      ingredients: [
        { name: 'Copper Ore', group: null, quantity: 4, note: null },
        { name: 'Coal', group: null, quantity: 1, note: null },
      ],
      ingredientsNote: null,
    });
  });

  it('joins two header rows (Fences) and reads Energy and Health', () => {
    expect(recipe('Gate').details).toBe('Duration (days): 360; Duration (seasons): 12.9');
    expect(recipe('Field Snack').details).toBe('Energy: 45; Health: 18');
    expect(recipe('Life Elixir').details).toBe('Energy: 0; Health: 100%');
  });

  it('reads how many one craft makes', () => {
    expect(recipe('Speed-Gro').outputQuantity).toBe(5);
    expect(recipe('Quality Fertilizer').outputQuantity).toBe(2);
    expect(recipe('Sprinkler').outputQuantity).toBe(1);
  });

  it('has no sell price outside the Bombs table', () => {
    expect(result.recipes.filter((r) => r.sellPrice !== null).map((r) => r.name)).toEqual([
      'Cherry Bomb',
      'Bomb',
      'Mega Bomb',
    ]);
  });

  it('lists the four wild seed packs as a group', () => {
    expect(result.groups).toEqual({ 'Wild Seeds': ['Spring Seeds', 'Summer Seeds', 'Fall Seeds', 'Winter Seeds'] });
  });
});
