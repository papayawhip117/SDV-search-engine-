// Forage, minerals, artifacts, flowers and books, read from five overview pages.
//
// Each of these wiki pages lists its items in tables, with the name, the
// sell price and where to find them, so no item pages are needed:
//
//   Foraging   one table per season or place (Spring, The Beach, The Mines...)
//   Minerals   Foraged Minerals, Gems, Geode Minerals and Geodes
//   Artifacts  one table of all artifacts
//   Flowers    one table (two header rows: "Sell Price" over "Base" and "Tiller")
//   Books      Power Books and Skill Books (no sell prices)
//
// A typical row (Minerals, Gems):
//   |[[File:Emerald.png|center]]
//   |[[Emerald]]
//   |{{Description|Emerald}}
//   |{{Price|250}}            ← Sell Price
//   |{{Price|325}}            ← Gemologist Sell Price
//   |{{Name|Emerald Node|...}}  ← Source
//
// Every item also joins a group named after its table (Gems, Artifacts,
// Flowers...), which is what the gift lists mean by "All Gems".

import { parseLeadingInteger, parseTableWithSpans, stripLinks, toPlainText } from './wikitext.js';
import { getWikitext } from './cropExtractor.js';
import { plainValue } from './fishExtractor.js';

/** The overview pages, with the item type each one's items get. */
export const COLLECTION_PAGES = {
  Foraging: 'forage',
  Minerals: 'mineral',
  Artifacts: 'artifact',
  Flowers: 'flower',
  Books: 'book',
};

const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];

export function isCollectionPage(page) {
  return Object.hasOwn(COLLECTION_PAGES, page.title);
}

/**
 * The group an item joins, from its page and table section.
 * Foraging sections are seasons and places, not groups, so forage gets none:
 * the Keg's "any positive energy Forage" needs more than a list of names.
 */
function groupFor(pageTitle, section) {
  if (pageTitle === 'Minerals') return section; // Foraged Minerals, Gems, Geode Minerals, Geodes
  if (pageTitle === 'Foraging') return null;
  return pageTitle; // Artifacts, Flowers, Books
}

/** "{{Qualityprice|Daffodil|30}}" or "{{Price|250}}" → 30 / 250. */
export function readPrice(cell) {
  const quality = /\{\{\s*Qualityprice\|[^|}]*\|([\d,]+)/i.exec(cell ?? '');
  if (quality) return Number(quality[1].replace(/,/g, ''));
  return parseLeadingInteger(toPlainText(cell ?? ''));
}

/** "{{EdibilityGrid|Common Mushroom|15}}" → 15; "''Inedible''" → null. */
export function readEdibility(cell) {
  const match = /\{\{\s*EdibilityGrid\|[^|}]*\|(-?\d+)/i.exec(cell ?? '');
  return match ? Number(match[1]) : null;
}

/**
 * Where an item is found, as one line.
 *   "{{Name|Stone Golem|10%}}" → "Stone Golem (10%)"
 *   "* [[Pelican Town]] (100%)\n* [[Bus Stop]] (45%)" → "Pelican Town (100%); Bus Stop (45%)"
 */
export function readFound(cell) {
  if (!cell) return null;
  const text = cell
    .replace(/\{\{!\}\}/g, '|')
    .replace(/<\/?(ul|p)>/gi, '\n')
    .replace(/<li>/gi, '\n* ')
    .replace(/\{\{\s*Name\|([^|}]+)((?:\|[^}]*)?)\}\}/gi, (_, name, rest) => {
      const extra = rest
        .split('|')
        .map((part) => part.trim())
        .filter((part) => part && !part.includes('=') && part !== name.trim()); // "link=...{{!}}Emerald Node" repeats the name
      return `\n* ${name.trim()}${extra.length ? ` (${extra.join(', ')})` : ''}`;
    })
    .replace(/\[\[File:[^\]]*\]\]/gi, '');
  return plainValue(text);
}

/** Header labels for a table; two header rows are joined ("Sell Price (base)"). */
function headerLabels(headerRows) {
  return headerRows[0].map((_, column) => {
    const [first, ...more] = [...new Set(headerRows.map((row) => toPlainText(row[column] ?? '')))];
    return (more.length ? `${first} (${more.join(' ').toLowerCase()})` : first ?? '').toLowerCase();
  });
}

/** Each table on a page, with the heading it sits under. */
function tablesWithSections(wikitext) {
  const tables = [];
  const headings = [...wikitext.matchAll(/^(=+)\s*(.+?)\s*\1\s*$/gm)].map((match) => ({
    index: match.index,
    title: toPlainText(match[2].replace(/\[\[File:[^\]]*\]\]/gi, '')),
  }));
  let from = 0;
  for (;;) {
    const start = wikitext.indexOf('{|', from);
    if (start === -1) break;
    const end = wikitext.indexOf('\n|}', start);
    const heading = headings.filter((h) => h.index < start).pop();
    tables.push({ section: heading?.title ?? null, text: wikitext.slice(start, end === -1 ? undefined : end + 3) });
    from = end === -1 ? wikitext.length : end + 3;
  }
  return tables;
}

/**
 * Read one overview page.
 * Returns { ok: true, items, warnings, notes } or { ok: false, reason }.
 * Each item: { name, type, groups, sections, seasons, sellPrice, gemologistPrice, edibility, found, details }.
 * An item in several tables (Common Mushroom: Spring and Fall) is listed once,
 * with all its sections.
 */
export function extractCollection(page) {
  // The Books page hides a column in <noinclude> tags; keep what's inside them.
  const wikitext = (getWikitext(page) ?? '').replace(/<\/?noinclude>/gi, '');
  const type = COLLECTION_PAGES[page.title];
  if (!type) return { ok: false, reason: `${page.title} is not one of the collection pages` };
  const warnings = [];
  const byName = new Map();

  for (const { section, text } of tablesWithSections(wikitext)) {
    const rows = parseTableWithSpans(text) ?? [];
    const headerRows = rows.filter((row) => row.some((cell) => stripLinks(cell).trim() === 'Name'));
    if (headerRows.length === 0) continue; // e.g. the foraging quality table
    const labels = headerLabels(headerRows);
    const column = (test) => labels.findIndex(test);
    const nameColumn = column((label) => label === 'name');
    const priceColumn = column((label) => label.startsWith('sell price'));
    const gemologistColumn = column((label) => label.startsWith('gemologist'));
    const foundColumn = column((label) => ['found', 'source', 'location'].includes(label));
    const seasonColumn = column((label) => label === 'season' || label === 'season found');
    const edibilityColumn = column((label) => label === 'energy / health' || label === 'restores');
    const readingColumn = column((label) => label === 'subsequent reading');

    const dataRows = rows.filter((r) => !headerRows.includes(r));
    // Two rows can show the same name for different items: "[[Strange Doll (green)|Strange Doll]]"
    // and "[[Strange Doll (yellow)|Strange Doll]]". Then we use the page titles to tell them apart.
    const shown = dataRows.map((row) => toPlainText(row[nameColumn] ?? ''));
    const nameOf = (row, index) => {
      const target = /\[\[([^\]|]+)\|/.exec(row[nameColumn] ?? '')?.[1]?.trim();
      const duplicate = shown.filter((name) => name === shown[index]).length > 1;
      return duplicate && target ? target : shown[index];
    };

    for (const [index, row] of dataRows.entries()) {
      const name = nameOf(row, index);
      if (!name) continue;
      const sellPrice = priceColumn === -1 ? null : readPrice(row[priceColumn]);
      if (priceColumn !== -1 && sellPrice === null) warnings.push(`${name}: could not read the sell price "${row[priceColumn]}"`);

      // Seasons: the Flowers "Season" column, or a Foraging section named after a season.
      const seasons = [];
      if (seasonColumn !== -1) {
        const text = toPlainText(row[seasonColumn] ?? '');
        seasons.push(...(/^all$/i.test(text) ? SEASONS : SEASONS.filter((s) => text.includes(s))));
      }
      if (page.title === 'Foraging' && SEASONS.includes(section)) seasons.push(section);

      const group = groupFor(page.title, section);
      const itemType = page.title === 'Minerals' && section === 'Geodes' ? 'geode' : type;
      const reading = readingColumn === -1 ? null : toPlainText(row[readingColumn] ?? '');
      const entry = byName.get(name) ?? {
        name,
        type: itemType,
        groups: [],
        sections: [],
        seasons: [],
        sellPrice,
        gemologistPrice: gemologistColumn === -1 ? null : readPrice(row[gemologistColumn]),
        edibility: edibilityColumn === -1 ? null : readEdibility(row[edibilityColumn]),
        found: foundColumn === -1 ? null : readFound(row[foundColumn]),
        details: reading ? `Reading it again: ${reading}` : null,
      };
      if (group && !entry.groups.includes(group)) entry.groups.push(group);
      if (section && !entry.sections.includes(section)) entry.sections.push(section);
      for (const season of seasons) if (!entry.seasons.includes(season)) entry.seasons.push(season);
      if (entry.sellPrice !== sellPrice && sellPrice !== null) {
        warnings.push(`${name}: two different sell prices (${entry.sellPrice} and ${sellPrice}); kept the first`);
      }
      byName.set(name, entry);
    }
  }
  const items = [...byName.values()];
  if (items.length === 0) return { ok: false, reason: 'no item tables found on the page' };
  return { ok: true, items, warnings, notes: [] };
}
