// The search engine. Everything here reads the local database only.
//
// Relevance: bm25 is the standard scoring formula for full-text search. We
// weight a match in the name 10×, in categories or shops 3×, and in the
// summary 1×, so "corn" ranks Corn above a page that merely mentions corn.
//
// The command line uses it now; the web API, web page and AI assistant will
// call the same two functions later, so they all give the same answers.
//
//   searchItems(db, { text: 'berry', season: 'Summer', type: 'seed', sortBy: 'buy' })
//   getItemDetails(db, 'Blueberry')

import { SEASON_ORDER } from '../calc/profit.js';

export const ITEM_TYPES = ['crop', 'seed'];

// Each sort option maps to a fixed piece of SQL. User input only ever picks
// a key from this list; it's never pasted into the SQL itself.
const SORTS = {
  relevance: { sql: 'relevance', defaultDescending: false }, // bm25 scores: lower = better match
  name: { sql: 'i.name', defaultDescending: false },
  sell: { sql: 'i.base_sell_price', defaultDescending: true },
  buy: { sql: 'buyPrice', defaultDescending: false },
};
export const SORT_OPTIONS = Object.keys(SORTS);

/** Which sort is used when none is chosen, and which way it normally runs. */
export function defaultSortFor(text) {
  return toFtsQuery(text).query ? 'relevance' : 'name';
}
export function sortsDescendingByDefault(sortKey) {
  return SORTS[sortKey]?.defaultDescending ?? false;
}

/**
 * Turn what the user typed into a safe FTS5 query.
 *   'blue berry'       → '"blue" "berry"'    (both must appear)
 *   'Pierre\'s'        → '"Pierre\'s"'
 *   '"; DROP TABLE x'  → '"DROP" "TABLE"'    (punctuation is ignored)
 * Words shorter than 3 letters are skipped, because the trigram index
 * can't search them. Returns { query, ignoredWords }.
 */
export function toFtsQuery(text) {
  const words = (text ?? '').match(/[\p{L}\p{N}']+/gu) ?? [];
  const usable = words.filter((word) => word.length >= 3);
  const ignoredWords = words.filter((word) => word.length < 3);
  const query = usable.map((word) => `"${word.replace(/"/g, '""')}"`).join(' ');
  return { query: query || null, ignoredWords };
}

function normaliseSeason(season) {
  if (!season) return null;
  const match = SEASON_ORDER.find((name) => name.toLowerCase() === String(season).toLowerCase());
  if (!match) throw new Error(`Unknown season "${season}". Choose one of: ${SEASON_ORDER.join(', ')}`);
  return match;
}

// The seasons an item belongs to: a crop's own seasons, or for a seed,
// the seasons of the crop it grows into.
const SEASONS_SQL = `
  SELECT DISTINCT s.id, s.name
  FROM crop_seasons cs JOIN seasons s ON s.id = cs.season_id
  WHERE cs.crop_item_id = :id
     OR cs.crop_item_id IN (SELECT c.item_id FROM crops c WHERE c.seed_item_id = :id)
  ORDER BY s.id`;

/**
 * Search items by text, with optional filters and sorting.
 *
 * @param options.text        words to look for in names, wiki categories and summaries
 * @param options.season      'Spring' | 'Summer' | 'Fall' | 'Winter'
 * @param options.type        'crop' | 'seed'
 * @param options.sortBy      'relevance' (default when searching text) | 'name' | 'sell' | 'buy'
 * @param options.descending  true/false to override the sort's usual direction
 * @param options.limit       maximum number of results (default 50)
 *
 * Returns { results, ignoredWords }. Every result carries its wiki source.
 */
export function searchItems(db, { text, season, type, sortBy, descending, limit = 50 } = {}) {
  const { query, ignoredWords } = toFtsQuery(text);
  const seasonName = normaliseSeason(season);
  if (type && !ITEM_TYPES.includes(type)) {
    throw new Error(`Unknown type "${type}". Choose one of: ${ITEM_TYPES.join(', ')}`);
  }
  const sortKey = sortBy ?? defaultSortFor(text);
  const sort = SORTS[sortKey];
  if (!sort) throw new Error(`Can't sort by "${sortBy}". Choose one of: ${SORT_OPTIONS.join(', ')}`);
  if (sortKey === 'relevance' && !query) throw new Error('Sorting by relevance needs search words');
  if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive whole number');

  const conditions = [];
  const params = { limit };
  if (query) {
    conditions.push('search_index MATCH :query');
    params.query = query;
  }
  if (type) {
    conditions.push('i.item_type = :type');
    params.type = type;
  }
  if (seasonName) {
    conditions.push(`EXISTS (SELECT 1 FROM (${SEASONS_SQL.replace(/:id/g, 'i.id')}) WHERE name = :season)`);
    params.season = seasonName;
  }

  // Each sort has a natural direction (highest sell price first, cheapest buy
  // price first); `descending` overrides it when given.
  const direction = (descending ?? sort.defaultDescending) ? 'DESC' : 'ASC';

  const rows = db
    .prepare(
      `SELECT
         i.id              AS id,
         i.name            AS name,
         i.item_type       AS type,
         i.base_sell_price AS sellPrice,
         (SELECT MIN(p.buy_price) FROM shop_prices p WHERE p.item_id = i.id) AS buyPrice,
         ${query ? 'bm25(search_index, 10.0, 3.0, 3.0, 1.0)' : '0'} AS relevance,
         sp.page_title     AS sourceTitle,
         sp.page_url       AS sourceUrl
       FROM search_index
       JOIN items i         ON i.id = search_index.item_id
       JOIN source_pages sp ON sp.id = i.source_page_id
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY ${sort.sql} IS NULL, ${sort.sql} ${direction}, i.name
       LIMIT :limit`,
    )
    .all(params);

  const seasonsOf = db.prepare(SEASONS_SQL);
  const results = rows.map(({ id, relevance, ...row }) => ({
    ...row,
    seasons: seasonsOf.all({ id }).map((season) => season.name),
  }));
  return { results, ignoredWords };
}

/**
 * Everything connected to one item, found by its exact name (any letter case).
 * Returns null if there's no such item.
 */
export function getItemDetails(db, name) {
  const item = db
    .prepare(
      `SELECT i.id, i.name, i.item_type AS type, i.base_sell_price AS sellPrice, i.sell_price_note AS sellPriceNote,
              sp.id AS sourcePageId, sp.page_title AS title, sp.page_url AS url, sp.revision_id AS revision,
              sp.revision_time AS revisionTime, sp.retrieved_at AS retrievedAt,
              si.summary AS summary
       FROM items i
       JOIN source_pages sp ON sp.id = i.source_page_id
       LEFT JOIN search_index si ON si.item_id = i.id
       WHERE i.name = ? COLLATE NOCASE`,
    )
    .get(name);
  if (!item) return null;

  const categories = db
    .prepare('SELECT category FROM page_categories WHERE source_page_id = ? ORDER BY category')
    .all(item.sourcePageId)
    .map((row) => row.category);

  const shopPrices = (itemId) =>
    db
      .prepare(
        `SELECT sh.name AS shop, p.buy_price AS price, p.availability_note AS note, src.page_url AS sourceUrl
         FROM shop_prices p JOIN shops sh ON sh.id = p.shop_id JOIN source_pages src ON src.id = p.source_page_id
         WHERE p.item_id = ? ORDER BY p.buy_price, sh.name`,
      )
      .all(itemId);

  // If this item is a crop: how it grows, and the seed it grows from.
  const cropRow = db
    .prepare(
      `SELECT c.growth_days AS growthDays, c.growth_note AS growthNote, c.regrows, c.regrowth_days AS regrowthDays,
              c.is_trellis AS isTrellis, seed.id AS seedId, seed.name AS seedName
       FROM crops c LEFT JOIN items seed ON seed.id = c.seed_item_id
       WHERE c.item_id = ?`,
    )
    .get(item.id);

  let crop = null;
  if (cropRow) {
    const { seedId, seedName, ...growth } = cropRow;
    crop = {
      ...growth,
      regrows: growth.regrows === null ? null : growth.regrows === 1,
      isTrellis: growth.isTrellis === null ? null : growth.isTrellis === 1,
      stageDays: db
        .prepare('SELECT days FROM crop_growth_stages WHERE crop_item_id = ? ORDER BY stage_number')
        .all(item.id)
        .map((row) => row.days),
      seed: seedId === null ? null : { name: seedName, prices: shopPrices(seedId) },
    };
  }

  // If this item is a seed (Coffee Bean is both): the crops it grows into.
  const growsInto = db
    .prepare('SELECT i.name FROM crops c JOIN items i ON i.id = c.item_id WHERE c.seed_item_id = ? AND c.item_id != ? ORDER BY i.name')
    .all(item.id, item.id)
    .map((row) => row.name);

  return {
    name: item.name,
    type: item.type,
    summary: item.summary || null,
    sellPrice: item.sellPrice,
    sellPriceNote: item.sellPriceNote,
    buyPrices: shopPrices(item.id),
    seasons: db.prepare(SEASONS_SQL).all({ id: item.id }).map((row) => row.name),
    categories,
    crop,
    growsInto,
    source: { title: item.title, url: item.url, revision: item.revision, revisionTime: item.revisionTime, retrievedAt: item.retrievedAt },
  };
}
