// Reusable database searches. The command line uses these now; the web
// app and the AI assistant will use the same functions later, so every
// part of the app gets the same answers.

// Only these columns may be used for sorting. Building SQL from a fixed
// list (never from raw user input) prevents "SQL injection", where someone
// sneaks their own SQL commands into a query.
const SORT_COLUMNS = {
  sell_price: 'i.base_sell_price',
  growth_days: 'c.growth_days',
  name: 'i.name',
};

const fromSqlBoolean = (value) => (value === null ? null : value === 1);

/**
 * Crops that grow in a season, each with its wiki source.
 *   getCropsBySeason(db, 'Summer', { sortBy: 'sell_price', descending: true })
 */
export function getCropsBySeason(db, season, { sortBy = 'sell_price', descending = true } = {}) {
  const sortColumn = SORT_COLUMNS[sortBy];
  if (!sortColumn) {
    throw new Error(`Can't sort by "${sortBy}". Choose one of: ${Object.keys(SORT_COLUMNS).join(', ')}`);
  }
  const direction = descending ? 'DESC' : 'ASC';

  return db
    .prepare(
      `SELECT
         i.name             AS name,
         i.base_sell_price  AS sellPrice,
         c.growth_days      AS growthDays,
         c.growth_note      AS growthNote,
         c.is_trellis       AS isTrellis,
         c.regrows          AS regrows,
         c.regrowth_days    AS regrowthDays,
         seed.name          AS seedName,
         sp.page_title      AS sourceTitle,
         sp.page_url        AS sourceUrl,
         sp.revision_id     AS sourceRevision,
         sp.retrieved_at    AS retrievedAt
       FROM crops c
       JOIN items i          ON i.id = c.item_id
       JOIN crop_seasons cs  ON cs.crop_item_id = c.item_id
       JOIN seasons s        ON s.id = cs.season_id
       JOIN source_pages sp  ON sp.id = c.source_page_id
       LEFT JOIN items seed  ON seed.id = c.seed_item_id
       WHERE s.name = ? COLLATE NOCASE
       ORDER BY ${sortColumn} IS NULL, ${sortColumn} ${direction}, i.name`,
    )
    .all(season)
    .map((row) => ({ ...row, regrows: fromSqlBoolean(row.regrows), isTrellis: fromSqlBoolean(row.isTrellis) }));
}
