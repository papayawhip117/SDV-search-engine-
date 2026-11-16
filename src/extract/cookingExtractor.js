// Turns one cooking recipe page into a dish with its ingredients.
//
// Dish pages wrap their infobox in a template parameter, so the page can
// also be shown as a row of the Cooking page's table:
//
//   <onlyinclude>{{{{{1|Infobox cooking}}}
//   |name        = Pizza
//   |recipe      = {{CookingChannel|7 Spring, Year 2}}<p>... Stardrop Saloon for {{Price|150}}</p>
//   |ingredients = {{Name|Wheat Flour|1}}{{Name|Tomato|1}}{{Name|Cheese|1}}
//   |sellprice   = 300
//   |edibility   = 60
//   }}</onlyinclude>
//
// "{{{1|Infobox cooking}}}" means "the first parameter, or Infobox cooking
// if there is none", so on the page itself it is {{Infobox cooking ...}}.

import { findTemplateCall, parseLeadingInteger, parseTemplateParams, toPlainText } from './wikitext.js';
import { getWikitext } from './cropExtractor.js';
import { INPUT_GROUPS } from './artisanExtractor.js';

/** The page text with the template-parameter wrapper turned into a plain infobox call. */
function unwrapInfobox(wikitext) {
  return (wikitext ?? '').replace(/\{\{\{\{\{1\|\s*Infobox cooking\s*\}\}\}/i, '{{Infobox cooking');
}

export function isCookingPage(page) {
  return findTemplateCall(unwrapInfobox(getWikitext(page)), 'Infobox cooking') !== null;
}

/** Remove image links like [[File:Gus Icon.png|22px|link=]]. */
function withoutFiles(text) {
  return text.replace(/\[\[File:[^\]]*\]\]/gi, '');
}

/**
 * "{{Name|Wheat Flour|1}}{{Name|Tomato|1}}" → [{ name: 'Wheat Flour', quantity: 1 }, ...]
 * "Any [[Fish]] (1){{Name|Seaweed|1}}"       → [{ group: 'Fish', quantity: 1, note: 'Any Fish (1)' }, { name: 'Seaweed', ... }]
 */
export function parseIngredientList(value) {
  const text = withoutFiles(value ?? '');
  const ingredients = [];
  // Walk through the text in order, picking up "Any [[X]] (n)" and {{Name|X|n}}.
  const pattern = /Any\s+\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*\((\d+)\)|\{\{\s*Name\|([^|}]+)(?:\|([^|}]*))?[^}]*\}\}/gi;
  for (const match of text.matchAll(pattern)) {
    if (match[1]) {
      const group = INPUT_GROUPS[match[1].trim().toLowerCase()] ?? null;
      ingredients.push({ name: null, group, quantity: Number(match[2]), note: toPlainText(match[0]) });
    } else {
      ingredients.push({ name: match[3].trim(), group: null, quantity: parseLeadingInteger(match[4]) ?? 1, note: null });
    }
  }
  return ingredients;
}

/**
 * How you get the recipe, as readable text.
 *   "{{CookingChannel|7 Spring, Year 2}}<p>Stardrop Saloon for {{Price|150}}</p>"
 *     → "The Queen of Sauce: 7 Spring, Year 2; Stardrop Saloon for 150g"
 *   "{{NPC|Caroline|Mail - 7+ [[File:HeartIconLarge.png|16px|link=]]}}" → "Caroline: Mail - 7+ hearts"
 */
export function readRecipeSource(value) {
  if (!value) return null;
  let text = value
    .replace(/\[\[File:HeartIcon[^\]]*\]\]/gi, ' hearts')
    .replace(/\{\{\s*CookingChannel\|([^}]*)\}\}/gi, ';; The Queen of Sauce: $1 ;;')
    .replace(/\{\{\s*NPC\|([^|}]+)((?:\|[^}]*)?)\}\}/gi, (_, name, rest) => {
      const words = rest.split('|').map((part) => part.trim()).filter((part) => part && !part.includes('='));
      return `;; ${name}${words.length ? `: ${words.join(' ')}` : ''}`;
    })
    .replace(/\{\{\s*Name\|([^|}]+)\|(\d+)[^}]*\}\}/gi, '$1 ×$2')
    .replace(/<\/?(p|div)[^>]*>/gi, ' ;; ');
  text = withoutFiles(text);
  return (
    toPlainText(text)
      .split(';;')
      .map((part) => part.trim().replace(/\s+hearts/, ' hearts'))
      .filter(Boolean)
      .join('; ') || null
  );
}

/** "{{Name|Farming|+2}}{{Name|Max Energy|+50}}" → "Farming +2, Max Energy +50" */
export function readBuffs(value) {
  const buffs = [...(value ?? '').matchAll(/\{\{\s*Name\|([^|}]+)\|([^|}]+)[^}]*\}\}/gi)].map(
    ([, name, amount]) => `${name.trim()} ${amount.trim()}`,
  );
  return buffs.length ? buffs.join(', ') : null;
}

/**
 * Extract one dish page.
 * Returns { ok: true, dish, warnings, notes } or { ok: false, reason }.
 */
export function extractDish(page) {
  const infobox = findTemplateCall(unwrapInfobox(getWikitext(page)), 'Infobox cooking');
  if (infobox === null) return { ok: false, reason: 'no {{Infobox cooking}} on the page' };
  const { named } = parseTemplateParams(infobox);
  const warnings = [];

  const sellPrice = parseLeadingInteger(named.sellprice);
  if (sellPrice === null) warnings.push(`could not read the sell price "${named.sellprice ?? ''}"`);

  const ingredients = parseIngredientList(named.ingredients);
  if (ingredients.length === 0) warnings.push(`could not read the ingredients "${named.ingredients ?? ''}"`);
  for (const ingredient of ingredients) {
    if (ingredient.note && !ingredient.group) warnings.push(`unknown ingredient group in "${ingredient.note}"`);
  }

  // edibility can be negative; parseLeadingInteger only reads positive numbers
  const edibility = /^\s*-?\d+\s*$/.test(named.edibility ?? '') ? Number(named.edibility) : null;

  return {
    ok: true,
    dish: {
      name: toPlainText(named.name ?? '') || page.title,
      sellPrice,
      edibility,
      buffs: readBuffs(named.buff),
      buffDuration: named.duration
        ? toPlainText(withoutFiles(named.duration.replace(/<includeonly>[\s\S]*?<\/includeonly>/gi, ' ').replace(/<br\s*\/?>/gi, '; '))) || null
        : null,
      recipeSource: readRecipeSource(named.recipe),
      ingredients,
    },
    warnings,
    notes: [],
  };
}
