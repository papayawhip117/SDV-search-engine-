// Opening the database and saving crops and seeds into it.
//
// We use better-sqlite3. "Synchronous" means each database call finishes
// before the next line runs, so there's no `await` here. That keeps the
// code simple, and SQLite on a local file is fast enough for this.

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { pageUrl } from '../wiki/apiClient.js';

const SCHEMA_SQL = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/**
 * Open (or create) a database file and make sure all tables exist.
 * Pass ':memory:' for a temporary in-memory database (used by the tests).
 */
export function openDatabase(filePath) {
  const db = new Database(filePath);
  db.exec(SCHEMA_SQL);
  return db;
}

/** SQLite has no true/false, so we store 1/0, and NULL for "unknown". */
function toSqlBoolean(value) {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Save the wiki page a fact came from, plus its categories, and return its id.
 * If we already have this exact revision, only the download date is updated.
 * Call it inside a transaction (saveCrop and saveSeed do).
 */
export function saveSourcePage(db, page, retrievedAt) {
  const revision = page.revisions[0];
  const { id: sourcePageId } = db
    .prepare(
      `INSERT INTO source_pages
         (page_title, page_url, wiki_page_id, revision_id, revision_time, retrieved_at, category, raw_wikitext)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (page_title, revision_id) DO UPDATE SET retrieved_at = excluded.retrieved_at
       RETURNING id`,
    )
    .get(
      page.title,
      pageUrl(page.title),
      page.pageid ?? null,
      revision.revid,
      revision.timestamp ?? null,
      retrievedAt,
      page.foundInCategory ?? null,
      revision.slots.main.content,
    );

  // The wiki's own category labels for this page.
  const insertCategory = db.prepare('INSERT OR IGNORE INTO page_categories (source_page_id, category) VALUES (?, ?)');
  for (const category of page.categories ?? []) {
    insertCategory.run(sourcePageId, category.title.replace(/^Category:/, ''));
  }
  return sourcePageId;
}

/**
 * Save one crop and its source page.
 *
 * @param db         an open database
 * @param page       the raw API page object (title, pageid, revisions, categories...)
 * @param crop       the result of extractCrop(page).crop
 * @param retrievedAt  ISO date string of when the page was downloaded
 *
 * Everything happens in one "transaction": either every row is saved, or
 * (if anything fails) none of them are, so the database is never half-updated.
 */
export function saveCrop(db, page, crop, retrievedAt) {
  const save = db.transaction(() => {
    // 1-2. The source page and its categories.
    const sourcePageId = saveSourcePage(db, page, retrievedAt);

    // 3. The harvested crop as an item. Newer data replaces older data.
    const { id: cropItemId } = db
      .prepare(
        `INSERT INTO items (name, item_type, base_sell_price, source_page_id)
         VALUES (?, 'crop', ?, ?)
         ON CONFLICT (name) DO UPDATE SET
           item_type = 'crop', base_sell_price = excluded.base_sell_price, source_page_id = excluded.source_page_id
         RETURNING id`,
      )
      .get(crop.name, crop.sellPrice, sourcePageId);

    // 4. The seed as an item. We only know its name so far (its price is on
    //    another page), so we never overwrite a seed that's already there.
    //    Some crops are their own seed (you plant a Coffee Bean), in which case
    //    seed_item_id simply points at the crop's own item.
    let seedItemId = null;
    if (crop.seedName) {
      db.prepare(
        `INSERT INTO items (name, item_type, base_sell_price, source_page_id)
         VALUES (?, 'seed', NULL, ?)
         ON CONFLICT (name) DO NOTHING`,
      ).run(crop.seedName, sourcePageId);
      seedItemId = db.prepare('SELECT id FROM items WHERE name = ?').get(crop.seedName).id;
    }

    // 5. Crop facts. "INSERT OR REPLACE" swaps out any older row for this crop.
    db.prepare(
      `INSERT OR REPLACE INTO crops
         (item_id, seed_item_id, growth_days, growth_note, regrows, regrowth_days, harvest_yield, is_trellis, source_page_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).run(
      cropItemId,
      seedItemId,
      crop.growthDays,
      crop.growthNote ?? null,
      toSqlBoolean(crop.regrows),
      crop.regrowthDays,
      toSqlBoolean(crop.isTrellis),
      sourcePageId,
    );

    // 6. Seasons and stages: clear the old rows, then insert the current ones.
    db.prepare('DELETE FROM crop_seasons WHERE crop_item_id = ?').run(cropItemId);
    const insertSeason = db.prepare(
      'INSERT INTO crop_seasons (crop_item_id, season_id) SELECT ?, id FROM seasons WHERE name = ?',
    );
    for (const season of crop.seasons) insertSeason.run(cropItemId, season);

    db.prepare('DELETE FROM crop_growth_stages WHERE crop_item_id = ?').run(cropItemId);
    const insertStage = db.prepare(
      'INSERT INTO crop_growth_stages (crop_item_id, stage_number, days) VALUES (?, ?, ?)',
    );
    crop.stageDays.forEach((days, index) => insertStage.run(cropItemId, index + 1, days));

    return cropItemId;
  });

  return save();
}

/**
 * Save a seed's own page, sell price and shop prices.
 *
 * @param seed  the result of extractSeed(page).seed
 *
 * A few items are both a crop and a seed (you plant a Coffee Bean). Those
 * stay a 'crop' item; we only add their shop prices.
 */
export function saveSeed(db, page, seed, retrievedAt) {
  const save = db.transaction(() => {
    const sourcePageId = saveSourcePage(db, page, retrievedAt);

    const existing = db.prepare('SELECT id, item_type FROM items WHERE name = ?').get(seed.name);
    let seedItemId;
    if (existing?.item_type === 'crop') {
      seedItemId = existing.id;
    } else {
      // The seed's own page is a better source than the crop page that
      // first mentioned it, so it replaces that source here.
      seedItemId = db
        .prepare(
          `INSERT INTO items (name, item_type, base_sell_price, sell_price_note, source_page_id)
           VALUES (?, 'seed', ?, ?, ?)
           ON CONFLICT (name) DO UPDATE SET
             base_sell_price = excluded.base_sell_price,
             sell_price_note = excluded.sell_price_note,
             source_page_id = excluded.source_page_id
           RETURNING id`,
        )
        .get(seed.name, seed.sellPrice, seed.sellPriceNote ?? null, sourcePageId).id;
    }

    // Replace this seed's shop prices with the ones on the current page.
    db.prepare('DELETE FROM shop_prices WHERE item_id = ?').run(seedItemId);
    const insertShop = db.prepare('INSERT OR IGNORE INTO shops (name) VALUES (?)');
    const findShop = db.prepare('SELECT id FROM shops WHERE name = ?');
    const insertPrice = db.prepare(
      `INSERT INTO shop_prices (shop_id, item_id, buy_price, availability_note, source_page_id)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const { shop, price, note } of seed.prices) {
      insertShop.run(shop);
      insertPrice.run(findShop.get(shop).id, seedItemId, price, note, sourcePageId);
    }
    return seedItemId;
  });

  return save();
}
