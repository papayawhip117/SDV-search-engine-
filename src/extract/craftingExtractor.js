// Reads every crafting recipe from the wiki's Crafting page.
//
// Unlike dishes, crafted items mostly have no infobox with their recipe, but
// the Crafting page lists them all in one table per section (Bombs,
// Sprinklers, Fertilizer...). A typical row:
//
//   |[[File:Quality Fertilizer.png|center]]
//   |[[Quality Fertilizer]] (2)                      ← name, and how many one craft makes
//   |{{Description|Quality Fertilizer}}
//   |{{Name|Sap|4}}[[File:Fish.png|24px|link=]] Any [[Fish]] (1)
//   |[[File:Farming Skill Icon.png|24px|link=]] [[Farming]] Level 9
//
// Some sections have extra columns (Radius for bombs, Duration for fences,
// Energy and Health for edible items). We keep those as one line of text.
// Only the Bombs table has a sell price.

import { getSection, parseLeadingInteger, parseTableWithSpans, stripLinks, toPlainText } from './wikitext.js';
import { getWikitext } from './cropExtractor.js';
import { parseIngredientList, readRecipeSource } from './cookingExtractor.js';

export const CRAFTING_PAGE = 'Crafting';

export function isCraftingPage(page) {
  return page.title === CRAFTING_PAGE;
}

/** Remove image links like [[File:Fish.png|24px|link=]]. */
function withoutFiles(text) {
  return text.replace(/\[\[File:[^\]]*\]\]/gi, '');
}

/**
 * The name cell → { name, outputQuantity, nameNote }.
 *   "[[Iron Fence]] (10)"                    → Iron Fence, 10
 *   "[[Bait (item)|Bait]] (5)"               → Bait, 5 (the name shown, not the page title)
 *   "Wild Seeds (Sp)<br />([[Spring Seeds]])" → Spring Seeds, 1, note "Wild Seeds (Sp)"
 *   "Transmute (Fe)"                          → Transmute (Fe), 1
 */
export function parseCraftedName(cell) {
  const text = withoutFiles(cell ?? '').trim();
  const quantityMatch = /\((\d+)\)\s*$/.exec(text);
  const outputQuantity = quantityMatch ? Number(quantityMatch[1]) : 1;
  const withoutQuantity = quantityMatch ? text.slice(0, quantityMatch.index).trim() : text;

  const link = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/.exec(withoutQuantity);
  if (!link) return { name: toPlainText(withoutQuantity), outputQuantity, nameNote: null };

  const name = (link[2] ?? link[1]).trim();
  // Text outside the link, e.g. "Wild Seeds (Sp)", is another name for it.
  const outside = toPlainText(withoutQuantity.replace(link[0], '').replace(/<br\s*\/?>/gi, ' '))
    .replace(/\(\s*\)/g, '')
    .trim();
  return { name, outputQuantity, nameNote: outside || null };
}

/**
 * The ingredients cell → { ingredients, ingredientsNote }.
 *   "{{Name|Sap|4}}Any [[Fish]] (1)"  → Sap ×4, any Fish ×1
 *   "Wild Seeds (Any) (2){{Name|Fiber|5}}" → any Wild Seeds ×2, Fiber ×5
 * The Crab Pot has a second, cheaper recipe for the Trapper profession on a
 * new line. Only the first recipe is parsed; the second is kept as a note.
 */
export function parseCraftingIngredients(cell) {
  const [main, ...rest] = withoutFiles(cell ?? '').split('\n');
  const ingredients = [];
  // "Wild Seeds (Any) (2)": any of the four wild seed packs.
  const wildSeeds = /Wild Seeds \(Any\)\s*\((\d+)\)/i.exec(main);
  if (wildSeeds) {
    ingredients.push({ name: null, group: 'Wild Seeds', quantity: Number(wildSeeds[1]), note: 'Wild Seeds (Any)' });
  }
  ingredients.push(...parseIngredientList(main));
  const ingredientsNote = rest.length ? toPlainText(rest.join(' ').replace(/\{\{\s*Name\|([^|}]+)\|(\d+)[^}]*\}\}/gi, ' $1 ×$2,')).replace(/,\s*$/, '').replace(/:\s*/, ': ') : null;
  return { ingredients, ingredientsNote: ingredientsNote || null };
}

/**
 * The recipe source cell → readable text.
 *   "[[File:Mining Skill Icon.png|24px|link=]] [[Mining]] Level 1" → "Mining Level 1"
 *   "Purchase from [[Qi's Walnut Room|Mr Qi]] for {{Price|20|Gem}}" → "Purchase from Mr Qi for 20 Qi Gems"
 *   "{{NPC|Dwarf|{{Price|500}}}}"                                   → "Dwarf: 500g"
 *   "{{Name|Foraging Skill Icon|link=Foraging|Level 4}}"            → "Foraging Level 4"
 */
export function readCraftingSource(cell) {
  if (!cell) return null;
  const text = cell
    .replace(/\{\{\s*Price\|(\d[\d,]*)\|\s*gem\s*\}\}/gi, '$1 Qi Gems')
    .replace(/\{\{\s*Price\|(\d[\d,]*)\s*\}\}/gi, '$1g')
    .replace(/\{\{\s*Name\|(\w+) Skill Icon\|[^|}]*\|([^|}]*)\}\}/gi, '$1 $2')
    // Links become their text first, so a link inside {{NPC|...}} doesn't split it.
    .replace(/\[\[(?!File:)([^\]|]+)\|([^\]]*)\]\]/gi, '$2')
    .replace(/\[\[(?!File:)([^\]|]+)\]\]/gi, '$1');
  const source = readRecipeSource(text);
  return source === 'Starter' ? 'Known from the start' : source;
}

/** "{{Energy|45}}" → "45", other cells → plain text. */
function plainCell(cell) {
  return toPlainText((cell ?? '').replace(/\{\{\s*(?:Energy|Health)\|([^|}]*)\}\}/gi, '$1'));
}

/** The section headings that hold a recipe table, in page order. */
function tableSections(wikitext) {
  return [...wikitext.matchAll(/^==([^=].*?)==\s*$/gm)]
    .map((match) => match[1].trim())
    .filter((heading) => /\{\|/.test(getSection(wikitext, heading) ?? ''));
}

/**
 * Read one section's table into recipes.
 * Header rows are the rows whose name column says "Name". With two header
 * rows (Fences: "Duration" over "Days" and "Seasons") the labels are joined:
 * "Duration (days)", "Duration (seasons)".
 */
function recipesInSection(section, sectionText, warnings) {
  const rows = parseTableWithSpans(sectionText) ?? [];
  const headerRows = rows.filter((row) => row.some((cell) => stripLinks(cell).trim() === 'Name'));
  const dataRows = rows.filter((row) => !headerRows.includes(row));
  if (headerRows.length === 0) {
    warnings.push(`${section}: no header row with "Name" in the table`);
    return [];
  }
  const labels = headerRows[0].map((cell, column) => {
    const [first, ...more] = [...new Set(headerRows.map((row) => toPlainText(row[column] ?? '')))];
    return more.length ? `${first} (${more.join(' ').toLowerCase()})` : first; // "Duration (days)"
  });
  const columnOf = (label) => labels.findIndex((text) => text.toLowerCase() === label.toLowerCase());
  const nameColumn = columnOf('Name');
  const ingredientsColumn = columnOf('Ingredients');
  const sourceColumn = columnOf('Recipe Source');
  const priceColumn = columnOf('Sell Price');
  const known = new Set(['image', 'name', 'description', 'ingredients', 'recipe source', 'sell price']);
  const extraColumns = labels
    .map((label, column) => ({ label, column }))
    .filter(({ label }) => label && !known.has(label.toLowerCase()));

  if (ingredientsColumn === -1 || sourceColumn === -1) {
    warnings.push(`${section}: the table has no Ingredients or Recipe Source column`);
    return [];
  }

  return dataRows.map((row) => {
    const { name, outputQuantity, nameNote } = parseCraftedName(row[nameColumn]);
    const { ingredients, ingredientsNote } = parseCraftingIngredients(row[ingredientsColumn]);
    if (ingredients.length === 0) warnings.push(`${name}: could not read the ingredients "${row[ingredientsColumn]}"`);
    for (const ingredient of ingredients) {
      if (ingredient.note && !ingredient.group) warnings.push(`${name}: unknown ingredient group in "${ingredient.note}"`);
    }
    const details = extraColumns
      .map(({ label, column }) => {
        const value = plainCell(row[column]);
        return value ? `${label}: ${value}` : null;
      })
      .filter(Boolean)
      .join('; ');
    return {
      name,
      section,
      outputQuantity,
      nameNote,
      sellPrice: priceColumn === -1 ? null : parseLeadingInteger(toPlainText(row[priceColumn] ?? '')),
      details: details || null,
      recipeSource: readCraftingSource(row[sourceColumn]),
      ingredients,
      ingredientsNote,
    };
  });
}

/**
 * Read every recipe on the Crafting page.
 * Returns { ok: true, recipes, groups, warnings, notes } or { ok: false, reason }.
 * groups is { 'Wild Seeds': ['Spring Seeds', ...] }, for "any Wild Seeds".
 */
export function extractCraftingRecipes(page) {
  const wikitext = getWikitext(page);
  if (!wikitext) return { ok: false, reason: 'the page has no text' };
  const warnings = [];
  const recipes = [];
  for (const section of tableSections(wikitext)) {
    recipes.push(...recipesInSection(section, getSection(wikitext, section), warnings));
  }
  if (recipes.length === 0) return { ok: false, reason: 'no recipe tables found on the Crafting page' };

  const seen = new Set();
  for (const recipe of recipes) {
    if (seen.has(recipe.name)) warnings.push(`${recipe.name} is listed twice; the later row wins`);
    seen.add(recipe.name);
  }
  // "Wild Seeds (Any)" (Tea Sapling) means any of the four wild seed packs,
  // which the Seeds table marks with "Wild Seeds (Sp)" and so on.
  const wildSeeds = recipes.filter((recipe) => /^Wild Seeds \(/.test(recipe.nameNote ?? '')).map((recipe) => recipe.name);
  return { ok: true, recipes, groups: { 'Wild Seeds': wildSeeds }, warnings, notes: [] };
}
