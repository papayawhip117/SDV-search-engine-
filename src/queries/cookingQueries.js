// Cooking: what's in a dish, and what you can cook with an item.
//
//   getDishIngredients(db, 'Pizza')      → Wheat Flour ×1, Tomato ×1, Cheese ×1 (with prices we know)
//   getDishesUsing(db, 'Tomato')         → Pizza, Spaghetti, Bruschetta...
//   getDishes(db, { buff: 'fishing' })   → dishes that give a Fishing buff

import { groupsOf } from './artisanQueries.js';

/**
 * A dish's ingredients in the wiki's order. Each one says whether it's an
 * item we have (with its sell price and source) or not yet.
 */
export function getDishIngredients(db, dishName) {
  return db
    .prepare(
      `SELECT di.ingredient_name AS name, di.ingredient_group AS "group", di.quantity,
              i.base_sell_price AS sellPrice, sp.page_url AS sourceUrl
       FROM dish_ingredients di
       JOIN items d ON d.id = di.dish_item_id
       LEFT JOIN items i ON i.name = di.ingredient_name
       LEFT JOIN source_pages sp ON sp.id = i.source_page_id
       WHERE d.name = ? COLLATE NOCASE
       ORDER BY di.position`,
    )
    .all(dishName)
    .map((row) => ({ ...row, known: row.sourceUrl !== null }));
}

/**
 * What the ingredients would sell for raw, when we know every price.
 * Returns null if any ingredient's price is unknown or it's "any fish".
 */
export function ingredientsValue(ingredients) {
  let total = 0;
  for (const ingredient of ingredients) {
    if (ingredient.sellPrice === null || ingredient.sellPrice === undefined) return null;
    total += ingredient.sellPrice * ingredient.quantity;
  }
  return total;
}

const DISH_COLUMNS = `
  d.name            AS name,
  d.base_sell_price AS sellPrice,
  x.edibility       AS edibility,
  x.buffs           AS buffs,
  x.buff_duration   AS buffDuration,
  x.recipe_source   AS recipeSource,
  sp.page_url       AS sourceUrl`;

function withIngredients(db, rows) {
  return rows.map((row) => {
    const ingredients = getDishIngredients(db, row.name);
    return { ...row, ingredients, ingredientsValue: ingredientsValue(ingredients) };
  });
}

/** Dishes that use an item, by name or through a group ("Any Fish"). Highest sell price first. */
export function getDishesUsing(db, itemName) {
  const groups = groupsOf(db, itemName);
  const rows = db
    .prepare(
      `SELECT DISTINCT ${DISH_COLUMNS}
       FROM dish_ingredients di
       JOIN items d         ON d.id = di.dish_item_id
       JOIN dishes x        ON x.item_id = d.id
       JOIN source_pages sp ON sp.id = x.source_page_id
       WHERE di.ingredient_name = :name COLLATE NOCASE
          OR di.ingredient_group IN (SELECT value FROM json_each(:groups))
       ORDER BY d.base_sell_price DESC, d.name`,
    )
    .all({ name: itemName, groups: JSON.stringify(groups) });
  return withIngredients(db, rows);
}

/**
 * All dishes, optionally only those whose buffs mention a word ("fishing", "luck").
 * Highest sell price first.
 */
export function getDishes(db, { buff } = {}) {
  const rows = db
    .prepare(
      `SELECT ${DISH_COLUMNS}
       FROM dishes x
       JOIN items d         ON d.id = x.item_id
       JOIN source_pages sp ON sp.id = x.source_page_id
       ${buff ? "WHERE x.buffs LIKE '%' || :buff || '%'" : ''}
       ORDER BY d.base_sell_price DESC, d.name`,
    )
    .all(buff ? { buff } : {});
  return withIngredients(db, rows);
}
