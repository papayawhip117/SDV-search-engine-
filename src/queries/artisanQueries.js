// Artisan goods: what you can make from an item, and how an item is made.
// All prices are calculated here in code, from the wiki's own formulas.
//
//   getProcessingOptions(db, 'Starfruit')  → sell it raw, Wine, Jelly, Dried Fruit...
//   getRecipesFor(db, 'Wine')               → Keg, any fruit, 10000 minutes, 3 × base price

import { MINUTES_PER_DAY } from '../extract/artisanExtractor.js';

/** The value of one product from a recipe, given the input's base price. */
export function productValue(recipe, inputBasePrice) {
  if (recipe.sellPrice !== null) return recipe.sellPrice;
  if (recipe.multiplier === null || inputBasePrice === null || inputBasePrice === undefined) return null;
  return recipe.multiplier * inputBasePrice + (recipe.bonus ?? 0);
}

/** Minutes → game days (the game clock has 1600 minutes per day). */
export function minutesToDays(minutes) {
  return minutes === null ? null : Math.round((minutes / MINUTES_PER_DAY) * 100) / 100;
}

const RECIPE_COLUMNS = `
  r.machine_name     AS machine,
  p.name             AS product,
  r.output_quantity  AS outputQuantity,
  r.input_name       AS inputName,
  r.input_group      AS inputGroup,
  r.input_quantity   AS inputQuantity,
  r.input_exclusions AS inputExclusions,
  r.input_note       AS inputNote,
  r.minutes          AS minutes,
  r.time_note        AS timeNote,
  r.sell_price       AS sellPrice,
  r.price_multiplier AS multiplier,
  r.price_bonus      AS bonus,
  r.price_note       AS priceNote,
  sp.page_title      AS sourceTitle,
  sp.page_url        AS sourceUrl`;

function tidy(row) {
  return { ...row, inputExclusions: row.inputExclusions ? row.inputExclusions.split(' | ') : [], days: minutesToDays(row.minutes) };
}

/** Every way an item is made (Wine: one row; Cheese: Milk and Large Milk). */
export function getRecipesFor(db, productName) {
  return db
    .prepare(
      `SELECT ${RECIPE_COLUMNS}
       FROM artisan_recipes r
       JOIN items p         ON p.id = r.product_item_id
       JOIN source_pages sp ON sp.id = r.source_page_id
       WHERE p.name = ? COLLATE NOCASE
       ORDER BY r.machine_name, r.id`,
    )
    .all(productName)
    .map(tidy);
}

/**
 * The groups an item belongs to, as "Any X" in a recipe means them:
 *   Fruits     from the Fruits page (item_groups)
 *   Vegetables from Category:Vegetables on the item's own page
 *   Fish       every item in the fish table
 */
export function groupsOf(db, name) {
  const groups = db
    .prepare('SELECT group_name AS name FROM item_groups WHERE item_name = ? COLLATE NOCASE')
    .all(name)
    .map((row) => row.name);
  const item = db.prepare('SELECT id, source_page_id FROM items WHERE name = ? COLLATE NOCASE').get(name);
  if (item) {
    const vegetable = db
      .prepare("SELECT 1 FROM page_categories WHERE source_page_id = ? AND category = 'Vegetables'")
      .get(item.source_page_id);
    if (vegetable) groups.push('Vegetables');
    if (db.prepare('SELECT 1 FROM fish WHERE item_id = ?').get(item.id)) groups.push('Fish');
  }
  return groups;
}

/**
 * What an item can be turned into, best value per input item first.
 * Returns null if we know nothing about the item. Otherwise:
 *   { name, basePrice, basePriceSource, groups, options: [...], source }
 * Each option has value (per product), valuePerInput, days, and its wiki source.
 * Options whose value can't be calculated (no base price) have value null.
 * Options marked nearby (Bee House honey) don't use the item up.
 * Values are the wiki's formulas worked out exactly; Juice from a 35g
 * Parsnip gives 78.75, and the wiki doesn't say how the game rounds that.
 */
export function getProcessingOptions(db, name) {
  const item = db
    .prepare(
      `SELECT i.name, i.base_sell_price AS basePrice, sp.page_url AS sourceUrl
       FROM items i JOIN source_pages sp ON sp.id = i.source_page_id
       WHERE i.name = ? COLLATE NOCASE`,
    )
    .get(name);
  const listed = db
    .prepare(
      `SELECT g.item_name AS name, g.base_price AS basePrice, sp.page_url AS sourceUrl
       FROM item_groups g JOIN source_pages sp ON sp.id = g.source_page_id
       WHERE g.item_name = ? COLLATE NOCASE`,
    )
    .get(name);
  if (!item && !listed) return null;

  const exactName = item?.name ?? listed.name;
  // Prefer the item's own page for its price; fall back to the list page.
  const basePrice = item?.basePrice ?? listed?.basePrice ?? null;
  const basePriceSource = item?.basePrice != null ? item.sourceUrl : listed?.sourceUrl ?? null;
  const groups = groupsOf(db, exactName);

  const rows = db
    .prepare(
      `SELECT ${RECIPE_COLUMNS}
       FROM artisan_recipes r
       JOIN items p         ON p.id = r.product_item_id
       JOIN source_pages sp ON sp.id = r.source_page_id
       WHERE r.input_name = :name COLLATE NOCASE
          OR r.input_group IN (SELECT value FROM json_each(:groups))`,
    )
    .all({ name: exactName, groups: JSON.stringify(groups) })
    .map(tidy)
    .filter((recipe) => !recipe.inputExclusions.some((excluded) => excluded.toLowerCase() === exactName.toLowerCase()));

  const options = rows.map((recipe) => {
    const value = productValue(recipe, basePrice);
    // A flower near a Bee House isn't used up, so there's no "per item" value.
    const nearby = recipe.inputQuantity === null;
    return {
      ...recipe,
      nearby,
      value,
      valuePerInput: value === null || nearby ? null : (value * recipe.outputQuantity) / recipe.inputQuantity,
    };
  });
  options.sort((a, b) => (b.valuePerInput ?? -Infinity) - (a.valuePerInput ?? -Infinity) || a.product.localeCompare(b.product));

  return { name: exactName, basePrice, basePriceSource, groups, options };
}
