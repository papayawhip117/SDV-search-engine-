// Turns one downloaded seed page into its shop prices.
//
// Seed pages use a different template from crop pages: {{Infobox seed}}.
// The real Parsnip Seeds infobox looks like this:
//
//   {{Infobox seed
//   |crop      = {{Name|Parsnip}}
//   |sellprice = {{Price|10}}
//   |gPrice    = {{Price|20}}
//   |jPrice    = {{Price|25}}
//   |tPrice    = {{Tprice|10}}
//   }}
//
// Which shop each field means, checked against the text of the pages
// (Parsnip Seeds: "purchased at Pierre's General Store, at JojaMart ... and
// occasionally from the Traveling Cart"; Rhubarb Seeds: "purchased at the Oasis"):

import {
  findTemplateCall,
  firstTemplateArgument,
  parseLeadingInteger,
  parseTemplateParams,
  stripLinks,
} from './wikitext.js';
import { getWikitext, splitVariants } from './cropExtractor.js';

export const SHOP_FIELDS = {
  gPrice: "Pierre's General Store",
  jPrice: 'JojaMart',
  oPrice: 'Oasis',
};

// tPrice (Traveling Cart) is deliberately NOT stored: the cart's prices are
// random within a range, so there's no single price to put in the database.

/** Read "{{Price|40}}" → 40. Returns null for anything else. */
export function parsePriceTemplate(value) {
  const argument = firstTemplateArgument(value ?? '', 'Price');
  return argument === null ? null : parseLeadingInteger(argument);
}

/**
 * Read one shop price field.
 *   "{{Price|20}}"             → { price: 20, note: null }
 *   "{{Price|40}} (Year 2+)"   → { price: 40, note: '(Year 2+)' }
 *   "Not Sold" or empty        → null (the shop doesn't sell it)
 * Returns { error } if the value is something we don't understand.
 */
export function parseShopPrice(value) {
  if (!value || /^not sold$/i.test(value.trim())) return null;
  if (splitVariants(value).length > 1) return { error: `several prices listed: "${value}"` };

  const price = parsePriceTemplate(value);
  if (price === null) return { error: `unreadable price "${value}"` };

  const note = stripLinks(value.replace(/\{\{[^}]*\}\}/g, '')).trim() || null;
  return { price, note };
}

/**
 * Read the "otherprice" field, used for one-off sellers such as festivals:
 *   "[[Egg Festival]]: {{Price|100}}"  →  [{ shop: 'Egg Festival', price: 100, note: null }]
 */
export function parseOtherPrices(value) {
  const prices = [];
  const errors = [];
  for (const line of splitVariants(value)) {
    const match = /^\s*(.+?)\s*:\s*(.+)$/.exec(line);
    const parsed = match ? parseShopPrice(match[2]) : null;
    if (!match || !parsed || parsed.error) {
      errors.push(`unreadable otherprice "${line}"`);
      continue;
    }
    prices.push({ shop: stripLinks(match[1]).trim(), price: parsed.price, note: parsed.note });
  }
  return { prices, errors };
}

/**
 * Read a seed's sell price. Usually one value, but Sunflower Seeds says:
 *   "{{Price|20}} (harvested)<br />{{Price|100}} (purchased from [[JojaMart]])"
 * Then we store the LOWEST price, so a profit estimate never counts on the
 * better case, and keep every price with its label in sellPriceNote.
 *
 *   "{{Price|10}}"  → { sellPrice: 10, sellPriceNote: null }
 *   Sunflower       → { sellPrice: 20, sellPriceNote: '20g (harvested) / 100g (purchased from JojaMart)' }
 *   unreadable      → { sellPrice: null, problem: '...' }
 */
export function parseSellPrice(value) {
  const variants = splitVariants(value ?? '');
  const parsed = variants.map((variant) => ({
    price: parsePriceTemplate(variant),
    label: stripLinks(variant.replace(/\{\{[^}]*\}\}/g, '')).trim(),
  }));
  if (parsed.length === 0 || parsed.some(({ price }) => price === null)) {
    return { sellPrice: null, sellPriceNote: null, problem: `could not read the sell price "${value ?? ''}"` };
  }
  if (parsed.length === 1) return { sellPrice: parsed[0].price, sellPriceNote: null };

  return {
    sellPrice: Math.min(...parsed.map(({ price }) => price)),
    sellPriceNote: parsed.map(({ price, label }) => `${price}g${label ? ` ${label}` : ''}`).join(' / '),
  };
}

/** True if the page uses the seed infobox. */
export function isSeedPage(page) {
  const wikitext = getWikitext(page);
  return Boolean(wikitext && findTemplateCall(wikitext, 'Infobox seed'));
}

/**
 * Extract a seed's facts from its page.
 * Returns { ok: true, seed, warnings } or { ok: false, reason }.
 */
export function extractSeed(page) {
  const wikitext = getWikitext(page);
  if (!wikitext) return { ok: false, reason: 'page has no wikitext' };
  const infobox = findTemplateCall(wikitext, 'Infobox seed');
  if (!infobox) return { ok: false, reason: 'no {{Infobox seed}} on the page' };

  const fields = parseTemplateParams(infobox).named;
  const warnings = [];

  const notes = [];
  const { sellPrice, sellPriceNote, problem } = parseSellPrice(fields.sellprice);
  if (problem) warnings.push(problem);
  if (sellPriceNote) notes.push(`sells for ${sellPriceNote}; stored the lowest, ${sellPrice}g`);

  const prices = [];
  for (const [field, shop] of Object.entries(SHOP_FIELDS)) {
    const parsed = parseShopPrice(fields[field]);
    if (parsed?.error) warnings.push(`${shop}: ${parsed.error}`);
    else if (parsed) prices.push({ shop, price: parsed.price, note: parsed.note });
  }
  const other = parseOtherPrices(fields.otherprice);
  prices.push(...other.prices);
  warnings.push(...other.errors);

  return {
    ok: true,
    seed: {
      name: page.title,
      cropName: fields.crop ? firstTemplateArgument(fields.crop, 'Name') : null,
      sellPrice,
      sellPriceNote,
      prices,
    },
    warnings,
    notes,
  };
}
