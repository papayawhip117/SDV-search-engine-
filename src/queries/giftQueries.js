// Villagers and gifts: birthdays, and what a villager thinks of an item.
//
//   getVillager(db, 'Alex')             → birthday, marriageable, and his lists as the wiki writes them
//   giftTaste(db, 'Alex', 'Tuna')       → { taste: 'neutral', ... } and why
//   whoLikes(db, 'Tuna')                → { love: [...], like: [...], neutral: [...], dislike: [...], hate: [...] }
//   getBirthdays(db, 'Summer')          → villagers with a birthday that season, by day
//
// How a taste is decided (the wiki's rule: a villager's own tastes override
// the universal ones), first match wins:
//   1. the villager lists the item by name
//   2. the villager lists a group the item is in ("All Fruit"), and doesn't except it
//   3. the universal lists name the item
//   4. the universal lists have a group the item is in
// If nothing matches, the wiki doesn't say, and we return null rather than guess.

import { groupsOf } from './artisanQueries.js';
import { TASTES } from '../extract/villagerExtractor.js';

/** "Warp Totem: Beach" and "Warp Totem Beach" are the same item; so are "Snail" and "snail". */
function normalise(name) {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Crafting page sections that the gift lists treat as groups. */
const CRAFTING_SECTION_GROUPS = {
  Bombs: 'Bombs',
  Fences: 'Fences',
  Sprinklers: 'Sprinklers',
  Fertilizer: 'Fertilizer',
  Decor: 'Floors & Paths',
  Seeds: 'Seeds',
};

/**
 * Every gift group an item is in, from the data we have:
 * item_groups (Fruits, Eggs, Mushrooms, Fruit Tree Fruit...), Category:Vegetables,
 * the fish table, artisan goods, dishes, seeds, and Crafting page sections.
 */
export function giftGroupsOf(db, itemName) {
  const groups = new Set(groupsOf(db, itemName));
  const item = db.prepare('SELECT id, item_type AS type FROM items WHERE name = ? COLLATE NOCASE').get(itemName);
  if (item) {
    if (item.type === 'artisan') groups.add('Artisan Goods');
    if (item.type === 'seed') groups.add('Seeds');
    if (db.prepare('SELECT 1 FROM dishes WHERE item_id = ?').get(item.id)) groups.add('Cooking');
    const crafting = db.prepare('SELECT section FROM crafting_recipes WHERE item_id = ?').get(item.id);
    if (crafting && CRAFTING_SECTION_GROUPS[crafting.section]) groups.add(CRAFTING_SECTION_GROUPS[crafting.section]);
  }
  return [...groups];
}

const TASTE_COLUMNS = `
  t.taste AS taste, t.item_name AS itemName, t.group_name AS groupName, t.exceptions AS exceptions,
  t.note AS note, sp.page_url AS sourceUrl, sp.revision_id AS revisionId`;

function tasteRows(db, villagerId) {
  return db
    .prepare(
      `SELECT ${TASTE_COLUMNS}
       FROM gift_tastes t JOIN source_pages sp ON sp.id = t.source_page_id
       WHERE t.villager_id IS ? ORDER BY t.position`,
    )
    .all(villagerId)
    .map((row) => ({ ...row, exceptions: row.exceptions ? row.exceptions.split(' | ') : [] }));
}

/** Pick the taste for one item from a villager's rows and the universal rows (see the rules at the top). */
function decide(villagerRows, universalRows, itemName, groups) {
  const name = normalise(itemName);
  const groupKeys = groups.map(normalise);
  const byName = (rows) => rows.find((row) => row.itemName && normalise(row.itemName) === name);
  const byGroup = (rows) =>
    rows.find((row) => {
      if (!row.groupName || !groups.includes(row.groupName)) return false;
      const excepted = row.exceptions.map(normalise);
      return !excepted.includes(name) && !excepted.some((exception) => groupKeys.includes(exception));
    });
  const steps = [
    ['villager', () => byName(villagerRows)],
    ['villager group', () => byGroup(villagerRows)],
    ['universal', () => byName(universalRows)],
    ['universal group', () => byGroup(universalRows)],
  ];
  for (const [from, find] of steps) {
    const row = find();
    if (row) {
      return {
        taste: row.taste,
        from,
        because: row.groupName ? row.note : row.itemName,
        note: row.groupName ? null : row.note,
        sourceUrl: row.sourceUrl,
        revisionId: row.revisionId,
      };
    }
  }
  return null;
}

function villagerRow(db, name) {
  return db
    .prepare(
      `SELECT v.id, v.name, v.birthday_season AS birthdaySeason, v.birthday_day AS birthdayDay,
              v.marriageable, sp.page_url AS sourceUrl, sp.revision_id AS revisionId
       FROM villagers v JOIN source_pages sp ON sp.id = v.source_page_id
       WHERE v.name = ? COLLATE NOCASE`,
    )
    .get(name);
}

/** What one villager thinks of one item, or null if the wiki doesn't say. Throws for an unknown villager. */
export function giftTaste(db, villagerName, itemName) {
  const villager = villagerRow(db, villagerName);
  if (!villager) throw new Error(`No villager called "${villagerName}" in the database`);
  return decide(tasteRows(db, villager.id), tasteRows(db, null), itemName, giftGroupsOf(db, itemName));
}

/**
 * How every villager feels about one item.
 * Returns { love: [names], like: [...], neutral: [...], dislike: [...], hate: [...], unknown: [...] }.
 */
export function whoLikes(db, itemName) {
  const universalRows = tasteRows(db, null);
  const groups = giftGroupsOf(db, itemName);
  const result = Object.fromEntries([...TASTES, 'unknown'].map((taste) => [taste, []]));
  for (const { id, name } of db.prepare('SELECT id, name FROM villagers ORDER BY name').all()) {
    const decided = decide(tasteRows(db, id), universalRows, itemName, groups);
    result[decided?.taste ?? 'unknown'].push(name);
  }
  return result;
}

/**
 * One villager with their birthday and their own gift lists, as the wiki
 * writes them (groups not expanded). Returns null for an unknown name.
 */
export function getVillager(db, name) {
  const villager = villagerRow(db, name);
  if (!villager) return null;
  const tastes = Object.fromEntries(TASTES.map((taste) => [taste, []]));
  for (const row of tasteRows(db, villager.id)) tastes[row.taste].push(row.groupName ? row.note : row.itemName);
  return {
    name: villager.name,
    birthday: villager.birthdaySeason ? { season: villager.birthdaySeason, day: villager.birthdayDay } : null,
    marriageable: villager.marriageable === null ? null : villager.marriageable === 1,
    tastes,
    source: { url: villager.sourceUrl, revision: villager.revisionId },
  };
}

/** Every villager's name, A to Z. */
export function getVillagerNames(db) {
  return db.prepare('SELECT name FROM villagers ORDER BY name').all().map((row) => row.name);
}

/** Villagers with a birthday in a season, by day. */
export function getBirthdays(db, season) {
  return db
    .prepare(
      `SELECT name, birthday_season AS season, birthday_day AS day FROM villagers
       WHERE birthday_season = ? COLLATE NOCASE ORDER BY birthday_day`,
    )
    .all(season);
}
