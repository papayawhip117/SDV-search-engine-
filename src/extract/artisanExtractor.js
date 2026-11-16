// Artisan goods and the machines that make them.
//
// Three kinds of page are read here:
//
// 1. MACHINE pages (Keg, Preserves Jar, ...). Each has a products table that
//    says what goes in, what comes out, how long it takes and what it sells for:
//
//      |[[Wine]] |Any [[Fruits|Fruit]] (1) |{{Duration|10000 mins}} |3 × Fruit Base Price
//
//    These tables are the main source of recipes, because they list every
//    product, including ones without a page of their own (Jelly, Pickles,
//    Vinegar), and every ingredient separately (Oil from Corn, Sunflower...).
//
// 2. GOODS pages (Wine, Cheese, ...), in Category:Artisan Goods, with a plain
//    {{Infobox}}: sellprice, ingredients, craftingstation, crafttime. They give
//    the item itself, are checked against the machine tables, and supply
//    exceptions the table leaves out (Juice: "other than Wheat, Hops & Tea
//    Leaves"). Goods that no machine table lists (Maple Syrup from the Tapper)
//    get their recipe from this infobox instead.
//
// 3. The FRUITS page, a table of every fruit. The wiki has no fruit category,
//    so this table is how we know what "Any Fruit" means (Wine, Jelly...).
//
// Prices that depend on the ingredient ("3 × Fruit Base Price") are stored as
// a multiplier and a bonus, so the app can calculate them: 3 × 750 = 2250g
// of Starfruit Wine. We never fill in a price the wiki doesn't give.

import {
  findTemplateCall,
  parseLeadingInteger,
  parseTableWithSpans,
  parseTemplateParams,
  splitTopLevel,
  toPlainText,
} from './wikitext.js';
import { getWikitext } from './cropExtractor.js';

/** The machines described on the wiki's "Artisan Goods" page, plus the Tapper. */
export const MACHINE_PAGES = [
  'Bee House', 'Cask', 'Cheese Press', 'Keg', 'Loom', 'Mayonnaise Machine',
  'Oil Maker', 'Preserves Jar', 'Dehydrator', 'Fish Smoker', 'Tapper',
];

/** "Any [[Fruits|Fruit]]": link target → the group of items it means. */
export const INPUT_GROUPS = {
  fruits: 'Fruits',
  vegetables: 'Vegetables',
  ':category:mushrooms': 'Mushrooms',
  'category:mushrooms': 'Mushrooms',
  fish: 'Fish',
  'foraging#foraged items': 'Forage',
  roe: 'Roe',
  flowers: 'Flowers',
};

/** The game clock runs 1600 minutes per day (from the Keg page: "One full day is 1600 minutes"). */
export const MINUTES_PER_DAY = 1600;

export function isMachinePage(page) {
  return MACHINE_PAGES.includes(page.title);
}

export function isArtisanGoodPage(page) {
  return (page.categories ?? []).some((category) => category.title === 'Category:Artisan Goods');
}

export function isFruitListPage(page) {
  return page.title === 'Fruits';
}

// ---------------------------------------------------------------- small readers

/** Turn HTML entities the tables use into characters: "&times;" → "×". */
function decodeEntities(text) {
  return text
    .replace(/&times;/g, '×')
    .replace(/&minus;/g, '−')
    .replace(/&#8776;/g, '≈')
    .replace(/&amp;/g, '&');
}

/** Wikitext → plain text with entities decoded and line breaks as spaces. */
function plain(text) {
  return toPlainText(decodeEntities((text ?? '').replace(/<br\s*\/?>/gi, ' '))) || null;
}

/**
 * Processing time → minutes when the wiki gives an exact time.
 *   "{{Duration|1750 mins}} (≈1.1 Days)" → { minutes: 1750, timeNote: '1.1 Days' }
 *   "{{duration|3 Hours}}"               → { minutes: 180, timeNote: null }
 *   "{{Duration|4 Nights}}"              → { minutes: null, timeNote: '4 Nights' }
 *   "9 or 4 days"                        → { minutes: null, timeNote: '9 or 4 days' }
 */
export function parseDuration(value) {
  if (!value) return { minutes: null, timeNote: null };
  const decoded = decodeEntities(value);
  const inner = findTemplateCall(decoded, 'Duration') ?? findTemplateCall(decoded, 'duration');
  const main = inner === null ? decoded : parseTemplateParams(inner).positional[0] ?? '';
  const rest = inner === null ? '' : decoded.replace(`{{${inner}}}`, '');
  const timeNote = plain(rest)?.replace(/^\((.*)\)$/, '$1') ?? null;

  const mins = /^\s*(\d[\d,]*)\s*(m|min|mins|minutes)\b/i.exec(main);
  if (mins) return { minutes: Number(mins[1].replace(/,/g, '')), timeNote: timeNote || null };
  const hours = /^\s*(\d+(?:\.\d+)?)\s*h(ours?)?\b/i.exec(main);
  if (hours) return { minutes: Math.round(Number(hours[1]) * 60), timeNote: timeNote || null };
  // Days or nights aren't an exact number of minutes ("1 day (ready the next morning)").
  return { minutes: null, timeNote: [plain(main), plain(rest)].filter(Boolean).join(' ') || null };
}

/**
 * A sell price cell → a fixed price, or a formula we can calculate with.
 *   "{{Price|200}}"                          → { sellPrice: 200 }
 *   "{{Qualityprice|Cheese|230|...}}"        → { sellPrice: 230 }
 *   "3 × [[Fruits|Fruit]] Base Price"        → { multiplier: 3, bonus: 0 }
 *   "2 × Base Ingredient Price + 50"         → { multiplier: 2, bonus: 50 }
 *   "7.5 × Fruit Base Price + {{Price|25}} (1.5 × Base + 5g per Fruit)" → { multiplier: 7.5, bonus: 25 }
 */
export function parsePrice(value) {
  const empty = { sellPrice: null, multiplier: null, bonus: null, priceNote: null };
  if (!value) return empty;
  const decoded = decodeEntities(value).trim();

  for (const name of ['Price', 'Qualityprice']) {
    const inner = findTemplateCall(decoded, name);
    if (inner !== null && decoded.startsWith('{{')) {
      const { positional } = parseTemplateParams(inner);
      const number = name === 'Price' ? positional[0] : positional[1];
      if (/^\s*\d[\d,]*\s*$/.test(number ?? '')) return { ...empty, sellPrice: parseLeadingInteger(number) };
    }
  }
  const asNumber = /^\s*(\d[\d,]*)\s*$/.exec(decoded);
  if (asNumber) return { ...empty, sellPrice: parseLeadingInteger(asNumber[1]) };

  const text = plain(decoded);
  // Only the part before any "(...)" explanation, e.g. "7.5 × Fruit Base Price + 25g".
  const formula = text.replace(/^\(\s*/, '').replace(/\s*\(.*$/, '');
  const match = /^(\d+(?:\.\d+)?)\s*[×x*]\s*[^+]*?\)?\s*(?:\+\s*(\d+)\s*g?)?\s*$/i.exec(formula);
  if (match) return { ...empty, multiplier: Number(match[1]), bonus: match[2] ? Number(match[2]) : 0, priceNote: text };
  return { ...empty, priceNote: text };
}

/** "[[Vinegar]] (2)" → { name: 'Vinegar', quantity: 2 }, "[[Jellies and Pickles|Jelly]]" → Jelly. */
export function parseProductName(value) {
  const link = /\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/.exec(value ?? '');
  const name = link ? link[1].trim() : plain(value);
  const quantity = /\((\d+)\)\s*$/.exec(value ?? '');
  return { name, quantity: quantity ? Number(quantity[1]) : 1 };
}

/** Item names linked inside "except [[Grape]]s" / "other than [[Wheat]], [[Hops]]". */
function exclusionsIn(text) {
  const match = /(?:except|other than)([\s\S]*)/i.exec(text);
  if (!match) return [];
  return [...match[1].matchAll(/\[\[(?:([^\]|]*)\|)?([^\]]+)\]\]/g)].map(([, target, label]) =>
    (target ?? label).replace(/^:?Category:/i, '').trim(),
  );
}

/**
 * An ingredient cell → the ways to make the product (one entry per "or").
 *   "{{Name|Milk|1}} ''or'' {{Name|Large Milk|1}}"  → Milk ×1, Large Milk ×1
 *   "Any [[Fruits|Fruit]] (1)"                       → any of the group Fruits ×1
 *   "5 of Any [[Fruits|Fruit]] (except [[Grape]]s)"  → any Fruits ×5, except Grape
 */
export function parseInputs(value) {
  if (!value) return [];
  const decoded = decodeEntities(value).replace(/\[\[File:[^\]]*\]\]/g, '');
  const alternatives = decoded
    .split(/''or''|\bor\b(?=\s*\{\{)|<br\s*\/?>|\n\s*\*/i)
    .map((part) => part.trim())
    .filter((part) => part && !/^one of:?$/i.test(part));

  return alternatives.map((part) => {
    const note = plain(part);
    const anyMatch = /^(?:(\d+)\s+of\s+)?any\b/i.exec(note ?? '');
    if (anyMatch) {
      const link = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(part);
      const group = link ? INPUT_GROUPS[link[1].trim().toLowerCase()] ?? null : null;
      const quantity = anyMatch[1] ? Number(anyMatch[1]) : parseLeadingInteger(/\((\d+)\)/.exec(part)?.[1]) ?? 1;
      return { name: null, group, quantity, exclusions: exclusionsIn(part), note };
    }
    const named = findTemplateCall(part, 'Name');
    if (named !== null && part.trim().startsWith('{{')) {
      const { positional } = parseTemplateParams(named);
      return { name: positional[0], group: null, quantity: parseLeadingInteger(positional[1]) ?? 1, exclusions: [], note };
    }
    // "5 [[Grape]]s"
    const counted = /^(\d+)\s*\[\[([^\]|]+)\]\]/.exec(part.trim());
    if (counted) return { name: counted[2], group: null, quantity: Number(counted[1]), exclusions: [], note };
    return { name: null, group: null, quantity: null, exclusions: [], note };
  });
}

/** "{{Name|Wood|30}}{{Name|Copper Bar|1}}" → "Wood ×30, Copper Bar ×1" */
function listNames(value) {
  const names = [...(value ?? '').matchAll(/\{\{\s*Name\|([^|}]+)(?:\|(\d+))?[^}]*\}\}/gi)];
  if (names.length === 0) return plain(value);
  return names.map(([, name, count]) => (count ? `${name} ×${count}` : name)).join(', ');
}

/** "{{Name|Farming Skill Icon|link=Farming|Level 8}}" → "Farming Level 8" */
function readRecipeSource(value) {
  const skill = /\{\{\s*Name\|(\w+) Skill Icon\|[^}]*?\|?(Level \d+)\s*\}\}/i.exec(value ?? '');
  if (skill) return `${skill[1]} ${skill[2]}`;
  return plain(value);
}

// ---------------------------------------------------------------- machine pages

/** Find the column whose header matches, in a header row of plain texts. */
function columnIndex(headers, test) {
  return headers.findIndex((header) => test(header.toLowerCase()));
}

/**
 * Extract one machine page: the machine itself and its products table.
 * Returns { ok, machine: { name, recipeSource, ingredients }, products, warnings, notes }.
 */
export function extractMachine(page) {
  const wikitext = getWikitext(page) ?? '';
  const infobox = findTemplateCall(wikitext, 'Infobox');
  if (infobox === null) return { ok: false, reason: 'no {{Infobox}} on the machine page' };
  const { named } = parseTemplateParams(infobox);
  const warnings = [];
  const notes = [];

  const machine = {
    name: plain(named.eng) ?? page.title,
    recipeSource: readRecipeSource(named.recipe),
    ingredients: listNames(named.ingredients),
    sellPriceNote: plain(named.sellprice), // "Cannot be sold"
  };

  if (page.title === 'Cask') {
    notes.push('the Cask ages goods to a higher quality; aging is not stored yet');
    return { ok: true, machine, products: [], warnings, notes };
  }
  // The products table sits in a "<section begin=...products/table>" block.
  const section = /<section begin="?([^"/]*(products|table))"?\s*\/>([\s\S]*?)<section end/i.exec(wikitext);
  if (!section) {
    // The Tapper's products are on their own pages (Maple Syrup...).
    if (page.title !== 'Tapper') warnings.push('no products table found on the page');
    return { ok: true, machine, products: [], warnings, notes };
  }

  const [headerRow, ...rows] = parseTableWithSpans(section[3]) ?? [[]];
  const headers = headerRow.map((cell) => plain(cell.replace(/<noinclude>[\s\S]*?<\/noinclude>/g, '')) ?? '');
  const nameColumn = columnIndex(headers, (h) => h === 'name');
  const inputColumn = columnIndex(headers, (h) => h.startsWith('ingredient'));
  const timeColumn = columnIndex(headers, (h) => h.startsWith('processing time'));
  // The Bee House has no ingredient column: its "Base Sell Price" header spans
  // two columns, the flower nearby and the price.
  const priceColumns = headers.map((h, i) => (h.toLowerCase().includes('sell price') ? i : -1)).filter((i) => i >= 0);
  const priceColumn = priceColumns[priceColumns.length - 1];
  const flowerColumn = inputColumn === -1 && priceColumns.length === 2 ? priceColumns[0] : -1;
  const seasonColumn = columnIndex(headers, (h) => h === 'availability');

  if ([nameColumn, timeColumn, priceColumn].some((i) => i === undefined || i < 0)) {
    warnings.push(`could not find the Name / Processing Time / Sell Price columns (${headers.join(', ')})`);
    return { ok: true, machine, products: [], warnings, notes };
  }

  const products = [];
  for (const row of rows) {
    if (row.length < headers.length) {
      warnings.push(`a products row has ${row.length} cells instead of ${headers.length}, skipped`);
      continue;
    }
    const { name, quantity } = parseProductName(row[nameColumn]);
    const time = parseDuration(row[timeColumn]);
    const price = parsePrice(row[priceColumn]);

    let inputs;
    if (flowerColumn >= 0) {
      // Bee House: "Wild" honey, or honey from a flower growing nearby.
      const flower = findTemplateCall(row[flowerColumn], 'Name');
      const season = plain(row[seasonColumn]);
      inputs = [
        flower === null
          ? { name: null, group: null, quantity: null, exclusions: [], note: `${plain(row[flowerColumn])} (no flower nearby)` }
          : {
              name: parseTemplateParams(flower).positional[0],
              group: null,
              quantity: null, // the flower is not used up
              exclusions: [],
              note: `${parseTemplateParams(flower).positional[0]} growing nearby${season ? ` (${season})` : ''}`,
            },
      ];
    } else {
      inputs = parseInputs(row[inputColumn]);
    }
    if (inputs.length === 0) warnings.push(`${name}: could not read the ingredients`);
    if (price.sellPrice === null && price.multiplier === null) {
      warnings.push(`${name}: could not read the sell price "${price.priceNote ?? ''}"`);
    }
    for (const input of inputs) {
      products.push({ machine: machine.name, product: name, outputQuantity: quantity, input, ...time, ...price });
    }
  }
  return { ok: true, machine, products, warnings, notes };
}

// ---------------------------------------------------------------- goods pages

/**
 * Extract one artisan goods page (Wine, Cheese...).
 * Returns { ok, good: { name, sellPrice, sellPriceNote, machines, inputs, minutes, timeNote, ...price } }.
 */
export function extractArtisanGood(page) {
  const wikitext = getWikitext(page) ?? '';
  const infobox = findTemplateCall(wikitext, 'Infobox');
  if (infobox === null) return { ok: false, reason: 'no {{Infobox}} (its products are read from the machine page)' };
  const { named } = parseTemplateParams(infobox);
  const warnings = [];

  const price = parsePrice(named.sellprice);
  if (price.sellPrice === null && price.multiplier === null) {
    warnings.push(`could not read the sell price "${named.sellprice ?? ''}"`);
  }
  const machines = [...(named.craftingstation ?? '').matchAll(/\{\{\s*Name\|([^|}]+)/gi)].map((m) => m[1].trim());

  return {
    ok: true,
    good: {
      name: plain(named.eng) ?? page.title,
      sellPrice: price.sellPrice,
      // keep the wiki's formula when the price depends on the ingredient
      sellPriceNote: price.sellPrice === null ? price.priceNote ?? plain(named.sellprice) : null,
      machines,
      inputs: parseInputs(named.ingredients),
      ...parseDuration(named.crafttime),
      multiplier: price.multiplier,
      bonus: price.bonus,
      priceNote: price.priceNote,
    },
    warnings,
    notes: [],
  };
}

// ---------------------------------------------------------------- fruits page

/**
 * The Fruits page's table → [{ name, basePrice }].
 * Used to know which items "Any Fruit" means, and their base prices.
 */
export function extractFruitList(page) {
  const rows = parseTableWithSpans(getWikitext(page) ?? '') ?? [];
  const fruits = [];
  for (const row of rows) {
    const link = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(row[1]?.trim() ?? '');
    if (!link) continue; // header rows
    const price = /\{\{Qualityprice\|[^|]*\|(\d[\d,]*)/i.exec(row[5] ?? '');
    fruits.push({ name: link[1].trim(), basePrice: price ? parseLeadingInteger(price[1]) : null });
  }
  return fruits;
}

// ---------------------------------------------------------------- combining

const sameInput = (a, b) => (a.name && a.name === b.name) || (a.group && a.group === b.group);

/**
 * Put the machine tables and the goods pages together into one list of
 * recipes, checking them against each other.
 *
 * @param machines  results of extractMachine (ok ones)
 * @param goods     results of extractArtisanGood (ok ones)
 * Returns { recipes, warnings: [{ title, warning }], notes: [{ title, note }] }.
 */
export function combineArtisanData(machines, goods) {
  const recipes = machines.flatMap((result) => result.products.map((product) => ({ ...product, source: 'machine' })));
  const warnings = [];
  const notes = [];
  const goodsByName = new Map(goods.map((result) => [result.good.name, result.good]));

  for (const recipe of recipes) {
    const good = goodsByName.get(recipe.product);
    if (!good) continue;
    // The goods page can name exceptions the machine table leaves out.
    const sameOnPage = good.inputs.find((input) => sameInput(input, recipe.input));
    if (sameOnPage) {
      const extra = sameOnPage.exclusions.filter((name) => !recipe.input.exclusions.includes(name));
      if (extra.length) {
        recipe.input = { ...recipe.input, exclusions: [...recipe.input.exclusions, ...extra] };
        notes.push({ title: good.name, note: `added the exceptions ${extra.join(', ')} from the ${good.name} page` });
      }
    }
    // Fixed prices must agree.
    if (recipe.sellPrice !== null && good.sellPrice !== null && recipe.sellPrice !== good.sellPrice && recipe.machine !== 'Bee House') {
      warnings.push({
        title: good.name,
        warning: `the ${recipe.machine} page says ${recipe.sellPrice}g but the ${good.name} page says ${good.sellPrice}g`,
      });
    }
  }

  // Goods that no machine table lists get their recipe from their own page.
  const listed = new Set(recipes.map((recipe) => recipe.product));
  for (const good of goods.map((result) => result.good)) {
    if (listed.has(good.name)) continue;
    if (good.machines.length === 0) continue;
    for (const machine of good.machines) {
      for (const input of good.inputs.length ? good.inputs : [{ name: null, group: null, quantity: null, exclusions: [], note: null }]) {
        recipes.push({
          machine,
          product: good.name,
          outputQuantity: 1,
          input,
          minutes: good.minutes,
          timeNote: good.timeNote,
          sellPrice: good.sellPrice,
          multiplier: good.multiplier,
          bonus: good.bonus,
          priceNote: good.priceNote,
          source: 'good',
        });
      }
    }
    notes.push({ title: good.name, note: `recipe taken from its own page, because no machine's products table lists it` });
  }
  return { recipes, warnings, notes };
}
