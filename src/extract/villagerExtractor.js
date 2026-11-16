// Villagers and their gift tastes.
//
// Three wiki pages, no villager pages needed:
//
//  - "Villagers": who can be married (Bachelors, Bachelorettes), who else
//    takes gifts, and who doesn't (Non-giftable NPCs).
//  - "List of All Gifts": one table, a row per villager, with their
//    birthday and what they love, like, are neutral about, dislike and hate.
//    The first row, "Universals", applies to everyone.
//  - "Friendship": the universal dislikes and hates, which the gift list
//    only links to.
//
// A gift taste is either one item or a group with exceptions:
//
//   *{{Name|Complete Breakfast}}                         → item "Complete Breakfast"
//   *All [[Fruits|Fruit]] ''(except [[Salmonberry]])''   → group "Fruits", except Salmonberry
//
// Groups are stored as written. Which items are in a group is worked out
// when the database is asked (src/queries/giftQueries.js), from the data we
// have: the Fruits page, Category:Vegetables, the fish table, artisan goods,
// dishes, and the lists at the top of the gift page (All Eggs...).

import { getSection, parseTableWithSpans, toPlainText } from './wikitext.js';
import { getWikitext } from './cropExtractor.js';

export const VILLAGERS_PAGE = 'Villagers';
export const GIFT_LIST_PAGE = 'List of All Gifts';
export const FRIENDSHIP_PAGE = 'Friendship';

export const TASTES = ['love', 'like', 'neutral', 'dislike', 'hate'];
export const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];

/**
 * "All [[...]]" link or word → the group name we store. Read from the gift
 * list (revision 195507). Groups we can't fill yet (Gems, Books...) are
 * still stored, so they start matching once those items are collected.
 */
export const GIFT_GROUPS = {
  fruits: 'Fruits',
  fruit: 'Fruits',
  'fruit trees': 'Fruit Tree Fruit',
  'fruit tree fruit': 'Fruit Tree Fruit',
  vegetables: 'Vegetables',
  fish: 'Fish',
  'artisan goods': 'Artisan Goods',
  cooking: 'Cooking',
  flowers: 'Flowers',
  eggs: 'Eggs',
  milk: 'Milk',
  mushrooms: 'Mushrooms',
  books: 'Books',
  artifacts: 'Artifacts',
  trinkets: 'Trinkets',
  'minerals#foraged minerals': 'Foraged Minerals',
  'foraged minerals': 'Foraged Minerals',
  'minerals#gems': 'Gems',
  gems: 'Gems',
  'minerals#geode minerals': 'Geode Minerals',
  'geode minerals': 'Geode Minerals',
  // Used by the Friendship page's universal dislikes and hates:
  'crafting#bombs': 'Bombs',
  bombs: 'Bombs',
  'crafting#decor': 'Floors & Paths',
  'crafted floors & paths': 'Floors & Paths',
  'crafting#fences': 'Fences',
  fences: 'Fences',
  fertilizer: 'Fertilizer',
  'fish#fish types': 'Fish',
  'minerals#geodes': 'Geodes',
  geodes: 'Geodes',
  crops: 'Seeds',
  seeds: 'Seeds',
  'crafting#sprinklers': 'Sprinklers',
  sprinklers: 'Sprinklers',
  tackle: 'Tackle',
  bait: 'Bait',
  'island field office#donations': 'Fossils',
  fossils: 'Fossils',
  'monster loot': 'Monster Loot',
  trash: 'Trash',
};

export function isVillagersPage(page) {
  return page.title === VILLAGERS_PAGE;
}
export function isGiftListPage(page) {
  return page.title === GIFT_LIST_PAGE;
}
export function isFriendshipPage(page) {
  return page.title === FRIENDSHIP_PAGE;
}

/** Every [[link]] in some text → [{ target, text }]. Image links are skipped. */
function linksIn(text) {
  return [...text.matchAll(/\[\[(?!File:)([^\]|]+)(?:\|([^\]]*))?\]\]/gi)].map((match) => ({
    target: match[1].trim(),
    text: (match[2] ?? match[1]).trim(),
  }));
}

/** The names in "(except [[A]] & [[B|b]])": both page titles and shown text, so either can match. */
function exceptionNames(text) {
  const names = [];
  for (const { target, text: shown } of linksIn(text)) {
    for (const name of [target, shown]) if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** The group name for an "All ..." label or link, or null. */
function groupNameFor(...keys) {
  return keys.map((key) => GIFT_GROUPS[key.trim().replace(/^All\s+/i, '').toLowerCase()]).find(Boolean) ?? null;
}

/**
 * One bullet of a gift list → gift taste entries (usually one).
 *   "{{Name|Pearl}}"                         → [{ itemName: 'Pearl', groupName: null, exceptions: [], note: null }]
 *   "{{Name|Stardrop Tea|'\'\'+250'\'\'}}"     → note "+250"
 *   "All [[Fruits|Fruit]] ''(except [[Salmonberry]])''"      → [{ groupName: 'Fruits', exceptions: ['Salmonberry'] }]
 *   "'\'\'[[Artifacts|All Artifacts]]'\'\'"            → [{ groupName: 'Artifacts' }]  (Friendship page style)
 *   "'\'\'All Building Materials'\'\' -- [[Clay]], [[Wood]]" → one item entry per name, noted "All Building Materials"
 * Exceptions keep both the page title and the text shown when they differ
 * ("[[Red Mushroom|Red]]" → 'Red Mushroom' and 'Red'), so either can match.
 * Returns [] if the bullet isn't a gift.
 */
export function parseGiftEntries(line) {
  const text = line
    .replace(/^\s*\*\s*/, '')
    .replace(/&amp;/g, '&')
    .replace(/\{\{!\}\}/g, '|')
    .trim();
  if (!text) return [];

  const item = /^\{\{\s*Name\|([^|}]+)(?:\|([^}]*))?\}\}\s*$/i.exec(text);
  if (item) {
    const extra = (item[2] ?? '').split('|').filter((part) => !part.includes('=')).join(' ');
    const note = toPlainText(extra.replace(/\[\[[^\]|]+\|([^\]]*)\]\]/g, '$1'));
    const itemName = item[1].trim();
    return [{ itemName, groupName: null, exceptions: [], note: note && note !== itemName ? note : null }];
  }

  // Friendship page style: '\'\'[[Link|All X]]'\'\' (except ...), or a named list.
  const bold = /^'\'\'(.+?)'\'\'(.*)$/.exec(text);
  if (bold) {
    const label = toPlainText(bold[1]);
    const rest = bold[2].trim();
    if (rest.startsWith('--')) {
      return linksIn(rest).map(({ target }) => ({ itemName: target, groupName: null, exceptions: [], note: label }));
    }
    const link = linksIn(bold[1])[0];
    const groupName = link ? groupNameFor(link.target, link.text) : groupNameFor(label);
    const except = /\(\s*except([^)]*)\)/i.exec(rest);
    return [{
      itemName: null,
      groupName,
      exceptions: except ? exceptionNames(except[1]) : [],
      note: toPlainText(`${label}${except ? ` (except${except[1].replace(/\[\[[^\]|]+\|([^\]]*)\]\]/g, '[[$1]]')})` : ''}`),
    }];
  }

  // Gift list style: All [[Fruits|Fruit]] '\'(except ...)'\'
  const group = /^All\s+(\[\[[^\]]+\]\]|[A-Za-z ]+?)(?=\s*(''|$))/i.exec(text);
  if (group) {
    const link = linksIn(group[1])[0];
    const groupName = link ? groupNameFor(link.target, link.text) : groupNameFor(group[1]);
    return [{
      itemName: null,
      groupName,
      exceptions: exceptionNames(text.slice(group[0].length)),
      note: toPlainText(text.replace(/\[\[[^\]|]+\|([^\]]*)\]\]/g, '[[$1]]')),
    }];
  }
  return [];
}

/** All bullets in a cell → entries, plus warnings for bullets we couldn't read. */
function entriesIn(cell, label, warnings) {
  const entries = [];
  const withoutComments = (cell ?? '').replace(/<!--[\s\S]*?-->/g, '');
  for (const line of withoutComments.split('\n')) {
    if (!/^\s*\*/.test(line)) continue;
    const parsed = parseGiftEntries(line);
    if (parsed.length === 0) warnings.push(`${label}: could not read the gift "${line.trim()}"`);
    for (const entry of parsed) {
      if (entry.itemName === null && entry.groupName === null) warnings.push(`${label}: unknown gift group in "${entry.note}"`);
      entries.push(entry);
    }
  }
  return entries;
}

/** "[[Summer]] 13" → { season: 'Summer', day: 13 }, or null. */
export function parseBirthday(cell) {
  const match = /(Spring|Summer|Fall|Winter)\s+(\d{1,2})/i.exec(toPlainText(cell ?? ''));
  if (!match) return null;
  return { season: SEASONS.find((season) => season.toLowerCase() === match[1].toLowerCase()), day: Number(match[2]) };
}

/**
 * Lines like "*'''All Eggs''' = {{Name|Egg|class=inline}}, ..." at the top of
 * the gift list → { Eggs: ['Egg', ...] }.
 */
function extractGroupLists(wikitext) {
  const groups = {};
  for (const match of wikitext.matchAll(/^\*\s*'''(?:All\s+)?([^']+)'''\s*=\s*(.+)$/gim)) {
    const groupName = GIFT_GROUPS[match[1].trim().toLowerCase()] ?? match[1].trim();
    groups[groupName] = [...match[2].matchAll(/\{\{\s*Name\|([^|}]+)/gi)].map((name) => name[1].trim());
  }
  return groups;
}

/**
 * Read the List of All Gifts page.
 * Returns { ok: true, villagers, universal, groups, warnings, notes } or { ok: false, reason }.
 *   villagers: [{ name, birthday: { season, day }, tastes: { love: [entries], like: [...], ... } }]
 *   universal: { love: [...], like: [...], neutral: [...] } (dislike and hate come from the Friendship page)
 */
export function extractGiftList(page) {
  const wikitext = getWikitext(page);
  const rows = parseTableWithSpans(wikitext ?? '');
  if (!rows || rows.length < 2) return { ok: false, reason: 'no gift table on the page' };
  const warnings = [];
  const [header, ...dataRows] = rows;

  // Columns by their header text, so a reordered table still reads right.
  const column = (word) => header.findIndex((cell) => toPlainText(cell).toLowerCase().startsWith(word));
  const columns = {
    villager: column('villager'),
    birthday: column('birthday'),
    love: column('loves'),
    like: column('likes'),
    neutral: column('neutral'),
    dislike: column('dislikes'),
    hate: column('hates'),
  };
  if (Object.values(columns).some((index) => index === -1)) {
    return { ok: false, reason: `unexpected gift table header: ${header.map(toPlainText).join(' | ')}` };
  }

  const villagers = [];
  let universal = null;
  for (const row of dataRows) {
    const name = toPlainText(row[columns.villager].replace(/\[\[File:[^\]]*\]\]/gi, ''));
    const tastes = {};
    for (const taste of TASTES) tastes[taste] = entriesIn(row[columns[taste]], `${name} ${taste}s`, warnings);
    if (/^universals?$/i.test(name)) {
      // The Universals row says "See Universal Dislikes" instead of listing them.
      universal = tastes;
      continue;
    }
    const birthday = parseBirthday(row[columns.birthday]);
    if (!birthday) warnings.push(`${name}: could not read the birthday "${row[columns.birthday]}"`);
    villagers.push({ name, birthday, tastes });
  }
  if (!universal) warnings.push('no Universals row in the gift table');

  return { ok: true, villagers, universal, groups: extractGroupLists(wikitext), warnings, notes: [] };
}

/**
 * Read the Villagers page: who can be married and who takes gifts.
 * Returns { ok: true, marriageable, giftable, nonGiftable } or { ok: false, reason }.
 */
export function extractVillagerList(page) {
  const wikitext = getWikitext(page) ?? '';
  const namesIn = (heading) => {
    const section = getSection(wikitext, heading) ?? '';
    return [...section.matchAll(/^File:[^|]+\|\[\[([^\]|]+)/gm)].map((match) => match[1].trim());
  };
  const marriageable = [...namesIn('Bachelors'), ...namesIn('Bachelorettes')];
  const others = namesIn('Non-marriage candidates');
  const nonGiftable = namesIn('Non-giftable NPCs');
  if (marriageable.length === 0 && others.length === 0) return { ok: false, reason: 'no villager galleries on the page' };
  return { ok: true, marriageable, giftable: [...marriageable, ...others], nonGiftable, warnings: [], notes: [] };
}

/**
 * Read the universal dislikes and hates from the Friendship page.
 * Only the lists themselves: each section stops at its "exceptions" part,
 * because each villager's own tastes come from the gift list.
 * Returns { ok: true, tastes: { dislike: [...], hate: [...] }, warnings, notes } or { ok: false, reason }.
 */
export function extractUniversalDislikes(page) {
  const wikitext = getWikitext(page) ?? '';
  const warnings = [];
  const tastes = {};
  for (const [taste, heading] of [['dislike', 'Universal Dislikes'], ['hate', 'Universal Hates']]) {
    const section = getSection(wikitext, heading);
    if (section === null) return { ok: false, reason: `no "${heading}" section on the page` };
    const list = section.split(/^====/m)[0]; // stop before "====Universal ... exceptions===="
    tastes[taste] = entriesIn(list, heading, warnings);
  }
  return { ok: true, tastes, warnings, notes: [] };
}
