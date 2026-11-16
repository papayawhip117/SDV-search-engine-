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

  // Sunflower Seeds lists two sell prices ("20 (harvested)<br />100 (purchased...)"),
  // so a sell price is only stored when there's exactly one.
  let sellPrice = null;
  if (splitVariants(fields.sellprice).length === 1) sellPrice = parsePriceTemplate(fields.sellprice);
  if (sellPrice === null) warnings.push(`could not read a single sell price from "${fields.sellprice ?? ''}"`);

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
      prices,
    },
    warnings,
  };
}
